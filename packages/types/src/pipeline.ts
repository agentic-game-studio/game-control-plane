/**
 * Lifecycle Pipeline types — Phase 0 foundation.
 *
 * A "pipeline" skill (`SkillDefinition.kind === "pipeline"`) chains phases with
 * inter-phase director gates, persists run-state for resume, and can run in
 * `manual` (pause at each gate for a human `/advance`) or `auto` (advance when
 * `isGatePassing(verdict)`) gate mode. See `.omc/plans/lifecycle-pipeline.md`.
 *
 * Run-state lives in `pipeline-service` (sessionId/runId-scoped JSON), NOT on the
 * skill definition — skills are stateless definitions; runs are stateful. Board
 * state is the observable side-effect, not the checkpoint (it cannot reconstruct
 * gate verdicts or phase index).
 */

import type { AgentRole } from "./agent.js";
import type { SkillName } from "./skill.js";
import type { GateResult } from "./gate.js";

/** Discriminator on SkillDefinition. "pipeline" opts into the pipeline-runner. */
export type SkillKind = "atomic" | "team" | "pipeline";

/**
 * How inter-phase gates are enforced.
 * - "auto":   advance when `isGatePassing(verdict)`; bounded retry then error on block.
 * - "manual": pause at every inter-phase gate (`status: "paused-at-gate"`); advance
 *             requires an explicit `/advance` call (human approval).
 */
export type GateMode = "auto" | "manual";

/**
 * High-level game-making lifecycle phase. A UI/sequencing label for pipelines.
 * NOT a replacement for milestones — milestones stay ticket-count-driven and
 * autonomous-only (pipelines take no milestone-service dependency).
 */
export type LifecyclePhase =
  | "concept"
  | "design"
  | "pre-production"
  | "production"
  | "polish"
  | "release"
  | "live-ops";

export type PipelineRunStatus =
  | "idle"
  | "running"
  | "paused-at-gate"
  | "completed"
  | "error"
  | "cancelled";

export interface PhaseStatus {
  order: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  /**
   * Mirrors `SkillPhase.createsTickets`. When true, dispatch this phase via the
   * Task tool (the only Quest-ticket creator, which also triggers auto-verification).
   * When false/omit, dispatch via invokeAgent (no tickets).
   */
  createsTickets?: boolean;
  agentResults?: { agent: AgentRole; ok: boolean; summary?: string }[];
  /** Set when the run is paused at this phase's gate in manual mode. */
  gateHeld?: { gateId: string; since: string };
}

export interface PipelineRunState {
  runId: string;
  sessionId: string;
  projectId?: string;
  skillName: SkillName;
  lifecyclePhase?: LifecyclePhase;
  gateMode: GateMode;
  status: PipelineRunStatus;
  /** Index into the skill's `phases[]`. */
  currentPhaseIndex: number;
  phaseStatuses: PhaseStatus[];
  /** gateId → last GateResult. Run-state is the checkpoint (board can't reconstruct this). */
  gateVerdicts: Record<string, GateResult>;
  /** Set when this run was spawned by /make-game manually sequencing child pipelines. */
  parentRunId?: string;
  startedAt: string;
  updatedAt: string;
  cancelledAt?: string;
  lastError?: string;
}

/** Options for `startPipelineRun`. */
export interface StartPipelineOptions {
  gateMode?: GateMode;
  projectId?: string;
  parentRunId?: string;
  /** REVIEW_MODE passthrough; "solo" short-circuits gate enforcement. */
  reviewMode?: string;
  /** Extra args forwarded into agent task prompts. */
  taskArgs?: string;
}
