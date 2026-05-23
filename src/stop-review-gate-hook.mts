#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
