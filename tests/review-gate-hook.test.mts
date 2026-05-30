import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
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

function makeHangingCodex(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-codex-"));
  const script = path.join(tempRoot, "hanging-codex.js");
  fs.writeFileSync(script, "#!/usr/bin/env node\nsetTimeout(() => {}, 10_000);\n");
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
  enabled = true,
  workspacePaths = [workspace],
  hookCwd = workspace,
  extraInput: Record<string, unknown> = {},
  extraEnv: Record<string, string> = {}
) {
  if (enabled) {
    withDataRoot(dataRoot, () => setReviewGateEnabled(workspace, true));
  }
  return spawnSync(process.execPath, [hookScript], {
    cwd: hookCwd,
    input: JSON.stringify({ fullyIdle: true, terminationReason: "model_stop", workspacePaths, ...extraInput }),
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: dataRoot,
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_PAYLOAD: JSON.stringify(payload),
      INIT_CWD: hookCwd,
      PWD: hookCwd,
      ...extraEnv
    }
  });
}

function spawnHook(
  workspace: string,
  fakeCodex: string,
  payload: unknown,
  dataRoot: string,
  extraInput: Record<string, unknown> = {},
  extraEnv: Record<string, string> = {}
): ChildProcessWithoutNullStreams {
  withDataRoot(dataRoot, () => setReviewGateEnabled(workspace, true));
  const child = spawn(process.execPath, [hookScript], {
    cwd: workspace,
    env: {
      ...process.env,
      AGY_CODEX_DATA: dataRoot,
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_PAYLOAD: JSON.stringify(payload),
      INIT_CWD: workspace,
      PWD: workspace,
      ...extraEnv
    }
  });
  child.stdin.end(JSON.stringify({ fullyIdle: true, terminationReason: "model_stop", workspacePaths: [workspace], ...extraInput }));
  return child;
}

