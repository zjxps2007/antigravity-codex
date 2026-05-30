import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const REVIEW_GATE_HOOK_NAME = "codex-stop-review-gate";
export const REVIEW_GATE_HOOK_TIMEOUT_SECONDS = 300;
export const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
export const NPX_REVIEW_GATE_COMMAND = `npx -y --package ${NPX_PACKAGE_SPEC} agy-codex-review-gate`;

export interface ActiveReviewGateHookInfo {
  configDir: string;
  hooksFile: string;
  hooksFileExists: boolean;
  installed: boolean;
  enabled: boolean | null;
  command: string | null;
  timeout: number | null;
  error: string | null;
}

export interface ImportedReviewGateHookInfo {
  hooksFile: string;
  exists: boolean;
  installed: boolean;
  enabled: boolean | null;
  disabled: boolean;
  command: string | null;
  timeout: number | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function antigravityConfigDir(): string {
  return path.resolve(
    process.env.AGY_CODEX_ANTIGRAVITY_CONFIG_DIR ?? path.join(os.homedir(), ".gemini", "config")
  );
}

export function antigravityHooksFile(): string {
  return path.join(antigravityConfigDir(), "hooks.json");
}

export function antigravityCliRoot(): string {
  return path.resolve(
    process.env.AGY_CODEX_ANTIGRAVITY_CLI_ROOT ?? path.join(os.homedir(), ".gemini", "antigravity-cli")
  );
}

function importedReviewGateHookFiles(): string[] {
  return Array.from(new Set([
    path.join(antigravityConfigDir(), "plugins", "codex", "hooks.json"),
    path.join(antigravityCliRoot(), "plugins", "codex", "hooks.json")
  ]));
}

function readHooksObject(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Antigravity hooks config at ${file}: ${message}`);
  }
}

function writeHooksObject(file: string, hooks: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(hooks, null, 2)}\n`);
  fs.renameSync(tmpFile, file);
}

