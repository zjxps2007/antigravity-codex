#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { appendReviewGateEvent, createReviewGateRunId, nowIso, readReviewGateEvents, reviewGateDir } from "./lib/review-gate-events.mjs";
import { formatReason } from "./lib/review-parser.mjs";
import { runCodexReview } from "./lib/review-runner.mjs";
import { isReviewGateEnabled, listReviewGateEnabledWorkspaces } from "./lib/state.mjs";
const STALE_STOP_HOOK_LOCK_MS = 5 * 60 * 1000;
function readStdin() {
    return new Promise((resolve) => {
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => resolve(input));
    });
}
function respond(payload) {
    process.stdout.write(JSON.stringify(payload));
}
function allow() {
    respond({ decision: "allow" });
}
function recordEvent(event) {
    try {
        appendReviewGateEvent(event);
    }
    catch {
        // Review gate logging must never block Antigravity from stopping.
    }
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
function existingWorkspaces(input) {
    const workspaces = [];
    for (const candidate of input.workspacePaths ?? []) {
        if (candidate && fs.existsSync(candidate)) {
            workspaces.push(candidate);
        }
    }
    return workspaces;
}
function uniqueExistingWorkspaces(candidates) {
    const seen = new Set();
    const workspaces = [];
    for (const candidate of candidates) {
        if (!candidate || !fs.existsSync(candidate))
            continue;
        const resolved = fs.realpathSync(candidate);
        if (seen.has(resolved))
            continue;
        seen.add(resolved);
        workspaces.push(resolved);
    }
    return workspaces;
}
function reviewWorkspace(input) {
    const directWorkspaces = uniqueExistingWorkspaces([
        ...existingWorkspaces(input),
        process.env.PWD,
        process.env.INIT_CWD,
        process.cwd()
    ]);
    const directEnabled = directWorkspaces.find((candidate) => isReviewGateEnabled(candidate));
    if (directEnabled) {
        return directEnabled;
    }
    const directGitWorkspace = directWorkspaces.find((candidate) => {
        const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
            cwd: candidate,
            encoding: "utf8",
            windowsHide: true
        });
        return result.status === 0 && result.stdout.trim() === "true";
    });
    if (directGitWorkspace) {
        return directGitWorkspace;
    }
    return listReviewGateEnabledWorkspaces()[0] ?? directWorkspaces[0] ?? process.cwd();
}
function hasGitChanges(cwd) {
    const result = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
        windowsHide: true
    });
    return result.status === 0 && Boolean(result.stdout?.trim());
}
function transcriptCandidates(input) {
    return [
        input.transcriptPath,
        input.artifactDirectoryPath
            ? path.join(input.artifactDirectoryPath, ".system_generated", "logs", "transcript.jsonl")
            : undefined,
        input.artifactDirectoryPath
            ? path.join(input.artifactDirectoryPath, ".system_generated", "logs", "transcript_full.jsonl")
            : undefined
    ].filter((candidate) => Boolean(candidate));
}
function readFileTail(file, maxBytes = 256 * 1024) {
    try {
        if (!fs.existsSync(file))
            return null;
        const stat = fs.statSync(file);
        const start = Math.max(0, stat.size - maxBytes);
        const length = stat.size - start;
        const fd = fs.openSync(file, "r");
        try {
            const buffer = Buffer.alloc(length);
            fs.readSync(fd, buffer, 0, length, start);
            return buffer.toString("utf8");
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return null;
    }
}
function extractUserRequest(content) {
    const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
    return (match?.[1] ?? content).trim();
}
function transcriptContentText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        const parts = content.flatMap((item) => {
            if (typeof item === "string")
                return [item];
            if (typeof item !== "object" || item === null)
                return [];
            const record = item;
            return [record.text, record.content].filter((value) => typeof value === "string");
        });
        return parts.length ? parts.join("\n") : null;
    }
    return null;
}
function latestUserRequest(input) {
    for (const transcript of transcriptCandidates(input)) {
        const content = readFileTail(transcript);
        if (!content)
            continue;
        const lines = content.split(/\r?\n/).filter(Boolean).reverse();
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.type !== "USER_INPUT")
                    continue;
                const source = entry.source?.toUpperCase();
                if (source && !source.startsWith("USER"))
                    continue;
                const text = transcriptContentText(entry.content);
                if (!text)
                    continue;
                return extractUserRequest(text);
            }
            catch {
                // Ignore malformed transcript lines.
            }
        }
    }
    return null;
}
function isCodexSlashCommandSession(input) {
    return /^\/codex(?::|$)/.test(latestUserRequest(input) ?? "");
}
function findingFingerprint(payload) {
    const findings = (payload.findings ?? []).map((finding) => ({
        severity: finding.severity ?? "",
        title: finding.title ?? "",
        file: finding.file ?? "",
        line: finding.line ?? null,
        description: finding.description ?? "",
        recommendation: finding.recommendation ?? ""
    }));
    return JSON.stringify({
        verdict: payload.verdict ?? "",
        summary: payload.summary ?? "",
        findings,
        nextSteps: payload.next_steps ?? []
    });
}
function safeRealpath(candidate) {
    try {
        return fs.realpathSync(candidate);
    }
    catch {
        return path.resolve(candidate);
    }
}
function isRepeatedContinue(cwd, payload) {
    const fingerprint = findingFingerprint(payload);
    const workspace = safeRealpath(cwd);
    const recentEvents = readReviewGateEvents(80, workspace).reverse();
    return recentEvents.some((event) => {
        if (event.type !== "decision" || event.decision !== "continue")
            return false;
        if (!event.workspace || safeRealpath(event.workspace) !== workspace)
            return false;
        const previousPayload = event.payload;
        if (!previousPayload)
            return false;
        return findingFingerprint(previousPayload) === fingerprint;
    });
}
function normalizedPath(value) {
    return value ? path.resolve(value) : "";
}
function stopHookFingerprint(input, cwd) {
    return createHash("sha256")
        .update(JSON.stringify({
        workspace: safeRealpath(cwd),
        terminationReason: input.terminationReason ?? "",
        error: input.error ?? "",
        fullyIdle: input.fullyIdle ?? null,
        artifactDirectoryPath: normalizedPath(input.artifactDirectoryPath),
        transcriptPath: normalizedPath(input.transcriptPath),
        userRequest: latestUserRequest(input) ?? ""
    }))
        .digest("hex");
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
            ? error.code
            : null;
        return code === "EPERM";
    }
}
function acquireStopHookInvocation(input, cwd) {
    try {
        const locksDir = path.join(reviewGateDir(), "locks");
        fs.mkdirSync(locksDir, { recursive: true });
        const now = Date.now();
        for (const entry of fs.readdirSync(locksDir)) {
            if (!entry.startsWith("stop-") || !entry.endsWith(".json"))
                continue;
            const file = path.join(locksDir, entry);
            try {
                const stat = fs.statSync(file);
                if (now - stat.mtimeMs > STALE_STOP_HOOK_LOCK_MS) {
                    fs.rmSync(file, { force: true });
                }
            }
            catch {
                // Best effort stale-lock cleanup.
            }
        }
        const lockFile = path.join(locksDir, `stop-${stopHookFingerprint(input, cwd)}.json`);
        const tryCreate = () => {
            try {
                const fd = fs.openSync(lockFile, "wx");
                try {
                    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, time: nowIso(), workspace: safeRealpath(cwd) }));
                }
                finally {
                    fs.closeSync(fd);
                }
                return true;
            }
            catch (error) {
                const code = typeof error === "object" && error !== null && "code" in error
                    ? error.code
                    : null;
                if (code !== "EEXIST") {
                    return true;
                }
                return null;
            }
        };
        const created = tryCreate();
        if (created !== null)
            return created;
        const stat = fs.statSync(lockFile);
        if (now - stat.mtimeMs < STALE_STOP_HOOK_LOCK_MS) {
            try {
                const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
                if (typeof lock.pid === "number" && isProcessAlive(lock.pid)) {
                    return false;
                }
            }
            catch {
                return false;
            }
        }
        fs.rmSync(lockFile, { force: true });
        return tryCreate() ?? true;
    }
    catch {
        return true;
    }
}
async function main() {
    const input = parseInput(await readStdin());
    const cwd = reviewWorkspace(input);
    if (!isReviewGateEnabled(cwd)) {
        allow();
        return;
    }
    if (isCodexSlashCommandSession(input)) {
        allow();
        return;
    }
    if (!acquireStopHookInvocation(input, cwd)) {
        allow();
        return;
    }
    const id = createReviewGateRunId();
    const startedAt = Date.now();
    const baseEvent = { id, workspace: cwd };
    const recordDecision = (decision, payload, extra = {}) => {
        recordEvent({
            ...baseEvent,
            time: nowIso(),
            type: "decision",
            decision,
            verdict: payload?.verdict,
            summary: payload?.summary,
            findings: payload?.findings,
            nextSteps: payload?.next_steps,
            durationMs: Date.now() - startedAt,
            payload,
            ...extra
        });
    };
    const finishAllow = (message, payload) => {
        recordDecision("allow", payload, { summary: payload?.summary ?? message });
        allow();
    };
    const finishContinue = (reason, payload) => {
        recordDecision("continue", payload, { reason });
        respond({ decision: "continue", reason });
    };
    recordEvent({
        ...baseEvent,
        time: nowIso(),
        type: "started",
        message: `terminationReason=${input.terminationReason ?? "unknown"} fullyIdle=${String(input.fullyIdle)}`
    });
    if (process.env.AGY_CODEX_REVIEW_GATE_BYPASS === "1") {
        recordEvent({ ...baseEvent, time: nowIso(), type: "skipped", message: "Bypassed by AGY_CODEX_REVIEW_GATE_BYPASS." });
        finishAllow("Bypassed by AGY_CODEX_REVIEW_GATE_BYPASS.");
        return;
    }
    if (input.fullyIdle === false || input.terminationReason === "error") {
        recordEvent({ ...baseEvent, time: nowIso(), type: "skipped", message: "Stop hook was not a fully idle normal stop." });
        finishAllow("Stop hook was not a fully idle normal stop.");
        return;
    }
    if (!hasGitChanges(cwd)) {
        recordEvent({ ...baseEvent, time: nowIso(), type: "skipped", message: "No git changes to review." });
        finishAllow("No git changes to review.");
        return;
    }
    const review = runCodexReview(cwd);
    recordEvent({
        ...baseEvent,
        time: nowIso(),
        type: "codex-result",
        status: review.status,
        verdict: review.payload?.verdict,
        summary: review.payload?.summary,
        findings: review.payload?.findings,
        nextSteps: review.payload?.next_steps,
        stdout: review.stdout,
        stderr: review.stderr,
        payload: review.payload
    });
    if (review.status !== 0) {
        const failureMessage = review.timedOut
            ? `Codex review gate timed out after ${Math.round(review.timeoutMs / 1000)}s.`
            : "Codex review gate command failed.";
        process.stderr.write(review.stderr || review.stdout);
        recordEvent({
            ...baseEvent,
            time: nowIso(),
            type: "error",
            status: review.status,
            message: failureMessage,
            stdout: review.stdout,
            stderr: review.stderr
        });
        finishAllow(failureMessage, review.payload);
        return;
    }
    const payload = review.payload;
    if (!payload || payload.verdict !== "needs-attention") {
        finishAllow(payload ? "Codex approved the changes." : "Codex review gate output could not be parsed.", payload);
        return;
    }
    const loopGuardMessage = isRepeatedContinue(cwd, payload)
        ? "Repeated needs-attention verdict; allowing to avoid a review-gate loop."
        : "";
    if (loopGuardMessage) {
        recordEvent({
            ...baseEvent,
            time: nowIso(),
            type: "skipped",
            verdict: payload.verdict,
            summary: payload.summary,
            findings: payload.findings,
            nextSteps: payload.next_steps,
            message: loopGuardMessage,
            payload
        });
        finishAllow(loopGuardMessage, payload);
        return;
    }
    finishContinue(formatReason(payload, review.stdout || review.stderr), payload);
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    allow();
});
