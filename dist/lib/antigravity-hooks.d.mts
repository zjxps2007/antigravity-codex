export declare const REVIEW_GATE_HOOK_NAME = "codex-stop-review-gate";
export declare const REVIEW_GATE_HOOK_TIMEOUT_SECONDS = 300;
export declare const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
export declare const NPX_REVIEW_GATE_COMMAND = "npx -y --package github:zjxps2007/antigravity-codex agy-codex-review-gate";
export interface ActiveReviewGateHookInfo {
    configDir: string;
    hooksFile: string;
    hooksFileExists: boolean;
    installed: boolean;
    enabled: boolean | null;
    command: string | null;
    timeout: number | null;
    error: string | null;
}
export interface ImportedReviewGateHookInfo {
    hooksFile: string;
    exists: boolean;
    installed: boolean;
    enabled: boolean | null;
    disabled: boolean;
    command: string | null;
    timeout: number | null;
    error: string | null;
}
export declare function antigravityConfigDir(): string;
export declare function antigravityHooksFile(): string;
export declare function antigravityCliRoot(): string;
export declare function findLocalReviewGateHookScript(rootDir: string): string | null;
export declare function buildActiveReviewGateHookCommand(rootDir: string): string;
export declare function inspectActiveReviewGateHook(): ActiveReviewGateHookInfo;
export declare function inspectImportedReviewGateHooks(): ImportedReviewGateHookInfo[];
export declare function installImportedReviewGateHooks(rootDir: string): ImportedReviewGateHookInfo[];
export declare function installActiveReviewGateHook(rootDir: string): ActiveReviewGateHookInfo;
export declare function disableImportedReviewGateHooks(): ImportedReviewGateHookInfo[];
export declare function removeActiveReviewGateHook(): ActiveReviewGateHookInfo;
