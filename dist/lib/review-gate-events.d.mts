export interface ReviewGateFinding {
    severity?: string;
    title?: string;
    file?: string | null;
    line?: number | null;
    description?: string;
    recommendation?: string;
}
export interface ReviewGateEvent {
    id: string;
    time: string;
    type: "started" | "skipped" | "codex-result" | "decision" | "error";
    workspace?: string;
    message?: string;
    decision?: "allow" | "continue";
    verdict?: string;
    summary?: string;
    findings?: ReviewGateFinding[];
    nextSteps?: string[];
    status?: number | null;
    stdout?: string;
    stderr?: string;
    reason?: string;
    durationMs?: number;
    payload?: unknown;
}
export interface MonitorState {
    pid: number;
    host: string;
    port: number;
    url: string;
    startedAt: string;
}
export declare function nowIso(): string;
export declare function createReviewGateRunId(): string;
export declare function dataRoot(): string;
export declare function reviewGateDir(): string;
export declare function reviewGateEventsFile(): string;
export declare function monitorStateFile(): string;
export declare function appendReviewGateEvent(event: ReviewGateEvent): void;
export declare function readReviewGateEvents(limit?: number, workspaceRoot?: string): ReviewGateEvent[];
export declare function clearReviewGateEvents(workspaceRoot?: string): void;
export declare function readMonitorState(): MonitorState | null;
export declare function writeMonitorState(state: MonitorState): void;
export declare function clearMonitorState(): void;
