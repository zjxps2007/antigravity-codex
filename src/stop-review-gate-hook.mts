#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  appendReviewGateEvent,
  createReviewGateRunId,
  nowIso,
  type ReviewGateEvent
} from "./lib/review-gate-events.mjs";
import { formatReason, parseReviewPayload, type ReviewGatePayload } from "./lib/review-parser.mjs";
import { runCodexReview } from "./lib/review-runner.mjs";
import { isReviewGateEnabled, listReviewGateEnabledWorkspaces } from "./lib/state.mjs";

interface StopHookInput {
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
  workspacePaths?: string[];
  artifactDirectoryPath?: string;
  transcriptPath?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
  });
}

function respond(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload));
}

function allow(): void {
  respond({ decision: "allow" });
}

function recordEvent(event: ReviewGateEvent): void {
  try {
    appendReviewGateEvent(event);
  } catch {
    // Review gate logging must never block Antigravity from stopping.
  }
}

function parseInput(raw: string): StopHookInput {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as StopHookInput;
  } catch {
    return {};
  }
}

function existingWorkspaces(input: StopHookInput): string[] {
  const workspaces = [];
  for (const candidate of input.workspacePaths ?? []) {
    if (candidate && fs.existsSync(candidate)) {
      workspaces.push(candidate);
    }
  }
  return workspaces;
}

function uniqueExistingWorkspaces(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const workspaces: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    workspaces.push(resolved);
  }
  return workspaces;
}

function reviewWorkspace(input: StopHookInput): string {
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
  return listReviewGateEnabledWorkspaces()[0] ?? directWorkspaces[0] ?? process.cwd();
}

function hasGitChanges(cwd: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function transcriptCandidates(input: StopHookInput): string[] {
  return [
    input.transcriptPath,
    input.artifactDirectoryPath
      ? path.join(input.artifactDirectoryPath, ".system_generated", "logs", "transcript.jsonl")
      : undefined,
    input.artifactDirectoryPath
      ? path.join(input.artifactDirectoryPath, ".system_generated", "logs", "transcript_full.jsonl")
      : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function readFileTail(file: string, maxBytes = 256 * 1024): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function extractUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return (match?.[1] ?? content).trim();
}

function latestUserRequest(input: StopHookInput): string | null {
  for (const transcript of transcriptCandidates(input)) {
    const content = readFileTail(transcript);
    if (!content) continue;
    const lines = content.split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { source?: string; type?: string; content?: unknown };
        if (entry.type !== "USER_INPUT" || typeof entry.content !== "string") continue;
        if (entry.source && !entry.source.startsWith("USER")) continue;
        return extractUserRequest(entry.content);
      } catch {
        // Ignore malformed transcript lines.
      }
    }
  }
  return null;
}

function isCodexSlashCommandSession(input: StopHookInput): boolean {
  return /^\/codex(?::|$)/.test(latestUserRequest(input) ?? "");
}

async function main(): Promise<void> {
  const input = parseInput(await readStdin());
  const cwd = reviewWorkspace(input);
  if (!isReviewGateEnabled(cwd)) {
    allow();
    return;
  }

  const id = createReviewGateRunId();
  const startedAt = Date.now();
  const baseEvent = { id, workspace: cwd };

  const recordDecision = (
    decision: "allow" | "continue",
    payload: ReviewGatePayload | null | undefined,
    extra: Partial<ReviewGateEvent> = {}
  ): void => {
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

  const finishAllow = (message: string, payload?: ReviewGatePayload | null): void => {
    recordDecision("allow", payload, { summary: payload?.summary ?? message });
    allow();
  };

  const finishContinue = (reason: string, payload: ReviewGatePayload): void => {
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
  if (isCodexSlashCommandSession(input)) {
    recordEvent({ ...baseEvent, time: nowIso(), type: "skipped", message: "Skipped for explicit /codex command session." });
    finishAllow("Skipped for explicit /codex command session.");
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
    process.stderr.write(review.stderr || review.stdout);
    recordEvent({
      ...baseEvent,
      time: nowIso(),
      type: "error",
      status: review.status,
      message: "Codex review gate command failed.",
      stdout: review.stdout,
      stderr: review.stderr
    });
    finishAllow("Codex review gate command failed.", review.payload);
    return;
  }

  const payload = review.payload;
  if (!payload || payload.verdict !== "needs-attention") {
    finishAllow(
      payload ? "Codex approved the changes." : "Codex review gate output could not be parsed.",
      payload
    );
    return;
  }

  finishContinue(formatReason(payload, review.stdout || review.stderr), payload);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  allow();
});
