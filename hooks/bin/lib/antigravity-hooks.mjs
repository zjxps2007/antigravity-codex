import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
export const REVIEW_GATE_HOOK_NAME = "codex-stop-review-gate";
export const REVIEW_GATE_HOOK_TIMEOUT_SECONDS = 300;
export const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
export const NPX_REVIEW_GATE_COMMAND = `npx -y --package ${NPX_PACKAGE_SPEC} agy-codex-review-gate`;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function antigravityConfigDir() {
    return path.resolve(process.env.AGY_CODEX_ANTIGRAVITY_CONFIG_DIR ?? path.join(os.homedir(), ".gemini", "config"));
}
export function antigravityHooksFile() {
    return path.join(antigravityConfigDir(), "hooks.json");
}
function readHooksObject(file) {
    if (!fs.existsSync(file)) {
        return {};
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!isRecord(parsed)) {
            throw new Error("expected a JSON object");
        }
        return parsed;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read Antigravity hooks config at ${file}: ${message}`);
    }
}
function writeHooksObject(file, hooks) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmpFile = `${file}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(hooks, null, 2)}\n`);
    fs.renameSync(tmpFile, file);
}
function quoteCommandPart(value) {
    if (process.platform === "win32") {
        return /[\s"]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
    }
    return /^[A-Za-z0-9_/:=.,@%+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
export function findLocalReviewGateHookScript(rootDir) {
    for (const candidate of [
        path.join(rootDir, "hooks", "bin", "stop-review-gate-hook.mjs"),
        path.join(rootDir, "dist", "stop-review-gate-hook.mjs")
    ]) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
export function buildActiveReviewGateHookCommand(rootDir) {
    const script = findLocalReviewGateHookScript(rootDir);
    if (!script) {
        return NPX_REVIEW_GATE_COMMAND;
    }
    return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(script)}`;
}
function readHookEntry(hooks) {
    const hook = hooks[REVIEW_GATE_HOOK_NAME];
    const hookObject = isRecord(hook) ? hook : null;
    const stopEntries = Array.isArray(hookObject?.Stop) ? hookObject.Stop : [];
    const commandEntry = stopEntries.find((item) => {
        return isRecord(item) && item.type === "command";
    });
    return {
        enabled: typeof hookObject?.enabled === "boolean" ? hookObject.enabled : null,
        command: typeof commandEntry?.command === "string" ? commandEntry.command : null,
        timeout: typeof commandEntry?.timeout === "number" ? commandEntry.timeout : null
    };
}
export function inspectActiveReviewGateHook() {
    const configDir = antigravityConfigDir();
    const hooksFile = antigravityHooksFile();
    try {
        const hooks = readHooksObject(hooksFile);
        const entry = readHookEntry(hooks);
        return {
            configDir,
            hooksFile,
            hooksFileExists: fs.existsSync(hooksFile),
            installed: Boolean(entry.command && entry.enabled !== false),
            enabled: entry.enabled,
            command: entry.command,
            timeout: entry.timeout,
            error: null
        };
    }
    catch (error) {
        return {
            configDir,
            hooksFile,
            hooksFileExists: fs.existsSync(hooksFile),
            installed: false,
            enabled: null,
            command: null,
            timeout: null,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
export function installActiveReviewGateHook(rootDir) {
    const hooksFile = antigravityHooksFile();
    const hooks = readHooksObject(hooksFile);
    hooks[REVIEW_GATE_HOOK_NAME] = {
        enabled: true,
        Stop: [
            {
                type: "command",
                command: buildActiveReviewGateHookCommand(rootDir),
                timeout: REVIEW_GATE_HOOK_TIMEOUT_SECONDS
            }
        ]
    };
    writeHooksObject(hooksFile, hooks);
    return inspectActiveReviewGateHook();
}
export function removeActiveReviewGateHook() {
    const hooksFile = antigravityHooksFile();
    if (!fs.existsSync(hooksFile)) {
        return inspectActiveReviewGateHook();
    }
    const hooks = readHooksObject(hooksFile);
    delete hooks[REVIEW_GATE_HOOK_NAME];
    if (Object.keys(hooks).length === 0) {
        fs.rmSync(hooksFile, { force: true });
    }
    else {
        writeHooksObject(hooksFile, hooks);
    }
    return inspectActiveReviewGateHook();
}
