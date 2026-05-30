import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readReviewGateEvents, reviewGateEventsFile } from "../dist/lib/review-gate-events.mjs";

function withDataRoot<T>(dataRoot: string, fn: () => T): T {
  const previous = process.env.AGY_CODEX_DATA;
  process.env.AGY_CODEX_DATA = dataRoot;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AGY_CODEX_DATA;
    } else {
      process.env.AGY_CODEX_DATA = previous;
    }
  }
}

test("review gate events can be read for one workspace without tail truncation from other workspaces", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-events-"));
  const workspace = path.join(dataRoot, "workspace-a");
  const otherWorkspace = path.join(dataRoot, "workspace-b");

  withDataRoot(dataRoot, () => {
    const file = reviewGateEventsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ id: "target-old", workspace, time: "2026-05-23T08:00:00.000Z", type: "started" }),
        JSON.stringify({ id: "other-new", workspace: otherWorkspace, time: "2026-05-23T08:00:01.000Z", type: "started" }),
        JSON.stringify({ id: "target-new", workspace, time: "2026-05-23T08:00:02.000Z", type: "decision", decision: "allow" })
      ].join("\n") + "\n"
    );

    const events = readReviewGateEvents(2, workspace);
    assert.deepEqual(
      events.map((event) => event.id),
      ["target-old", "target-new"]
    );
  });
});
