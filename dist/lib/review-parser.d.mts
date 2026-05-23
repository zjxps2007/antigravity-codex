export interface ReviewFinding {
    severity?: string;
    title?: string;
    file?: string | null;
    line?: number | null;
    description?: string;
    recommendation?: string;
}
export interface ReviewGatePayload {
    verdict?: string;
    summary?: string;
    findings?: ReviewFinding[];
    next_steps?: string[];
}
export declare function parseReviewPayload(text: string): ReviewGatePayload | null;
export declare function formatReason(payload: ReviewGatePayload, rawFallback: string): string;
