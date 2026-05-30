import fs from "node:fs";
import path from "node:path";
import type { ReviewGateFinding } from "./review-gate-events.mjs";
import type { Job } from "./state.mjs";

export interface ReviewResultPayload {
  verdict?: string;
  summary?: string;
  findings?: ReviewGateFinding[];
  nextSteps?: string[];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value === null ? null : undefined;
}

function normalizeFinding(value: unknown): ReviewGateFinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const finding: ReviewGateFinding = {};
  const severity = stringValue(raw.severity);
  const title = stringValue(raw.title);
  const file = stringValue(raw.file) ?? (raw.file === null ? null : undefined);
  const line = numberValue(raw.line);
  const description = stringValue(raw.description);
  const recommendation = stringValue(raw.recommendation);

  if (severity) finding.severity = severity;
  if (title) finding.title = title;
  if (file !== undefined) finding.file = file;
  if (line !== undefined) finding.line = line;
  if (description) finding.description = description;
  if (recommendation) finding.recommendation = recommendation;

  return Object.keys(finding).length ? finding : null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return items.length ? items : undefined;
}

function parsePayloadObject(value: unknown): ReviewResultPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const verdict = stringValue(raw.verdict);
  const summary = stringValue(raw.summary);
  const findings = Array.isArray(raw.findings)
    ? raw.findings.map(normalizeFinding).filter((finding): finding is ReviewGateFinding => Boolean(finding))
    : undefined;
  const nextSteps = normalizeStringArray(raw.nextSteps) ?? normalizeStringArray(raw.next_steps);

  if (!verdict && !summary && !findings?.length && !nextSteps?.length) {
    return null;
  }

  const payload: ReviewResultPayload = {};
  if (verdict) payload.verdict = verdict;
  if (summary) payload.summary = summary;
  if (findings?.length) payload.findings = findings;
  if (nextSteps?.length) payload.nextSteps = nextSteps;
  return payload;
}

export function parseReviewResultPayload(value: unknown): ReviewResultPayload | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return null;
    }
    try {
      return parsePayloadObject(JSON.parse(text));
    } catch {
      return null;
    }
  }
  return parsePayloadObject(value);
}

function readTextFile(file: string): string | null {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readReviewResultForJob(job: Job): ReviewResultPayload | null {
  if (!job.logFile) {
    return null;
  }
  const dir = path.dirname(job.logFile);
  const stdout = readTextFile(path.join(dir, "stdout.txt"));
  const stdoutPayload = stdout ? parseReviewResultPayload(stdout) : null;
  if (stdoutPayload) {
    return stdoutPayload;
  }

  const resultText = readTextFile(path.join(dir, "result.json"));
  if (!resultText) {
    return null;
  }

  try {
    const result = JSON.parse(resultText) as Record<string, unknown>;
    return parseReviewResultPayload(result.stdout);
  } catch {
    return null;
  }
}
