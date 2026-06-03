/**
 * Run metrics for long autonomous production sessions.
 */

import { readData, updateData, broadcastEvent } from "./data-store.js";
import type { AutonomousRunMetrics, RunMetricsData, WSEvent } from "@game-studio/types";

const DEFAULT: RunMetricsData = { runs: [] };

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

export async function upsertRunMetrics(partial: Partial<AutonomousRunMetrics> & { sessionId: string; projectId: string }): Promise<AutonomousRunMetrics> {
  // 14-CR-run-metrics: route the read-modify-write through updateData so
  // the per-file mutex serializes concurrent upserts. recordTokenUsage
  // is called from makeTokenTracker on every LLM tool call — two
  // concurrent calls (one for invokeAgent tokens, one for the
  // verifier tokens) would both see the same baseline, each compute
  // its own delta, and last-writer-wins losing one delta silently.
  // updateData takes a mutator and applies it under the lock.
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
    Object.assign(existing, partial, { lastUpdatedAt: now });
    data.runs = data.runs.slice(0, 100);
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
  // 14-CR-run-metrics: read baseline once, then perform a single
  // atomic upsert. Avoids the previous two-IO pattern (read, find,
  // upsert-create-if-missing, read-again-to-find) which had its own
  // race between the first read and the second upsert.
  const data = await readMetricsData();
  const existing = data.runs.find((r) => r.sessionId === sessionId);
  const baseTokens = existing?.estimatedTokens ?? 0;
  const delta = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  await upsertRunMetrics({
    sessionId,
    projectId,
    estimatedTokens: baseTokens + delta,
  });
}
