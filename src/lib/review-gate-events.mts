import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ReviewGateFinding {
  severity?: string;
  title?: string;
  file?: string | null;
  line?: number | null;
  description?: string;
  recommendation?: string;
}

export interface ReviewGateEvent {
  id: string;
  time: string;
  type: "started" | "skipped" | "codex-result" | "decision" | "error";
  workspace?: string;
  message?: string;
  decision?: "allow" | "continue";
  verdict?: string;
  summary?: string;
  findings?: ReviewGateFinding[];
  nextSteps?: string[];
  status?: number | null;
  stdout?: string;
  stderr?: string;
  reason?: string;
  durationMs?: number;
  payload?: unknown;
}

export interface MonitorState {
  pid: number;
  host: string;
  port: number;
  url: string;
  startedAt: string;
}

const MAX_TEXT_LENGTH = 8000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createReviewGateRunId(): string {
  return `gate-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function dataRoot(): string {
  return (
    process.env.AGY_CODEX_DATA ||
    process.env.ANTIGRAVITY_CODEX_DATA ||
    path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-codex")
  );
}

export function reviewGateDir(): string {
  return path.join(dataRoot(), "review-gate");
}

export function reviewGateEventsFile(): string {
  return path.join(reviewGateDir(), "events.jsonl");
}

export function monitorStateFile(): string {
  return path.join(reviewGateDir(), "monitor.json");
}

function truncateText(value: string | undefined): string | undefined {
  if (value === undefined || value.length <= MAX_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_LENGTH)}\n[truncated ${value.length - MAX_TEXT_LENGTH} chars]`;
}

function normalizeEvent(event: ReviewGateEvent): ReviewGateEvent {
  return {
    ...event,
    stdout: truncateText(event.stdout),
    stderr: truncateText(event.stderr),
    reason: truncateText(event.reason)
  };
}

let reviewGateDirCreated = false;

function ensureReviewGateDir(): void {
  if (!reviewGateDirCreated) {
    const dir = reviewGateDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    reviewGateDirCreated = true;
  }
}

export function appendReviewGateEvent(event: ReviewGateEvent): void {
  ensureReviewGateDir();
  fs.appendFileSync(reviewGateEventsFile(), `${JSON.stringify(normalizeEvent(event))}\n`);
}

export function readReviewGateEvents(limit = 200): ReviewGateEvent[] {
  const file = reviewGateEventsFile();
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/).filter(Boolean);
  const events: ReviewGateEvent[] = [];
  for (const line of lines.slice(Math.max(0, lines.length - limit))) {
    try {
      events.push(JSON.parse(line) as ReviewGateEvent);
    } catch {
      // Ignore partial lines from interrupted writes.
    }
  }
  return events;
}

export function clearReviewGateEvents(): void {
  try {
    fs.rmSync(reviewGateEventsFile(), { force: true });
  } catch {
    // Best effort cleanup.
  }
}

export function readMonitorState(): MonitorState | null {
  const file = monitorStateFile();
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MonitorState;
  } catch {
    return null;
  }
}

export function writeMonitorState(state: MonitorState): void {
  ensureReviewGateDir();
  fs.writeFileSync(monitorStateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

export function clearMonitorState(): void {
  try {
    fs.rmSync(monitorStateFile(), { force: true });
  } catch {
    // Best effort cleanup.
  }
}
