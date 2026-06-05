/**
 * Run metrics for long autonomous production sessions.
 */

import { readData, updateData, broadcastEvent } from "./data-store.js";
import type { AutonomousRunMetrics, RunMetricsData, WSEvent } from "@game-studio/types";

const DEFAULT: RunMetricsData = { runs: [] };

// 27-L-run-metrics-cap-const: hoist the runs slice cap to a named
// constant. The pattern was applied to gateVerdicts, toolsCache,
// lastGatedByProject, ticketProjectCache, usageLog, and
// changelog in earlier passes. A magic 100 inline would force any
// future bump to be done in two places if the cap is used in both
// write and read paths.
const MAX_RUN_METRICS_ENTRIES = 100;

async function readMetricsData(): Promise<RunMetricsData> {
  try {
    return await readData<RunMetricsData>("run-metrics.json");
  } catch {
    return DEFAULT;
  }
}

export async function getRunMetrics(sessionId: string): Promise<AutonomousRunMetrics | null> {
  const data = await readMetricsData();
  return data.runs.find((r) => r.sessionId === sessionId) ?? null;
}

export async function upsertRunMetrics(partial: Partial<AutonomousRunMetrics> & { sessionId: string; projectId: string; addTokens?: number }): Promise<AutonomousRunMetrics> {
  // 14-CR-run-metrics: route the read-modify-write through updateData so
  // the per-file mutex serializes concurrent upserts. recordTokenUsage
  // is called from makeTokenTracker on every LLM tool call — two
  // concurrent calls (one for invokeAgent tokens, one for the
  // verifier tokens) would both see the same baseline, each compute
  // its own delta, and last-writer-wins losing one delta silently.
  // updateData takes a mutator and applies it under the lock.
  //
  // 20-M-run-metrics-rwm: the previous fix moved the *write* under the
  // mutex but left the *read* outside it. recordTokenUsage computed
  // `baseTokens + delta` from a lock-free read and then passed that
  // fixed value to upsertRunMetrics, which Object.assign'd it on top
  // of whatever the mutex had. Two concurrent calls (CallA reading
  // baseline=100 with delta=50, CallB reading baseline=100 with
  // delta=30) would serialize at the mutex but the second writer
  // would clobber the first's increment — the lock guaranteed mutual
  // exclusion, not linearizability. Fix: callers that want to
  // *add* to estimatedTokens pass `addTokens: delta` instead of
  // `estimatedTokens: baseTokens + delta`; we apply the += inside
  // the same mutex acquisition that read the baseline. Object.assign
  // is still used for all other fields, so non-token upserts are
  // unchanged.
  const now = new Date().toISOString();
  const blankRecord: AutonomousRunMetrics = {
    sessionId: partial.sessionId,
    projectId: partial.projectId,
    startedAt: now,
    lastUpdatedAt: now,
    totalIterations: 0,
    completedCount: 0,
    failedCount: 0,
    totalDurationMs: 0,
    estimatedTokens: 0,
    qaGatePasses: 0,
    qaGateFailures: 0,
    milestoneIndex: 0,
  };
  // Capture the updated record by reading back through updateData's
  // return value. updateData returns the post-mutation data, so the
  // last .runs[0] is our just-upserted entry (it's the one we
  // unshifted for new entries, or the existing entry that we Object.assign'd
  // over). The mutex guarantees no other writer snuck in between.
  const after = await updateData<RunMetricsData>("run-metrics.json", (data) => {
    let existing = data.runs.find((r) => r.sessionId === partial.sessionId);
    if (!existing) {
      existing = { ...blankRecord };
      data.runs.unshift(existing);
    }
    // Pull addTokens out of the assign payload so Object.assign doesn't
    // treat it as a real field. Apply the increment under the same
    // mutex acquisition that read the baseline.
    const { addTokens, ...assignable } = partial;
    if (typeof addTokens === "number" && addTokens > 0) {
      existing.estimatedTokens = (existing.estimatedTokens ?? 0) + addTokens;
    }
    // 30-H-run-metrics-prototype-sink: Object.assign copies every
    // own-enumerable property of `assignable` onto `existing`. If a
    // future caller passes an object parsed from a JSON body, and the
    // body contains a `__proto__` / `constructor` / `prototype` key
    // (all valid JSON object keys that JSON.parse will preserve as
    // own-enumerable properties), the assignment invokes the
    // `__proto__` setter on `existing` and corrupts its prototype
    // chain. Safe today because every call site is internal and
    // strongly-typed, but a future WebSocket-driven metrics update
    // or external integration would change that in one line. Strip
    // the prototype-bearing keys before Object.assign.
    for (const key of Object.keys(assignable)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        delete (assignable as Record<string, unknown>)[key];
      }
    }
    Object.assign(existing, assignable, { lastUpdatedAt: now });
    data.runs = data.runs.slice(0, MAX_RUN_METRICS_ENTRIES);
    return data;
  });
  const updated: AutonomousRunMetrics =
    after.runs.find((r) => r.sessionId === partial.sessionId) ?? blankRecord;

  broadcastEvent({
    type: "autonomous:metrics",
    sessionId: updated.sessionId,
    metrics: updated,
  } as WSEvent);

  return updated;
}

export async function listRunMetrics(projectId?: string): Promise<AutonomousRunMetrics[]> {
  const data = await readMetricsData();
  if (!projectId) return data.runs;
  return data.runs.filter((r) => r.projectId === projectId);
}

export async function recordTokenUsage(
  sessionId: string,
  projectId: string,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  // 20-M-run-metrics-rwm: the read-modify-write must happen under a
  // single mutex acquisition. The previous shape read the baseline
  // here, added the delta lock-free, then passed the pre-summed
  // value into upsertRunMetrics. Two concurrent calls (invokeAgent
  // tokens + verifier tokens, both routed through makeTokenTracker)
  // would both see the same baseline, both compute the delta, and
  // last-writer-wins inside the mutex would clobber the first
  // call's increment. Pass the delta only and let upsertRunMetrics
  // apply `existing.estimatedTokens += delta` under the same lock
  // that located `existing`. The lock-free read is gone.
  const delta = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  if (delta <= 0) return;
  await upsertRunMetrics({
    sessionId,
    projectId,
    addTokens: delta,
  });
}
