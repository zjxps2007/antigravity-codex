import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDoctorReport } from "./doctor.mjs";
import { resolveRuntimeRoot } from "./exec-resolver.mjs";
import {
  clearReviewGateEvents,
  clearMonitorState,
  readMonitorState,
  readReviewGateEvents,
  reviewGateEventsFile,
  writeMonitorState,
  type ReviewGateFinding,
  type MonitorState
} from "./review-gate-events.mjs";
import { readReviewResultForJob } from "./review-result.mjs";
import { renderMonitorHtml } from "./monitor-template.mjs";
import { CliOptions } from "./request-builders.mjs";
import { listJobs, clearJobs, resolveWorkspaceRoot, type Job } from "./state.mjs";

const DEFAULT_MONITOR_HOST = "127.0.0.1";
const DEFAULT_MONITOR_PORT = 8765;
const MAX_LOG_TAIL_BYTES = 24_000;
const ROOT_DIR = resolveRuntimeRoot(path.dirname(fileURLToPath(import.meta.url)));
const MONITOR_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"]);

interface MonitorJob {
  id: string;
  kind?: string;
  title?: string;
  summary?: string;
  status?: string;
  phase?: string;
  pid?: number | null;
  logFile?: string;
  logTail?: string;
  exitCode?: number;
  signal?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  reviewVerdict?: string;
  reviewSummary?: string;
  reviewFindings?: ReviewGateFinding[];
  reviewNextSteps?: string[];
}

export function normalizeMonitorHost(value: string | undefined): string {
  const host = value?.trim() || DEFAULT_MONITOR_HOST;
  if (!MONITOR_HOSTS.has(host)) {
    throw new Error("Monitor host must be one of: 127.0.0.1, localhost, ::1, 0.0.0.0, ::.");
  }
  return host;
}

export function parseMonitorPort(value: string | undefined): number {
  if (!value) return DEFAULT_MONITOR_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Monitor port must be an integer between 1 and 65535.");
  }
  return port;
}

export function monitorUrl(host: string, port: number): string {
  return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}

export function processIsRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function monitorHealth(state: MonitorState, timeoutMs = 600): Promise<boolean> {
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

export async function readActiveMonitor(): Promise<MonitorState | null> {
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

export async function waitForMonitor(state: MonitorState, timeoutMs = 2500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (processIsRunning(state.pid) && (await monitorHealth(state, 400))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export function printMonitorState(state: MonitorState | null, asJson: boolean): void {
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

export function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function sendHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function readFileTail(file: string | undefined, maxBytes = MAX_LOG_TAIL_BYTES): string {
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
    } finally {
      fs.closeSync(fd);
    }
    const text = buffer.toString("utf8");
    return stat.size > maxBytes ? `[showing last ${maxBytes} bytes]\n${text}` : text;
  } catch {
    return "";
  }
}

function monitorJob(job: Job): MonitorJob {
  const reviewResult = readReviewResultForJob(job);
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
    completedAt: job.completedAt,
    reviewVerdict: reviewResult?.verdict,
    reviewSummary: reviewResult?.summary,
    reviewFindings: reviewResult?.findings,
    reviewNextSteps: reviewResult?.nextSteps
  };
}

export function handleMonitorRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  state: MonitorState,
  shutdown: () => void
): void {
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
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      sendJson(response, 200, {
        events: readReviewGateEvents(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 200, workspaceRoot),
        jobs: listJobs(process.cwd()).slice(0, 20).map(monitorJob),
        diagnostics: buildDoctorReport(process.cwd(), { rootDir: ROOT_DIR, checkExecutables: false }),
        eventsFile: reviewGateEventsFile(),
        monitor: state
      });
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/events") {
      clearReviewGateEvents(resolveWorkspaceRoot(process.cwd()));
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Monitor Server Error] ${request.method} ${request.url}:`, error);
    sendJson(response, 500, { error: "Internal Server Error", message: msg });
  }
}

export function startMonitorServer(host: string, port: number): Promise<void> {
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

export function stopMonitorProcess(pid: number): void {
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

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsCommandLineArg(value: string): string {
  if (value.length > 0 && !/[\s"]/.test(value)) {
    return value;
  }
  let result = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += "\\".repeat(backslashes * 2 + 1);
      result += '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes);
    result += char;
    backslashes = 0;
  }
  result += "\\".repeat(backslashes * 2);
  result += '"';
  return result;
}

function monitorCommandLine(scriptPath: string, host: string, port: number): string {
  return [
    process.execPath,
    scriptPath,
    "monitor-server",
    "--host",
    host,
    "--port",
    String(port)
  ].map(windowsCommandLineArg).join(" ");
}

function startWindowsMonitorWithCim(scriptPath: string, host: string, port: number): number | null {
  const commandLine = monitorCommandLine(scriptPath, host, port);
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$arguments = @{ CommandLine = ${powershellQuote(commandLine)}; CurrentDirectory = ${powershellQuote(process.cwd())} }`,
    "$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $arguments",
    "if ($result.ReturnValue -ne 0) { throw \"Win32_Process.Create failed with code $($result.ReturnValue)\" }",
    "[Console]::Out.Write($result.ProcessId)"
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: process.env
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "Failed to start monitor with Win32_Process.Create.");
  }
  const pid = Number(result.stdout.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function startWindowsMonitorWithStartProcess(scriptPath: string, host: string, port: number): number | null {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath ${powershellQuote(process.execPath)} -ArgumentList @(${[
      scriptPath,
      "monitor-server",
      "--host",
      host,
      "--port",
      String(port)
    ].map(powershellQuote).join(", ")}) -WorkingDirectory ${powershellQuote(process.cwd())} -WindowStyle Hidden -PassThru`,
    "[Console]::Out.Write($process.Id)"
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: process.env
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "Failed to start monitor with PowerShell.");
  }
  const pid = Number(result.stdout.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function startWindowsMonitorProcess(scriptPath: string, host: string, port: number): number | null {
  try {
    return startWindowsMonitorWithCim(scriptPath, host, port);
  } catch (error) {
    process.stderr.write(
      `Win32_Process.Create monitor launch failed; falling back to Start-Process: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return startWindowsMonitorWithStartProcess(scriptPath, host, port);
  }
}

function startDetachedMonitorProcess(scriptPath: string, host: string, port: number): number | null {
  if (process.platform === "win32") {
    return startWindowsMonitorProcess(scriptPath, host, port);
  }
  const child = spawn(process.execPath, [scriptPath, "monitor-server", "--host", host, "--port", String(port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env
  });
  child.unref();
  return child.pid ?? null;
}

export async function handleMonitor(
  argv: string[],
  scriptPath: string,
  options: CliOptions
): Promise<void> {
  const asJson = options.json === true;

  if (options.clear === true) {
    clearReviewGateEvents(resolveWorkspaceRoot(process.cwd()));
    clearJobs(process.cwd());
    if (asJson) {
      console.log(JSON.stringify({ cleared: true, eventsFile: reviewGateEventsFile() }, null, 2));
    } else {
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
    } else {
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

  const pid = startDetachedMonitorProcess(scriptPath, host, port);
  if (!pid) {
    throw new Error("Failed to start Codex monitor.");
  }

  const state: MonitorState = {
    pid,
    host,
    port,
    url: monitorUrl(host, port),
    startedAt: new Date().toISOString()
  };
  writeMonitorState(state);
  if (!(await waitForMonitor(state))) {
    stopMonitorProcess(pid);
    clearMonitorState();
    throw new Error(`Codex monitor did not become reachable at ${state.url}.`);
  }
  printMonitorState(await readActiveMonitor(), asJson);
}
