import { type ActiveReviewGateHookInfo, type ImportedReviewGateHookInfo } from "./antigravity-hooks.mjs";
import { type CommandAvailability } from "./exec-resolver.mjs";
import { type ReviewGateEvent } from "./review-gate-events.mjs";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";
export interface DoctorCheck {
    name: string;
    status: DoctorCheckStatus;
    message: string;
}
export interface GitDoctorInfo {
    isRepo: boolean;
    root: string | null;
    hasChanges: boolean;
    status: number | null;
    error: string | null;
}
export interface AntigravityDoctorInfo {
    cliRoot: string;
    importManifestFile: string;
    importManifestExists: boolean;
    importSource: string | null;
    importComponents: string[];
    installedPluginDir: string;
    installedHooksFile: string;
    installedHooksFileExists: boolean;
    installedHookCommand: string | null;
    installedHookEnabled: boolean | null;
    importedHooks: ImportedReviewGateHookInfo[];
    importedHookInstalled: boolean;
}
export interface ReviewGateDoctorInfo {
    enabled: boolean;
    configDir: string;
    eventsFile: string;
    eventsFileExists: boolean;
    eventCount: number;
    lastEvent: ReviewGateEvent | null;
}
export interface HookSmokeTestResult {
    status: DoctorCheckStatus;
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    eventsRecorded: number;
    error: string | null;
}
export interface DoctorReport {
    workspaceRoot: string;
    rootDir: string;
    ready: boolean;
    diagnosis: string;
    checks: DoctorCheck[];
    node: CommandAvailability | null;
    codex: CommandAvailability | null;
    git: GitDoctorInfo;
    antigravity: AntigravityDoctorInfo;
    activeHook: ActiveReviewGateHookInfo;
    reviewGate: ReviewGateDoctorInfo;
    hookSmokeTest: HookSmokeTestResult | null;
    nextSteps: string[];
}
export interface DoctorOptions {
    rootDir: string;
    checkExecutables?: boolean;
    runHookTest?: boolean;
}
export declare function buildDoctorReport(cwd: string, options: DoctorOptions): DoctorReport;
export declare function printDoctorReport(report: DoctorReport): void;
