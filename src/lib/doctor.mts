import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  inspectActiveReviewGateHook,
  type ActiveReviewGateHookInfo
} from "./antigravity-hooks.mjs";
import { commandAvailable, codexAvailable, type CommandAvailability } from "./exec-resolver.mjs";
import {
  readReviewGateEvents,
  reviewGateEventsFile,
  type ReviewGateEvent
} from "./review-gate-events.mjs";
import {
  isReviewGateEnabled,
  resolveWorkspaceRoot,
  setReviewGateEnabled,
  workspaceStateDir
} from "./state.mjs";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface GitDoctorInfo {
  isRepo: boolean;
  root: string | null;
  hasChanges: boolean;
  status: number | null;
  error: string | null;
}

export interface AntigravityDoctorInfo {
  cliRoot: string;
  importManifestFile: string;
  importManifestExists: boolean;
  importSource: string | null;
  importComponents: string[];
  installedPluginDir: string;
  installedHooksFile: string;
  installedHooksFileExists: boolean;
  installedHookCommand: string | null;
  installedHookEnabled: boolean | null;
}

export interface ReviewGateDoctorInfo {
  enabled: boolean;
  configDir: string;
  eventsFile: string;
  eventsFileExists: boolean;
  eventCount: number;
  lastEvent: ReviewGateEvent | null;
}

export interface HookSmokeTestResult {
  status: DoctorCheckStatus;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  eventsRecorded: number;
  error: string | null;
}

export interface DoctorReport {
  workspaceRoot: string;
  rootDir: string;
  ready: boolean;
  diagnosis: string;
  checks: DoctorCheck[];
  node: CommandAvailability | null;
  codex: CommandAvailability | null;
  git: GitDoctorInfo;
  antigravity: AntigravityDoctorInfo;
  activeHook: ActiveReviewGateHookInfo;
  reviewGate: ReviewGateDoctorInfo;
  hookSmokeTest: HookSmokeTestResult | null;
  nextSteps: string[];
}

export interface DoctorOptions {
  rootDir: string;
  checkExecutables?: boolean;
  runHookTest?: boolean;
}

function antigravityCliRoot(): string {
  return path.join(os.homedir(), ".gemini", "antigravity-cli");
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function inspectAntigravity(): AntigravityDoctorInfo {
  const cliRoot = antigravityCliRoot();
  const importManifestFile = path.join(cliRoot, "import_manifest.json");
  const installedPluginDir = path.join(cliRoot, "plugins", "codex");
  const installedHooksFile = path.join(installedPluginDir, "hooks.json");
  const manifest = readJsonObject(importManifestFile);
  const imports = Array.isArray(manifest?.imports) ? manifest.imports : [];
  const codexImport = imports.find((item): item is Record<string, unknown> => {
    return typeof item === "object" && item !== null && (item as Record<string, unknown>).name === "codex";
  });
  const hooks = readJsonObject(installedHooksFile);
  const stopHook = hooks?.["codex-stop-review-gate"];
  const stopHookObject = typeof stopHook === "object" && stopHook ? (stopHook as Record<string, unknown>) : null;
  const stopEntries = Array.isArray(stopHookObject?.Stop) ? stopHookObject.Stop : [];
  const commandEntry = stopEntries.find((item): item is Record<string, unknown> => {
    return typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "command";
  });
  const command = typeof commandEntry?.command === "string" ? commandEntry.command : null;
  const enabled = typeof stopHookObject?.enabled === "boolean" ? stopHookObject.enabled : null;

  return {
    cliRoot,
    importManifestFile,
    importManifestExists: fs.existsSync(importManifestFile),
    importSource: typeof codexImport?.source === "string" ? codexImport.source : null,
    importComponents: stringArray(codexImport?.components),
    installedPluginDir,
    installedHooksFile,
    installedHooksFileExists: fs.existsSync(installedHooksFile),
    installedHookCommand: command,
    installedHookEnabled: enabled
  };
}

function inspectGit(cwd: string): GitDoctorInfo {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return {
      isRepo: false,
      root: null,
      hasChanges: false,
      status: inside.status,
      error: inside.stderr?.trim() || inside.error?.message || null
    };
  }

  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    isRepo: true,
    root: root.status === 0 && root.stdout.trim() ? path.resolve(root.stdout.trim()) : cwd,
    hasChanges: status.status === 0 && Boolean(status.stdout?.trim()),
    status: status.status,
    error: status.stderr?.trim() || status.error?.message || null
  };
}

