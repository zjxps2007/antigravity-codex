#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  appendReviewGateEvent,
  createReviewGateRunId,
  nowIso,
  type ReviewGateEvent
} from "./lib/review-gate-events.mjs";

interface StopHookInput {
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
  workspacePaths?: string[];
}

interface ReviewFinding {
  severity?: string;
  title?: string;
  file?: string | null;
  line?: number | null;
  description?: string;
  recommendation?: string;
}

interface ReviewGatePayload {
  verdict?: string;
  summary?: string;
  findings?: ReviewFinding[];
  next_steps?: string[];
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REVIEW_SCHEMA = path.resolve(SCRIPT_DIR, "..", "schemas", "review-output.schema.json");

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      input += chunk;
    });
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

function firstWorkspace(input: StopHookInput): string {
  for (const candidate of input.workspacePaths ?? []) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.cwd();
}

function hasGitChanges(cwd: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function codexCommand(): string {
  return process.env.CODEX_BIN?.trim() || "codex";
}

function reviewPrompt(): string {
  return [
    "You are a read-only review gate for Antigravity.",
    "Review the current git working tree, including staged, unstaged, and untracked changes.",
    "Do not modify files. Do not apply patches. Use shell commands only to inspect the repository.",
    "Return approve only when there are no actionable correctness, security, data-loss, build, packaging, or test risks.",
    "Return needs-attention when the agent should continue before stopping.",
    "Keep findings concise and include file and line when available."
  ].join("\n");
}

function parseReviewPayload(text: string): ReviewGatePayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ReviewGatePayload;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}$/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as ReviewGatePayload;
    } catch {
      return null;
    }
  }
}

function formatReason(payload: ReviewGatePayload, rawFallback: string): string {
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
      if (finding.description) lines.push(`  ${finding.description}`);
      if (finding.recommendation) lines.push(`  Recommendation: ${finding.recommendation}`);
    }
  } else if (rawFallback.trim()) {
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

function runCodexReview(cwd: string): { payload: ReviewGatePayload | null; stdout: string; stderr: string; status: number | null } {
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
  } catch {
    // Best effort cleanup.
  }

  return {
    payload: parseReviewPayload(lastMessage || result.stdout),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

async function main(): Promise<void> {
  const input = parseInput(await readStdin());
  const cwd = firstWorkspace(input);
  const id = createReviewGateRunId();
  const startedAt = Date.now();
  const baseEvent = { id, workspace: cwd };
  recordEvent({
    ...baseEvent,
    time: nowIso(),
    type: "started",
    message: `terminationReason=${input.terminationReason ?? "unknown"} fullyIdle=${String(input.fullyIdle)}`
  });

  const finishAllow = (message: string, payload?: ReviewGatePayload | null): void => {
    recordEvent({
      ...baseEvent,
      time: nowIso(),
      type: "decision",
      decision: "allow",
      verdict: payload?.verdict,
      summary: payload?.summary ?? message,
      findings: payload?.findings,
      nextSteps: payload?.next_steps,
      durationMs: Date.now() - startedAt,
      payload
    });
    allow();
  };

  const finishContinue = (reason: string, payload: ReviewGatePayload): void => {
    recordEvent({
      ...baseEvent,
      time: nowIso(),
      type: "decision",
      decision: "continue",
      verdict: payload.verdict,
      summary: payload.summary,
      findings: payload.findings,
      nextSteps: payload.next_steps,
      reason,
      durationMs: Date.now() - startedAt,
      payload
    });
    respond({ decision: "continue", reason });
  };

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
    finishAllow(payload ? "Codex approved the changes." : "Codex review gate output could not be parsed.", payload);
    return;
  }

  finishContinue(formatReason(payload, review.stdout || review.stderr), payload);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  allow();
});
