import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseReviewResultPayload, readReviewResultForJob } from "../dist/lib/review-result.mjs";
import type { Job } from "../dist/lib/state.mjs";

test("parseReviewResultPayload normalizes review output schema", () => {
  const payload = parseReviewResultPayload(
    JSON.stringify({
      verdict: "needs-attention",
      summary: "Review found issues.",
      findings: [
        {
          severity: "medium",
          title: "Finding",
          file: "src/file.ts",
          line: "12",
          description: "Problem",
          recommendation: "Fix it"
        }
      ],
      next_steps: ["Run tests"]
    })
  );

  assert.deepEqual(payload, {
    verdict: "needs-attention",
    summary: "Review found issues.",
    findings: [
      {
        severity: "medium",
        title: "Finding",
        file: "src/file.ts",
        line: 12,
        description: "Problem",
        recommendation: "Fix it"
      }
    ],
    nextSteps: ["Run tests"]
  });
});

test("readReviewResultForJob reads structured stdout artifact before result.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-review-result-"));
  const jobDir = path.join(dir, "job");
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, "stdout.txt"),
    `${JSON.stringify({ verdict: "approve", summary: "Looks good.", findings: [] })}\n`
  );
  fs.writeFileSync(
    path.join(jobDir, "result.json"),
    `${JSON.stringify({ stdout: JSON.stringify({ verdict: "needs-attention", summary: "Stale fallback." }) })}\n`
  );

  const job: Job = {
    id: "review-test",
    status: "completed",
    logFile: path.join(jobDir, "log.txt")
  };

  assert.deepEqual(readReviewResultForJob(job), {
    verdict: "approve",
    summary: "Looks good."
  });
});