function inspectReviewGate(cwd: string): ReviewGateDoctorInfo {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const events = readReviewGateEvents(1000).filter(
    (event) => event.workspace && path.resolve(event.workspace) === workspaceRoot
  );
  const eventsFile = reviewGateEventsFile();
  return {
    enabled: isReviewGateEnabled(cwd),
    configDir: workspaceStateDir(cwd),
    eventsFile,
    eventsFileExists: fs.existsSync(eventsFile),
    eventCount: events.length,
    lastEvent: events.at(-1) ?? null
  };
}

function hookScriptPath(rootDir: string): string | null {
  for (const candidate of [
    path.join(rootDir, "hooks", "bin", "stop-review-gate-hook.mjs"),
    path.join(rootDir, "dist", "stop-review-gate-hook.mjs")
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function withTemporaryDataRoot<T>(dataRoot: string, fn: () => T): T {
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

function runHookSmokeTest(
  cwd: string,
  rootDir: string,
  activeHookCommand: string | null,
  installedHookCommand: string | null
): HookSmokeTestResult {
  const script = hookScriptPath(rootDir);
  const commandToRun =
    activeHookCommand || (script ? `${process.execPath} ${script}` : null) || installedHookCommand;
  if (!commandToRun) {
    return {
      status: "fail",
      command: "",
      exitCode: null,
      stdout: "",
      stderr: "",
      eventsRecorded: 0,
      error: "Unable to locate installed hook command or stop-review-gate-hook.mjs."
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-doctor-"));
  try {
    withTemporaryDataRoot(tempRoot, () => setReviewGateEnabled(cwd, true));
    const useShell = Boolean(activeHookCommand || (!script && installedHookCommand));
    const cmd = useShell ? commandToRun : process.execPath;
    const cmdArgs = useShell ? [] : [script!];

    const result = spawnSync(cmd, cmdArgs, {
      cwd,
      shell: useShell,
      input: JSON.stringify({
        terminationReason: "model_stop",
        fullyIdle: true,
        workspacePaths: [cwd]
      }),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        AGY_CODEX_DATA: tempRoot,
        AGY_CODEX_REVIEW_GATE_BYPASS: "1"
      }
    });
    const eventsRecorded = withTemporaryDataRoot(tempRoot, () => readReviewGateEvents(20).length);
    const passed = result.status === 0 && eventsRecorded > 0;
    return {
      status: passed ? "pass" : "fail",
      command: commandToRun,
      exitCode: result.status,
      stdout: result.stdout?.trim() ?? "",
      stderr: result.stderr?.trim() ?? "",
      eventsRecorded,
      error: result.error?.message ?? null
    };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

function addCheck(checks: DoctorCheck[], name: string, status: DoctorCheckStatus, message: string): void {
  checks.push({ name, status, message });
}

function buildChecks(
  node: CommandAvailability | null,
  codex: CommandAvailability | null,
  git: GitDoctorInfo,
  antigravity: AntigravityDoctorInfo,
  activeHook: ActiveReviewGateHookInfo,
  reviewGate: ReviewGateDoctorInfo,
  hookSmokeTest: HookSmokeTestResult | null
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  addCheck(
    checks,
    "Node",
    node ? (node.available ? "pass" : "fail") : "skip",
    node ? (node.available ? node.stdout : node.error ?? node.stderr ?? "missing") : "not checked"
  );
  addCheck(
    checks,
    "Codex CLI",
    codex ? (codex.available ? "pass" : "fail") : "skip",
    codex ? (codex.available ? codex.stdout : codex.error ?? codex.stderr ?? "missing") : "not checked"
  );
  addCheck(checks, "Git workspace", git.isRepo ? "pass" : "fail", git.root ?? git.error ?? "not a git repository");
  addCheck(
    checks,
    "Git changes",
    git.isRepo && git.hasChanges ? "pass" : "warn",
    git.isRepo
      ? git.hasChanges
        ? "uncommitted changes are available for review"
        : "working tree is clean; the Stop hook will skip Codex review"
      : "not checked because this is not a git repository"
  );
  addCheck(
    checks,
    "Review gate config",
    reviewGate.enabled ? "pass" : "fail",
    reviewGate.enabled ? `enabled at ${reviewGate.configDir}` : `disabled at ${reviewGate.configDir}`
  );
  addCheck(
    checks,
    "Antigravity import",
    antigravity.importComponents.includes("hooks") ? "pass" : "fail",
    antigravity.importManifestExists
      ? `components: ${antigravity.importComponents.join(", ") || "none"}`
      : `missing ${antigravity.importManifestFile}`
  );
  addCheck(
    checks,
    "Installed Stop hook",
    antigravity.installedHookCommand && antigravity.installedHookEnabled !== false ? "pass" : "fail",
    antigravity.installedHooksFileExists
      ? antigravity.installedHookCommand ?? "codex-stop-review-gate command missing"
      : `missing ${antigravity.installedHooksFile}`
  );
  addCheck(
    checks,
    "Active Stop hook",
    reviewGate.enabled ? (activeHook.installed ? "pass" : "fail") : "skip",
    reviewGate.enabled
      ? activeHook.error ??
          (activeHook.installed
            ? `${activeHook.command} at ${activeHook.hooksFile}`
            : `missing ${activeHook.hooksFile}`)
      : "not required while Review Gate is disabled"
  );
  addCheck(
    checks,
    "Review gate events",
    reviewGate.eventCount > 0 ? "pass" : "warn",
    reviewGate.eventCount > 0
      ? `${reviewGate.eventCount} event(s), last ${reviewGate.lastEvent?.time ?? "unknown"}`
      : `no events at ${reviewGate.eventsFile}`
  );
  if (hookSmokeTest) {
    addCheck(
      checks,
      "Manual hook smoke test",
      hookSmokeTest.status,
      hookSmokeTest.status === "pass"
        ? `${hookSmokeTest.eventsRecorded} event(s) recorded in isolated data root`
        : hookSmokeTest.error ?? (hookSmokeTest.stderr || "manual hook test failed")
    );
  }
  return checks;
}

function nextStepsFor(
  git: GitDoctorInfo,
  antigravity: AntigravityDoctorInfo,
  activeHook: ActiveReviewGateHookInfo,
  reviewGate: ReviewGateDoctorInfo,
  hookSmokeTest: HookSmokeTestResult | null
): string[] {
  const steps: string[] = [];
  if (!antigravity.importComponents.includes("hooks") || !antigravity.installedHookCommand) {
    steps.push("Reinstall the plugin with `agy plugin uninstall codex` and `agy plugin install https://github.com/zjxps2007/antigravity-codex.git`.");
  }
  if (!reviewGate.enabled) {
    steps.push("Run `/codex:setup --enable-review-gate` in this workspace.");
  }
  if (reviewGate.enabled && !activeHook.installed) {
    steps.push(`Run \`/codex:setup --enable-review-gate\` again to install the active Stop hook at ${activeHook.hooksFile}.`);
  }
  if (!git.isRepo) {
    steps.push("Open a git repository workspace before expecting review-gate checks.");
  } else if (!git.hasChanges) {
    steps.push("Create a staged, unstaged, or untracked change before testing automatic review.");
  }
  if (reviewGate.enabled && reviewGate.eventCount === 0 && !hookSmokeTest) {
    steps.push("Run `/codex:doctor --run-hook-test` to verify the hook command and event writer without invoking Codex.");
  }
  if (hookSmokeTest?.status === "pass" && reviewGate.eventCount === 0) {
    steps.push("Start a fresh Antigravity session after plugin reinstall; the local hook path works, but no automatic Stop-hook event has been recorded.");
  }
  return steps;
}

function diagnosisFor(
  git: GitDoctorInfo,
  antigravity: AntigravityDoctorInfo,
  activeHook: ActiveReviewGateHookInfo,
  reviewGate: ReviewGateDoctorInfo,
  hookSmokeTest: HookSmokeTestResult | null
): string {
  if (!antigravity.importComponents.includes("hooks") || !antigravity.installedHookCommand) {
    return "Antigravity has not installed the codex Stop hook.";
  }
  if (!reviewGate.enabled) {
    return "Review Gate is disabled for this workspace.";
  }
  if (!activeHook.installed) {
    return "Review Gate is enabled, but Antigravity's active hooks config does not contain the codex Stop hook.";
  }
  if (!git.isRepo) {
    return "The current workspace is not a git repository, so the review gate cannot inspect changes.";
  }
  if (!git.hasChanges) {
    return "Review Gate is configured, but the working tree is clean; the hook will skip Codex review.";
  }
  if (reviewGate.eventCount > 0) {
    return "Review Gate events are being recorded; the monitor should be able to display them.";
  }
  if (hookSmokeTest?.status === "pass") {
    return "Manual hook logging works, but no automatic Antigravity Stop-hook event has been recorded.";
  }
  if (hookSmokeTest?.status === "fail") {
    return "Manual hook logging failed; fix the local hook command before testing Antigravity automation.";
  }
  return "No Review Gate events have been recorded yet; run a hook smoke test or start a fresh Antigravity session.";
}

export function buildDoctorReport(cwd: string, options: DoctorOptions): DoctorReport {
  const workspaceRoot = path.resolve(cwd);
  const node = options.checkExecutables === false ? null : commandAvailable("node", ["--version"], workspaceRoot);
  const codex = options.checkExecutables === false ? null : codexAvailable(workspaceRoot);
  const git = inspectGit(workspaceRoot);
  const antigravity = inspectAntigravity();
  const activeHook = inspectActiveReviewGateHook();
  const reviewGate = inspectReviewGate(workspaceRoot);
  const hookSmokeTest = options.runHookTest
    ? runHookSmokeTest(workspaceRoot, options.rootDir, activeHook.command, antigravity.installedHookCommand)
    : null;
  const checks = buildChecks(node, codex, git, antigravity, activeHook, reviewGate, hookSmokeTest);
  const nextSteps = nextStepsFor(git, antigravity, activeHook, reviewGate, hookSmokeTest);

  return {
    workspaceRoot,
    rootDir: options.rootDir,
    ready: checks.every((check) => check.status !== "fail"),
    diagnosis: diagnosisFor(git, antigravity, activeHook, reviewGate, hookSmokeTest),
    checks,
    node,
    codex,
    git,
    antigravity,
    activeHook,
    reviewGate,
    hookSmokeTest,
    nextSteps
  };
}

export function printDoctorReport(report: DoctorReport): void {
  console.log("# Antigravity Codex doctor");
  console.log(`Workspace: ${report.workspaceRoot}`);
  console.log(`Diagnosis: ${report.diagnosis}`);
  console.log("");
  console.log("Checks:");
  for (const check of report.checks) {
    console.log(`[${check.status}] ${check.name}: ${check.message}`);
  }
  if (report.nextSteps.length) {
    console.log("");
    console.log("Next steps:");
    for (const step of report.nextSteps) {
      console.log(`- ${step}`);
    }
  }
}
