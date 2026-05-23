import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDoctorReport } from "./doctor.mjs";
import { resolveRuntimeRoot } from "./exec-resolver.mjs";
import { clearReviewGateEvents, clearMonitorState, readMonitorState, readReviewGateEvents, reviewGateEventsFile, writeMonitorState } from "./review-gate-events.mjs";
import { renderMonitorHtml } from "./monitor-template.mjs";
import { listJobs, clearJobs } from "./state.mjs";
const DEFAULT_MONITOR_HOST = "127.0.0.1";
const DEFAULT_MONITOR_PORT = 8765;
const MAX_LOG_TAIL_BYTES = 24_000;
const ROOT_DIR = resolveRuntimeRoot(path.dirname(fileURLToPath(import.meta.url)));
export function normalizeMonitorHost(value) {
    const host = value?.trim() || DEFAULT_MONITOR_HOST;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
        throw new Error("Monitor host must be local: 127.0.0.1, localhost, or ::1.");
    }
    return host;
}
export function parseMonitorPort(value) {
    if (!value)
        return DEFAULT_MONITOR_PORT;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Monitor port must be an integer between 1 and 65535.");
    }
    return port;
}
export function monitorUrl(host, port) {
    return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}
export function processIsRunning(pid) {
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
export function monitorHealth(state, timeoutMs = 600) {
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
export async function readActiveMonitor() {
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
export async function waitForMonitor(state, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (processIsRunning(state.pid) && (await monitorHealth(state, 400))) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
}
export function printMonitorState(state, asJson) {
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
export function sendJson(response, status, payload) {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
    });
    response.end(JSON.stringify(payload, null, 2));
}
export function sendHtml(response, html) {
    response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
    });
    response.end(html);
}
function readFileTail(file, maxBytes = MAX_LOG_TAIL_BYTES) {
    try {
        if (!file || !fs.existsSync(file)) {
            return "";
        }
        const stat = fs.statSync(file);
        const length = Math.min(stat.size, maxBytes);
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(file, "r");
        try {
            fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
        }
        finally {
            fs.closeSync(fd);
        }
        const text = buffer.toString("utf8");
        return stat.size > maxBytes ? `[showing last ${maxBytes} bytes]\n${text}` : text;
    }
    catch {
        return "";
    }
}
function monitorJob(job) {
    return {
        id: job.id,
        kind: job.kind,
        title: job.title,
        summary: job.summary,
        status: job.status,
        phase: job.phase,
        pid: job.pid,
        logFile: job.logFile,
        logTail: readFileTail(job.logFile),
        exitCode: job.exitCode,
        signal: job.signal,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt
    };
}
export function handleMonitorRequest(request, response, state, shutdown) {
    try {
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
                jobs: listJobs(process.cwd()).slice(0, 20).map(monitorJob),
                diagnostics: buildDoctorReport(process.cwd(), { rootDir: ROOT_DIR, checkExecutables: false }),
                eventsFile: reviewGateEventsFile(),
                monitor: state
            });
            return;
        }
        if (request.method === "DELETE" && url.pathname === "/api/events") {
            clearReviewGateEvents();
            clearJobs(process.cwd());
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
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Monitor Server Error] ${request.method} ${request.url}:`, error);
        sendJson(response, 500, { error: "Internal Server Error", message: msg });
    }
}
export function startMonitorServer(host, port) {
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
                startedAt: new Date().toISOString()
            };
            writeMonitorState(state);
            console.log(`Codex monitor running at ${state.url}`);
            console.log(`Events file: ${reviewGateEventsFile()}`);
        });
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    });
}
export function stopMonitorProcess(pid) {
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
export async function handleMonitor(argv, scriptPath, options) {
    const asJson = options.json === true;
    if (options.clear === true) {
        clearReviewGateEvents();
        clearJobs(process.cwd());
        if (asJson) {
            console.log(JSON.stringify({ cleared: true, eventsFile: reviewGateEventsFile() }, null, 2));
        }
        else {
            console.log(`Cleared review gate events: ${reviewGateEventsFile()}`);
        }
        return;
    }
    if (options.status === true) {
        printMonitorState(await readActiveMonitor(), asJson);
        return;
    }
    if (options.stop === true) {
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
    const host = normalizeMonitorHost(typeof options.host === "string" ? options.host : undefined);
    const port = parseMonitorPort(typeof options.port === "string" ? options.port : undefined);
    if (options.foreground === true) {
        await startMonitorServer(host, port);
        return;
    }
    const active = await readActiveMonitor();
    if (active) {
        printMonitorState(active, asJson);
        return;
    }
    const child = spawn(process.execPath, [scriptPath, "monitor-server", "--host", host, "--port", String(port)], {
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
        startedAt: new Date().toISOString()
    };
    writeMonitorState(state);
    if (!(await waitForMonitor(state))) {
        stopMonitorProcess(child.pid);
        clearMonitorState();
        throw new Error(`Codex monitor did not become reachable at ${state.url}.`);
    }
    printMonitorState(await readActiveMonitor(), asJson);
}
