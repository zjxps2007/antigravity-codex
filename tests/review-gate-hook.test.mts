import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readReviewGateEvents } from "../dist/lib/review-gate-events.mjs";
import { setReviewGateEnabled } from "../dist/lib/state.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const hookScript = path.join(repoRoot, "dist", "stop-review-gate-hook.mjs");

function makeGitWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-work-"));
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: workspace, stdio: "ignore" });
  fs.writeFileSync(path.join(workspace, "file.txt"), "before\n");
  spawnSync("git", ["add", "file.txt"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, stdio: "ignore" });
  fs.writeFileSync(path.join(workspace, "file.txt"), "after\n");
  return workspace;
}

function makeFakeCodex(payload: unknown): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-codex-"));
  const script = path.join(tempRoot, "fake-codex.js");
  fs.writeFileSync(
    script,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const payload = JSON.parse(process.env.FAKE_CODEX_PAYLOAD);",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('--output-last-message');",
      "if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], JSON.stringify(payload));",
      "console.log(JSON.stringify(payload));"
    ].join("\n")
  );
  fs.chmodSync(script, 0o755);
  return script;
}

function withDataRoot<T>(dataRoot: string, fn: () => T): T {
  const previousDataRoot = process.env.AGY_CODEX_DATA;
  process.env.AGY_CODEX_DATA = dataRoot;
  try {
    return fn();
  } finally {
    if (previousDataRoot === undefined) {
      delete process.env.AGY_CODEX_DATA;
    } else {
      process.env.AGY_CODEX_DATA = previousDataRoot;
    }
  }
}

function runHook(
  workspace: string,
  fakeCodex: string,
  payload: unknown,
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-")),
  enabled = true
) {
  if (enabled) {
    withDataRoot(dataRoot, () => setReviewGateEnabled(workspace, true));
  }
  return spawnSync(process.execPath, [hookScript], {
    cwd: workspace,
    input: JSON.stringify({ fullyIdle: true, terminationReason: "model_stop", workspacePaths: [workspace] }),
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: dataRoot,
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_PAYLOAD: JSON.stringify(payload)
    }
  });
}

test("review gate allows without running Codex when disabled", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const fakeCodex = makeFakeCodex({ verdict: "needs-attention", summary: "should not run", findings: [], next_steps: [] });
  const result = runHook(workspace, fakeCodex, {}, dataRoot, false);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });
  withDataRoot(dataRoot, () => assert.deepEqual(readReviewGateEvents(10), []));
});

test("review gate allows when Codex approves changes", () => {
  const workspace = makeGitWorkspace();
  const fakeCodex = makeFakeCodex({ verdict: "approve", summary: "ok", findings: [], next_steps: [] });
  const result = runHook(workspace, fakeCodex, { verdict: "approve", summary: "ok", findings: [], next_steps: [] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });
});

test("review gate continues when Codex reports actionable findings", () => {
  const workspace = makeGitWorkspace();
  const payload = {
    verdict: "needs-attention",
    summary: "Risk found",
    findings: [
      {
        severity: "high",
        title: "Broken behavior",
        file: "file.txt",
        line: 1,
        description: "The change breaks expected behavior.",
        recommendation: "Fix the behavior before stopping."
      }
    ],
    next_steps: ["Fix file.txt"]
  };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision: string; reason: string };
  assert.equal(output.decision, "continue");
  assert.match(output.reason, /Broken behavior/);
  assert.match(output.reason, /file\.txt:1/);
});

test("review gate records monitor events", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const payload = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload, dataRoot);
  assert.equal(result.status, 0, result.stderr);

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(10);
    assert.equal(events[0]?.type, "started");
    assert.ok(events.some((event) => event.type === "codex-result" && event.verdict === "approve"));
    assert.ok(events.some((event) => event.type === "decision" && event.decision === "allow"));
  });
});
