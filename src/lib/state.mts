import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const MAX_JOBS = 100;

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobKind = "review" | "adversarial-review" | "task";

export interface CodexRequest {
  cwd: string;
  command: string;
  args: string[];
  title: string;
  kind: JobKind;
  summary: string;
  write?: boolean;
}

export interface Job {
  id: string;
  kind?: JobKind;
  title?: string;
  summary?: string;
  status?: JobStatus;
  phase?: string;
  pid?: number | null;
  request?: CodexRequest;
  write?: boolean;
  logFile?: string;
  exitCode?: number;
  signal?: NodeJS.Signals | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface CodexState {
  version: number;
  workspaceRoot: string;
  jobs: Job[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dataRoot(): string {
  return (
    process.env.AGY_CODEX_DATA ||
    process.env.ANTIGRAVITY_CODEX_DATA ||
    path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-codex")
  );
}

const workspaceRootCache = new Map<string, string>();

interface WorkspacePaths {
  workspaceRoot: string;
  stateDir: string;
  jobsDir: string;
  stateFile: string;
}

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  const resolved = path.resolve(cwd);
  const cached = workspaceRootCache.get(resolved);
  if (cached) {
    return cached;
  }
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: resolved,
    encoding: "utf8",
    windowsHide: true
  });
  let workspaceRoot = resolved;
  if (result.status === 0 && result.stdout.trim()) {
    workspaceRoot = path.resolve(result.stdout.trim());
  }
  workspaceRootCache.set(resolved, workspaceRoot);
  return workspaceRoot;
}

function workspaceKey(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 16);
}

function resolveWorkspacePaths(cwd = process.cwd()): WorkspacePaths {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = path.join(dataRoot(), "workspaces", workspaceKey(workspaceRoot));
  return {
    workspaceRoot,
    stateDir,
    jobsDir: path.join(stateDir, "jobs"),
    stateFile: path.join(stateDir, "state.json")
  };
}

export function workspaceStateDir(cwd = process.cwd()): string {
  return resolveWorkspacePaths(cwd).stateDir;
}

function defaultState(workspaceRoot: string): CodexState {
  return {
    version: STATE_VERSION,
    workspaceRoot,
    jobs: []
  };
}

function ensureWorkspacePaths(cwd = process.cwd()): WorkspacePaths {
  const paths = resolveWorkspacePaths(cwd);
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  return paths;
}

export function ensureStateDir(cwd = process.cwd()): void {
  ensureWorkspacePaths(cwd);
}

function readStateFromPaths(paths: WorkspacePaths): CodexState {
  if (!fs.existsSync(paths.stateFile)) {
    return defaultState(paths.workspaceRoot);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.stateFile, "utf8")) as Partial<CodexState>;
    return {
      ...defaultState(paths.workspaceRoot),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState(paths.workspaceRoot);
  }
}

export function readState(cwd = process.cwd()): CodexState {
  return readStateFromPaths(ensureWorkspacePaths(cwd));
}

function writeStateToPaths(paths: WorkspacePaths, state: CodexState): CodexState {
  const next: CodexState = {
    ...state,
    version: STATE_VERSION,
    jobs: [...state.jobs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_JOBS)
  };
  const tmpFile = `${paths.stateFile}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmpFile, paths.stateFile);
  return next;
}

export function writeState(cwd: string, state: CodexState): CodexState {
  return writeStateToPaths(ensureWorkspacePaths(cwd), state);
}

export function generateJobId(prefix = "job"): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function jobDir(cwd: string, jobId: string): string {
  return path.join(resolveWorkspacePaths(cwd).jobsDir, jobId);
}

export function writeJobArtifact(cwd: string, jobId: string, name: string, value: unknown): void {
  const dir = jobDir(cwd, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const text = content ?? "";
  fs.writeFileSync(path.join(dir, name), text.endsWith("\n") ? text : `${text}\n`);
}

export function readJobArtifact(cwd: string, jobId: string, name: string): string | null {
  const file = path.join(jobDir(cwd, jobId), name);
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, "utf8");
}

export function upsertJob(cwd: string, patch: Partial<Job> & { id: string }): Job {
  const paths = ensureWorkspacePaths(cwd);
  const state = readStateFromPaths(paths);
  const existing = state.jobs.find((job) => job.id === patch.id);
  const now = nowIso();
  const nextJob: Job = {
    ...(existing ?? {}),
    ...patch,
    updatedAt: now,
    createdAt: existing?.createdAt ?? patch.createdAt ?? now
  };
  state.jobs = [nextJob, ...state.jobs.filter((job) => job.id !== patch.id)];
  writeStateToPaths(paths, state);
  return nextJob;
}

export function listJobs(cwd = process.cwd()): Job[] {
  return readState(cwd).jobs;
}

export function findJob(cwd: string, reference = ""): Job | null {
  const jobs = listJobs(cwd);
  if (!reference) {
    return jobs[0] ?? null;
  }
  return jobs.find((job) => job.id === reference || job.id.startsWith(reference)) ?? null;
}

export function findLatestResultJob(cwd: string, reference = ""): Job | null {
  if (reference) {
    return findJob(cwd, reference);
  }
  return listJobs(cwd).find((job) => ["completed", "failed", "cancelled"].includes(job.status ?? "")) ?? null;
}
