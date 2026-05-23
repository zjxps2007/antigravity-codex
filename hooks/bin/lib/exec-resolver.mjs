import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
/**
 * Walk up from startDir until we find a directory containing plugin.json.
 * This lets all lib modules reliably locate the plugin root regardless of
 * whether they are running from dist/, hooks/bin/, or hooks/bin/lib/.
 */
export function resolveRuntimeRoot(startDir) {
    let current = path.resolve(startDir);
    for (let i = 0; i < 8; i += 1) {
        if (fs.existsSync(path.join(current, "plugin.json"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    // Fallback: assume root is two levels above startDir (dist/lib -> root)
    return path.resolve(startDir, "..", "..");
}
export function shouldUseShell(command) {
    return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}
export function commandCandidates(command) {
    if (command === "node") {
        return [process.execPath, "node.exe", "node"];
    }
    if (process.env.CODEX_BIN && command === "codex") {
        return [process.env.CODEX_BIN];
    }
    if (process.platform !== "win32" || path.extname(command)) {
        return [command];
    }
    return [`${command}.cmd`, `${command}.exe`, command];
}
export function resolveExecutable(command, args = ["--version"], cwd = process.cwd()) {
    for (const candidate of commandCandidates(command)) {
        const result = spawnSync(candidate, args, {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            shell: shouldUseShell(candidate)
        });
        const errorCode = result.error?.code;
        if (!result.error || errorCode !== "ENOENT") {
            return { command: candidate, result };
        }
    }
    const result = {
        status: null,
        stdout: "",
        stderr: "",
        error: new Error(`Unable to find ${command} on PATH.`)
    };
    return { command, result };
}
let cachedCodexInvocation = null;
export function resolveCodexInvocation(cwd = process.cwd()) {
    if (cachedCodexInvocation) {
        return cachedCodexInvocation;
    }
    let invocation;
    if (process.env.CODEX_BIN) {
        if (/\.js$/i.test(process.env.CODEX_BIN)) {
            invocation = { command: process.execPath, args: [process.env.CODEX_BIN] };
        }
        else {
            invocation = { command: process.env.CODEX_BIN, args: [] };
        }
    }
    else if (process.platform === "win32") {
        const found = spawnSync("where.exe", ["codex"], { cwd, encoding: "utf8", windowsHide: true });
        const paths = found.status === 0
            ? found.stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
            : [];
        invocation = { command: "codex", args: [] };
        for (const candidate of paths) {
            if (/\.exe$/i.test(candidate)) {
                invocation = { command: candidate, args: [] };
                break;
            }
            const codexJs = path.join(path.dirname(candidate), "node_modules", "@openai", "codex", "bin", "codex.js");
            if (fs.existsSync(codexJs)) {
                invocation = { command: process.execPath, args: [codexJs] };
                break;
            }
        }
    }
    else {
        invocation = { command: "codex", args: [] };
    }
    cachedCodexInvocation = invocation;
    return invocation;
}
export function codexAvailable(cwd = process.cwd()) {
    const invocation = resolveCodexInvocation(cwd);
    const result = spawnSync(invocation.command, [...invocation.args, "--version"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        shell: shouldUseShell(invocation.command)
    });
    return {
        available: result.status === 0,
        command: [invocation.command, ...invocation.args].join(" "),
        status: result.status,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
        error: result.error?.message ?? null
    };
}
export function commandAvailable(command, args = ["--version"], cwd = process.cwd()) {
    const { command: resolvedCommand, result } = resolveExecutable(command, args, cwd);
    return {
        available: result.status === 0,
        command: resolvedCommand,
        status: result.status,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
        error: result.error?.message ?? null
    };
}
