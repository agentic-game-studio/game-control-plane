/**
 * Pipeline Service — runs `kind: "pipeline"` skills with real inter-phase gate
 * enforcement, resumable run-state, and manual/auto gate modes.
 *
 * Design (see .omc/plans/lifecycle-pipeline.md, consensus-approved v2):
 * - Verdict classification reuses `isGatePassing()` from milestone-gate-service as
 *   the SINGLE classifier — never hand-rolled, never re-declared. This guarantees
 *   manual pipelines and autonomous milestone gates classify verdicts identically.
 * - `executeGate` is wrapped in try/catch; a throw is treated as the ERROR verdict
 *   (a BLOCK verdict) — never advances.
 * - Gate enforcement is gated purely on `skill.kind === "pipeline"` (NO feature flag).
 *   Legacy atomic/team skills keep their log-only behavior in routes/skills.ts.
 * - Gate placement: `executeGate` fires ONCE per phase, AFTER the agent loop, BEFORE
 *   advancing — never per-agent (fixes the routes/skills.ts:138-149 3x log bug).
 * - Run-state is the checkpoint (persisted atomically, tmp+rename); board state is
 *   the observable side-effect. Pipelines take NO milestone-service dependency.
 * - v1 runs phases + agents strictly sequentially; `parallel:true` is parsed but not
 *   honored yet (documented follow-up).
 */

import { skills } from "@game-studio/skills";
import type {
  AgentRole,
  GateResult,
  PipelineRunState,
  PhaseStatus,
  SkillDefinition,
  StartPipelineOptions,
  WSEvent,
} from "@game-studio/types";
import { invokeAgent, detectEngineFromWorkspace, type ProjectContext } from "./llm-service.js";
import { executeGate } from "./gate-service.js";
import { isGatePassing } from "./milestone-gate-service.js";
import { broadcast } from "./websocket.js";
import { readData } from "./data-store.js";
import { newId } from "../utils/ids.js";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";

const PIPELINE_GATE_MAX_RETRIES = 2;

/** In-memory mirror of persisted run-state (source of truth during a run). */
const activeRuns = new Map<string, PipelineRunState>();
/** Skill definitions are not serialized; cached here keyed by runId. */
const runSkills = new Map<string, SkillDefinition>();
/** The detached loop promise per run, so callers/tests can await completion. */
const runLoops = new Map<string, Promise<void>>();

/** Test hook: override the runs directory. Production uses the workspace path. */
let runsDirOverride: string | null = null;
export function _setRunsDirForTest(dir: string | null): void {
  runsDirOverride = dir;
}

function runsDir(): string {
  if (runsDirOverride) return runsDirOverride;
  return path.join(loadConfig().WORKSPACE_DIR, "production", "pipeline-runs");
}

function runPath(runId: string): string {
  // runId comes from newId("run") → "run-<uuid>"; sanitize defensively anyway.
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(runsDir(), `${safe}.json`);
}

async function persistRun(run: PipelineRunState): Promise<void> {
  run.updatedAt = new Date().toISOString();
  const dir = runsDir();
  await fs.mkdir(dir, { recursive: true });
  const p = runPath(run.runId);
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(run, null, 2), "utf-8");
  // Atomic write: a crash mid-write can't leave a truncated run-state.json.
  await fs.rename(tmp, p);
}

async function loadRunFromDisk(runId: string): Promise<PipelineRunState | null> {
  try {
    const raw = await fs.readFile(runPath(runId), "utf-8");
    return JSON.parse(raw) as PipelineRunState;
  } catch {
    return null;
  }
}

function resolveSkill(run: PipelineRunState, override?: SkillDefinition): SkillDefinition | undefined {
  if (override) return override;
  const cached = runSkills.get(run.runId);
  if (cached) return cached;
  return skills[run.skillName as keyof typeof skills] as SkillDefinition | undefined;
}

function emit(event: WSEvent): void {
  broadcast(event);
}

/**
 * True if the run was cancelled. Reads status into a fresh local so TypeScript's
 * control-flow narrowing (which would otherwise pin `run.status` to a literal
 * like "running" across an `await`) doesn't flag the "cancelled" comparison as
 * unreachable — stopPipelineRun can mutate a shared run object between awaits.
 */
