import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderMonitorHtml } from "../dist/lib/monitor-template.mjs";

interface FakeElement {
  textContent: string;
  innerHTML: string;
  classList: { toggle: () => void };
  setAttribute: () => void;
  querySelector: (selector: string) => FakeElement;
  addEventListener: () => void;
}

function extractScript(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match?.[1], "monitor template script should exist");
  return match[1];
}

function createFakeElement(elements: Map<string, FakeElement>, id: string): FakeElement {
  const element: FakeElement = {
    textContent: "",
    innerHTML: "",
    classList: { toggle: () => undefined },
    setAttribute: () => undefined,
    querySelector: (selector: string) => {
      const key = `${id}:${selector}`;
      let child = elements.get(key);
      if (!child) {
        child = createFakeElement(elements, key);
        elements.set(key, child);
      }
      return child;
    },
    addEventListener: () => undefined
  };
  elements.set(id, element);
  return element;
}

test("monitor template renders event timeline and execution logs", async () => {
  const elements = new Map<string, FakeElement>();
  for (const id of [
    "runs",
    "jobs",
    "updated",
    "events-file",
    "run-count",
    "job-count",
    "diagnostics",
    "auto-refresh",
    "refresh",
    "clear",
    "stop"
  ]) {
    createFakeElement(elements, id);
  }

  const events = [
    {
      id: "gate-test",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:00.000Z",
      type: "started",
      message: "terminationReason=model_stop fullyIdle=true"
    },
    {
      id: "gate-test",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:01.000Z",
      type: "codex-result",
      status: 0,
      verdict: "approve",
      summary: "Codex approved.",
      stdout: "stdout log line",
      stderr: "stderr log line"
    },
    {
      id: "gate-test",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:02.000Z",
      type: "decision",
      decision: "allow",
      verdict: "approve",
      summary: "Allowed.",
      reason: "decision reason"
    }
  ];

  const context = vm.createContext({
    document: {
      getElementById: (id: string) => elements.get(id) ?? createFakeElement(elements, id)
    },
    fetch: async () => ({
      json: async () => ({
        events,
        jobs: [
          {
            id: "review-test",
            kind: "review",
            title: "Codex Review",
            summary: "Review uncommitted changes",
            status: "running",
            updatedAt: "2026-05-23T08:00:03.000Z",
            logFile: "/tmp/job/log.txt",
            logTail: "job log line"
          }
        ],
        diagnostics: {
          diagnosis: "Manual hook logging works, but no automatic Antigravity Stop-hook event has been recorded.",
          checks: [
            { name: "Review gate config", status: "pass", message: "enabled" },
            { name: "Review gate events", status: "warn", message: "no events" }
          ],
          nextSteps: ["Start a fresh Antigravity session."]
        },
        eventsFile: "/tmp/events.jsonl"
      })
    }),
    Date,
    Map,
    Number,
    String,
    JSON,
    setInterval,
    clearInterval,
    confirm: () => false,
    navigator: { clipboard: { writeText: () => undefined } },
    console
  });

  vm.runInContext(extractScript(renderMonitorHtml()), context, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const output = elements.get("runs")?.innerHTML ?? "";
  const jobOutput = elements.get("jobs")?.innerHTML ?? "";
  const diagnosticsOutput = elements.get("diagnostics")?.innerHTML ?? "";
  assert.equal(elements.get("run-count")?.textContent, "1");
  assert.equal(elements.get("job-count")?.textContent, "1");
  assert.match(diagnosticsOutput, /Diagnostics/);
  assert.match(diagnosticsOutput, /Manual hook logging works/);
  assert.match(diagnosticsOutput, /Review gate config/);
  assert.match(output, /Event Timeline/);
  assert.match(output, /Execution Logs/);
  assert.match(output, /stdout log line/);
  assert.match(output, /stderr log line/);
  assert.match(output, /decision reason/);
  assert.match(jobOutput, /Codex Review/);
  assert.match(jobOutput, /Job Log/);
  assert.match(jobOutput, /job log line/);
});

test("monitor template handles throwing localStorage safely", async () => {
  const elements = new Map<string, FakeElement>();
  for (const id of [
    "runs",
    "jobs",
    "updated",
    "events-file",
    "run-count",
    "job-count",
    "diagnostics",
    "auto-refresh",
    "refresh",
    "clear",
    "stop",
    "toggle-sidebar",
    "layout-container"
  ]) {
    createFakeElement(elements, id);
  }

  const context = vm.createContext({
    document: {
      getElementById: (id: string) => elements.get(id) ?? createFakeElement(elements, id)
    },
    fetch: async () => ({
      json: async () => ({
        events: [],
        jobs: [],
        diagnostics: {},
        eventsFile: "/tmp/events.jsonl"
      })
    }),
    Date,
    Map,
    Number,
    String,
    JSON,
    setInterval,
    clearInterval,
    confirm: () => false,
    navigator: { clipboard: { writeText: () => undefined } },
    localStorage: {
      getItem: () => { throw new Error("Storage access denied"); },
      setItem: () => { throw new Error("Storage access denied"); }
    },
    console
  });

  // Should compile and run without throwing ReferenceError or SecurityError
  vm.runInContext(extractScript(renderMonitorHtml()), context, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const output = elements.get("runs")?.innerHTML ?? "";
  assert.equal(elements.get("run-count")?.textContent, "0");
  assert.equal(elements.get("job-count")?.textContent, "0");
});

test("monitor template uses needs-attention class on continue cards", async () => {
  assert.match(renderMonitorHtml(), /\.badge\.continue \{[\s\S]*?color: #38bdf8;/);

  const elements = new Map<string, FakeElement>();
  for (const id of [
    "runs",
    "jobs",
    "updated",
    "events-file",
    "run-count",
    "job-count",
    "diagnostics",
    "auto-refresh",
    "refresh",
    "clear",
    "stop",
    "toggle-sidebar",
    "layout-container"
  ]) {
    createFakeElement(elements, id);
  }

  const events = [
    {
      id: "gate-needs-attention",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:00.000Z",
      type: "started",
      message: "terminationReason=NO_TOOL_CALL fullyIdle=true"
    },
    {
      id: "gate-needs-attention",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:01.000Z",
      type: "decision",
      decision: "continue",
      verdict: "needs-attention",
      summary: "Fix before stopping."
    }
  ];

  const context = vm.createContext({
    document: {
      getElementById: (id: string) => elements.get(id) ?? createFakeElement(elements, id)
    },
    fetch: async () => ({
      json: async () => ({
        events,
        jobs: [],
        diagnostics: {},
        eventsFile: "/tmp/events.jsonl"
      })
    }),
    Date,
    Map,
    Number,
    String,
    JSON,
    setInterval,
    clearInterval,
    confirm: () => false,
    navigator: { clipboard: { writeText: () => undefined } },
    console
  });

  vm.runInContext(extractScript(renderMonitorHtml()), context, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const output = elements.get("runs")?.innerHTML ?? "";
  assert.match(output, /class="run continue needs-attention"/);
});

test("monitor template handles collapsible runs and default collapsed state", async () => {
  const elements = new Map<string, FakeElement>();
  for (const id of [
    "runs",
    "jobs",
    "updated",
    "events-file",
    "run-count",
    "job-count",
    "diagnostics",
    "auto-refresh",
    "refresh",
    "clear",
    "stop"
  ]) {
    createFakeElement(elements, id);
  }

  const events = [
    {
      id: "run-first",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:01.000Z",
      type: "decision",
      decision: "allow",
      verdict: "approve",
      summary: "First run is expanded."
    },
    {
      id: "run-second",
      workspace: "/tmp/workspace",
      time: "2026-05-23T08:00:00.000Z",
      type: "decision",
      decision: "allow",
      verdict: "approve",
      summary: "Second run is collapsed."
    }
  ];

  const context = vm.createContext({
    document: {
      getElementById: (id: string) => elements.get(id) ?? createFakeElement(elements, id)
    },
    fetch: async () => ({
      json: async () => ({
        events,
        jobs: [],
        diagnostics: {},
        eventsFile: "/tmp/events.jsonl"
      })
    }),
    Date,
    Map,
    Number,
    String,
    JSON,
    setInterval,
    clearInterval,
    confirm: () => false,
    navigator: { clipboard: { writeText: () => undefined } },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined
    },
    console
  });

  vm.runInContext(extractScript(renderMonitorHtml()), context, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const output = elements.get("runs")?.innerHTML ?? "";
  // The first run should NOT have run-collapsed
  assert.match(output, /id="run-run-first" class="run allow approve"/);
  // The second run should have run-collapsed
  assert.match(output, /id="run-run-second" class="run allow approve run-collapsed"/);
});
