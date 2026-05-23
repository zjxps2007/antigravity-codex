#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { findJob, findLatestResultJob, generateJobId, jobDir, listJobs, nowIso, readJobArtifact, resolveWorkspaceRoot, upsertJob, writeJobArtifact } from "./lib/state.mjs";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT_DIR = resolveRuntimeRoot(SCRIPT_DIR);
const REVIEW_SCHEMA_CANDIDATES = [
    path.join(ROOT_DIR, "schemas", "review-output.schema.json"),
    path.join(SCRIPT_DIR, "..", "schemas", "review-output.schema.json")
];
const REVIEW_SCHEMA = REVIEW_SCHEMA_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? REVIEW_SCHEMA_CANDIDATES[0];
const MODEL_ALIASES = new Map([["spark", "gpt-5.3-codex-spark"]]);
const VALID_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
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
function optionString(options, key) {
    const value = options[key];
    return typeof value === "string" ? value : undefined;
}
function optionBool(options, key) {
    return options[key] === true;
}
function commandCandidates(command) {
    if (command === "node") {
        return [process.execPath, "node.exe", "node"];
    }
    if (process.env.CODEX_BIN && command === "codex") {
        return [process.env.CODEX_BIN];
    }
    if (process.platform !== "win32" || path.extname(command)) {
        return [command];
    }
    return [`${command}.cmd`, `${command}.exe`, command];
}
function shouldUseShell(command) {
    return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}
function resolveExecutable(command, args = ["--version"], cwd = process.cwd()) {
    for (const candidate of commandCandidates(command)) {
        const result = spawnSync(candidate, args, {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            shell: shouldUseShell(candidate)
        });
        const errorCode = result.error?.code;
        if (!result.error || errorCode !== "ENOENT") {
            return { command: candidate, result };
        }
    }
    const result = {
        status: null,
        stdout: "",
        stderr: "",
        error: new Error(`Unable to find ${command} on PATH.`)
    };
    return { command, result };
}
function resolveCodexInvocation(cwd = process.cwd()) {
    if (process.env.CODEX_BIN) {
        if (/\.js$/i.test(process.env.CODEX_BIN)) {
            return { command: process.execPath, args: [process.env.CODEX_BIN] };
        }
        return { command: process.env.CODEX_BIN, args: [] };
    }
    if (process.platform === "win32") {
        const found = spawnSync("where.exe", ["codex"], { cwd, encoding: "utf8", windowsHide: true });
        const paths = found.status === 0 ? found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
        for (const candidate of paths) {
            if (/\.exe$/i.test(candidate)) {
                return { command: candidate, args: [] };
            }
            const codexJs = path.join(path.dirname(candidate), "node_modules", "@openai", "codex", "bin", "codex.js");
            if (fs.existsSync(codexJs)) {
                return { command: process.execPath, args: [codexJs] };
            }
        }
    }
    return { command: "codex", args: [] };
}
function codexAvailable(cwd = process.cwd()) {
    const invocation = resolveCodexInvocation(cwd);
    const result = spawnSync(invocation.command, [...invocation.args, "--version"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        shell: shouldUseShell(invocation.command)
    });
    return {
        available: result.status === 0,
        command: [invocation.command, ...invocation.args].join(" "),
        status: result.status,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
        error: result.error?.message ?? null
    };
}
function usage() {
    console.log(`Usage:
  node dist/agy-codex.mjs setup [--json] [--enable-review-gate|--disable-review-gate]
  node dist/agy-codex.mjs review [--wait|--background] [--base <ref>|--commit <sha>] [--model <model>]
  node dist/agy-codex.mjs adversarial-review [--wait|--background] [--base <ref>] [--model <model>] [focus text]
  node dist/agy-codex.mjs rescue [--wait|--background] [--write] [--resume] [--model <model>] [--effort <effort>] <prompt>
  node dist/agy-codex.mjs task [--wait|--background] [--write] [--resume] [--model <model>] [--effort <effort>] <prompt>
  node dist/agy-codex.mjs status [job-id] [--json]
  node dist/agy-codex.mjs result [job-id] [--json]
  node dist/agy-codex.mjs cancel [job-id] [--json]`);
}
function normalizeModel(model) {
    if (!model)
        return null;
    const trimmed = model.trim();
    return MODEL_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}