function isCancelled(run: PipelineRunState): boolean {
  const status = run.status;
  return status === "cancelled";
}

function buildTask(skill: SkillDefinition, phase: SkillDefinition["phases"][number], taskArgs: string, total: number): string {
  return `SKILL: ${skill.name}
PHASE: ${phase.name} (${phase.order}/${total})
DESCRIPTION: ${phase.description}

TASK ARGUMENTS:
${taskArgs || "No additional arguments provided."}

Execute this phase of the pipeline workflow.`;
}

function buildGateContext(run: PipelineRunState): string {
  return `Pipeline ${run.skillName} (run ${run.runId}), phase ${run.currentPhaseIndex + 1}. Review the phase output for gate compliance.`;
}

function ensurePhaseStatus(run: PipelineRunState, order: number, name: string): PhaseStatus {
  let ps = run.phaseStatuses.find((p) => p.order === order);
  if (!ps) {
    ps = { order, name, status: "pending" };
    run.phaseStatuses.push(ps);
  }
  return ps;
}

/**
 * Run a single phase's agents sequentially (v1). `createsTickets:true` phases
 * SHOULD dispatch via the Task tool (the only Quest-ticket creator), but that
 * wiring lands in Phase 3 (/sprint). No Phase 0 pipeline skill sets it, so this
 * branch is dormant; flagged so Phase 3 can swap invokeAgent → executeTool("Task").
 */
async function runPhaseAgents(
  run: PipelineRunState,
  skill: SkillDefinition,
  phase: SkillDefinition["phases"][number],
  taskArgs: string,
  projectContext?: ProjectContext,
): Promise<PhaseStatus["agentResults"]> {
  const total = skill.phases.length;
  const results: NonNullable<PhaseStatus["agentResults"]> = [];
  for (const agentRole of phase.agents) {
    if (isCancelled(run)) break;
    const task = buildTask(skill, phase, taskArgs, total);
    if (phase.createsTickets) {
      // Phase 3 TODO: dispatch via executeTool("Task", {...}) so Quest tickets are
      // created + auto-verification triggered. For now (no pipeline skill uses it),
      // fall through to invokeAgent.
      logger.warn(
        { runId: run.runId, phase: phase.name, event: "pipeline_creates_tickets_unwired" },
        `Phase ${phase.name} declares createsTickets but Task-tool dispatch is wired in Phase 3; using invokeAgent`,
      );
    }
    const result = await invokeAgent(
      agentRole as AgentRole,
      task,
      run.sessionId,
      undefined,
      undefined,
      undefined,
      true,
      1,
      projectContext,
    );
    results.push({ agent: agentRole, ok: true, summary: result.content.slice(0, 200) });
  }
  return results;
}

type GateOutcome = "passed" | "paused" | "error";

/**
 * Enforce this phase's gates. Called ONCE per phase (after the agent loop, before
 * advancing). Emits `pipeline:gate:pending` BEFORE the (potentially ~30s)
 * `executeGate` so the UI shows "Director reviewing..." in both modes.
 */
