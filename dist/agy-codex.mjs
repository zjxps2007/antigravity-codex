#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { clearReviewGateEvents, clearMonitorState, readMonitorState, readReviewGateEvents, reviewGateEventsFile, writeMonitorState } from "./lib/review-gate-events.mjs";
import { findJob, findLatestResultJob, generateJobId, isReviewGateEnabled, jobDir, listJobs, nowIso, readJobArtifact, resolveWorkspaceRoot, setReviewGateEnabled, upsertJob, workspaceStateDir, writeJobArtifact } from "./lib/state.mjs";
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
const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
const NPX_REVIEW_GATE_COMMAND = `npx -y --package ${NPX_PACKAGE_SPEC} agy-codex-review-gate`;
const DEFAULT_MONITOR_HOST = "127.0.0.1";
const DEFAULT_MONITOR_PORT = 8765;
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
let cachedCodexInvocation = null;
function resolveCodexInvocation(cwd = process.cwd()) {
    if (cachedCodexInvocation) {
        return cachedCodexInvocation;
    }
    let invocation;
    if (process.env.CODEX_BIN) {
        if (/\.js$/i.test(process.env.CODEX_BIN)) {
            invocation = { command: process.execPath, args: [process.env.CODEX_BIN] };
        }
        else {
            invocation = { command: process.env.CODEX_BIN, args: [] };
        }
    }
    else if (process.platform === "win32") {
        const found = spawnSync("where.exe", ["codex"], { cwd, encoding: "utf8", windowsHide: true });
        const paths = found.status === 0 ? found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
        invocation = { command: "codex", args: [] };
        for (const candidate of paths) {
            if (/\.exe$/i.test(candidate)) {
                invocation = { command: candidate, args: [] };
                break;
            }
            const codexJs = path.join(path.dirname(candidate), "node_modules", "@openai", "codex", "bin", "codex.js");
            if (fs.existsSync(codexJs)) {
                invocation = { command: process.execPath, args: [codexJs] };
                break;
            }
        }
    }
    else {
        invocation = { command: "codex", args: [] };
    }
    cachedCodexInvocation = invocation;
    return invocation;
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
  node dist/agy-codex.mjs cancel [job-id] [--json]
  node dist/agy-codex.mjs monitor [--status|--stop|--clear|--foreground] [--port <port>] [--json]`);
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
function reviewGateHookFile() {
    return path.join(ROOT_DIR, "hooks", "hooks.json");
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
    const { options } = parseArgs(argv, {
        valueOptions: ["cwd"],
        booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
    });
    if (optionBool(options, "enable-review-gate") && optionBool(options, "disable-review-gate")) {
        throw new Error("Use only one of --enable-review-gate or --disable-review-gate.");
    }
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    if (optionBool(options, "enable-review-gate")) {
        setReviewGateEnabled(cwd, true);
    }
    else if (optionBool(options, "disable-review-gate")) {
        setReviewGateEnabled(cwd, false);
    }
    const node = commandAvailable("node", ["--version"], cwd);
    const codex = codexAvailable(cwd);
    const ready = node.available && codex.available;
    const reviewGate = {
        enabled: isReviewGateEnabled(cwd),
        configDir: workspaceStateDir(cwd),
        hooksFile: reviewGateHookFile(),
        hookCommand: NPX_REVIEW_GATE_COMMAND
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
function parseMonitorPort(value) {
    if (!value)
        return DEFAULT_MONITOR_PORT;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Monitor port must be an integer between 1 and 65535.");
    }
    return port;
}
function normalizeMonitorHost(value) {
    const host = value?.trim() || DEFAULT_MONITOR_HOST;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
        throw new Error("Monitor host must be local: 127.0.0.1, localhost, or ::1.");
    }
    return host;
}
function monitorUrl(host, port) {
    return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}
function processIsRunning(pid) {
    if (!pid || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
function monitorHealth(state, timeoutMs = 600) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (healthy) => {
            if (settled)
                return;
            settled = true;
            resolve(healthy);
        };
        const request = http.get(`${state.url}/api/health`, { timeout: timeoutMs }, (response) => {
            response.resume();
            done(response.statusCode === 200);
        });
        request.on("timeout", () => {
            request.destroy();
            done(false);
        });
        request.on("error", () => done(false));
    });
}
async function readActiveMonitor() {
    const state = readMonitorState();
    if (!state) {
        return null;
    }
    if (processIsRunning(state.pid) && (await monitorHealth(state))) {
        return state;
    }
    clearMonitorState();
    return null;
}
async function waitForMonitor(state, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (processIsRunning(state.pid) && (await monitorHealth(state, 400))) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
}
function printMonitorState(state, asJson) {
    if (asJson) {
        console.log(JSON.stringify({ running: Boolean(state), monitor: state, eventsFile: reviewGateEventsFile() }, null, 2));
        return;
    }
    if (!state) {
        console.log("Codex monitor is not running.");
        console.log(`Events file: ${reviewGateEventsFile()}`);
        return;
    }
    console.log(`Codex monitor running at ${state.url}`);
    console.log(`PID: ${state.pid}`);
    console.log(`Events file: ${reviewGateEventsFile()}`);
    console.log("Stop with: /codex:monitor --stop");
}
function sendJson(response, status, payload) {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
    });
    response.end(JSON.stringify(payload, null, 2));
}
function sendHtml(response, html) {
    response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
    });
    response.end(html);
}
function renderMonitorHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Review Gate Monitor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg-start: #030712;
      --bg-end: #090d16;
      --panel: rgba(17, 24, 39, 0.45);
      --panel-hover: rgba(24, 32, 53, 0.65);
      --panel-border: rgba(255, 255, 255, 0.05);
      --panel-border-hover: rgba(99, 102, 241, 0.25);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --ink: #ffffff;

      /* Vibrant Tailored HSL Colors */
      --indigo: 250, 89%, 65%;
      --indigo-glow: rgba(99, 102, 241, 0.15);

      --success: 142, 70%, 45%;
      --success-glow: rgba(16, 185, 129, 0.12);

      --danger: 350, 80%, 55%;
      --danger-glow: rgba(239, 68, 68, 0.12);

      --warning: 38, 92%, 50%;
      --warning-glow: rgba(245, 158, 11, 0.12);

      --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    * {
      box-sizing: border-box;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    body {
      margin: 0;
      background: radial-gradient(circle at 50% 0%, #111827, #030712);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
      position: relative;
      overflow-x: hidden;
    }

    /* Ambient background glow elements */
    body::before {
      content: '';
      position: fixed;
      top: -10%;
      left: 50%;
      transform: translateX(-50%);
      width: 80vw;
      height: 60vh;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0) 70%);
      z-index: -1;
      pointer-events: none;
    }

    body::after {
      content: '';
      position: fixed;
      bottom: -10%;
      right: 5%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(236, 72, 153, 0.03) 0%, rgba(236, 72, 153, 0) 70%);
      z-index: -1;
      pointer-events: none;
    }

    header {
      border-bottom: 1px solid var(--panel-border);
      background: rgba(3, 7, 18, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .wrap {
      width: min(1200px, calc(100vw - 32px));
      margin: 0 auto;
    }

    .top {
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-glow {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 10px;
      color: #a5b4fc;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.2);
    }

    .logo-glow::after {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #a5b4fc);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      opacity: 0.5;
    }

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.025em;
    }

    .sub {
      margin-top: 2px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      background: rgb(16, 185, 129);
      border-radius: 50%;
      position: relative;
      display: inline-block;
    }

    .live-dot::after {
      content: '';
      position: absolute;
      top: -3px;
      left: -3px;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(16, 185, 129, 0.4);
      border-radius: 50%;
      animation: pulse-ring 1.5s cubic-bezier(0.215, 0.610, 0.355, 1) infinite;
    }

    @keyframes pulse-ring {
      0% { transform: scale(0.5); opacity: 1; }
      80%, 100% { transform: scale(1.8); opacity: 0; }
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    button {
      height: 40px;
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      padding: 0 16px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    button:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    button:active {
      transform: translateY(-1px);
    }

    button svg {
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      transition: color 0.2s ease;
    }

    button:hover svg {
      color: var(--text);
    }

    button.primary {
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      border-color: rgba(99, 102, 241, 0.5);
      box-shadow: 0 0 15px var(--indigo-glow), 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    button.primary:hover {
      background: linear-gradient(135deg, #584feb 0%, #7578f5 100%);
      border-color: rgba(99, 102, 241, 0.8);
      box-shadow: 0 0 25px rgba(99, 102, 241, 0.4), 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    button.primary svg {
      color: #ffffff;
    }

    button.toggle {
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.22);
      background: rgba(99, 102, 241, 0.07);
    }

    button.toggle:hover {
      border-color: rgba(99, 102, 241, 0.45);
      background: rgba(99, 102, 241, 0.13);
    }

    button.toggle.active {
      color: #bbf7d0;
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.12);
      box-shadow: 0 0 18px rgba(16, 185, 129, 0.18), 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    button.toggle.active svg {
      color: #86efac;
    }

    button.danger {
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.2);
      background: rgba(239, 68, 68, 0.08);
    }
    button.danger:hover {
      background: rgba(239, 68, 68, 0.16);
      border-color: rgba(239, 68, 68, 0.5);
      color: #ffffff;
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.25);
    }
    button.danger svg {
      color: #fca5a5;
    }
    button.danger:hover svg {
      color: #ffffff;
    }

    main {
      padding: 32px 0 64px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }

    .metric {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 20px;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: center;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
    }

    .metric::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(180deg, #6366f1, #4f46e5);
    }

    .metric.runs-count::before {
      background: linear-gradient(180deg, #10b981, #059669);
    }

    .metric b {
      display: block;
      margin-bottom: 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      font-weight: 700;
    }

    .metric span {
      font-size: 15px;
      font-weight: 600;
      color: var(--ink);
      word-break: break-all;
    }
    .metric.runs-count span {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.1;
      background: linear-gradient(135deg, #ffffff 0%, #10b981 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .runs {
      display: grid;
      gap: 20px;
    }

    .run {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 24px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      position: relative;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .run::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 6px;
      height: 100%;
      border-radius: 16px 0 0 16px;
      background: var(--text-muted);
      transition: all 0.2s ease;
    }

    .run:hover {
      background: var(--panel-hover);
      border-color: var(--panel-border-hover);
      transform: translateY(-3px);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.1);
    }

    .run.allow::before {
      background: rgb(16, 185, 129);
    }
    .run.allow:hover {
      border-color: rgba(16, 185, 129, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(16, 185, 129, 0.08);
    }

    .run.continue::before {
      background: rgb(239, 68, 68);
    }
    .run.continue:hover {
      border-color: rgba(239, 68, 68, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(239, 68, 68, 0.08);
    }

    .run.running::before {
      background: rgb(245, 158, 11);
    }
    .run.running:hover {
      border-color: rgba(245, 158, 11, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(245, 158, 11, 0.08);
    }

    .run-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      border-bottom: 1px solid var(--panel-border);
      padding-bottom: 16px;
      margin-bottom: 16px;
    }

    .run-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.015em;
    }

    .run-time {
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      font-family: var(--font-mono);
      background: rgba(255, 255, 255, 0.03);
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--panel-border);
    }

    .badge-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 24px;
      border-radius: 8px;
      padding: 0 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid rgba(255, 255, 255, 0.05);
      gap: 6px;
    }

    .badge.allow {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge.continue {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .badge.running {
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .badge.needs-attention {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .badge.approve {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .badge svg {
      width: 12px;
      height: 12px;
    }

    .summary {
      margin: 16px 0;
      color: var(--text);
      line-height: 1.6;
      font-size: 14.5px;
      background: rgba(255, 255, 255, 0.015);
      padding: 12px 16px;
      border-radius: 10px;
      border-left: 3px solid rgba(255, 255, 255, 0.15);
    }

    .run.allow .summary {
      border-left-color: rgba(16, 185, 129, 0.4);
    }
    .run.continue .summary {
      border-left-color: rgba(239, 68, 68, 0.4);
    }
    .run.running .summary {
      border-left-color: rgba(245, 158, 11, 0.4);
    }

    .findings-container {
      margin-top: 20px;
    }

    .findings-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .findings {
      display: grid;
      gap: 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(255, 255, 255, 0.03);
    }

    .finding {
      position: relative;
      padding: 12px 14px 12px 28px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.02);
    }

    .finding::before {
      content: '';
      position: absolute;
      left: 14px;
      top: 18px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 8px var(--text-muted);
    }

    .finding.severity-high, .finding.severity-critical {
      border-left: 3px solid rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.02);
    }
    .finding.severity-high::before, .finding.severity-critical::before {
      background: rgb(239, 68, 68);
      box-shadow: 0 0 8px rgb(239, 68, 68);
    }

    .finding.severity-medium {
      border-left: 3px solid rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.02);
    }
    .finding.severity-medium::before {
      background: rgb(245, 158, 11);
      box-shadow: 0 0 8px rgb(245, 158, 11);
    }

    .finding.severity-low {
      border-left: 3px solid rgba(99, 102, 241, 0.4);
      background: rgba(99, 102, 241, 0.02);
    }
    .finding.severity-low::before {
      background: rgb(99, 102, 241);
      box-shadow: 0 0 8px rgb(99, 102, 241);
    }

    .finding-header {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .finding b {
      color: var(--ink);
      font-weight: 600;
      font-size: 14px;
    }

    .location {
      background: rgba(165, 180, 252, 0.1);
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: #a5b4fc;
      border: 1px solid rgba(165, 180, 252, 0.15);
      cursor: pointer;
    }
    .location:hover {
      background: rgba(165, 180, 252, 0.18);
      color: #ffffff;
    }

    .finding-desc {
      margin-top: 6px;
      color: var(--text-muted);
      font-size: 13.5px;
      line-height: 1.5;
    }

    .finding-rec {
      margin-top: 8px;
      font-size: 13px;
      color: #c7d2fe;
      background: rgba(99, 102, 241, 0.06);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(99, 102, 241, 0.1);
    }

    details {
      margin-top: 18px;
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      overflow: hidden;
    }

    summary {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      padding: 10px 14px;
      outline: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.01);
      border-bottom: 1px solid transparent;
    }
    summary:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    details[open] summary {
      border-bottom-color: var(--panel-border);
      background: rgba(255, 255, 255, 0.02);
    }

    pre {
      overflow: auto;
      max-height: 300px;
      background: #02040a;
      color: #e6edf3;
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      margin: 0;
    }

    .empty {
      border: 2px dashed var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      color: var(--text-muted);
      padding: 64px 32px;
      text-align: center;
      font-size: 15px;
      font-weight: 500;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
    }

    /* Animations */
    @keyframes pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    .badge.running {
      animation: pulse 1.8s infinite ease-in-out;
    }

    .spin {
      animation: rotate 1.5s linear infinite;
    }

    @keyframes rotate {
      100% { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .top { align-items: flex-start; flex-direction: column; padding: 20px 0; }
      .actions { justify-content: flex-start; width: 100%; }
      .meta { grid-template-columns: 1fr; gap: 12px; }
      .run-head { flex-direction: column; align-items: flex-start; gap: 10px; }
      .run-time { align-self: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div class="logo-container">
        <div class="logo-glow">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
        </div>
        <div>
          <h1>Codex Review Gate Monitor</h1>
          <div class="sub">
            <span class="live-dot"></span>
            Local review companion live system
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="refresh" class="primary" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
          Refresh
        </button>
        <button id="auto-refresh" class="toggle" type="button" aria-pressed="false" title="Toggle automatic refresh every 2 seconds">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span class="auto-label">Auto Off</span>
        </button>
        <button id="clear" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          Clear Events
        </button>
        <button id="stop" class="danger" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" /></svg>
          Stop Monitor
        </button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="meta">
      <div class="metric">
        <b>Last Updated</b>
        <span id="updated">Loading...</span>
      </div>
      <div class="metric">
        <b>Events Log Stream</b>
        <span id="events-file">Loading...</span>
      </div>
      <div class="metric runs-count">
        <b>Total Runs</b>
        <span id="run-count">0</span>
      </div>
    </section>
    <section id="runs" class="runs"></section>
  </main>
  <script>
    const runsEl = document.getElementById('runs');
    const updatedEl = document.getElementById('updated');
    const eventsFileEl = document.getElementById('events-file');
    const runCountEl = document.getElementById('run-count');
    const autoRefreshButton = document.getElementById('auto-refresh');
    const autoRefreshLabel = autoRefreshButton.querySelector('.auto-label');
    let autoRefreshTimer = null;
    let autoRefreshEnabled = false;
    let loading = false;

    const ICONS = {
      allow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      approve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      continue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      'needs-attention': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      running: '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>',
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      finding: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>'
    };

    function h(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function groupEvents(events) {
      const map = new Map();
      for (const event of events) {
        if (!map.has(event.id)) map.set(event.id, []);
        map.get(event.id).push(event);
      }
      return [...map.entries()].map(([id, items]) => {
        items.sort((a, b) => Date.parse(a.time || 0) - Date.parse(b.time || 0));
        return { id, items, last: items[items.length - 1] || {} };
      }).sort((a, b) => Date.parse(b.last.time || 0) - Date.parse(a.last.time || 0));
    }

    function pick(items, type) {
      return [...items].reverse().find((event) => event.type === type);
    }

    function renderFindings(findings) {
      if (!findings || !findings.length) return '';

      const itemsHtml = findings.map((finding) => {
        const location = finding.file ? finding.file + (finding.line ? ':' + finding.line : '') : '';
        const severityClass = finding.severity ? 'severity-' + finding.severity.toLowerCase() : '';
        const severityLabel = finding.severity ? finding.severity.toUpperCase() : 'FINDING';

        return '<div class="finding ' + h(severityClass) + '">' +
          '<div class="finding-header">' +
          '<b>[' + h(severityLabel) + '] ' + h(finding.title || 'Finding') + '</b>' +
          (location ? '<span class="location" title="Click to copy path" onclick="navigator.clipboard.writeText(\\\'' + location.replaceAll('\\\\', '\\\\\\\\').replaceAll('\\\'', '\\\\\\\'') + '\\\')">' + h(location) + '</span>' : '') +
          '</div>' +
          (finding.description ? '<div class="finding-desc">' + h(finding.description) + '</div>' : '') +
          (finding.recommendation ? '<div class="finding-rec"><b>💡 Recommendation:</b> ' + h(finding.recommendation) + '</div>' : '') +
          '</div>';
      }).join('');

      return '<div class="findings-container">' +
        '<div class="findings-title">' + ICONS.finding + ' Actionable Findings (' + findings.length + ')</div>' +
        '<div class="findings">' + itemsHtml + '</div>' +
        '</div>';
    }

    function renderRun(run) {
      const started = pick(run.items, 'started');
      const result = pick(run.items, 'codex-result');
      const decision = pick(run.items, 'decision');
      const status = decision ? decision.decision : 'running';
      const verdict = (decision && decision.verdict) || (result && result.verdict) || 'pending';
      const summary = (decision && decision.summary) || (result && result.summary) || (started && started.message) || '';
      const findings = (decision && decision.findings) || (result && result.findings) || [];
      const raw = { id: run.id, events: run.items };

      const statusIcon = ICONS[status] || '';
      const verdictIcon = ICONS[verdict] || '';

      return '<article class="run ' + h(status) + '">' +
        '<div class="run-head">' +
        '<div>' +
        '<div class="run-title">' + h(started && started.workspace || 'Workspace review') + '</div>' +
        '<div class="badge-group">' +
        '<span class="badge ' + h(status) + '">' + statusIcon + h(status) + '</span>' +
        '<span class="badge ' + h(verdict) + '">' + verdictIcon + h(verdict) + '</span>' +
        '</div>' +
        '</div>' +
        '<div class="run-time">' + h(new Date(run.last.time || Date.now()).toLocaleString()) + '</div>' +
        '</div>' +
        (summary ? '<div class="summary">' + h(summary) + '</div>' : '') +
        renderFindings(findings) +
        '<details>' +
        '<summary>' +
        '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>' +
        'Raw events payload' +
        '</summary>' +
        '<pre>' + h(JSON.stringify(raw, null, 2)) + '</pre>' +
        '</details>' +
        '</article>';
    }

    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch('/api/events?limit=200', { cache: 'no-store' });
        const data = await response.json();
        const runs = groupEvents(data.events || []);
        updatedEl.textContent = new Date().toLocaleString();
        eventsFileEl.textContent = data.eventsFile || '';
        runCountEl.textContent = String(runs.length);
        runsEl.innerHTML = runs.length ? runs.map(renderRun).join('') : '<div class="empty">No review gate runs recorded yet.</div>';
      } finally {
        loading = false;
      }
    }

    function showLoadError(error) {
      runsEl.innerHTML = '<div class="empty">' + h(error.message || error) + '</div>';
    }

    function setAutoRefresh(enabled) {
      autoRefreshEnabled = enabled;
      autoRefreshButton.classList.toggle('active', enabled);
      autoRefreshButton.setAttribute('aria-pressed', String(enabled));
      autoRefreshLabel.textContent = enabled ? 'Auto On' : 'Auto Off';
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      if (enabled) {
        autoRefreshTimer = setInterval(() => {
          load().catch(showLoadError);
        }, 2000);
        load().catch(showLoadError);
      }
    }

    document.getElementById('refresh').addEventListener('click', () => load().catch(showLoadError));
    autoRefreshButton.addEventListener('click', () => setAutoRefresh(!autoRefreshEnabled));
    document.getElementById('clear').addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all review events?')) {
        await fetch('/api/events', { method: 'DELETE' });
        await load();
      }
    });
    document.getElementById('stop').addEventListener('click', async () => {
      if (confirm('Are you sure you want to stop the review gate monitor?')) {
        await fetch('/api/stop', { method: 'POST' });
        document.body.innerHTML = '<main class="wrap"><div class="empty">Monitor has been stopped. You can safely close this page.</div></main>';
      }
    });
    load().catch((error) => {
      showLoadError(error);
    });
  </script>
</body>
</html>`;
}
function handleMonitorRequest(request, response, state, shutdown) {
    const url = new URL(request.url ?? "/", state.url);
    if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, renderMonitorHtml());
        return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true, monitor: state, eventsFile: reviewGateEventsFile() });
        return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
        const limit = Number(url.searchParams.get("limit") ?? 200);
        sendJson(response, 200, {
            events: readReviewGateEvents(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 200),
            eventsFile: reviewGateEventsFile(),
            monitor: state
        });
        return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/events") {
        clearReviewGateEvents();
        sendJson(response, 200, { cleared: true, eventsFile: reviewGateEventsFile() });
        return;
    }
    if (request.method === "POST" && url.pathname === "/api/stop") {
        sendJson(response, 200, { stopping: true });
        setTimeout(shutdown, 50);
        return;
    }
    sendJson(response, 404, { error: "Not found" });
}
function startMonitorServer(host, port) {
    return new Promise((resolve, reject) => {
        let state = null;
        let closing = false;
        const server = http.createServer((request, response) => {
            if (!state) {
                sendJson(response, 503, { error: "Monitor is starting." });
                return;
            }
            handleMonitorRequest(request, response, state, shutdown);
        });
        const shutdown = () => {
            if (closing)
                return;
            closing = true;
            clearMonitorState();
            server.close(() => resolve());
        };
        server.on("error", reject);
        server.listen(port, host, () => {
            const address = server.address();
            const actualPort = typeof address === "object" && address ? address.port : port;
            state = {
                pid: process.pid,
                host,
                port: actualPort,
                url: monitorUrl(host, actualPort),
                startedAt: nowIso()
            };
            writeMonitorState(state);
            console.log(`Codex monitor running at ${state.url}`);
            console.log(`Events file: ${reviewGateEventsFile()}`);
        });
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    });
}
function stopMonitorProcess(pid) {
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
        return;
    }
    try {
        process.kill(pid, "SIGTERM");
    }
    catch {
        // Already stopped.
    }
}
async function handleMonitor(argv) {
    const { options } = parseArgs(argv, {
        valueOptions: ["host", "port"],
        booleanOptions: ["json", "status", "stop", "clear", "foreground"]
    });
    const asJson = optionBool(options, "json");
    if (optionBool(options, "clear")) {
        clearReviewGateEvents();
        if (asJson) {
            console.log(JSON.stringify({ cleared: true, eventsFile: reviewGateEventsFile() }, null, 2));
        }
        else {
            console.log(`Cleared review gate events: ${reviewGateEventsFile()}`);
        }
        return;
    }
    if (optionBool(options, "status")) {
        printMonitorState(await readActiveMonitor(), asJson);
        return;
    }
    if (optionBool(options, "stop")) {
        const active = await readActiveMonitor();
        if (active) {
            stopMonitorProcess(active.pid);
            clearMonitorState();
        }
        if (asJson) {
            console.log(JSON.stringify({ stopped: Boolean(active), monitor: active }, null, 2));
        }
        else {
            console.log(active ? `Stopped Codex monitor on ${active.url}.` : "Codex monitor is not running.");
        }
        return;
    }
    const host = normalizeMonitorHost(optionString(options, "host"));
    const port = parseMonitorPort(optionString(options, "port"));
    if (optionBool(options, "foreground")) {
        await startMonitorServer(host, port);
        return;
    }
    const active = await readActiveMonitor();
    if (active) {
        printMonitorState(active, asJson);
        return;
    }
    const child = spawn(process.execPath, [SCRIPT_PATH, "monitor-server", "--host", host, "--port", String(port)], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env
    });
    child.unref();
    if (!child.pid) {
        throw new Error("Failed to start Codex monitor.");
    }
    const state = {
        pid: child.pid,
        host,
        port,
        url: monitorUrl(host, port),
        startedAt: nowIso()
    };
    writeMonitorState(state);
    if (!(await waitForMonitor(state))) {
        stopMonitorProcess(child.pid);
        clearMonitorState();
        throw new Error(`Codex monitor did not become reachable at ${state.url}.`);
    }
    printMonitorState(await readActiveMonitor(), asJson);
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
        case "monitor":
            await handleMonitor(argv);
            break;
        case "monitor-server": {
            const { options } = parseArgs(argv, { valueOptions: ["host", "port"] });
            await startMonitorServer(normalizeMonitorHost(optionString(options, "host")), parseMonitorPort(optionString(options, "port")));
            break;
        }
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
