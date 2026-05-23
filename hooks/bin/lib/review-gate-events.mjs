import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const MAX_TEXT_LENGTH = 8000;
export function nowIso() {
    return new Date().toISOString();
}
export function createReviewGateRunId() {
    return `gate-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
export function dataRoot() {
    return (process.env.AGY_CODEX_DATA ||
        process.env.ANTIGRAVITY_CODEX_DATA ||
        path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-codex"));
}
export function reviewGateDir() {
    return path.join(dataRoot(), "review-gate");
}
export function reviewGateEventsFile() {
    return path.join(reviewGateDir(), "events.jsonl");
}
export function monitorStateFile() {
    return path.join(reviewGateDir(), "monitor.json");
}
function truncateText(value) {
    if (value === undefined || value.length <= MAX_TEXT_LENGTH) {
        return value;
    }
    return `${value.slice(0, MAX_TEXT_LENGTH)}\n[truncated ${value.length - MAX_TEXT_LENGTH} chars]`;
}
function normalizeEvent(event) {
    return {
        ...event,
        stdout: truncateText(event.stdout),
        stderr: truncateText(event.stderr),
        reason: truncateText(event.reason)
    };
}
export function appendReviewGateEvent(event) {
    fs.mkdirSync(reviewGateDir(), { recursive: true });
    fs.appendFileSync(reviewGateEventsFile(), `${JSON.stringify(normalizeEvent(event))}\n`);
}
export function readReviewGateEvents(limit = 200) {
    const file = reviewGateEventsFile();
    if (!fs.existsSync(file)) {
        return [];
    }
    const lines = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines.slice(Math.max(0, lines.length - limit))) {
        try {
            events.push(JSON.parse(line));
        }
        catch {
            // Ignore partial lines from interrupted writes.
        }
    }
    return events;
}
export function clearReviewGateEvents() {
    try {
        fs.rmSync(reviewGateEventsFile(), { force: true });
    }
    catch {
        // Best effort cleanup.
    }
}
export function readMonitorState() {
    const file = monitorStateFile();
    if (!fs.existsSync(file)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
export function writeMonitorState(state) {
    fs.mkdirSync(reviewGateDir(), { recursive: true });
    fs.writeFileSync(monitorStateFile(), `${JSON.stringify(state, null, 2)}\n`);
}
export function clearMonitorState() {
    try {
        fs.rmSync(monitorStateFile(), { force: true });
    }
    catch {
        // Best effort cleanup.
    }
}
