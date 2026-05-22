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
export declare function nowIso(): string;
export declare function dataRoot(): string;
export declare function resolveWorkspaceRoot(cwd?: string): string;
export declare function workspaceStateDir(cwd?: string): string;
export declare function ensureStateDir(cwd?: string): void;
export declare function readState(cwd?: string): CodexState;
export declare function writeState(cwd: string, state: CodexState): CodexState;
export declare function generateJobId(prefix?: string): string;
export declare function jobDir(cwd: string, jobId: string): string;
export declare function writeJobArtifact(cwd: string, jobId: string, name: string, value: unknown): void;
export declare function readJobArtifact(cwd: string, jobId: string, name: string): string | null;
export declare function upsertJob(cwd: string, patch: Partial<Job> & {
    id: string;
}): Job;
export declare function listJobs(cwd?: string): Job[];
export declare function findJob(cwd: string, reference?: string): Job | null;
export declare function findLatestResultJob(cwd: string, reference?: string): Job | null;
