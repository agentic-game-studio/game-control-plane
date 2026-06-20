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
  BuildPlatform,
  GateResult,
  PipelineRunState,
  PhaseStatus,
  SkillDefinition,
  SkillName,
  StartPipelineOptions,
  WSEvent,
} from "@game-studio/types";
import { invokeAgent, detectEngineFromWorkspace, type ProjectContext } from "./llm-service.js";
import { executeGate } from "./gate-service.js";
import { isGatePassing } from "./milestone-gate-service.js";
import { runDeepResearch, isDeepResearchAvailable } from "./deep-research-service.js";
import { ingestGDD } from "./gdd-ingest-service.js";
import { createQuestTicket, moveQuestTicket } from "./quest-bridge.js";
import { readTicketsBoard, resolveProjectIdForSession } from "./ticket-board.js";
import { planSprintDispatch } from "./sprint-dispatcher.js";
import { executeGodotExport } from "./build-service.js";
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

type PhaseHookResult = { ran: boolean; ok: boolean; summary?: string };

/**
 * Phase-specific hooks, centralized so the runner stays generic. Each
 * (phase.name, when) pair maps to one side-effecting integration; all other
 * pairs are no-ops.
 *
 *   pre  + "market-research" → MiroMind deep research (grounds the agent in a report)
 *   post + "gdd-draft"       → ingest the drafted GDD onto the Kanban board (gdd:ingested)
 *
 * Hooks NEVER block the loop: a failure (or graceful skip) is recorded on
 * PhaseStatus.lastError and the agent loop / gate enforcement proceeds. This is
 * deliberate graceful degradation — MiroMind and GDD ingest are external/best-effort.
 *
 * (Future deslop: lift these to a `phase.prefetch`/`phase.postProcess` discriminator
 * on SkillPhase so phase names aren't string-coupled to the runner. Two keyed
 * branches are fine for now; revisit when a third integration lands.)
 */
async function runPhaseHook(
  run: PipelineRunState,
  phase: SkillDefinition["phases"][number],
  when: "pre" | "post",
  projectContext: ProjectContext | undefined,
): Promise<PhaseHookResult> {
  if (when === "pre" && phase.name === "market-research") return runDeepResearchHook(run, projectContext);
  if (when === "post" && phase.name === "gdd-draft") return runGddIngestHook(run);
  if (when === "pre" && phase.name === "sprint-dispatch") return runSprintDispatchHook(run);
  if (when === "post" && phase.name === "release-build") return runReleaseBuildHook(run, projectContext);
  if (when === "pre" && run.skillName === "pipeline-make-game" && MAKE_GAME_CHILDREN[phase.name]) {
    return runMakeGameChildHook(run, phase);
  }
  return { ran: false, ok: true };
}