function quoteCommandPart(value: string): string {
  if (process.platform === "win32") {
    return /[\s"]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
  }
  return /^[A-Za-z0-9_/:=.,@%+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function findLocalReviewGateHookScript(rootDir: string): string | null {
  for (const candidate of [
    path.join(rootDir, "hooks", "bin", "stop-review-gate-hook.mjs"),
    path.join(rootDir, "dist", "stop-review-gate-hook.mjs")
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function buildActiveReviewGateHookCommand(rootDir: string): string {
  const script = findLocalReviewGateHookScript(rootDir);
  if (!script) {
    return NPX_REVIEW_GATE_COMMAND;
  }
  return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(script)}`;
}

function readHookEntry(hooks: Record<string, unknown>): {
  enabled: boolean | null;
  command: string | null;
  timeout: number | null;
} {
  const hook = hooks[REVIEW_GATE_HOOK_NAME];
  const hookObject = isRecord(hook) ? hook : null;
  const stopEntries = Array.isArray(hookObject?.Stop) ? hookObject.Stop : [];
  const commandEntry = stopEntries.find((item): item is Record<string, unknown> => {
    return isRecord(item) && item.type === "command";
  });
  return {
    enabled: typeof hookObject?.enabled === "boolean" ? hookObject.enabled : null,
    command: typeof commandEntry?.command === "string" ? commandEntry.command : null,
    timeout: typeof commandEntry?.timeout === "number" ? commandEntry.timeout : null
  };
}

export function inspectActiveReviewGateHook(): ActiveReviewGateHookInfo {
  const configDir = antigravityConfigDir();
  const hooksFile = antigravityHooksFile();
  try {
    const hooks = readHooksObject(hooksFile);
    const entry = readHookEntry(hooks);
    return {
      configDir,
      hooksFile,
      hooksFileExists: fs.existsSync(hooksFile),
      installed: Boolean(entry.command && entry.enabled !== false),
      enabled: entry.enabled,
      command: entry.command,
      timeout: entry.timeout,
      error: null
    };
  } catch (error) {
    return {
      configDir,
      hooksFile,
      hooksFileExists: fs.existsSync(hooksFile),
      installed: false,
      enabled: null,
      command: null,
      timeout: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function inspectImportedReviewGateHook(hooksFile: string): ImportedReviewGateHookInfo {
  if (!fs.existsSync(hooksFile)) {
    return {
      hooksFile,
      exists: false,
      installed: false,
      enabled: null,
      disabled: false,
      command: null,
      timeout: null,
      error: null
    };
  }

  try {
    const hooks = readHooksObject(hooksFile);
    const entry = readHookEntry(hooks);
    return {
      hooksFile,
      exists: true,
      installed: Boolean(entry.command && entry.enabled !== false),
      enabled: entry.enabled,
      disabled: entry.enabled === false,
      command: entry.command,
      timeout: entry.timeout,
      error: null
    };
  } catch (error) {
    return {
      hooksFile,
      exists: true,
      installed: false,
      enabled: null,
      disabled: false,
      command: null,
      timeout: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function inspectImportedReviewGateHooks(): ImportedReviewGateHookInfo[] {
  return importedReviewGateHookFiles().map((hooksFile) => inspectImportedReviewGateHook(hooksFile));
}

export function installImportedReviewGateHooks(rootDir: string): ImportedReviewGateHookInfo[] {
  return importedReviewGateHookFiles().map((hooksFile) => {
    const hooks = readHooksObject(hooksFile);
    hooks[REVIEW_GATE_HOOK_NAME] = {
      enabled: true,
      Stop: [
        {
          type: "command",
          command: buildActiveReviewGateHookCommand(rootDir),
          timeout: REVIEW_GATE_HOOK_TIMEOUT_SECONDS
        }
      ]
    };
    writeHooksObject(hooksFile, hooks);
    return inspectImportedReviewGateHook(hooksFile);
  });
}

export function installActiveReviewGateHook(rootDir: string): ActiveReviewGateHookInfo {
  installImportedReviewGateHooks(rootDir);
  const hooksFile = antigravityHooksFile();
  const hooks = readHooksObject(hooksFile);
  hooks[REVIEW_GATE_HOOK_NAME] = {
    enabled: true,
    Stop: [
      {
        type: "command",
        command: buildActiveReviewGateHookCommand(rootDir),
        timeout: REVIEW_GATE_HOOK_TIMEOUT_SECONDS
      }
    ]
  };
  writeHooksObject(hooksFile, hooks);
  return inspectActiveReviewGateHook();
}

export function disableImportedReviewGateHooks(): ImportedReviewGateHookInfo[] {
  return importedReviewGateHookFiles().map((hooksFile) => {
    if (!fs.existsSync(hooksFile)) {
      return inspectImportedReviewGateHook(hooksFile);
    }

    try {
      const hooks = readHooksObject(hooksFile);
      const hook = hooks[REVIEW_GATE_HOOK_NAME];
      if (!isRecord(hook)) {
        return inspectImportedReviewGateHook(hooksFile);
      }

      if (hook.enabled !== false) {
        hooks[REVIEW_GATE_HOOK_NAME] = {
          ...hook,
          enabled: false
        };
        writeHooksObject(hooksFile, hooks);
      }

      return inspectImportedReviewGateHook(hooksFile);
    } catch (error) {
      return {
        hooksFile,
        exists: true,
        installed: false,
        enabled: null,
        disabled: false,
        command: null,
        timeout: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

export function removeActiveReviewGateHook(): ActiveReviewGateHookInfo {
  const hooksFile = antigravityHooksFile();
  if (!fs.existsSync(hooksFile)) {
    return inspectActiveReviewGateHook();
  }
  const hooks = readHooksObject(hooksFile);
  delete hooks[REVIEW_GATE_HOOK_NAME];
  if (Object.keys(hooks).length === 0) {
    fs.rmSync(hooksFile, { force: true });
  } else {
    writeHooksObject(hooksFile, hooks);
  }
  return inspectActiveReviewGateHook();
}
