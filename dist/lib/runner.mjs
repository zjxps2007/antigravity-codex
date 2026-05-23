import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { shouldUseShell } from "./exec-resolver.mjs";
import { findJob, generateJobId, jobDir, nowIso, upsertJob, writeJobArtifact } from "./state.mjs";
export function createLogFile(cwd, jobId) {
    const dir = jobDir(cwd, jobId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "log.txt");
}
export function killProcessTree(pid) {
    if (!pid)
        return;
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true
        });
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
export function printQueued(job, asJson = false) {
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
export function runProcess(request, job, { stream = true } = {}) {
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
export async function executeTrackedRequest(request, job, options = {}) {
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
    const status = isCancelled
        ? "cancelled"
        : result.code === 0
            ? "completed"
            : "failed";
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
export function queueBackground(request, scriptPath) {
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
    const child = spawn(process.execPath, [scriptPath, "worker", "--cwd", request.cwd, "--job-id", jobId], {
        cwd: request.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env
    });
    child.unref();
    return upsertJob(request.cwd, {
        id: job.id,
        pid: child.pid ?? null,
        status: "queued",
        phase: "queued"
    });
}
export async function runForeground(request) {
    const job = {
        id: generateJobId(request.kind === "task" ? "task" : "review")
    };
    job.logFile = createLogFile(request.cwd, job.id);
    await executeTrackedRequest(request, job, { stream: true });
}
export async function runMaybeBackground(request, options, scriptPath) {
    if (options["background"] === true) {
        printQueued(queueBackground(request, scriptPath), options["json"] === true);
        return;
    }
    await runForeground(request);
}
