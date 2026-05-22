import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listJobs, readJobArtifact, upsertJob, writeJobArtifact } from "../scripts/lib/state.mjs";

test("state stores jobs and artifacts under AGY_CODEX_DATA", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-test-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-work-"));
  process.env.AGY_CODEX_DATA = tempRoot;

  upsertJob(workspace, {
    id: "job-1",
    kind: "review",
    status: "queued"
  });
  writeJobArtifact(workspace, "job-1", "stdout.txt", "ok");

  const jobs = listJobs(workspace);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "job-1");
  assert.equal(readJobArtifact(workspace, "job-1", "stdout.txt"), "ok\n");
});

