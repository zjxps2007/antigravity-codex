import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeMonitorHost } from "../dist/lib/monitor-server.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const companion = path.join(repoRoot, "dist", "agy-codex.mjs");

function makeFakeCodex(): {
  script: string;
  dataRoot: string;
  antigravityConfigDir: string;
  antigravityCliRoot: string;
  workspace: string;
} {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-cli-test-"));
  const script = path.join(tempRoot, "fake-codex.js");
  fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  return {
    script,
    dataRoot: path.join(tempRoot, "data"),
    antigravityConfigDir: path.join(tempRoot, "gemini-config"),
    antigravityCliRoot: path.join(tempRoot, "antigravity-cli"),
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
      AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
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
      AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { running: boolean };
  assert.equal(payload.running, false);
});

test("monitor host accepts loopback and wildcard bindings", () => {
  assert.equal(normalizeMonitorHost(undefined), "127.0.0.1");
  assert.equal(normalizeMonitorHost("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeMonitorHost("0.0.0.0"), "0.0.0.0");
  assert.throws(() => normalizeMonitorHost("example.com"), /Monitor host/);
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
      AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { cleared: boolean };
  assert.equal(payload.cleared, true);
  assert.equal(fs.existsSync(eventsFile), false);
});

test("monitor clear keeps review gate events from other workspaces", () => {
  const fake = makeFakeCodex();
  const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-other-work-"));
  const eventsDir = path.join(fake.dataRoot, "review-gate");
  const eventsFile = path.join(eventsDir, "events.jsonl");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    eventsFile,
    [
      JSON.stringify({ id: "current", workspace: fake.workspace, time: "now", type: "started" }),
      JSON.stringify({ id: "other", workspace: otherWorkspace, time: "now", type: "started" })
    ].join("\n") + "\n"
  );

  const result = spawnSync(process.execPath, [companion, "monitor", "--clear", "--json"], {
    cwd: fake.workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: fake.dataRoot,
      AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
      AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { cleared: boolean };
  assert.equal(payload.cleared, true);
  const remaining = fs.readFileSync(eventsFile, "utf8");
  assert.doesNotMatch(remaining, /current/);
  assert.match(remaining, /other/);
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
        AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
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

test("setup activates imported plugin stop hooks with the local command", () => {
  const fake = makeFakeCodex();
  const importedHook = {
    "codex-stop-review-gate": {
      enabled: false,
      Stop: [{ type: "command", command: "npx -y --package github:zjxps2007/antigravity-codex agy-codex-review-gate", timeout: 300 }]
    }
  };
  const configPluginHooks = path.join(fake.antigravityConfigDir, "plugins", "codex", "hooks.json");
  const cliPluginHooks = path.join(fake.antigravityCliRoot, "plugins", "codex", "hooks.json");
  for (const file of [configPluginHooks, cliPluginHooks]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(importedHook, null, 2)}\n`);
  }

  const result = spawnSync(process.execPath, [companion, "setup", "--enable-review-gate", "--json", "--cwd", fake.workspace], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CODEX_DATA: fake.dataRoot,
      AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
      AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
      CODEX_BIN: fake.script
    }
  });
  assert.equal(result.status, 0, result.stderr);

  for (const file of [configPluginHooks, cliPluginHooks]) {
    const hooks = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, {
      enabled: boolean;
      Stop: Array<{ command: string; timeout: number }>;
    }>;
    assert.equal(hooks["codex-stop-review-gate"]?.enabled, true);
    assert.match(hooks["codex-stop-review-gate"]?.Stop[0]?.command ?? "", /stop-review-gate-hook\.mjs/);
    assert.equal(hooks["codex-stop-review-gate"]?.Stop[0]?.timeout, 300);
  }
});

test("setup preserves unrelated active hooks and removes only codex hook on disable", () => {
  const fake = makeFakeCodex();
  const activeHooksFile = path.join(fake.antigravityConfigDir, "hooks.json");
  const configPluginHooks = path.join(fake.antigravityConfigDir, "plugins", "codex", "hooks.json");
  const cliPluginHooks = path.join(fake.antigravityCliRoot, "plugins", "codex", "hooks.json");
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
        AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
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
        AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
        CODEX_BIN: fake.script
      }
    }
  );
  assert.equal(disable.status, 0, disable.stderr);
  const afterDisable = JSON.parse(fs.readFileSync(activeHooksFile, "utf8")) as Record<string, unknown>;
  assert.ok(afterDisable["other-stop-hook"]);
  assert.equal(afterDisable["codex-stop-review-gate"], undefined);

  for (const file of [configPluginHooks, cliPluginHooks]) {
    const hooks = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { enabled: boolean }>;
    assert.equal(hooks["codex-stop-review-gate"]?.enabled, false);
  }
});

test("setup disable keeps active hook while another workspace remains enabled", () => {
  const fake = makeFakeCodex();
  const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-work-"));
  const activeHooksFile = path.join(fake.antigravityConfigDir, "hooks.json");
  const env = {
    ...process.env,
    AGY_CODEX_DATA: fake.dataRoot,
    AGY_CODEX_ANTIGRAVITY_CONFIG_DIR: fake.antigravityConfigDir,
    AGY_CODEX_ANTIGRAVITY_CLI_ROOT: fake.antigravityCliRoot,
    CODEX_BIN: fake.script
  };

  for (const workspace of [fake.workspace, otherWorkspace]) {
    const enable = spawnSync(
      process.execPath,
      [companion, "setup", "--enable-review-gate", "--json", "--cwd", workspace],
      { cwd: repoRoot, encoding: "utf8", env }
    );
    assert.equal(enable.status, 0, enable.stderr);
  }

  const disableOne = spawnSync(
    process.execPath,
    [companion, "setup", "--disable-review-gate", "--json", "--cwd", fake.workspace],
    { cwd: repoRoot, encoding: "utf8", env }
  );
  assert.equal(disableOne.status, 0, disableOne.stderr);
  const payload = JSON.parse(disableOne.stdout) as { reviewGate: { enabled: boolean; activeHookInstalled: boolean } };
  assert.equal(payload.reviewGate.enabled, false);
  assert.equal(payload.reviewGate.activeHookInstalled, true);

  const afterDisableOne = JSON.parse(fs.readFileSync(activeHooksFile, "utf8")) as Record<string, unknown>;
  assert.ok(afterDisableOne["codex-stop-review-gate"]);
  for (const file of [
    path.join(fake.antigravityConfigDir, "plugins", "codex", "hooks.json"),
    path.join(fake.antigravityCliRoot, "plugins", "codex", "hooks.json")
  ]) {
    const hooks = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { enabled: boolean }>;
    assert.equal(hooks["codex-stop-review-gate"]?.enabled, true);
  }
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
