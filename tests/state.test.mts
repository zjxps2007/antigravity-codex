import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isReviewGateEnabled,
  listJobs,
  readJobArtifact,
  readState,
  setReviewGateEnabled,
  upsertJob,
  writeJobArtifact,
  writeState,
  clearJobs
} from "../dist/lib/state.mjs";

function runWithSandbox(fn: (workspace: string, tempRoot: string) => void) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-test-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "agy-codex-work-"));
  const previousDataRoot = process.env.AGY_CODEX_DATA;
  process.env.AGY_CODEX_DATA = tempRoot;
  try {
    fn(workspace, tempRoot);
  } finally {
    if (previousDataRoot === undefined) {
      delete process.env.AGY_CODEX_DATA;
    } else {
      process.env.AGY_CODEX_DATA = previousDataRoot;
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

test("state stores jobs and artifacts under AGY_CODEX_DATA", () => {
  runWithSandbox((workspace) => {
    upsertJob(workspace, {
      id: "job-1",
      kind: "review",
      status: "queued"
    });
    writeJobArtifact(workspace, "job-1", "stdout.txt", "ok");

    const jobs = listJobs(workspace);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, "job-1");
    assert.equal(readJobArtifact(workspace, "job-1", "stdout.txt"), "ok\n");
  });
});

test("state cleans up orphaned job directories", () => {
  runWithSandbox((workspace) => {
    upsertJob(workspace, { id: "job-1", kind: "review", status: "queued" });
    writeJobArtifact(workspace, "job-1", "stdout.txt", "ok");

    upsertJob(workspace, { id: "job-2", kind: "review", status: "queued" });
    writeJobArtifact(workspace, "job-2", "stdout.txt", "ok2");

    const state = readState(workspace);
    // Manually remove job-1 from state and write it back
    state.jobs = state.jobs.filter(j => j.id !== "job-1");
    writeState(workspace, state);

    // Check that job-1 directory is deleted but job-2 directory remains
    assert.equal(readJobArtifact(workspace, "job-1", "stdout.txt"), null);
    assert.equal(readJobArtifact(workspace, "job-2", "stdout.txt"), "ok2\n");
  });
});

test("state stores review gate config per workspace", () => {
  runWithSandbox((workspace) => {
    assert.equal(isReviewGateEnabled(workspace), false);
    setReviewGateEnabled(workspace, true);
    assert.equal(isReviewGateEnabled(workspace), true);
    setReviewGateEnabled(workspace, false);
    assert.equal(isReviewGateEnabled(workspace), false);
  });
});

test("clearJobs empties the list of jobs and deletes directories", () => {
  runWithSandbox((workspace) => {
    upsertJob(workspace, { id: "job-1", kind: "review", status: "queued" });
    writeJobArtifact(workspace, "job-1", "stdout.txt", "ok");

    upsertJob(workspace, { id: "job-2", kind: "review", status: "queued" });
    writeJobArtifact(workspace, "job-2", "stdout.txt", "ok2");

    assert.equal(listJobs(workspace).length, 2);

    clearJobs(workspace);

    assert.equal(listJobs(workspace).length, 0);
    assert.equal(readJobArtifact(workspace, "job-1", "stdout.txt"), null);
    assert.equal(readJobArtifact(workspace, "job-2", "stdout.txt"), null);
  });
});
