import { toolLabel } from "./rendering.mjs";

export function elapsedTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Progress follows observed stream events. A quiet connection is not proof of work.
export function createProgress(now = Date.now()) {
  return {
    started: now,
    updated: now,
    ended: null,
    phase: "running",
    title: "Reading your workspace",
    sources: [],
    warnings: 0,
    log: [],
  };
}

export function advanceProgress(current, event, now = Date.now()) {
  if (current.phase !== "running") return current;
  const next = { ...current, updated: now, sources: [...current.sources] };
  let activity = "";
  if (event.type === "status")
    next.title = event.text || "Reviewing the evidence";
  else if (event.type === "delta" && event.text)
    next.title = "Writing your answer";
  else if (event.type === "tool") {
    next.title =
      event.status === "error"
        ? "Continuing with available evidence"
        : toolLabel(event.name);
    if (event.status === "error") {
      next.warnings++;
      activity = event.error || "A source could not be read.";
    }
  } else if (event.type === "evidence") {
    if (!next.sources.includes(event.evidence.id))
      next.sources.push(event.evidence.id);
    activity = `Read ${event.evidence.id} · ${event.evidence.label}`;
  } else if (event.type === "action")
    activity = "Prepared a change for your review. No change executed.";
  else if (["done", "error", "stopped"].includes(event.type)) {
    next.phase = event.type;
    next.ended = now;
    next.title =
      event.type === "done"
        ? next.warnings
          ? "Answer ready · source limitations"
          : "Answer ready"
        : event.type === "stopped"
          ? "Response stopped"
          : "Response interrupted";
    if (event.type === "done" && Array.isArray(event.evidence))
      next.sources = event.evidence.map((source) => source.id);
    next.detail =
      event.error ||
      (event.type === "done" ? "" : "This response is incomplete.");
  }
  activity ||= next.title !== current.title ? next.title : "";
  if (activity)
    next.log = [
      ...next.log,
      { text: activity, elapsed: elapsedTime(now - next.started) },
    ].slice(-24);
  return next;
}

export function progressDetail(progress, now = Date.now()) {
  if (progress.phase === "done")
    return progress.warnings
      ? `${progress.warnings} source ${progress.warnings === 1 ? "issue" : "issues"}. Check the answer and activity for limitations.`
      : "Response complete. Open the evidence to verify the findings.";
  if (progress.phase !== "running") return progress.detail;
  const quietSeconds = Math.floor((now - progress.updated) / 1000);
  if (quietSeconds >= 30)
    return `No new update for ${elapsedTime(now - progress.updated)}. Waiting for the service; you can stop receiving this response.`;
  if (progress.title === "Writing your answer")
    return "The answer is arriving below. You can read while it finishes.";
  return progress.sources.length
    ? "Checking the collected evidence before finishing the answer."
    : "Waiting for source results. Your answer will appear here.";
}
