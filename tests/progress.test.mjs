import test from "node:test";
import assert from "node:assert/strict";
import {
  createProgress,
  advanceProgress,
  progressDetail,
  elapsedTime,
} from "../static/js/progress.mjs";

test("a streamed answer changes phase after reasoning and unique sources accumulate", () => {
  let progress = createProgress(0);
  progress = advanceProgress(
    progress,
    { type: "status", text: "Connecting the evidence" },
    1000,
  );
  progress = advanceProgress(
    progress,
    { type: "evidence", evidence: { id: "S1", label: "Inventory" } },
    2000,
  );
  progress = advanceProgress(
    progress,
    { type: "evidence", evidence: { id: "S1", label: "Inventory" } },
    3000,
  );
  progress = advanceProgress(
    progress,
    { type: "delta", text: "Findings" },
    4000,
  );
  assert.equal(progress.title, "Writing your answer");
  assert.deepEqual(progress.sources, ["S1"]);
  assert.match(progressDetail(progress, 4000), /arriving/);
  progress = advanceProgress(
    progress,
    { type: "tool", name: "slide_device_alerts", status: "running" },
    5000,
  );
  assert.equal(progress.title, "Checking device alerts");
});

test("a quiet connection is described honestly and a new event clears the warning", () => {
  let progress = createProgress(0);
  assert.match(progressDetail(progress, 45000), /No new update for 45s/);
  progress = advanceProgress(
    progress,
    { type: "status", text: "Reviewing the evidence" },
    46000,
  );
  assert.doesNotMatch(progressDetail(progress, 46000), /No new update/);
});

test("source errors remain visible as limitations even when an answer completes", () => {
  let progress = advanceProgress(
    createProgress(0),
    { type: "tool", status: "error", error: "Source unavailable" },
    1000,
  );
  progress = advanceProgress(
    progress,
    { type: "done", evidence: [{ id: "S2" }] },
    2000,
  );
  assert.equal(progress.title, "Answer ready · source limitations");
  assert.match(progressDetail(progress), /1 source issue/);
  assert.equal(progress.ended, 2000);
  assert.deepEqual(progress.sources, ["S2"]);
  assert.ok(progress.log.some((entry) => entry.text === "Source unavailable"));
});

test("stopped and failed responses never become successful on a late event", () => {
  for (const type of ["stopped", "error"]) {
    const progress = advanceProgress(
      createProgress(0),
      { type, error: "Incomplete response" },
      13000,
    );
    assert.equal(progress.phase, type);
    assert.equal(progressDetail(progress), "Incomplete response");
    assert.equal(advanceProgress(progress, { type: "done" }, 20000), progress);
  }
});

test("activity stays bounded and elapsed times continue beyond a minute", () => {
  let progress = createProgress(0);
  for (let index = 0; index < 80; index++)
    progress = advanceProgress(
      progress,
      { type: "status", text: `Step ${index}` },
      index * 1000,
    );
  assert.equal(progress.log.length, 24);
  assert.equal(elapsedTime(125000), "2m 5s");
  assert.equal(elapsedTime(-1000), "0s");
});
