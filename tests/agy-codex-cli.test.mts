import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const companion = path.join(repoRoot, "dist", "agy-codex.mjs");

function makeFakeCodex(): { script: string; dataRoot: string; antigravityConfigDir: string; workspace: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-cli-test-"));
  const script = path.join(tempRoot, "fake-codex.js");
  fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  return {
    script,
    dataRoot: path.join(tempRoot, "data"),
    antigravityConfigDir: path.join(tempRoot, "gemini-config"),
    workspace: fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-work-"))
  };
}

function runCompanion(args: string[]) {
  const fake = makeFakeCodex();
  return spawnSync(process.execPath, [companion, ...args, "--cwd", fake.workspace], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: fake.dataRoot,
      AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
      CODEX_BIN: fake.script
    }
  });
}

test("review defaults to uncommitted changes", () => {
  const result = runCompanion(["review", "--wait"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["--ask-for-approval", "never", "exec", "review", "--uncommitted"]);
});

test("review rejects custom focus text", () => {
  const result = runCompanion(["review", "focus on auth"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /adversarial-review/);
  assert.equal(result.stdout, "");
});

test("review supports base refs without focus text", () => {
  const result = runCompanion(["review", "--base", "main", "--wait"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["--ask-for-approval", "never", "exec", "review", "--base", "main"]);
});

test("monitor status reports stopped without a running server", () => {
  const fake = makeFakeCodex();
  const result = spawnSync(process.execPath, [companion, "monitor", "--status", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: fake.dataRoot,
      AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { running: boolean };
  assert.equal(payload.running, false);
});

test("monitor clear removes stored review gate events", () => {
  const fake = makeFakeCodex();
  const eventsDir = path.join(fake.dataRoot, "review-gate");
  const eventsFile = path.join(eventsDir, "events.jsonl");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(eventsFile, '{"id":"old","time":"now","type":"started"}\n');

  const result = spawnSync(process.execPath, [companion, "monitor", "--clear", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: fake.dataRoot,
      AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { cleared: boolean };
  assert.equal(payload.cleared, true);
  assert.equal(fs.existsSync(eventsFile), false);
});

test("setup stores review gate config outside hooks manifest", () => {
  const fake = makeFakeCodex();
  const hooksFile = path.join(repoRoot, "hooks", "hooks.json");
  const hooksBefore = fs.readFileSync(hooksFile, "utf8");
  const result = spawnSync(
    process.execPath,
    [companion, "setup", "--enable-review-gate", "--json", "--cwd", fake.workspace],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGY_CODEX_DATA: fake.dataRoot,
        AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
        CODEX_BIN: fake.script
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    reviewGate: {
      enabled: boolean;
      hooksFile: string;
      configDir: string;
      activeHooksFile: string;
      activeHookInstalled: boolean;
      activeHookCommand: string;
    };
  };
  assert.equal(payload.reviewGate.enabled, true);
  assert.equal(payload.reviewGate.activeHookInstalled, true);
  assert.match(payload.reviewGate.configDir, /workspaces/);
  assert.equal(payload.reviewGate.activeHooksFile, path.join(fake.antigravityConfigDir, "hooks.json"));
  assert.match(payload.reviewGate.activeHookCommand, /stop-review-gate-hook\.mjs/);
  assert.equal(fs.readFileSync(hooksFile, "utf8"), hooksBefore);
});

test("setup preserves unrelated active hooks and removes only codex hook on disable", () => {
  const fake = makeFakeCodex();
  const activeHooksFile = path.join(fake.antigravityConfigDir, "hooks.json");
  fs.mkdirSync(fake.antigravityConfigDir, { recursive: true });
  fs.writeFileSync(
    activeHooksFile,
    `${JSON.stringify(
      {
        "other-stop-hook": {
          Stop: [{ type: "command", command: "echo other", timeout: 10 }]
        }
      },
      null,
      2
    )}\n`
  );

  const enable = spawnSync(
    process.execPath,
    [companion, "setup", "--enable-review-gate", "--json", "--cwd", fake.workspace],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGY_CODEX_DATA: fake.dataRoot,
        AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
        CODEX_BIN: fake.script
      }
    }
  );
  assert.equal(enable.status, 0, enable.stderr);
  const afterEnable = JSON.parse(fs.readFileSync(activeHooksFile, "utf8")) as Record<string, unknown>;
  assert.ok(afterEnable["other-stop-hook"]);
  assert.ok(afterEnable["codex-stop-review-gate"]);

  const disable = spawnSync(
    process.execPath,
    [companion, "setup", "--disable-review-gate", "--json", "--cwd", fake.workspace],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGY_CODEX_DATA: fake.dataRoot,
        AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
        CODEX_BIN: fake.script
      }
    }
  );
  assert.equal(disable.status, 0, disable.stderr);
  const afterDisable = JSON.parse(fs.readFileSync(activeHooksFile, "utf8")) as Record<string, unknown>;
  assert.ok(afterDisable["other-stop-hook"]);
  assert.equal(afterDisable["codex-stop-review-gate"], undefined);
});

test("doctor reports diagnostics as json", () => {
  const result = runCompanion(["doctor", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    diagnosis: string;
    checks: unknown[];
    reviewGate: { eventsFile: string };
  };
  assert.equal(typeof payload.diagnosis, "string");
  assert.ok(Array.isArray(payload.checks));
  assert.match(payload.reviewGate.eventsFile, /review-gate/);
});

test("doctor smoke test verifies hook event writing", () => {
  const result = runCompanion(["doctor", "--run-hook-test", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    hookSmokeTest: { status: string; eventsRecorded: number } | null;
  };
  assert.equal(payload.hookSmokeTest?.status, "pass");
  assert.ok((payload.hookSmokeTest?.eventsRecorded ?? 0) > 0);
});
