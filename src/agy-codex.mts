#!/usr/bin/env node
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParsedOptionValue } from "./lib/args.mjs";
import {
  clearReviewGateEvents,
  clearMonitorState,
  readMonitorState,
  readReviewGateEvents,
  reviewGateEventsFile,
  writeMonitorState,
  type MonitorState
} from "./lib/review-gate-events.mjs";
import {
  findJob,
  findLatestResultJob,
  generateJobId,
  jobDir,
  listJobs,
  nowIso,
  readJobArtifact,
  resolveWorkspaceRoot,
  type CodexRequest,
  type Job,
  type JobStatus,
  upsertJob,
  writeJobArtifact
} from "./lib/state.mjs";

type CliOptions = Record<string, ParsedOptionValue | undefined>;

interface CommandAvailability {
  available: boolean;
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

interface CommandResolution {
  command: string;
  result: SpawnSyncReturns<string>;
}

interface CodexInvocation {
  command: string;
  args: string[];
}

interface ProcessResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  logFile: string;
}

interface ExecutionOptions {
  stream?: boolean;
  background?: boolean;
}

interface JobIdentity {
  id: string;
  logFile?: string;
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT_DIR = resolveRuntimeRoot(SCRIPT_DIR);
const REVIEW_SCHEMA_CANDIDATES = [
  path.join(ROOT_DIR, "schemas", "review-output.schema.json"),
  path.join(SCRIPT_DIR, "..", "schemas", "review-output.schema.json")
];
const REVIEW_SCHEMA = REVIEW_SCHEMA_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? REVIEW_SCHEMA_CANDIDATES[0]!;
const MODEL_ALIASES = new Map<string, string>([["spark", "gpt-5.3-codex-spark"]]);
const VALID_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
const NPX_REVIEW_GATE_COMMAND = `npx -y --package ${NPX_PACKAGE_SPEC} agy-codex-review-gate`;
const DEFAULT_MONITOR_HOST = "127.0.0.1";
const DEFAULT_MONITOR_PORT = 8765;

function resolveRuntimeRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(current, "plugin.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir, "..");
}

function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

function commandCandidates(command: string): string[] {
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

function shouldUseShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function resolveExecutable(command: string, args = ["--version"], cwd = process.cwd()): CommandResolution {
  for (const candidate of commandCandidates(command)) {
    const result = spawnSync(candidate, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      shell: shouldUseShell(candidate)
    });
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (!result.error || errorCode !== "ENOENT") {
      return { command: candidate, result };
    }
  }
  const result = {
    status: null,
    stdout: "",
    stderr: "",
    error: new Error(`Unable to find ${command} on PATH.`)
  } as SpawnSyncReturns<string>;
  return { command, result };
}

let cachedCodexInvocation: CodexInvocation | null = null;

function resolveCodexInvocation(cwd = process.cwd()): CodexInvocation {
  if (cachedCodexInvocation) {
    return cachedCodexInvocation;
  }

  let invocation: CodexInvocation;
  if (process.env.CODEX_BIN) {
    if (/\.js$/i.test(process.env.CODEX_BIN)) {
      invocation = { command: process.execPath, args: [process.env.CODEX_BIN] };
    } else {
      invocation = { command: process.env.CODEX_BIN, args: [] };
    }
  } else if (process.platform === "win32") {
    const found = spawnSync("where.exe", ["codex"], { cwd, encoding: "utf8", windowsHide: true });
    const paths =
      found.status === 0 ? found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
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
  } else {
    invocation = { command: "codex", args: [] };
  }

  cachedCodexInvocation = invocation;
  return invocation;
}

function codexAvailable(cwd = process.cwd()): CommandAvailability {
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

function usage(): void {
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

function normalizeModel(model: string | undefined): string | null {
  if (!model) return null;
  const trimmed = model.trim();
  return MODEL_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}

function normalizeEffort(effort: string | undefined): string | null {
  if (!effort) return null;
  const normalized = effort.trim().toLowerCase();
  if (!VALID_EFFORTS.has(normalized)) {
    throw new Error(`Unsupported effort "${effort}". Use one of: ${[...VALID_EFFORTS].join(", ")}.`);
  }
  return normalized;
}

function commandAvailable(command: string, args = ["--version"], cwd = process.cwd()): CommandAvailability {
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

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function reviewGateHookFile(): string {
  return path.join(reviewGatePluginRoot(), "hooks", "hooks.json");
}

function reviewGatePluginRoot(): string {
  return path.resolve(process.env.AGY_CODEX_PLUGIN_ROOT || process.env.ANTIGRAVITY_PLUGIN_ROOT || ROOT_DIR);
}

function reviewGateScriptFile(): string | null {
  const root = reviewGatePluginRoot();
  const candidates = [
    path.join(root, "hooks", "bin", "stop-review-gate-hook.mjs"),
    path.join(root, "dist", "stop-review-gate-hook.mjs")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function reviewGateCommand(): string {
  const script = reviewGateScriptFile();
  return script ? `node ${shellQuote(script)}` : NPX_REVIEW_GATE_COMMAND;
}

function reviewGateConfig(enabled: boolean): Record<string, unknown> {
  return {
    "codex-stop-review-gate": {
      enabled,
      Stop: [
        {
          type: "command",
          command: reviewGateCommand(),
          timeout: 300
        }
      ]
    }
  };
}

function readReviewGateEnabled(): boolean {
  const file = reviewGateHookFile();
  if (!fs.existsSync(file)) {
    return false;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      "codex-stop-review-gate"?: { enabled?: boolean };
    };
    return parsed["codex-stop-review-gate"]?.enabled !== false;
  } catch {
    return false;
  }
}

function setReviewGateEnabled(enabled: boolean): void {
  const file = reviewGateHookFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(reviewGateConfig(enabled), null, 2)}\n`);
}

function codexConfigArg(key: string, value: string): string[] {
  return ["-c", `${key}="${value.replaceAll('"', '\\"')}"`];
}

function addRuntimeOptions(args: string[], options: CliOptions): string[] {
  const model = normalizeModel(optionString(options, "model"));
  const effort = normalizeEffort(optionString(options, "effort"));
  if (model) args.push("-m", model);
  if (effort) args.push(...codexConfigArg("model_reasoning_effort", effort));
  return args;
}

function buildReviewRequest(cwd: string, options: CliOptions, positionals: string[]): CodexRequest {
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

function buildAdversarialPrompt(options: CliOptions, focusText: string): string {
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

function buildAdversarialRequest(cwd: string, options: CliOptions, positionals: string[]): CodexRequest {
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

function buildTaskRequest(cwd: string, options: CliOptions, positionals: string[]): CodexRequest {
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

function createLogFile(cwd: string, jobId: string): string {
  const dir = jobDir(cwd, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "log.txt");
}

function runProcess(request: CodexRequest, job: JobIdentity, { stream = true }: ExecutionOptions = {}): Promise<ProcessResult> {
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
    const append = (chunk: Buffer | string, isErr = false): void => {
      const text = chunk.toString();
      if (isErr) stderr += text;
      else stdout += text;
      logStream.write(text);
      if (stream) {
        (isErr ? process.stderr : process.stdout).write(text);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => append(chunk, true));
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

async function executeTrackedRequest(
  request: CodexRequest,
  job: JobIdentity,
  options: ExecutionOptions = {}
): Promise<ProcessResult> {
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
  const status: JobStatus = isCancelled ? "cancelled" : (result.code === 0 ? "completed" : "failed");

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

function queueBackground(request: CodexRequest): Job {
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

async function runForeground(request: CodexRequest): Promise<void> {
  const job: JobIdentity = {
    id: generateJobId(request.kind === "task" ? "task" : "review")
  };
  job.logFile = createLogFile(request.cwd, job.id);
  await executeTrackedRequest(request, job, { stream: true });
}

function printQueued(job: Job, asJson = false): void {
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
  } else {
    console.log(`${job.title ?? "Codex job"} started in the background as ${job.id}.`);
    console.log(`Check progress with: node dist/agy-codex.mjs status ${job.id}`);
  }
}

async function handleWorker(argv: string[]): Promise<void> {
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

async function runMaybeBackground(request: CodexRequest, options: CliOptions): Promise<void> {
  if (optionBool(options, "background")) {
    printQueued(queueBackground(request), optionBool(options, "json"));
    return;
  }
  await runForeground(request);
}

async function handleSetup(argv: string[]): Promise<void> {
  const { options } = parseArgs(argv, { booleanOptions: ["json", "enable-review-gate", "disable-review-gate"] });
  if (optionBool(options, "enable-review-gate") && optionBool(options, "disable-review-gate")) {
    throw new Error("Use only one of --enable-review-gate or --disable-review-gate.");
  }
  if (optionBool(options, "enable-review-gate")) {
    setReviewGateEnabled(true);
  } else if (optionBool(options, "disable-review-gate")) {
    setReviewGateEnabled(false);
  }

  const cwd = process.cwd();
  const node = commandAvailable("node", ["--version"], cwd);
  const codex = codexAvailable(cwd);
  const ready = node.available && codex.available;
  const reviewGate = {
    enabled: readReviewGateEnabled(),
    hooksFile: reviewGateHookFile(),
    hookCommand: reviewGateCommand()
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
  for (const step of payload.nextSteps) console.log(`- ${step}`);
}

async function handleReview(argv: string[], adversarial = false): Promise<void> {
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

async function handleTask(argv: string[]): Promise<void> {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["model", "cwd", "effort"],
    booleanOptions: ["wait", "background", "json", "write", "resume"],
    aliasMap: { m: "model" }
  });
  const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
  const request = buildTaskRequest(cwd, options, positionals);
  await runMaybeBackground(request, options);
}

function renderStatus(job: Job): string {
  return `${job.id}\t${job.kind ?? ""}\t${job.status ?? ""}\t${job.pid ?? ""}\t${job.summary ?? ""}`;
}

function handleStatus(argv: string[]): void {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
  const reference = positionals[0] ?? "";
  const jobs = reference ? [findJob(cwd, reference)].filter((job): job is Job => Boolean(job)) : listJobs(cwd).slice(0, 12);
  if (optionBool(options, "json")) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }
  if (!jobs.length) {
    console.log("No Codex jobs found for this workspace.");
    return;
  }
  console.log("id\tkind\tstatus\tpid\tsummary");
  for (const job of jobs) console.log(renderStatus(job));
}

function handleResult(argv: string[]): void {
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

function killProcessTree(pid: number | null | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already exited.
      }
    }
  }
}

function handleCancel(argv: string[]): void {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
  const reference = positionals[0] ?? "";
  const job =
    findJob(cwd, reference) ??
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
  } else {
    console.log(`Cancelled ${job.id}.`);
  }
}

function parseMonitorPort(value: string | undefined): number {
  if (!value) return DEFAULT_MONITOR_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Monitor port must be an integer between 1 and 65535.");
  }
  return port;
}

function normalizeMonitorHost(value: string | undefined): string {
  const host = value?.trim() || DEFAULT_MONITOR_HOST;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Monitor host must be local: 127.0.0.1, localhost, or ::1.");
  }
  return host;
}

function monitorUrl(host: string, port: number): string {
  return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}

function processIsRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function monitorHealth(state: MonitorState, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (healthy: boolean): void => {
      if (settled) return;
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

async function readActiveMonitor(): Promise<MonitorState | null> {
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

async function waitForMonitor(state: MonitorState, timeoutMs = 2500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (processIsRunning(state.pid) && (await monitorHealth(state, 400))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function printMonitorState(state: MonitorState | null, asJson: boolean): void {
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

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function renderMonitorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Review Gate Monitor</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #667085;
      --line: #d9dee7;
      --blue: #2563eb;
      --green: #15803d;
      --red: #b42318;
      --amber: #b7791f;
      --ink: #111827;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .top {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 680;
      letter-spacing: 0;
    }
    .sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button {
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      background: var(--blue);
      border-color: var(--blue);
      color: white;
    }
    button.danger {
      color: var(--red);
    }
    main {
      padding: 18px 0 32px;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      min-width: 0;
    }
    .metric b {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--muted);
      font-weight: 620;
    }
    .metric span {
      overflow-wrap: anywhere;
    }
    .runs {
      display: grid;
      gap: 10px;
    }
    .run {
      border: 1px solid var(--line);
      border-left: 4px solid var(--muted);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
    }
    .run.allow { border-left-color: var(--green); }
    .run.continue { border-left-color: var(--red); }
    .run.running { border-left-color: var(--amber); }
    .run-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .run-title {
      font-weight: 680;
      margin-bottom: 4px;
    }
    .run-time {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      font-size: 12px;
      font-weight: 680;
      background: #eef2ff;
      color: #243b8f;
    }
    .badge.allow { background: #dcfce7; color: #14532d; }
    .badge.continue { background: #fee2e2; color: #7f1d1d; }
    .badge.running { background: #fef3c7; color: #78350f; }
    .summary {
      margin: 10px 0;
      color: var(--text);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .findings {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .finding {
      border-top: 1px solid var(--line);
      padding-top: 9px;
      line-height: 1.45;
    }
    .finding b {
      color: var(--ink);
    }
    .location {
      color: var(--muted);
      font-size: 12px;
      margin-left: 6px;
    }
    details {
      margin-top: 10px;
    }
    summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
    }
    pre {
      overflow: auto;
      max-height: 340px;
      background: #111827;
      color: #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      line-height: 1.45;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      padding: 28px;
      text-align: center;
    }
    @media (max-width: 760px) {
      .top { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      .actions { justify-content: flex-start; }
      .meta { grid-template-columns: 1fr; }
      .run-head { flex-direction: column; }
      .run-time { white-space: normal; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div>
        <h1>Codex Review Gate Monitor</h1>
        <div class="sub">Local view of automatic Stop hook reviews</div>
      </div>
      <div class="actions">
        <button id="refresh" class="primary" type="button">Refresh</button>
        <button id="clear" type="button">Clear Events</button>
        <button id="stop" class="danger" type="button">Stop Monitor</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="meta">
      <div class="metric"><b>Last Updated</b><span id="updated">Loading</span></div>
      <div class="metric"><b>Events File</b><span id="events-file">Loading</span></div>
      <div class="metric"><b>Runs</b><span id="run-count">0</span></div>
    </section>
    <section id="runs" class="runs"></section>
  </main>
  <script>
    const runsEl = document.getElementById('runs');
    const updatedEl = document.getElementById('updated');
    const eventsFileEl = document.getElementById('events-file');
    const runCountEl = document.getElementById('run-count');

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
      return '<div class="findings">' + findings.map((finding) => {
        const location = finding.file ? finding.file + (finding.line ? ':' + finding.line : '') : '';
        return '<div class="finding"><b>' + h((finding.severity ? '[' + finding.severity + '] ' : '') + (finding.title || 'Finding')) + '</b>' +
          (location ? '<span class="location">' + h(location) + '</span>' : '') +
          (finding.description ? '<div>' + h(finding.description) + '</div>' : '') +
          (finding.recommendation ? '<div><b>Recommendation:</b> ' + h(finding.recommendation) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
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
      return '<article class="run ' + h(status) + '">' +
        '<div class="run-head"><div><div class="run-title">' + h(started && started.workspace || 'Workspace unavailable') + '</div>' +
        '<span class="badge ' + h(status) + '">' + h(status) + '</span> <span class="badge">' + h(verdict) + '</span></div>' +
        '<div class="run-time">' + h(new Date(run.last.time || Date.now()).toLocaleString()) + '</div></div>' +
        (summary ? '<div class="summary">' + h(summary) + '</div>' : '') +
        renderFindings(findings) +
        '<details><summary>Raw events</summary><pre>' + h(JSON.stringify(raw, null, 2)) + '</pre></details>' +
        '</article>';
    }

    async function load() {
      const response = await fetch('/api/events?limit=200', { cache: 'no-store' });
      const data = await response.json();
      const runs = groupEvents(data.events || []);
      updatedEl.textContent = new Date().toLocaleString();
      eventsFileEl.textContent = data.eventsFile || '';
      runCountEl.textContent = String(runs.length);
      runsEl.innerHTML = runs.length ? runs.map(renderRun).join('') : '<div class="empty">No review gate runs recorded yet.</div>';
    }

    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('clear').addEventListener('click', async () => {
      await fetch('/api/events', { method: 'DELETE' });
      await load();
    });
    document.getElementById('stop').addEventListener('click', async () => {
      await fetch('/api/stop', { method: 'POST' });
      document.body.innerHTML = '<main class="wrap"><div class="empty">Monitor stopped.</div></main>';
    });
    load().catch((error) => {
      runsEl.innerHTML = '<div class="empty">' + h(error.message || error) + '</div>';
    });
    setInterval(load, 1500);
  </script>
</body>
</html>`;
}

function handleMonitorRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  state: MonitorState,
  shutdown: () => void
): void {
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

function startMonitorServer(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let state: MonitorState | null = null;
    let closing = false;
    const server = http.createServer((request, response) => {
      if (!state) {
        sendJson(response, 503, { error: "Monitor is starting." });
        return;
      }
      handleMonitorRequest(request, response, state, shutdown);
    });
    const shutdown = (): void => {
      if (closing) return;
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

function stopMonitorProcess(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already stopped.
  }
}

async function handleMonitor(argv: string[]): Promise<void> {
  const { options } = parseArgs(argv, {
    valueOptions: ["host", "port"],
    booleanOptions: ["json", "status", "stop", "clear", "foreground"]
  });
  const asJson = optionBool(options, "json");

  if (optionBool(options, "clear")) {
    clearReviewGateEvents();
    if (asJson) {
      console.log(JSON.stringify({ cleared: true, eventsFile: reviewGateEventsFile() }, null, 2));
    } else {
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
    } else {
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

  const state: MonitorState = {
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

async function main(): Promise<void> {
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
      await startMonitorServer(
        normalizeMonitorHost(optionString(options, "host")),
        parseMonitorPort(optionString(options, "port"))
      );
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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
