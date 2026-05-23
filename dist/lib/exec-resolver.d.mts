import { type SpawnSyncReturns } from "node:child_process";
/**
 * Walk up from startDir until we find a directory containing plugin.json.
 * This lets all lib modules reliably locate the plugin root regardless of
 * whether they are running from dist/, hooks/bin/, or hooks/bin/lib/.
 */
export declare function resolveRuntimeRoot(startDir: string): string;
export interface CommandAvailability {
    available: boolean;
    command: string;
    status: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
}
export interface CommandResolution {
    command: string;
    result: SpawnSyncReturns<string>;
}
export interface CodexInvocation {
    command: string;
    args: string[];
}
export declare function shouldUseShell(command: string): boolean;
export declare function commandCandidates(command: string): string[];
export declare function resolveExecutable(command: string, args?: string[], cwd?: string): CommandResolution;
export declare function resolveCodexInvocation(cwd?: string): CodexInvocation;
export declare function codexAvailable(cwd?: string): CommandAvailability;
export declare function commandAvailable(command: string, args?: string[], cwd?: string): CommandAvailability;
