import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexInvocation, resolveRuntimeRoot } from "./exec-resolver.mjs";
import type { CodexRequest } from "./state.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);

export const MODEL_ALIASES = new Map<string, string>([["spark", "gpt-5.3-codex-spark"]]);
export const VALID_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

const ROOT_DIR = resolveRuntimeRoot(SCRIPT_DIR);
const REVIEW_SCHEMA_CANDIDATES = [
  path.join(ROOT_DIR, "schemas", "review-output.schema.json"),
  path.join(SCRIPT_DIR, "..", "schemas", "review-output.schema.json")
];
export const REVIEW_SCHEMA =
  REVIEW_SCHEMA_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ??
  REVIEW_SCHEMA_CANDIDATES[0]!;

export type CliOptions = Record<string, string | boolean | undefined>;

export function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

export function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

export function normalizeModel(model: string | undefined): string | null {
  if (!model) return null;
  const trimmed = model.trim();
  return MODEL_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}

export function normalizeEffort(effort: string | undefined): string | null {
  if (!effort) return null;
  const normalized = effort.trim().toLowerCase();
  if (!VALID_EFFORTS.has(normalized)) {
    throw new Error(
      `Unsupported effort "${effort}". Use one of: ${[...VALID_EFFORTS].join(", ")}.`
    );
  }
  return normalized;
}

function codexConfigArg(key: string, value: string): string[] {
  return ["-c", `${key}="${value.replaceAll('"', '\\"')}"`];
}

export function addRuntimeOptions(args: string[], options: CliOptions): string[] {
  const model = normalizeModel(optionString(options, "model"));
  const effort = normalizeEffort(optionString(options, "effort"));
  if (model) args.push("-m", model);
  if (effort) args.push(...codexConfigArg("model_reasoning_effort", effort));
  return args;
}

export function buildReviewRequest(
  cwd: string,
  options: CliOptions,
  positionals: string[]
): CodexRequest {
  const codex = resolveCodexInvocation(cwd);
  const args = ["exec", "review"];
  addRuntimeOptions(args, options);

  const prompt = positionals.join(" ").trim();
  if (prompt) {
    throw new Error(
      "`review` does not support custom focus text. Use `adversarial-review` when you need focused review instructions."
    );
  }

  const base = optionString(options, "base");
  const commit = optionString(options, "commit");
  if (base) {
    args.push("--base", base);
  } else if (commit) {
    args.push("--commit", commit);
  } else {
    args.push("--uncommitted");
  }

  const target = base ? `base ${base}` : commit ? `commit ${commit}` : "uncommitted changes";
  return {
    cwd,
    command: codex.command,
    args: [...codex.args, ...args],
    title: "Codex Review",
    kind: "review",
    summary: `Review ${target}`
  };
}

export function buildAdversarialPrompt(options: CliOptions, focusText: string): string {
  const base = optionString(options, "base");
  const target = base
    ? `Review this branch against base ref "${base}".`
    : "Review the current staged, unstaged, and untracked changes.";
  const focus = focusText || "No extra focus was provided.";
  return [
    "You are running a read-only adversarial engineering review.",
    target,
    "Question the chosen design, assumptions, failure modes, rollback story, and tests.",
    "Do not modify files. Do not apply patches. Findings must lead the response, ordered by severity.",
    `Focus: ${focus}`
  ].join("\n");
}

export function buildAdversarialRequest(
  cwd: string,
  options: CliOptions,
  positionals: string[]
): CodexRequest {
  const codex = resolveCodexInvocation(cwd);
  const prompt = buildAdversarialPrompt(options, positionals.join(" ").trim());
  const args = ["--ask-for-approval", "never", "exec", "--sandbox", "read-only"];
  addRuntimeOptions(args, options);
  if (fs.existsSync(REVIEW_SCHEMA)) {
    args.push("--output-schema", REVIEW_SCHEMA);
  }
  args.push(prompt);

  const base = optionString(options, "base");
  return {
    cwd,
    command: codex.command,
    args: [...codex.args, ...args],
    title: "Codex Adversarial Review",
    kind: "adversarial-review",
    summary: base
      ? `Adversarial review against ${base}`
      : "Adversarial review of working tree"
  };
}

export function buildTaskRequest(
  cwd: string,
  options: CliOptions,
  positionals: string[]
): CodexRequest {
  const codex = resolveCodexInvocation(cwd);
  const prompt = positionals.join(" ").trim();
  if (!prompt && !optionBool(options, "resume")) {
    throw new Error(
      "Provide a task prompt, or pass --resume to continue the latest Codex session."
    );
  }

  const args = ["--ask-for-approval", "never", "exec"];
  args.push("--sandbox", optionBool(options, "write") ? "workspace-write" : "read-only");
  addRuntimeOptions(args, options);

  if (optionBool(options, "resume")) {
    args.push("resume", "--last");
  }
  if (prompt) args.push(prompt);

  return {
    cwd,
    command: codex.command,
    args: [...codex.args, ...args],
    title: optionBool(options, "resume") ? "Codex Resume" : "Codex Task",
    kind: "task",
    summary: prompt ? prompt.slice(0, 140) : "Resume latest Codex session",
    write: optionBool(options, "write")
  };
}
