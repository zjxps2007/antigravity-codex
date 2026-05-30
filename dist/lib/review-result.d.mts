import type { ReviewGateFinding } from "./review-gate-events.mjs";
import type { Job } from "./state.mjs";
export interface ReviewResultPayload {
    verdict?: string;
    summary?: string;
    findings?: ReviewGateFinding[];
    nextSteps?: string[];
}
export declare function parseReviewResultPayload(value: unknown): ReviewResultPayload | null;
export declare function readReviewResultForJob(job: Job): ReviewResultPayload | null;
