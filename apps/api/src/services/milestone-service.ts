/**
 * Milestone tracking for autonomous production phases.
 */

import { readTicketsBoard, updateTicketsBoard } from "./ticket-board.js";
import { broadcast } from "./websocket.js";
import { runMilestoneGates } from "./milestone-gate-service.js";
import type { WSEvent } from "@game-studio/types";

export const MILESTONES = [
  { id: "foundation", name: "Foundation", phase: 1, minCompleted: 4 },
  { id: "core", name: "Core Features", phase: 2, minCompleted: 8 },
  { id: "polish", name: "Polish", phase: 3, minCompleted: 14 },
  { id: "ship", name: "Ship Ready", phase: 4, minCompleted: 18 },
] as const;

const lastGatedByProject = new Map<string, number>();

export interface MilestoneStatus {
  index: number;
  milestone: (typeof MILESTONES)[number];
  completedCount: number;
  passed: boolean;
}

export async function getMilestoneStatus(projectId: string): Promise<MilestoneStatus> {
  const board = await readTicketsBoard(projectId);
  const completedCount = board.columns.find((c) => c.id === "completed")?.tickets.length ?? 0;

  let index = 0;
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (completedCount >= MILESTONES[i].minCompleted) {
      index = i;
      break;
    }
  }

  const milestone = MILESTONES[index];
  const passed = completedCount >= milestone.minCompleted;
  return { index, milestone, completedCount, passed };
}

export async function advanceMilestoneIfReady(
  projectId: string,
  sessionId: string,
  completedCount: number,
  gateContext?: string,
): Promise<MilestoneStatus | null> {
  const status = await getMilestoneStatus(projectId);
  const nextIndex = status.index + 1;

  if (nextIndex >= MILESTONES.length) return null;
  if (completedCount < MILESTONES[nextIndex].minCompleted) return null;

  const lastGated = lastGatedByProject.get(projectId) ?? 0;
  if (nextIndex <= lastGated) return null;

  const next = MILESTONES[nextIndex];

  if (gateContext) {
    const gateRun = await runMilestoneGates(nextIndex, sessionId, projectId, gateContext);
    if (!gateRun.passed) {
      return {
        index: status.index,
        milestone: status.milestone,
        completedCount,
        passed: false,
      };
    }
  }

  lastGatedByProject.set(projectId, nextIndex);

  await updateTicketsBoard(projectId, (board) => {
    board.milestone = next.name;
    return board;
  });

  broadcast({
    type: "autonomous:milestone",
    sessionId,
    projectId,
    milestone: next.name,
    index: nextIndex,
    summary: `Reached ${next.name} with ${completedCount} completed tickets`,
  } as WSEvent);

  return {
    index: nextIndex,
    milestone: next,
    completedCount,
    passed: true,
  };
}