async function runPhaseGates(
  run: PipelineRunState,
  skill: SkillDefinition,
  phase: SkillDefinition["phases"][number],
  reviewMode: string,
  taskArgs: string,
  projectContext: ProjectContext | undefined,
): Promise<GateOutcome> {
  const gates = phase.gates ?? [];
  for (const gateId of gates) {
    emit({ type: "pipeline:gate:pending", runId: run.runId, sessionId: run.sessionId, gateId, phaseIndex: run.currentPhaseIndex });

    let verdict: string;
    let details = "";
    try {
      const result = await executeGate(gateId, run.sessionId, buildGateContext(run));
      verdict = result.verdict;
      details = result.details;
      // gate-service returns its own GateResult whose verdict union is wider than
      // the types-package GateVerdict (it includes ERROR/NOT_SUPPORTED — the known
      // type-lie, plan R10). Store via spread + verdict cast so the persisted record
      // conforms to the shared type without re-declaring a verdict union.
      run.gateVerdicts[gateId] = { ...result, verdict: result.verdict as GateResult["verdict"], agent: result.agent as AgentRole };
    } catch (err) {
      // executeGate normally self-catches (returns verdict "ERROR"), but be
      // defensive: any throw is treated as the ERROR verdict — never advance.
      verdict = "ERROR";
      details = err instanceof Error ? err.message : String(err);
      // types-package GateVerdict omits the ERROR sentinel (the known type-lie —
      // see plan R10), so store a blocking REJECT with the error in details. The
      // broadcast below still reports the true "ERROR" verdict string.
      run.gateVerdicts[gateId] = { gateId, verdict: "REJECT", details: `ERROR: ${details}`, agent: "producer", timestamp: new Date().toISOString() };
    }
    const passing = isGatePassing(verdict);
    emit({ type: "pipeline:gate:verdict", runId: run.runId, sessionId: run.sessionId, gateId, verdict, passing, details: details.slice(0, 500) });
    await persistRun(run);

    if (run.gateMode === "manual") {
      // Manual mode ALWAYS pauses after a gate so a human reviews the verdict and
      // decides to /advance (override) or /stop. Manual never auto-retries.
      const ps = ensurePhaseStatus(run, phase.order, phase.name);
      ps.gateHeld = { gateId, since: new Date().toISOString() };
      run.status = "paused-at-gate";
      await persistRun(run);
      return "paused";
    }

    // gateMode === "auto"
    if (passing) continue; // advance to next gate (or out of the phase)

    // Blocked → bounded retry (re-run agents + re-gate), then error.
    const recovered = await boundedRetry(run, skill, phase, gateId, reviewMode, taskArgs, projectContext);
    if (!recovered) {
      run.status = "error";
      run.lastError = `Gate ${gateId} blocked after ${PIPELINE_GATE_MAX_RETRIES} retries: ${verdict}`;
      await persistRun(run);
      emit({ type: "pipeline:error", runId: run.runId, sessionId: run.sessionId, message: run.lastError, failedPhaseIndex: run.currentPhaseIndex });
      return "error";
    }
  }
  return "passed";
}

/** Re-run the phase's agents then re-gate, up to PIPELINE_GATE_MAX_RETRIES times. Returns true if the gate eventually passes. */
async function boundedRetry(
  run: PipelineRunState,
  skill: SkillDefinition,
  phase: SkillDefinition["phases"][number],
  gateId: string,
  _reviewMode: string,
  taskArgs: string,
  projectContext: ProjectContext | undefined,
): Promise<boolean> {
  for (let attempt = 1; attempt <= PIPELINE_GATE_MAX_RETRIES; attempt++) {
    logger.info({ runId: run.runId, gateId, attempt, event: "pipeline_gate_retry" }, `Retrying gate ${gateId} (attempt ${attempt})`);
    await runPhaseAgents(run, skill, phase, taskArgs, projectContext);
    if (isCancelled(run)) return false;
    emit({ type: "pipeline:gate:pending", runId: run.runId, sessionId: run.sessionId, gateId, phaseIndex: run.currentPhaseIndex });
    let verdict: string;
    try {
      verdict = (await executeGate(gateId, run.sessionId, buildGateContext(run))).verdict;
    } catch {
      verdict = "ERROR";
    }
    const passing = isGatePassing(verdict);
    emit({ type: "pipeline:gate:verdict", runId: run.runId, sessionId: run.sessionId, gateId, verdict, passing });
    if (passing) return true;
  }
  return false;
}

/**
 * The core loop. Processes phases from `run.currentPhaseIndex` until the skill
 * completes, pauses at a gate (manual), errors (auto, retries exhausted), or is
 * cancelled. Re-entrant: resume/advance re-enter here.
 */
