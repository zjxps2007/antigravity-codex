import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveRuntimeRoot } from "./exec-resolver.mjs";
import { parseReviewPayload } from "./review-parser.mjs";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolveRuntimeRoot(SCRIPT_DIR);
export const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_REVIEW_TIMEOUT_MS = 120_000;
function codexCommand() {
    return process.env.CODEX_BIN?.trim() || "codex";
}
function reviewTimeoutMs() {
    const raw = process.env.AGY_CODEX_REVIEW_TIMEOUT_MS?.trim();
    if (!raw)
        return DEFAULT_REVIEW_TIMEOUT_MS;
    const timeout = Number(raw);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REVIEW_TIMEOUT_MS;
}
function reviewPrompt() {
    return [
        "You are a read-only review gate for Antigravity.",
        "Review the current git working tree, including staged, unstaged, and untracked changes.",
        "Do not modify files. Do not apply patches. Use shell commands only to inspect the repository.",
        "Return approve only when there are no actionable correctness, security, data-loss, build, packaging, or test risks.",
        "Return needs-attention when the agent should continue before stopping.",
        "Keep findings concise and include file and line when available."
    ].join("\n");
}
export function runCodexReview(cwd) {
    const timeoutMs = reviewTimeoutMs();
    const outputFile = path.join(os.tmpdir(), `agy-codex-review-gate-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const args = [
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "read-only",
        "--output-schema",
        REVIEW_SCHEMA,
        "--output-last-message",
        outputFile,
        reviewPrompt()
    ];
    const result = spawnSync(codexCommand(), args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        env: { ...process.env, NO_COLOR: "1", AGY_CODEX_REVIEW_GATE: "1" }
    });
    const lastMessage = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8")
        : "";
    try {
        fs.rmSync(outputFile, { force: true });
    }
    catch {
        // Best effort cleanup.
    }
    const errorMessage = result.error
        ? `Codex review gate process error: ${result.error.message}\n`
        : "";
    return {
        payload: parseReviewPayload(lastMessage || result.stdout),
        stdout: result.stdout ?? "",
        stderr: `${result.stderr ?? ""}${errorMessage}`,
        status: result.status,
        timedOut: result.error?.code === "ETIMEDOUT",
        timeoutMs
    };
}
