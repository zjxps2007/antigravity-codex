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
  for (const id of ["runs", "jobs", "updated", "events-file", "run-count", "job-count", "auto-refresh", "refresh", "clear", "stop"]) {
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
  assert.equal(elements.get("run-count")?.textContent, "1");
  assert.equal(elements.get("job-count")?.textContent, "1");
  assert.match(output, /Event Timeline/);
  assert.match(output, /Execution Logs/);
  assert.match(output, /stdout log line/);
  assert.match(output, /stderr log line/);
  assert.match(output, /decision reason/);
  assert.match(jobOutput, /Codex Review/);
  assert.match(jobOutput, /Job Log/);
  assert.match(jobOutput, /job log line/);
});
