#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { commandAvailable, codexAvailable, resolveRuntimeRoot } from "./lib/exec-resolver.mjs";
import { handleMonitor, startMonitorServer, normalizeMonitorHost, parseMonitorPort } from "./lib/monitor-server.mjs";
import { buildAdversarialRequest, buildReviewRequest, buildTaskRequest, optionBool, optionString } from "./lib/request-builders.mjs";
import { executeTrackedRequest, killProcessTree, runMaybeBackground } from "./lib/runner.mjs";
import { findJob, findLatestResultJob, isReviewGateEnabled, listJobs, nowIso, readJobArtifact, resolveWorkspaceRoot, setReviewGateEnabled, upsertJob, workspaceStateDir } from "./lib/state.mjs";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = resolveRuntimeRoot(path.dirname(SCRIPT_PATH));
const NPX_PACKAGE_SPEC = "github:zjxps2007/antigravity-codex";
const NPX_REVIEW_GATE_COMMAND = `npx -y --package ${NPX_PACKAGE_SPEC} agy-codex-review-gate`;
function reviewGateHookFile() {
    return path.join(ROOT_DIR, "hooks", "hooks.json");
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
// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------
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
    await runMaybeBackground(request, options, SCRIPT_PATH);
}
async function handleTask(argv) {
    const { options, positionals } = parseArgs(argv, {
        valueOptions: ["model", "cwd", "effort"],
        booleanOptions: ["wait", "background", "json", "write", "resume"],
        aliasMap: { m: "model" }
    });
    const cwd = path.resolve(optionString(options, "cwd") ?? process.cwd());
    const request = buildTaskRequest(cwd, options, positionals);
    await runMaybeBackground(request, options, SCRIPT_PATH);
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
    const jobs = reference
        ? [findJob(cwd, reference)].filter((job) => Boolean(job))
        : listJobs(cwd).slice(0, 12);
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
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
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
        case "monitor": {
            const { options } = parseArgs(argv, {
                valueOptions: ["host", "port"],
                booleanOptions: ["json", "status", "stop", "clear", "foreground"]
            });
            await handleMonitor(argv, SCRIPT_PATH, options);
            break;
        }
        case "monitor-server": {
            const { options } = parseArgs(argv, { valueOptions: ["host", "port"] });
            await startMonitorServer(normalizeMonitorHost(optionString(options, "host") ?? undefined), parseMonitorPort(optionString(options, "port") ?? undefined));
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