/** pre-hook: MiroMind multi-angle deep research for the market-research phase. */
async function runDeepResearchHook(run: PipelineRunState, projectContext: ProjectContext | undefined): Promise<PhaseHookResult> {
  if (!isDeepResearchAvailable()) {
    logger.warn(
      { runId: run.runId, event: "pipeline_deep_research_unavailable" },
      "market-research phase requested but MIROMIND_API_KEY is not configured — skipping deep research (agents will still run)",
    );
    return { ran: true, ok: true, summary: "skipped: MIROMIND_API_KEY not configured" };
  }

  if (!run.projectId) {
    logger.warn(
      { runId: run.runId, event: "pipeline_deep_research_no_project" },
      "market-research phase requested but pipeline has no projectId — skipping deep research",
    );
    return { ran: true, ok: true, summary: "skipped: no projectId on run" };
  }

  const concept = projectContext?.description ?? projectContext?.name ?? "an unreleased game concept";
  try {
    const report = await runDeepResearch(run.projectId, concept, {
      projectDescription: projectContext?.description,
    });
    return {
      ran: true,
      ok: true,
      summary: `research report written (${report.sections.length} angles, ${report.citations.length} citations, ${report.totalTokens} tokens)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { runId: run.runId, err: msg, event: "pipeline_deep_research_failed" },
      "MiroMind deep research failed during market-research phase — agents will still run with a degraded prompt",
    );
    return { ran: true, ok: false, summary: `failed: ${msg}` };
  }
}

/**
 * post-hook: ingest the GDD drafted in the gdd-draft phase onto the Kanban board
 * via an in-process call to gdd-ingest-service (NO HTTP hop). ingestGDD creates
 * Quest tickets (gdd:ingested) but does NOT trigger auto-verification (only the
 * Task tool does, wired in Phase 3) — that is the intended /design contract.
 */
async function runGddIngestHook(run: PipelineRunState): Promise<PhaseHookResult> {
  if (!run.projectId) {
    logger.warn(
      { runId: run.runId, event: "pipeline_gdd_ingest_no_project" },
      "gdd-draft phase completed but pipeline has no projectId — skipping GDD ingest",
    );
    return { ran: true, ok: true, summary: "skipped: no projectId on run" };
  }
  try {
    const result = await ingestGDD(run.sessionId, run.projectId, { broadcast: true });
    return {
      ran: true,
      ok: true,
      summary: `GDD ingested: ${result.created} created, ${result.skipped} skipped, ${result.errorCount} errors`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { runId: run.runId, err: msg, event: "pipeline_gdd_ingest_failed" },
      "GDD ingest failed after gdd-draft phase — agents already ran; gate enforcement proceeds",
    );
    return { ran: true, ok: false, summary: `failed: ${msg}` };
  }
}

/**
 * pre-hook: /sprint's sprint-dispatch phase. Reads available tickets off the
 * Kanban board, groups them by area→team (sprint-dispatcher), and dispatches each
 * team's lead agent via the Task-tool recipe (spawnTicketedAgent → Quest ticket +
 * triggerVerification). This is what makes /sprint auto-route work to the right
 * feature team. Graceful: no projectId / no available tickets / failure → logged,
 * non-blocking (the producer agent still runs to summarize).
 */
async function runSprintDispatchHook(run: PipelineRunState): Promise<PhaseHookResult> {
  const projectId = run.projectId ?? (await resolveProjectIdForSession(run.sessionId)) ?? undefined;
  if (!projectId) {
    logger.warn(
      { runId: run.runId, event: "pipeline_sprint_no_project" },
      "sprint-dispatch phase has no projectId (and session resolved to none) — skipping dispatch",
    );
    return { ran: true, ok: true, summary: "skipped: no projectId on run" };
  }
  try {
    const board = await readTicketsBoard(projectId);
    const available = board.columns.find((c) => c.id === "available")?.tickets ?? [];
    if (available.length === 0) {
      return { ran: true, ok: true, summary: "no available tickets to dispatch" };
    }
    const units = planSprintDispatch(available);
    let dispatched = 0;
    for (const unit of units) {
      if (isCancelled(run)) break;
      const task = `SPRINT DISPATCH — ${unit.ticketCount} ticket(s) in area "${unit.area}" routed to ${unit.teamSkill} (lead agent: ${unit.agent}). Tickets: ${unit.ticketTitles.slice(0, 6).join("; ") || "(untitled)"}. Implement/resolve these and report completion.`;
      await spawnTicketedAgent(run, "pipeline-sprint", unit.agent, task);
      dispatched += 1;
    }
    return {
      ran: true,
      ok: true,
      summary: `dispatched ${dispatched} team(s) (${units.map((u) => u.teamSkill).join(", ")}) across ${available.length} available ticket(s)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { runId: run.runId, err: msg, event: "pipeline_sprint_dispatch_failed" },
      "sprint-dispatch failed — producer agent still runs; gate enforcement proceeds",
    );
    return { ran: true, ok: false, summary: `failed: ${msg}` };
  }
}

/**
 * post-hook: /release's release-build phase. Exports the project via
 * executeGodotExport (build artifact + changelog in one call). Graceful: no
 * workspacePath/projectId or export failure → logged on PhaseStatus.lastError,
 * non-blocking (release sign-off still proceeds). executeGodotExport shells out
 * to Godot headless (~240s), so this is best-effort — the gate decides
 * release-readiness, not the export itself.
 */