function normalizeEffort(effort) {
    if (!effort)
        return null;
    const normalized = effort.trim().toLowerCase();
    if (!VALID_EFFORTS.has(normalized)) {
        throw new Error(`Unsupported effort "${effort}". Use one of: ${[...VALID_EFFORTS].join(", ")}.`);
    }
    return normalized;
}
function commandAvailable(command, args = ["--version"], cwd = process.cwd()) {
    const { command: resolvedCommand, result } = resolveExecutable(command, args, cwd);
    return {
        available: result.status === 0,
        command: resolvedCommand,
        status: result.status,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
        error: result.error?.message ?? null
    };
}
function shellQuote(value) {
    if (process.platform === "win32") {
        return `"${value.replaceAll('"', '\\"')}"`;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
function reviewGateHookFile() {
    return path.join(ROOT_DIR, "hooks", "hooks.json");
}
function reviewGateScriptFile() {
    const candidates = [
        path.join(ROOT_DIR, "hooks", "bin", "stop-review-gate-hook.mjs"),
        path.join(ROOT_DIR, "dist", "stop-review-gate-hook.mjs")
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
function reviewGateConfig(enabled) {
    return {
        "codex-stop-review-gate": {
            enabled,
            Stop: [
                {
                    type: "command",
                    command: `node ${shellQuote(reviewGateScriptFile())}`,
                    timeout: 300
                }
            ]
        }
    };
}
function readReviewGateEnabled() {
    const file = reviewGateHookFile();
    if (!fs.existsSync(file)) {
        return false;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return parsed["codex-stop-review-gate"]?.enabled !== false;
    }
    catch {
        return false;
    }
}
function setReviewGateEnabled(enabled) {
    const file = reviewGateHookFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(reviewGateConfig(enabled), null, 2)}\n`);
}
function codexConfigArg(key, value) {
    return ["-c", `${key}="${value.replaceAll('"', '\\"')}"`];
}
function addRuntimeOptions(args, options) {
    const model = normalizeModel(optionString(options, "model"));
    const effort = normalizeEffort(optionString(options, "effort"));
    if (model)
        args.push("-m", model);
    if (effort)
        args.push(...codexConfigArg("model_reasoning_effort", effort));
    return args;
}
function buildReviewRequest(cwd, options, positionals) {
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
function buildAdversarialPrompt(options, focusText) {
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
function buildAdversarialRequest(cwd, options, positionals) {
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
        summary: base ? `Adversarial review against ${base}` : "Adversarial review of working tree"
    };
}
function buildTaskRequest(cwd, options, positionals) {
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
function createLogFile(cwd, jobId) {
    const dir = jobDir(cwd, jobId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "log.txt");
}
function runProcess(request, job, { stream = true } = {}) {
    const logFile = job.logFile ?? createLogFile(request.cwd, job.id);
    return new Promise((resolve) => {
        const child = spawn(request.command, request.args, {
            cwd: request.cwd,
            env: { ...process.env, NO_COLOR: "1" },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            shell: shouldUseShell(request.command)
        });
        upsertJob(request.cwd, {
            id: job.id,
            pid: child.pid ?? null,
            status: "running",
            phase: "running",
            logFile
        });
        const logStream = fs.createWriteStream(logFile, { flags: "a" });
        logStream.on("error", (err) => {
            process.stderr.write(`Failed to write to log file: ${err.message}\n`);
        });
        let stdout = "";
        let stderr = "";
        const append = (chunk, isErr = false) => {
            const text = chunk.toString();
            if (isErr)
                stderr += text;
            else
                stdout += text;
            logStream.write(text);
            if (stream) {
                (isErr ? process.stderr : process.stdout).write(text);
            }
        };
        child.stdout?.on("data", (chunk) => append(chunk));
        child.stderr?.on("data", (chunk) => append(chunk, true));
        child.on("error", (error) => {
            const msg = `${error.message}\n`;
            stderr += msg;
            logStream.write(msg);
        });
        child.on("close", (code, signal) => {
            logStream.end(() => {
                resolve({ code: code ?? 1, signal, stdout, stderr, logFile });
            });
        });
    });
}
async function executeTrackedRequest(request, job, options = {}) {
    upsertJob(request.cwd, {
        id: job.id,
        kind: request.kind,
        title: request.title,
        summary: request.summary,
        status: "queued",
        phase: "queued",
        request,
        write: Boolean(request.write),
        logFile: job.logFile
    });
    writeJobArtifact(request.cwd, job.id, "request.json", request);
    const result = await runProcess(request, job, options);
    writeJobArtifact(request.cwd, job.id, "stdout.txt", result.stdout);
    writeJobArtifact(request.cwd, job.id, "stderr.txt", result.stderr);
    writeJobArtifact(request.cwd, job.id, "result.json", result);
    const currentJob = findJob(request.cwd, job.id);
    const isCancelled = currentJob?.status === "cancelled";
    const status = isCancelled ? "cancelled" : (result.code === 0 ? "completed" : "failed");
    upsertJob(request.cwd, {
        id: job.id,
        status,
        phase: status,
        pid: null,
        exitCode: result.code,
        signal: result.signal,
        completedAt: nowIso(),
        logFile: result.logFile
    });
    if (result.code !== 0 && !options.background) {
        process.exitCode = result.code;
    }
    return result;
}
function queueBackground(request) {
    const jobId = generateJobId(request.kind === "task" ? "task" : "review");
    const logFile = createLogFile(request.cwd, jobId);
    const job = upsertJob(request.cwd, {
        id: jobId,
        kind: request.kind,
        title: request.title,
        summary: request.summary,
        status: "queued",
        phase: "queued",
        request,
        logFile,
        write: Boolean(request.write)
    });
    writeJobArtifact(request.cwd, jobId, "request.json", request);
    const child = spawn(process.execPath, [SCRIPT_PATH, "worker", "--cwd", request.cwd, "--job-id", jobId], {
        cwd: request.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env
    });
    child.unref();
    return upsertJob(request.cwd, { id: job.id, pid: child.pid ?? null, status: "queued", phase: "queued" });
}
async function runForeground(request) {
    const job = {
        id: generateJobId(request.kind === "task" ? "task" : "review")
    };
    job.logFile = createLogFile(request.cwd, job.id);
    await executeTrackedRequest(request, job, { stream: true });
}
function printQueued(job, asJson = false) {
    const payload = {
        jobId: job.id,
        status: "queued",
        title: job.title,
        summary: job.summary,
        pid: job.pid ?? null,
        logFile: job.logFile
    };
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
    }
    else {
        console.log(`${job.title ?? "Codex job"} started in the background as ${job.id}.`);
        console.log(`Check progress with: node dist/agy-codex.mjs status ${job.id}`);
    }
}
async function handleWorker(argv) {
    const { options } = parseArgs(argv, { valueOptions: ["cwd", "job-id"] });
    const cwd = optionString(options, "cwd");
    const jobId = optionString(options, "job-id");
    if (!cwd || !jobId) {
        throw new Error("worker requires --cwd and --job-id.");
    }
    const job = findJob(cwd, jobId);
    if (!job) {
        throw new Error(`No job found for ${jobId}.`);
    }
    if (job.status === "cancelled") {
        return;
    }
    if (!job.request) {
        throw new Error(`No queued request found for ${jobId}.`);
    }
    await executeTrackedRequest(job.request, job, { stream: false, background: true });
}
async function runMaybeBackground(request, options) {
    if (optionBool(options, "background")) {
        printQueued(queueBackground(request), optionBool(options, "json"));
        return;
    }
    await runForeground(request);
}
async function handleSetup(argv) {
    const { options } = parseArgs(argv, { booleanOptions: ["json", "enable-review-gate", "disable-review-gate"] });
    if (optionBool(options, "enable-review-gate") && optionBool(options, "disable-review-gate")) {
        throw new Error("Use only one of --enable-review-gate or --disable-review-gate.");
    }
    if (optionBool(options, "enable-review-gate")) {
        setReviewGateEnabled(true);
    }
    else if (optionBool(options, "disable-review-gate")) {
        setReviewGateEnabled(false);
    }
    const cwd = process.cwd();
    const node = commandAvailable("node", ["--version"], cwd);
    const codex = codexAvailable(cwd);
    const ready = node.available && codex.available;
    const reviewGate = {
        enabled: readReviewGateEnabled(),
        hooksFile: reviewGateHookFile(),
        hookScript: reviewGateScriptFile()
    };
    const payload = {
        ready,
        node,
        codex,
        reviewGate,
        workspaceRoot: resolveWorkspaceRoot(cwd),
        nextSteps: ready ? [] : ["Install Codex with `npm install -g @openai/codex` and run `codex login`."]
    };
    if (optionBool(options, "json")) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log("# Antigravity Codex setup");
    console.log(`Node: ${node.available ? node.stdout : "missing"}`);
    console.log(`Codex: ${codex.available ? codex.stdout : "missing"}`);
    console.log(`Workspace: ${payload.workspaceRoot}`);
    console.log(`Review gate: ${reviewGate.enabled ? "enabled" : "disabled"}`);
    console.log(`Ready: ${ready ? "yes" : "no"}`);
    for (const step of payload.nextSteps)
        console.log(`- ${step}`);
}
async function handleReview(argv, adversarial = false) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["base", "commit", "model", "cwd", "effort"],
        booleanOptions: ["wait", "background", "json"],
        aliasMap: { m: "model" }
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const request = adversarial
        ? buildAdversarialRequest(cwd, options, positionals)
        : buildReviewRequest(cwd, options, positionals);
    await runMaybeBackground(request, options);
}
async function handleTask(argv) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["model", "cwd", "effort"],
        booleanOptions: ["wait", "background", "json", "write", "resume"],
        aliasMap: { m: "model" }
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const request = buildTaskRequest(cwd, options, positionals);
    await runMaybeBackground(request, options);
}
function renderStatus(job) {
    return `${job.id}\t${job.kind ?? ""}\t${job.status ?? ""}\t${job.pid ?? ""}\t${job.summary ?? ""}`;
}
function handleStatus(argv) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["cwd"],
        booleanOptions: ["json"]
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const reference = positionals[0] ?? "";
    const jobs = reference ? [findJob(cwd, reference)].filter((job) => Boolean(job)) : listJobs(cwd).slice(0, 12);
    if (optionBool(options, "json")) {
        console.log(JSON.stringify(jobs, null, 2));
        return;
    }
    if (!jobs.length) {
        console.log("No Codex jobs found for this workspace.");
        return;
    }
    console.log("id\tkind\tstatus\tpid\tsummary");
    for (const job of jobs)
        console.log(renderStatus(job));
}
function handleResult(argv) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["cwd"],
        booleanOptions: ["json"]
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const job = findLatestResultJob(cwd, positionals[0] ?? "");
    if (!job) {
        throw new Error("No completed Codex job found for this workspace.");
    }
    const stdout = readJobArtifact(cwd, job.id, "stdout.txt") ?? "";
    const stderr = readJobArtifact(cwd, job.id, "stderr.txt") ?? "";
    const payload = { job, stdout, stderr };
    if (optionBool(options, "json")) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    process.stdout.write(stdout);
    if (stderr.trim()) {
        process.stderr.write(stderr);
    }
}
function killProcessTree(pid) {
    if (!pid)
        return;
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
    else {
        try {
            process.kill(-pid, "SIGTERM");
        }
        catch {
            try {
                process.kill(pid, "SIGTERM");
            }
            catch {
                // Already exited.
            }
        }
    }
}
function handleCancel(argv) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["cwd"],
        booleanOptions: ["json"]
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const reference = positionals[0] ?? "";
    const job = findJob(cwd, reference) ??
        listJobs(cwd).find((candidate) => ["queued", "running"].includes(candidate.status ?? ""));
    if (!job) {
        throw new Error("No active Codex job found to cancel.");
    }
    killProcessTree(job.pid);
    const next = upsertJob(cwd, {
        id: job.id,
        status: "cancelled",
        phase: "cancelled",
        pid: null,
        completedAt: nowIso()
    });
    if (optionBool(options, "json")) {
        console.log(JSON.stringify(next, null, 2));
    }
    else {
        console.log(`Cancelled ${job.id}.`);
    }
}
async function main() {
    const [subcommand, ...argv] = process.argv.slice(2);
    switch (subcommand) {
        case "setup":
            await handleSetup(argv);
            break;
        case "review":
            await handleReview(argv, false);
            break;
        case "adversarial-review":
            await handleReview(argv, true);
            break;
        case "task":
            await handleTask(argv);
            break;
        case "rescue":
            await handleTask(argv);
            break;
        case "worker":
            await handleWorker(argv);
            break;
        case "status":
            handleStatus(argv);
            break;
        case "result":
            handleResult(argv);
            break;
        case "cancel":
            handleCancel(argv);
            break;
        case "help":
        case "--help":
        case undefined:
            usage();
            break;
        default:
            throw new Error(`Unknown subcommand: ${subcommand}`);
    }
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
