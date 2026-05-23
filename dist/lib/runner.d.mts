import { type CodexRequest, type Job } from "./state.mjs";
export interface ExecutionOptions {
    stream?: boolean;
    background?: boolean;
}
export interface ProcessResult {
    code: number;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    logFile: string;
}
export interface JobIdentity {
    id: string;
    logFile?: string;
}
export declare function createLogFile(cwd: string, jobId: string): string;
export declare function killProcessTree(pid: number | null | undefined): void;
export declare function printQueued(job: Job, asJson?: boolean): void;
export declare function runProcess(request: CodexRequest, job: JobIdentity, { stream }?: ExecutionOptions): Promise<ProcessResult>;
export declare function executeTrackedRequest(request: CodexRequest, job: JobIdentity, options?: ExecutionOptions): Promise<ProcessResult>;
export declare function queueBackground(request: CodexRequest, scriptPath: string): Job;
export declare function runForeground(request: CodexRequest): Promise<void>;
export declare function runMaybeBackground(request: CodexRequest, options: Record<string, string | boolean | undefined>, scriptPath: string): Promise<void>;
