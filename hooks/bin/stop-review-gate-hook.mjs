#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REVIEW_SCHEMA = path.resolve(SCRIPT_DIR, "..", "schemas", "review-output.schema.json");
function readStdin() {
    return new Promise((resolve) => {
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
            input += chunk;
        });
        process.stdin.on("end", () => resolve(input));
    });
}
function respond(payload) {
    process.stdout.write(JSON.stringify(payload));
}
function allow() {
    respond({ decision: "allow" });
}
function parseInput(raw) {
    if (!raw.trim())
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function firstWorkspace(input) {
    for (const candidate of input.workspacePaths ?? []) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return process.cwd();
}
function hasGitChanges(cwd) {
    const result = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
        windowsHide: true
    });
    return result.status === 0 && Boolean(result.stdout.trim());
}
function codexCommand() {
    return process.env.CODEX_BIN?.trim() || "codex";
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
function parseReviewPayload(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const match = trimmed.match(/\{[\s\S]*\}$/);
        if (!match)
            return null;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
}
function formatReason(payload, rawFallback) {
    const lines = ["Codex review gate found issues that should be addressed before stopping."];
    if (payload.summary) {
        lines.push("", payload.summary);
    }
    const findings = payload.findings ?? [];
    if (findings.length) {
        lines.push("", "Findings:");
        for (const finding of findings.slice(0, 8)) {
            const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
            const title = finding.title || "Review finding";
            const severity = finding.severity ? `[${finding.severity}] ` : "";
            lines.push(`- ${severity}${title}${location ? ` (${location})` : ""}`);
            if (finding.description)
                lines.push(`  ${finding.description}`);
            if (finding.recommendation)
                lines.push(`  Recommendation: ${finding.recommendation}`);
        }
    }
    else if (rawFallback.trim()) {
        lines.push("", rawFallback.trim().slice(0, 4000));
    }
    const nextSteps = payload.next_steps ?? [];
    if (nextSteps.length) {
        lines.push("", "Next steps:");
        for (const step of nextSteps.slice(0, 5)) {
            lines.push(`- ${step}`);
        }
    }
    return lines.join("\n");
}
function runCodexReview(cwd) {
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
        timeout: 240_000,
        env: { ...process.env, NO_COLOR: "1", AGY_CODEX_REVIEW_GATE: "1" }
    });
    const lastMessage = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
    try {
        fs.rmSync(outputFile, { force: true });
    }
    catch {
        // Best effort cleanup.
    }
    return {
        payload: parseReviewPayload(lastMessage || result.stdout),
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status
    };
}
async function main() {
    const input = parseInput(await readStdin());
    if (process.env.AGY_CODEX_REVIEW_GATE_BYPASS === "1") {
        allow();
        return;
    }
    if (input.fullyIdle === false || input.terminationReason === "error") {
        allow();
        return;
    }
    const cwd = firstWorkspace(input);
    if (!hasGitChanges(cwd)) {
        allow();
        return;
    }
    const review = runCodexReview(cwd);
    if (review.status !== 0) {
        process.stderr.write(review.stderr || review.stdout);
        allow();
        return;
    }
    const payload = review.payload;
    if (!payload || payload.verdict !== "needs-attention") {
        allow();
        return;
    }
    respond({
        decision: "continue",
        reason: formatReason(payload, review.stdout || review.stderr)
    });
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    allow();
});