async function runReleaseBuildHook(run: PipelineRunState, projectContext: ProjectContext | undefined): Promise<PhaseHookResult> {
  const workspacePath = projectContext?.workspacePath;
  if (!workspacePath || !run.projectId) {
    logger.warn(
      { runId: run.runId, event: "pipeline_release_build_no_workspace" },
      "release-build phase has no resolvable workspacePath/projectId — skipping export",
    );
    return { ran: true, ok: true, summary: "skipped: no workspacePath/projectId" };
  }
  try {
    // Default platform; a future enhancement can fan out across platforms or
    // read the target from taskArgs. One export proves the build path.
    const platform: BuildPlatform = "linux";
    const build = await executeGodotExport(run.projectId, workspacePath, platform);
    return { ran: true, ok: true, summary: `build exported: ${build.id} (${platform})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { runId: run.runId, err: msg, event: "pipeline_release_build_failed" },
      "Godot export failed during release-build phase — sign-off still proceeds",
    );
    return { ran: true, ok: false, summary: `failed: ${msg}` };
  }
}

/**
 * /make-game's child-pipeline phase names → child skill. Each /make-game phase
 * runs ONE child pipeline to completion, then the parent's PR-PHASE-GATE reviews
 * before advancing to the next lifecycle stage. Phase names are unique to
 * /make-game (no other pipeline has a phase named "concept"/"design"/"slice"/…),
 * but the dispatcher is also guarded on run.skillName === "pipeline-make-game"
 * so a future phase name collision can't accidentally trigger chaining.
 */
const MAKE_GAME_CHILDREN: Record<string, SkillName> = {
  concept: "pipeline-concept",
  design: "pipeline-design",
  slice: "pipeline-slice",
  sprint: "pipeline-sprint",
  polish: "pipeline-polish",
  release: "pipeline-release",
};

/**
 * pre-hook: start + await a /make-game child pipeline. Children run AUTO so each
 * completes end-to-end — passing the parent's manual gateMode to children would
 * nest pauses (a manual child pauses at its own gate and never completes,
 * breaking the parent's sequencing). The PARENT's inter-pipeline PR-PHASE-GATE
 * is where the human approves moving to the next lifecycle stage. Each child
 * carries parentRunId so its PipelineRunState is independent + resumable, and
 * is NOT declared as a subSkill (registry-forbidden on pipeline phases).
 */
async function runMakeGameChildHook(run: PipelineRunState, phase: SkillDefinition["phases"][number]): Promise<PhaseHookResult> {
  const childSkillName = MAKE_GAME_CHILDREN[phase.name];
  if (!childSkillName) return { ran: false, ok: true };
  const childSkill = skills[childSkillName] as SkillDefinition | undefined;
  if (!childSkill) {
    logger.error(
      { runId: run.runId, child: childSkillName, event: "pipeline_makegame_child_missing" },
      `make-game child skill ${childSkillName} not found in registry`,
    );
    return { ran: true, ok: false, summary: `child skill ${childSkillName} not found` };
  }
  try {
    const childRun = await startPipelineRun(childSkill, run.sessionId, {
      gateMode: "auto",
      parentRunId: run.runId,
      projectId: run.projectId,
    });
    // Await the child's detached loop to settle (auto → completes or errors).
    const done = getRunDone(childRun.runId);
    if (done) await done;
    const final = getRun(childRun.runId);
    const status = final?.status ?? "unknown";
    if (status === "error" || status === "cancelled") {
      return { ran: true, ok: false, summary: `child ${childSkillName} ${status}: ${final?.lastError ?? ""}` };
    }
    return { ran: true, ok: true, summary: `child ${childSkillName} ${status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { runId: run.runId, child: childSkillName, err: msg, event: "pipeline_makegame_child_failed" },
      `make-game child ${childSkillName} failed`,
    );
    return { ran: true, ok: false, summary: `failed: ${msg}` };
  }
}

/**
 * Run a single phase's agents sequentially (v1). When `phase.createsTickets` is
 * true, each agent is dispatched via the Task-tool recipe (createQuestTicket →
 * in_progress → invokeAgent → qa) — the only path that creates Quest tickets AND
 * triggers auto-verification (moveQuestTicket("qa") fires triggerVerification).
 * This serves ticket-producing phases (e.g. /polish's QA pass, /sprint dispatch).
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
    const result = await dispatchPhaseAgent(run, skill, agentRole as AgentRole, task, phase, projectContext);
    results.push({ agent: agentRole, ok: true, summary: result.content.slice(0, 200) });
  }
  return results;
}

/**
 * Spawn one agent wrapped in the Task-tool recipe (createQuestTicket → in_progress
 * → invokeAgent → qa). moveQuestTicket("qa") is what fires triggerVerification.
 * Shared by createsTickets phase dispatch AND /sprint team dispatch. Degrades
 * gracefully: a ticket-creation failure logs and runs the agent bare; a qa-move
 * failure logs (verification may not fire). invokeAgent runs exactly once.
 */
async function spawnTicketedAgent(
  run: PipelineRunState,
  skillName: string,
  agentRole: AgentRole,
  task: string,
  projectContext?: ProjectContext,
) {
  const invoke = () =>
    invokeAgent(agentRole, task, run.sessionId, undefined, undefined, undefined, true, 1, projectContext);

  let ticketId: string | undefined;
  try {
    const ticket = await createQuestTicket(
      run.sessionId,
      task.slice(0, 80),
      agentRole,
      task,
      "WORKFLOW",
      `pipeline:${skillName}`,
      run.projectId,
    );
    ticketId = ticket.id;
    await moveQuestTicket(ticketId, "in_progress", agentRole, run.projectId);
  } catch (err) {
    logger.error(
      { runId: run.runId, agent: agentRole, err: String(err), event: "pipeline_ticket_create_failed" },
      "createQuestTicket failed — running agent without a Quest ticket",
    );
    return invoke();
  }

  const result = await invoke();

  try {
    // moveQuestTicket("qa") fires triggerVerification (quest-bridge).
    await moveQuestTicket(ticketId, "qa", agentRole, run.projectId);
  } catch (err) {
    logger.warn(
      { runId: run.runId, agent: agentRole, ticketId, err: String(err), event: "pipeline_ticket_qa_failed" },
      "moveQuestTicket(qa) failed — auto-verification may not fire for this ticket",
    );
  }
  return result;
}

/**
 * Dispatch one phase agent. createsTickets phases route through spawnTicketedAgent
 * (Quest ticket + auto-verification); otherwise a bare invokeAgent.
 */
async function dispatchPhaseAgent(
  run: PipelineRunState,
  skill: SkillDefinition,
  agentRole: AgentRole,
  task: string,
  phase: SkillDefinition["phases"][number],
  projectContext?: ProjectContext,
) {
  if (!phase.createsTickets) {
    return invokeAgent(agentRole, task, run.sessionId, undefined, undefined, undefined, true, 1, projectContext);
  }
  return spawnTicketedAgent(run, skill.name, agentRole, task, projectContext);
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
    // Skip gates already reviewed this run. Manual /advance re-enters the phase
    // for the NEXT gate; a stored verdict means this gate already executed
    // (and, in manual mode, the human has chosen to advance past it). This is
    // what makes multi-gate phases work in manual mode (e.g. /design's
    // TD-FEASIBILITY then TD-ARCHITECTURE on the same phase).
    if (run.gateVerdicts[gateId]) continue;
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

      // Fresh phase execution (agents + hooks). Skipped on re-entry after a manual
      // /advance resumed us mid-phase for the NEXT gate: ps.status flips to
      // "completed" once agents have run, so a resumed phase goes straight to gate
      // enforcement without re-invoking agents or re-firing hooks. This makes
      // per-phase execution idempotent and is what lets multi-gate manual phases
      // advance gate-by-gate.
      if (ps.status !== "completed") {
        ps.status = "running";
        run.status = "running";
        await persistRun(run);
        emit({ type: "pipeline:phase:started", runId: run.runId, sessionId: run.sessionId, phaseIndex: run.currentPhaseIndex, phaseName: phase.name, createsTickets: phase.createsTickets });

        // Pre-phase hook (e.g. MiroMind deep research for market-research). No-op for
        // phases that don't declare one. Failures are recorded on PhaseStatus but never
        // block the agent loop (graceful degradation — agents run with degraded context).
        const pre = await runPhaseHook(run, phase, "pre", projectContext);
        if (pre.ran && !pre.ok) {
          ps.lastError = `pre-hook failed: ${pre.summary ?? "unknown"}`;
        }

        const agentResults = await runPhaseAgents(run, skill, phase, taskArgs, projectContext);
        if (isCancelled(run)) return;
        ps.agentResults = agentResults;
        ps.status = "completed";
        emit({ type: "pipeline:phase:completed", runId: run.runId, sessionId: run.sessionId, phaseIndex: run.currentPhaseIndex, phaseName: phase.name, agentResults });

        // Post-phase hook (e.g. GDD ingest after gdd-draft). Runs AFTER the phase's
        // artifact is produced, BEFORE gate enforcement. Same graceful-degradation
        // contract as the pre-hook: failures are recorded, never block.
        const post = await runPhaseHook(run, phase, "post", projectContext);
        if (post.ran && !post.ok) {
          ps.lastError = `post-hook failed: ${post.summary ?? "unknown"}`;
        }
      }

      // ── Gate enforcement: ONCE per phase, AFTER the agent loop, BEFORE advancing ──
      // (subSkills are rejected on pipeline phases by the registry validator.)
      if (skill.kind === "pipeline" && phase.gates && phase.gates.length > 0 && reviewMode !== "solo") {
        const outcome = await runPhaseGates(run, skill, phase, reviewMode, taskArgs, projectContext);
        if (outcome === "paused") return; // manual mode — await /advance
        if (outcome === "error") return; // retries exhausted
        // "passed" → fall through and advance
      }

      // Advance to the next phase. Clear THIS phase's gate verdicts so a gate
      // that legitimately repeats across phases (e.g. /make-game's PR-PHASE-GATE
      // on every phase) is re-reviewed in the next phase rather than skipped by
      // the gate-skip optimization above. (Within a single multi-gate phase, the
      // skip still works because clearing happens only at phase advance, after all
      // of the phase's gates have passed.)
      for (const g of phase.gates ?? []) delete run.gateVerdicts[g];
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
  // Clear the held gate and re-enter the loop at the SAME phase index (do NOT
  // increment here). The loop's idempotent per-phase execution skips already-run
  // agents, and runPhaseGates skips already-reviewed gates — so we resume at the
  // next unreviewed gate of this phase, or advance to the next phase if all of
  // this phase's gates are reviewed. Incrementing here would skip the remaining
  // gates of a multi-gate phase (the bug this fixes for /design's TD-* gates).
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

  // Cascade: cancel any active CHILD runs (e.g. /make-game's child pipelines) so
  // a stopped orchestrator doesn't leave orphan runs still consuming agents. Only
  // /make-game spawns children, and its children aren't orchestrators, so the
  // recursion is bounded (depth ≤ 2). A cancelled/completed child is left as-is.
  const children = Array.from(activeRuns.values()).filter(
    (r) => r.parentRunId === runId && (r.status === "running" || r.status === "paused-at-gate"),
  );
  for (const child of children) {
    await stopPipelineRun(child.runId);
  }
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

/**
 * True if a run for this session is still ACTIVE (running or paused-at-gate).
 * Completed/cancelled/error runs do NOT count — a fresh /start is allowed once
 * the previous run has reached a terminal state. Used by routes/pipeline.ts to
 * reject a second concurrent run for the same session (409 collision), which
 * Phase 5 (/make-game) would otherwise amplify into a write race on the same
 * project artifacts.
 */
export function hasActiveRunForSession(sessionId: string): boolean {
  return listRuns(sessionId).some((r) => r.status === "running" || r.status === "paused-at-gate");
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
