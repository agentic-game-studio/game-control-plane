/**
 * Run metrics for long autonomous production sessions.
 */

import { readData, writeData, broadcastEvent } from "./data-store.js";
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
  const data = await readMetricsData();
  const now = new Date().toISOString();
  let existing = data.runs.find((r) => r.sessionId === partial.sessionId);

  if (!existing) {
    existing = {
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
    data.runs.unshift(existing);
  }

  Object.assign(existing, partial, { lastUpdatedAt: now });
  data.runs = data.runs.slice(0, 100);
  await writeData("run-metrics.json", data);

  broadcastEvent({
    type: "autonomous:metrics",
    sessionId: existing.sessionId,
    metrics: existing,
  } as WSEvent);

  return existing;
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
  const data = await readMetricsData();
  let existing = data.runs.find((r) => r.sessionId === sessionId);
  if (!existing) {
    await upsertRunMetrics({ sessionId, projectId });
    existing = (await readMetricsData()).runs.find((r) => r.sessionId === sessionId);
  }
  if (!existing) return;

  const delta = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  await upsertRunMetrics({
    sessionId,
    projectId,
    estimatedTokens: (existing.estimatedTokens ?? 0) + delta,
  });
}