async function runPipelineLoop(
  run: PipelineRunState,
  skill: SkillDefinition,
  reviewMode: string,
  taskArgs: string,
  projectContext: ProjectContext | undefined,
): Promise<void> {
  const total = skill.phases.length;
  try {
    while (run.currentPhaseIndex < total) {
      if (isCancelled(run)) return;
      const phase = skill.phases[run.currentPhaseIndex];
      const ps = ensurePhaseStatus(run, phase.order, phase.name);
      ps.status = "running";
      run.status = "running";
      await persistRun(run);
      emit({ type: "pipeline:phase:started", runId: run.runId, sessionId: run.sessionId, phaseIndex: run.currentPhaseIndex, phaseName: phase.name, createsTickets: phase.createsTickets });

      const agentResults = await runPhaseAgents(run, skill, phase, taskArgs, projectContext);
      if (isCancelled(run)) return;
      ps.agentResults = agentResults;
      ps.status = "completed";
      emit({ type: "pipeline:phase:completed", runId: run.runId, sessionId: run.sessionId, phaseIndex: run.currentPhaseIndex, phaseName: phase.name, agentResults });

      // ── Gate enforcement: ONCE per phase, AFTER the agent loop, BEFORE advancing ──
      // (subSkills are rejected on pipeline phases by the registry validator.)
      if (skill.kind === "pipeline" && phase.gates && phase.gates.length > 0 && reviewMode !== "solo") {
        const outcome = await runPhaseGates(run, skill, phase, reviewMode, taskArgs, projectContext);
        if (outcome === "paused") return; // manual mode — await /advance
        if (outcome === "error") return; // retries exhausted
        // "passed" → fall through and advance
      }

      run.currentPhaseIndex += 1;
      await persistRun(run);
    }
    run.status = "completed";
    await persistRun(run);
    emit({ type: "pipeline:completed", runId: run.runId, sessionId: run.sessionId, finalPhaseIndex: Math.max(0, total - 1) });
  } catch (err) {
    run.status = "error";
    run.lastError = err instanceof Error ? err.message : String(err);
    await persistRun(run);
    emit({ type: "pipeline:error", runId: run.runId, sessionId: run.sessionId, message: "Pipeline loop failed", lastError: run.lastError, failedPhaseIndex: run.currentPhaseIndex });
  } finally {
    runLoops.delete(run.runId);
  }
}

function kickLoop(
  run: PipelineRunState,
  skill: SkillDefinition,
  reviewMode: string,
  taskArgs: string,
  projectContext: ProjectContext | undefined,
): void {
  const done = runPipelineLoop(run, skill, reviewMode, taskArgs, projectContext).catch((err) => {
    logger.error({ runId: run.runId, err: String(err), event: "pipeline_loop_fatal" }, "pipeline loop fatal");
  });
  runLoops.set(run.runId, done);
}

// ── Public API ──

export async function startPipelineRun(
  skill: SkillDefinition,
  sessionId: string,
  opts: StartPipelineOptions = {},
): Promise<PipelineRunState> {
  const runId = newId("run");
  const now = new Date().toISOString();
  const gateMode = opts.gateMode ?? skill.gateMode ?? "auto";
  const run: PipelineRunState = {
    runId,
    sessionId,
    projectId: opts.projectId,
    skillName: skill.name,
    lifecyclePhase: skill.lifecyclePhase,
    gateMode,
    status: "idle",
    currentPhaseIndex: 0,
    phaseStatuses: skill.phases.map((p) => ({ order: p.order, name: p.name, status: "pending", createsTickets: p.createsTickets })),
    gateVerdicts: {},
    parentRunId: opts.parentRunId,
    startedAt: now,
    updatedAt: now,
  };
  activeRuns.set(runId, run);
  runSkills.set(runId, skill);
  await persistRun(run);
  emit({
    type: "pipeline:started",
    runId,
    sessionId,
    projectId: opts.projectId,
    skillName: skill.name,
    lifecyclePhase: skill.lifecyclePhase,
    gateMode,
  });

  const projectContext = await resolveProjectContext(opts.projectId);
  kickLoop(run, skill, opts.reviewMode ?? "lean", opts.taskArgs ?? "", projectContext);
  return run;
}

/** Continue a run that was interrupted mid-execution (e.g. process restart). Re-enters the loop at currentPhaseIndex. */
export async function resumePipelineRun(
  runId: string,
  opts: { skill?: SkillDefinition; reviewMode?: string; taskArgs?: string } = {},
): Promise<PipelineRunState | null> {
  let run = activeRuns.get(runId) ?? null;
  if (!run) {
    run = await loadRunFromDisk(runId);
    if (!run) return null;
    activeRuns.set(runId, run);
  }
  if (run.status === "completed" || run.status === "cancelled") return run;
  const skill = resolveSkill(run, opts.skill);
  if (!skill) {
    logger.warn({ runId, skillName: run.skillName, event: "pipeline_resume_no_skill" }, "Cannot resume pipeline — skill unresolvable");
    return run;
  }
  run.status = "running";
  await persistRun(run);
  const projectContext = await resolveProjectContext(run.projectId);
  kickLoop(run, skill, opts.reviewMode ?? "lean", opts.taskArgs ?? "", projectContext);
  return run;
}

