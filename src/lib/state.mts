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

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  const resolved = path.resolve(cwd);
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: resolved,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return resolved;
}

function workspaceKey(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 16);
}

export function workspaceStateDir(cwd = process.cwd()): string {
  const root = resolveWorkspaceRoot(cwd);
  return path.join(dataRoot(), "workspaces", workspaceKey(root));
}

function stateFile(cwd = process.cwd()): string {
  return path.join(workspaceStateDir(cwd), "state.json");
}

function defaultState(cwd = process.cwd()): CodexState {
  return {
    version: STATE_VERSION,
    workspaceRoot: resolveWorkspaceRoot(cwd),
    jobs: []
  };
}

export function ensureStateDir(cwd = process.cwd()): void {
  fs.mkdirSync(path.join(workspaceStateDir(cwd), "jobs"), { recursive: true });
}

export function readState(cwd = process.cwd()): CodexState {
  ensureStateDir(cwd);
  const file = stateFile(cwd);
  if (!fs.existsSync(file)) {
    return defaultState(cwd);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CodexState>;
    return {
      ...defaultState(cwd),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState(cwd);
  }
}

export function writeState(cwd: string, state: CodexState): CodexState {
  ensureStateDir(cwd);
  const next: CodexState = {
    ...state,
    version: STATE_VERSION,
    jobs: [...state.jobs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_JOBS)
  };
  const file = stateFile(cwd);
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmpFile, file);
  return next;
}

export function generateJobId(prefix = "job"): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function jobDir(cwd: string, jobId: string): string {
  return path.join(workspaceStateDir(cwd), "jobs", jobId);
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
  const state = readState(cwd);
  const existing = state.jobs.find((job) => job.id === patch.id);
  const now = nowIso();
  const nextJob: Job = {
    ...(existing ?? {}),
    ...patch,
    updatedAt: now,
    createdAt: existing?.createdAt ?? patch.createdAt ?? now
  };
  state.jobs = [nextJob, ...state.jobs.filter((job) => job.id !== patch.id)];
  writeState(cwd, state);
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