function waitForChild(child: ChildProcessWithoutNullStreams): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function makeTranscript(userRequest: string, source = "USER_EXPLICIT", content: unknown = `<USER_REQUEST>\n${userRequest}\n</USER_REQUEST>`): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-transcript-"));
  const transcript = path.join(tempRoot, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({
      source,
      type: "USER_INPUT",
      content
    })}\n`
  );
  return transcript;
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

test("review gate allows repeated identical findings to avoid a loop", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const payload = {
    verdict: "needs-attention",
    summary: "Risk found",
    findings: [
      {
        severity: "medium",
        title: "Repeated issue",
        file: "file.txt",
        line: 1,
        description: "The same issue keeps recurring.",
        recommendation: "Fix it once."
      }
    ],
    next_steps: ["Fix file.txt"]
  };
  const fakeCodex = makeFakeCodex(payload);

  const first = runHook(workspace, fakeCodex, payload, dataRoot);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).decision, "continue");

  const second = runHook(workspace, fakeCodex, payload, dataRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(20);
    assert.ok(events.some((event) => event.type === "skipped" && event.message?.includes("avoid a review-gate loop")));
    assert.ok(events.some((event) => event.type === "decision" && event.decision === "allow"));
  });
});

test("review gate re-runs after a recent continue and allows approval", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const firstPayload = {
    verdict: "needs-attention",
    summary: "Risk found",
    findings: [
      {
        severity: "medium",
        title: "Fix required",
        file: "file.txt",
        line: 1,
        description: "The file still needs a fix.",
        recommendation: "Update file.txt."
      }
    ],
    next_steps: ["Fix file.txt"]
  };
  const secondPayload = { verdict: "approve", summary: "fixed", findings: [], next_steps: [] };

  const first = runHook(workspace, makeFakeCodex(firstPayload), firstPayload, dataRoot);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).decision, "continue");

  fs.writeFileSync(path.join(workspace, "file.txt"), "after fix\n");

  const second = runHook(workspace, makeFakeCodex(secondPayload), secondPayload, dataRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(30);
    assert.equal(events.filter((event) => event.type === "codex-result").length, 2);
    assert.ok(events.some((event) => event.type === "codex-result" && event.verdict === "approve"));
    assert.equal(events.some((event) => event.type === "skipped" && event.message?.includes("Recent needs-attention")), false);
  });
});

test("review gate continues for different findings after a recent continue", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const firstPayload = {
    verdict: "needs-attention",
    summary: "First risk",
    findings: [
      {
        severity: "medium",
        title: "First issue",
        file: "file.txt",
        line: 1,
        description: "The first issue.",
        recommendation: "Fix the first issue."
      }
    ],
    next_steps: ["Fix first issue"]
  };
  const secondPayload = {
    verdict: "needs-attention",
    summary: "Second risk",
    findings: [
      {
        severity: "low",
        title: "Second issue",
        file: "file.txt",
        line: 1,
        description: "A different issue appeared.",
        recommendation: "Fix the second issue."
      }
    ],
    next_steps: ["Fix second issue"]
  };

  const first = runHook(workspace, makeFakeCodex(firstPayload), firstPayload, dataRoot);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).decision, "continue");

  fs.writeFileSync(path.join(workspace, "file.txt"), "after second issue\n");

  const second = runHook(workspace, makeFakeCodex(secondPayload), secondPayload, dataRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).decision, "continue");

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(20);
    assert.equal(events.filter((event) => event.type === "decision" && event.decision === "continue").length, 2);
  });
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

test("review gate chooses enabled workspace from Antigravity workspace paths", () => {
  const workspace = makeGitWorkspace();
  const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-brain-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const payload = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload, dataRoot, true, [brainDir, workspace]);
  assert.equal(result.status, 0, result.stderr);

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(10);
    assert.equal(events[0]?.workspace, fs.realpathSync(workspace));
    assert.ok(events.some((event) => event.type === "codex-result" && event.verdict === "approve"));
  });
});

test("review gate falls back to enabled workspace state when Antigravity omits workspace paths", () => {
  const workspace = makeGitWorkspace();
  const hookCwd = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-hook-cwd-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const payload = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload, dataRoot, true, [], hookCwd);
  assert.equal(result.status, 0, result.stderr);

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(10);
    assert.equal(events[0]?.workspace, fs.realpathSync(workspace));
    assert.ok(events.some((event) => event.type === "codex-result" && event.verdict === "approve"));
  });
});

test("review gate does not fall back to another enabled workspace when current git workspace is disabled", () => {
  const enabledWorkspace = makeGitWorkspace();
  const disabledWorkspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const payload = { verdict: "approve", summary: "should not run", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(enabledWorkspace, fakeCodex, payload, dataRoot, true, [disabledWorkspace], disabledWorkspace);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    assert.deepEqual(readReviewGateEvents(10), []);
  });
});

test("review gate records a terminal decision when Codex review times out", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const fakeCodex = makeHangingCodex();
  const result = runHook(
    workspace,
    fakeCodex,
    {},
    dataRoot,
    true,
    [workspace],
    workspace,
    {},
    { AGY_CODEX_REVIEW_TIMEOUT_MS: "50" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(10);
    assert.ok(events.some((event) => event.type === "error" && event.message?.includes("timed out")));
    assert.ok(events.some((event) => event.type === "decision" && event.decision === "allow"));
  });
});

test("review gate suppresses duplicate concurrent Stop hook invocations", async () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const fakeCodex = makeHangingCodex();
  const transcriptPath = makeTranscript("finish the current task");
  const first = spawnHook(
    workspace,
    fakeCodex,
    {},
    dataRoot,
    { transcriptPath },
    { AGY_CODEX_REVIEW_TIMEOUT_MS: "500" }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  const second = spawnHook(
    workspace,
    fakeCodex,
    {},
    dataRoot,
    { transcriptPath },
    { AGY_CODEX_REVIEW_TIMEOUT_MS: "500" }
  );
  const secondResult = await waitForChild(second);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.deepEqual(JSON.parse(secondResult.stdout), { decision: "allow" });

  const firstResult = await waitForChild(first);
  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.deepEqual(JSON.parse(firstResult.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    const events = readReviewGateEvents(20);
    assert.equal(events.filter((event) => event.type === "started").length, 1);
    assert.ok(events.some((event) => event.type === "error" && event.message?.includes("timed out")));
  });
});

test("review gate skips explicit codex slash command sessions", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const transcriptPath = makeTranscript("/codex:monitor");
  const payload = { verdict: "needs-attention", summary: "should not run", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload, dataRoot, true, [workspace], workspace, { transcriptPath });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    assert.deepEqual(readReviewGateEvents(10), []);
  });
});

test("review gate recognizes codex slash commands from lowercase and structured transcript entries", () => {
  const workspace = makeGitWorkspace();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-gate-data-"));
  const transcriptPath = makeTranscript(
    "/codex:status",
    "user",
    [{ type: "text", text: "<USER_REQUEST>\n/codex:status\n</USER_REQUEST>" }]
  );
  const payload = { verdict: "needs-attention", summary: "should not run", findings: [], next_steps: [] };
  const fakeCodex = makeFakeCodex(payload);
  const result = runHook(workspace, fakeCodex, payload, dataRoot, true, [workspace], workspace, { transcriptPath });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });

  withDataRoot(dataRoot, () => {
    assert.deepEqual(readReviewGateEvents(10), []);
  });
});