/** Human-approved advance past a paused gate. Only valid when status is "paused-at-gate". */
export async function advanceFromGate(
  runId: string,
  opts: { skill?: SkillDefinition; reviewMode?: string; taskArgs?: string } = {},
): Promise<PipelineRunState | null> {
  let run = activeRuns.get(runId) ?? null;
  if (!run) {
    run = await loadRunFromDisk(runId);
    if (!run) return null;
    activeRuns.set(runId, run);
  }
  if (run.status !== "paused-at-gate") return null;
  const skill = resolveSkill(run, opts.skill);
  if (!skill) {
    logger.warn({ runId, skillName: run.skillName, event: "pipeline_advance_no_skill" }, "Cannot advance pipeline — skill unresolvable");
    return run;
  }
  run.currentPhaseIndex += 1;
  const held = run.phaseStatuses.find((p) => p.gateHeld);
  if (held) held.gateHeld = undefined;
  run.status = "running";
  await persistRun(run);
  const projectContext = await resolveProjectContext(run.projectId);
  kickLoop(run, skill, opts.reviewMode ?? "lean", opts.taskArgs ?? "", projectContext);
  return run;
}

/** Cancel a run. The loop halts at the next phase/agent boundary (an in-flight LLM call is allowed to complete). */
export async function stopPipelineRun(runId: string): Promise<PipelineRunState | null> {
  let run = activeRuns.get(runId) ?? null;
  if (!run) {
    run = await loadRunFromDisk(runId);
    if (!run) return null;
    activeRuns.set(runId, run);
  }
  if (run.status === "completed" || run.status === "cancelled") return run;
  // Persist first so a failed write doesn't leave in-memory state ahead of disk.
  // Then commit the in-memory mutation + broadcast; if the in-memory mutation
  // threw (it can't here, but defensive) the worst case is a stale read in memory.
  const cancelledAt = new Date().toISOString();
  const atPhaseIndex = run.currentPhaseIndex;
  await persistRun({ ...run, status: "cancelled", cancelledAt });
  run.status = "cancelled";
  run.cancelledAt = cancelledAt;
  emit({ type: "pipeline:cancelled", runId, sessionId: run.sessionId, cancelledAt, atPhaseIndex });
  return run;
}

export function getRun(runId: string): PipelineRunState | undefined {
  return activeRuns.get(runId);
}

export async function getRunAsync(runId: string): Promise<PipelineRunState | null> {
  return activeRuns.get(runId) ?? (await loadRunFromDisk(runId));
}

export function listRuns(sessionId?: string): PipelineRunState[] {
  const all = Array.from(activeRuns.values());
  return sessionId ? all.filter((r) => r.sessionId === sessionId) : all;
}

/** Await a run's detached loop (reaches terminal/paused state). For callers/tests. */
export function getRunDone(runId: string): Promise<void> | undefined {
  return runLoops.get(runId);
}

// Resolve a ProjectContext from projectId (mirrors routes/skills.ts getProjectCtx).
// Kept local + best-effort: a missing/unresolvable project just yields undefined
// (the runner still works; agent prompts won't carry project context).
async function resolveProjectContext(projectId?: string): Promise<ProjectContext | undefined> {
  if (!projectId) return undefined;
  try {
    type DashboardData = { projects: { id: string; name: string; description?: string; engine?: string; workspacePath?: string }[] };
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) return undefined;
    let engine = project.engine;
    if (!engine && project.workspacePath) {
      const detected = await detectEngineFromWorkspace(project.workspacePath);
      if (detected) engine = detected as "godot" | "unreal" | "unity" | "phaser" | "threejs";
    }
    return {
      name: project.name,
      description: project.description,
      engine,
      workspacePath: project.workspacePath,
      projectId: project.id,
    } as ProjectContext;
  } catch (err) {
    logger.warn({ projectId, err: String(err), event: "pipeline_project_context_failed" }, "Failed to resolve project context for pipeline");
    return undefined;
  }
}
