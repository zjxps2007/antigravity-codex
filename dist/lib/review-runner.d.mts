import { type ReviewGatePayload } from "./review-parser.mjs";
export declare const REVIEW_SCHEMA: string;
export interface ReviewRunResult {
    payload: ReviewGatePayload | null;
    stdout: string;
    stderr: string;
    status: number | null;
    timedOut: boolean;
    timeoutMs: number;
}
export declare function runCodexReview(cwd: string): ReviewRunResult;
