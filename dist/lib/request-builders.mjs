import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexInvocation } from "./exec-resolver.mjs";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
export const MODEL_ALIASES = new Map([["spark", "gpt-5.3-codex-spark"]]);
export const VALID_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
function resolveRuntimeRoot(startDir) {
    let current = path.resolve(startDir);
    for (let i = 0; i < 5; i += 1) {
        if (fs.existsSync(path.join(current, "plugin.json"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return path.resolve(startDir, "..");
}
const ROOT_DIR = resolveRuntimeRoot(SCRIPT_DIR);
const REVIEW_SCHEMA_CANDIDATES = [
    path.join(ROOT_DIR, "schemas", "review-output.schema.json"),
    path.join(SCRIPT_DIR, "..", "schemas", "review-output.schema.json")
];
export const REVIEW_SCHEMA = REVIEW_SCHEMA_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ??
    REVIEW_SCHEMA_CANDIDATES[0];
export function optionString(options, key) {
    const value = options[key];
    return typeof value === "string" ? value : undefined;
}
export function optionBool(options, key) {
    return options[key] === true;
}
export function normalizeModel(model) {
    if (!model)
        return null;
    const trimmed = model.trim();
    return MODEL_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}
export function normalizeEffort(effort) {
    if (!effort)
        return null;
    const normalized = effort.trim().toLowerCase();
    if (!VALID_EFFORTS.has(normalized)) {
        throw new Error(`Unsupported effort "${effort}". Use one of: ${[...VALID_EFFORTS].join(", ")}.`);
    }
    return normalized;
}
function codexConfigArg(key, value) {
    return ["-c", `${key}="${value.replaceAll('"', '\\"')}"`];
}
export function addRuntimeOptions(args, options) {
    const model = normalizeModel(optionString(options, "model"));
    const effort = normalizeEffort(optionString(options, "effort"));
    if (model)
        args.push("-m", model);
    if (effort)
        args.push(...codexConfigArg("model_reasoning_effort", effort));
    return args;
}
export function buildReviewRequest(cwd, options, positionals) {
    const codex = resolveCodexInvocation(cwd);
    const args = ["exec", "review"];
    addRuntimeOptions(args, options);
    const prompt = positionals.join(" ").trim();
    if (prompt) {
        throw new Error("`review` does not support custom focus text. Use `adversarial-review` when you need focused review instructions.");
    }
    const base = optionString(options, "base");
    const commit = optionString(options, "commit");
    if (base) {
        args.push("--base", base);
    }
    else if (commit) {
        args.push("--commit", commit);
    }
    else {
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
export function buildAdversarialPrompt(options, focusText) {
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
export function buildAdversarialRequest(cwd, options, positionals) {
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
export function buildTaskRequest(cwd, options, positionals) {
    const codex = resolveCodexInvocation(cwd);
    const prompt = positionals.join(" ").trim();
    if (!prompt && !optionBool(options, "resume")) {
        throw new Error("Provide a task prompt, or pass --resume to continue the latest Codex session.");
    }
    const args = ["--ask-for-approval", "never", "exec"];
    args.push("--sandbox", optionBool(options, "write") ? "workspace-write" : "read-only");
    addRuntimeOptions(args, options);
    if (optionBool(options, "resume")) {
        args.push("resume", "--last");
    }
    if (prompt)
        args.push(prompt);
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
