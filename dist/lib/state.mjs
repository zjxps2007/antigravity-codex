import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const STATE_VERSION = 1;
const MAX_JOBS = 100;
export function nowIso() {
    return new Date().toISOString();
}
export function dataRoot() {
    return (process.env.AGY_CODEX_DATA ||
        process.env.ANTIGRAVITY_CODEX_DATA ||
        path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-codex"));
}
const workspaceRootCache = new Map();
export function resolveWorkspaceRoot(cwd = process.cwd()) {
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
function workspaceKey(workspaceRoot) {
    return createHash("sha256").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 16);
}
function resolveWorkspacePaths(cwd = process.cwd()) {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const stateDir = path.join(dataRoot(), "workspaces", workspaceKey(workspaceRoot));
    return {
        workspaceRoot,
        stateDir,
        jobsDir: path.join(stateDir, "jobs"),
        stateFile: path.join(stateDir, "state.json")
    };
}
export function workspaceStateDir(cwd = process.cwd()) {
    return resolveWorkspacePaths(cwd).stateDir;
}
function defaultState(workspaceRoot) {
    return {
        version: STATE_VERSION,
        workspaceRoot,
        config: {
            reviewGateEnabled: false
        },
        jobs: []
    };
}
function ensureWorkspacePaths(cwd = process.cwd()) {
    const paths = resolveWorkspacePaths(cwd);
    fs.mkdirSync(paths.jobsDir, { recursive: true });
    return paths;
}
export function ensureStateDir(cwd = process.cwd()) {
    ensureWorkspacePaths(cwd);
}
function readStateFromPaths(paths) {
    if (!fs.existsSync(paths.stateFile)) {
        return defaultState(paths.workspaceRoot);
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(paths.stateFile, "utf8"));
        return {
            ...defaultState(paths.workspaceRoot),
            ...parsed,
            config: {
                ...defaultState(paths.workspaceRoot).config,
                ...(typeof parsed.config === "object" && parsed.config ? parsed.config : {})
            },
            jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
        };
    }
    catch {
        return defaultState(paths.workspaceRoot);
    }
}
export function readState(cwd = process.cwd()) {
    return readStateFromPaths(ensureWorkspacePaths(cwd));
}
function cleanupOrphanedJobs(paths, activeJobIds) {
    try {
        if (!fs.existsSync(paths.jobsDir))
            return;
        const entries = fs.readdirSync(paths.jobsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && !activeJobIds.has(entry.name)) {
                const dirPath = path.join(paths.jobsDir, entry.name);
                fs.rmSync(dirPath, { recursive: true, force: true });
            }
        }
    }
    catch {
        // Best effort cleanup.
    }
}
function writeStateToPaths(paths, state) {
    const next = {
        ...state,
        version: STATE_VERSION,
        config: {
            ...defaultState(paths.workspaceRoot).config,
            ...(state.config ?? {})
        },
        jobs: [...state.jobs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_JOBS)
    };
    const tmpFile = `${paths.stateFile}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmpFile, paths.stateFile);
    const activeJobIds = new Set(next.jobs.map((job) => job.id));
    cleanupOrphanedJobs(paths, activeJobIds);
    return next;
}
export function writeState(cwd, state) {
    return writeStateToPaths(ensureWorkspacePaths(cwd), state);
}
export function readConfig(cwd = process.cwd()) {
    return readState(cwd).config;
}
export function isReviewGateEnabled(cwd = process.cwd()) {
    return readConfig(cwd).reviewGateEnabled;
}
export function setReviewGateEnabled(cwd, enabled) {
    const state = readState(cwd);
    return writeState(cwd, {
        ...state,
        config: {
            ...state.config,
            reviewGateEnabled: enabled
        }
    });
}
export function generateJobId(prefix = "job") {
    return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
export function jobDir(cwd, jobId) {
    return path.join(resolveWorkspacePaths(cwd).jobsDir, jobId);
}
export function writeJobArtifact(cwd, jobId, name, value) {
    const dir = jobDir(cwd, jobId);
    fs.mkdirSync(dir, { recursive: true });
    const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const text = content ?? "";
    fs.writeFileSync(path.join(dir, name), text.endsWith("\n") ? text : `${text}\n`);
}
export function readJobArtifact(cwd, jobId, name) {
    const file = path.join(jobDir(cwd, jobId), name);
    if (!fs.existsSync(file)) {
        return null;
    }
    return fs.readFileSync(file, "utf8");
}
export function upsertJob(cwd, patch) {
    const paths = ensureWorkspacePaths(cwd);
    const state = readStateFromPaths(paths);
    const existing = state.jobs.find((job) => job.id === patch.id);
    const now = nowIso();
    const nextJob = {
        ...(existing ?? {}),
        ...patch,
        updatedAt: now,
        createdAt: existing?.createdAt ?? patch.createdAt ?? now
    };
    state.jobs = [nextJob, ...state.jobs.filter((job) => job.id !== patch.id)];
    writeStateToPaths(paths, state);
    return nextJob;
}
export function listJobs(cwd = process.cwd()) {
    return readState(cwd).jobs;
}
export function findJob(cwd, reference = "") {
    const jobs = listJobs(cwd);
    if (!reference) {
        return jobs[0] ?? null;
    }
    return jobs.find((job) => job.id === reference || job.id.startsWith(reference)) ?? null;
}
export function findLatestResultJob(cwd, reference = "") {
    if (reference) {
        return findJob(cwd, reference);
    }
    return listJobs(cwd).find((job) => ["completed", "failed", "cancelled"].includes(job.status ?? "")) ?? null;
}
export function clearJobs(cwd = process.cwd()) {
    const paths = ensureWorkspacePaths(cwd);
    const state = readStateFromPaths(paths);
    state.jobs = [];
    writeStateToPaths(paths, state);
}
