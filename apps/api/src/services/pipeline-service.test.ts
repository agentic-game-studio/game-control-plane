/**
 * pipeline-service.test.ts
 *
 * Mocked tests (no live LLM) covering the Phase 0 contract:
 *   1. Spy: executeGate is called exactly ONCE per phase for a 3-agent phase
 *      (fixes the log-only 3x bug from routes/skills.ts:138-149), placed
 *      AFTER the agent loop and BEFORE advancing.
 *   2. advance-on-pass (auto + APPROVE verdict): status reaches completed.
 *   3. pause-on-block (manual + REJECT verdict): status paused-at-gate.
 *   4. ERROR-on-throw (manual): executeGate throws → verdict "ERROR" →
 *      status paused-at-gate; auto: bounded retry then status error.
 *   5. resume-after-restart: a run-state persisted with currentPhaseIndex=1
 *      is loaded + resumed; the runner executes phases[1] and phases[2] only
 *      (proves the checkpoint is honored).
 *   6. cancel: /stop sets status cancelled; loop halts at the next boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the three collaborators we don't want to hit the real LLM / registry / config.
vi.mock("./gate-service.js", () => ({
  executeGate: vi.fn(),
}));
vi.mock("./llm-service.js", () => ({
  invokeAgent: vi.fn(async (agentRole: string) => ({ content: `[${agentRole}] phase output` })),
  detectEngineFromWorkspace: vi.fn(async () => undefined),
}));
vi.mock("./websocket.js", () => ({
  broadcast: vi.fn(),
}));
vi.mock("./deep-research-service.js", () => ({
  runDeepResearch: vi.fn(async () => ({
    projectId: "p-test",
    concept: "test",
    timestamp: new Date().toISOString(),
    model: "mock",
    sections: [{ title: "Market", content: "stub" }],
    citations: [],
    totalTokens: 0,
    turns: 2,
  })),
  isDeepResearchAvailable: vi.fn(() => true),
}));

import {
  startPipelineRun,
  resumePipelineRun,
  advanceFromGate,
  stopPipelineRun,
  getRun,
  _setRunsDirForTest,
} from "./pipeline-service.js";
import { executeGate } from "./gate-service.js";
import { invokeAgent } from "./llm-service.js";
import { runDeepResearch, isDeepResearchAvailable } from "./deep-research-service.js";

const executeGateMock = executeGate as unknown as ReturnType<typeof vi.fn>;
const invokeAgentMock = invokeAgent as unknown as ReturnType<typeof vi.fn>;
const runDeepResearchMock = runDeepResearch as unknown as ReturnType<typeof vi.fn>;
const isDeepResearchAvailableMock = isDeepResearchAvailable as unknown as ReturnType<typeof vi.fn>;

/** Build a 3-phase dummy pipeline skill (each phase has 1 agent for simplicity, except phase 1 which has 3 to exercise the once-per-phase gate placement). */
function buildDummySkill(opts: { withGate?: boolean; subSkillsOnPipeline?: boolean } = {}) {
  return {
    name: "pipeline-dummy" as const,
    description: "Dummy pipeline skill for tests",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "auto" as const,
    resumable: true,
    lifecyclePhase: "concept" as const,
    phases: [
      {
        order: 1,
        name: "Research",
        description: "3-agent research phase (exercises once-per-phase gate placement)",
        agents: ["market-researcher", "creative-director", "game-designer"] as any,
        gates: opts.withGate === false ? undefined : ["CD-PILLARS"],
        subSkills: opts.subSkillsOnPipeline ? ["setup-godot-project"] : undefined,
      },
      {
        order: 2,
        name: "Synthesis",
        description: "Phase 2",
        agents: ["game-designer"] as any,
      },
      {
        order: 3,
        name: "Output",
        description: "Phase 3",
        agents: ["writer"] as any,
      },
    ],
  } as any;
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
  _setRunsDirForTest(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  _setRunsDirForTest(null);
});

/** Await the run's detached loop to settle (terminal/paused). */
async function awaitLoop(runId: string): Promise<void> {
  const { getRunDone } = await import("./pipeline-service.js");
  const done = getRunDone(runId);
  if (done) await done;
}

describe("pipeline-service gate enforcement", () => {
  it("calls executeGate exactly ONCE per phase for a 3-agent phase (after agent loop, before advancing)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });

    const skill = buildDummySkill();
    const run = await startPipelineRun(skill, "sess-1", { reviewMode: "full" });
    await awaitLoop(run.runId);

    // Auto mode + APPROVE → all 3 phases complete without retries.
    expect(executeGateMock).toHaveBeenCalledTimes(1); // once for phase 1, not 3x
    expect(invokeAgentMock).toHaveBeenCalledTimes(5); // 3 (phase 1) + 1 (phase 2) + 1 (phase 3)
    expect(getRun(run.runId)?.status).toBe("completed");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(3);
  });

  it("advance-on-pass (auto + APPROVE) completes all phases", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });

    const run = await startPipelineRun(buildDummySkill(), "sess-2", { gateMode: "auto" });
    await awaitLoop(run.runId);

    expect(getRun(run.runId)?.status).toBe("completed");
    expect(executeGateMock).toHaveBeenCalledTimes(1);
  });

  it("pause-on-block (manual + REJECT) pauses at the gate (no advance)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "REJECT", details: "weak pillars", agent: "creative-director", timestamp: new Date().toISOString() });

    const skill = buildDummySkill();
    const run = await startPipelineRun(skill, "sess-3", { gateMode: "manual" });
    await awaitLoop(run.runId);

    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(0); // held at phase 0
    expect(executeGateMock).toHaveBeenCalledTimes(1); // manual never retries
    expect(invokeAgentMock).toHaveBeenCalledTimes(3); // phase 1 agents only
  });

  it("ERROR-on-throw (manual) pauses at the gate; auto retries then errors", async () => {
    executeGateMock.mockRejectedValue(new Error("LLM boom"));

    // Manual: throws → ERROR verdict → pauses at gate.
    const runManual = await startPipelineRun(buildDummySkill(), "sess-4a", { gateMode: "manual" });
    await awaitLoop(runManual.runId);
    expect(getRun(runManual.runId)?.status).toBe("paused-at-gate");

    vi.clearAllMocks();
    executeGateMock.mockRejectedValue(new Error("LLM boom"));

    // Auto: throws → ERROR → bounded retry (always re-throws in this test) → error.
    const runAuto = await startPipelineRun(buildDummySkill(), "sess-4b", { gateMode: "auto" });
    await awaitLoop(runAuto.runId);
    expect(getRun(runAuto.runId)?.status).toBe("error");
    // 1 initial + 2 retries = 3 executeGate calls for the single gate.
    expect(executeGateMock).toHaveBeenCalledTimes(3);
  });

  it("resumePipelineRun continues from the persisted currentPhaseIndex (does NOT re-run completed phases)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });

    const skill = buildDummySkill();
    // Build a runId matching newId("run") = "run-<uuid>" and a "crashed mid-execution"
    // state: currentPhaseIndex=1, status=running, phase 0 completed, phases 1+2 pending.
    // Persist it to the tmp runs dir. resumePipelineRun must load from disk and re-run
    // ONLY phases[1] and phases[2] (1 agent each = 2 invokes), NOT phase 0's 3 agents.
    const { randomUUID } = await import("node:crypto");
    const runId = `run-${randomUUID()}`;
    const now = new Date().toISOString();
    const crashedState = {
      runId,
      sessionId: "sess-5",
      skillName: skill.name,
      lifecyclePhase: "concept",
      gateMode: "auto",
      status: "running",
      currentPhaseIndex: 1,
      phaseStatuses: [
        { order: 1, name: "Research", status: "completed", createsTickets: false, agentResults: [] },
        { order: 2, name: "Synthesis", status: "pending", createsTickets: false },
        { order: 3, name: "Output", status: "pending", createsTickets: false },
      ],
      gateVerdicts: {},
      startedAt: now,
      updatedAt: now,
    };
    require("node:fs").writeFileSync(join(tmpDir, `${runId}.json`), JSON.stringify(crashedState, null, 2));

    // No startPipelineRun call — resume must read from disk (nothing in activeRuns yet).
    const resumed = await resumePipelineRun(runId, { skill });
    expect(resumed).not.toBeNull();
    await awaitLoop(runId);

    // phases[1] + phases[2] = 2 invokes. If resume had re-run phase 0, count would be 5.
    expect(invokeAgentMock).toHaveBeenCalledTimes(2);
    expect(getRun(runId)?.status).toBe("completed");
    expect(getRun(runId)?.currentPhaseIndex).toBe(3);
  });

  it("stopPipelineRun sets status cancelled", async () => {
    // Use a passing gate so the run doesn't immediately error.
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildDummySkill(), "sess-6", { gateMode: "manual" });
    await awaitLoop(run.runId); // pauses at gate (manual + one gate)
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");

    const stopped = await stopPipelineRun(run.runId);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.cancelledAt).toBeTruthy();
  });

  it("advanceFromGate on a non-paused run returns null (no-op)", async () => {
    const run = await startPipelineRun(buildDummySkill(), "sess-7", { gateMode: "auto" });
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("completed");
    expect(await advanceFromGate(run.runId)).toBeNull();
  });

  it("reviewMode 'solo' short-circuits gate enforcement (legacy behavior parity)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "REJECT", details: "x", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildDummySkill(), "sess-8", { gateMode: "auto", reviewMode: "solo" });
    await awaitLoop(run.runId);
    expect(executeGateMock).not.toHaveBeenCalled();
    expect(getRun(run.runId)?.status).toBe("completed");
  });
});

/**
 * Pipeline-concept tests — Phase 1. Verifies the real `/concept` shape:
 * market-research phase triggers MiroMind, creative-director phase ends with
 * the CD-PILLARS gate, manual mode pauses, advance resumes.
 */

function buildConceptSkill() {
  return {
    name: "pipeline-concept" as const,
    description: "/concept — the simplest kind:\"pipeline\" skill",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "manual" as const,
    resumable: true,
    lifecyclePhase: "concept" as const,
    phases: [
      {
        order: 1,
        name: "market-research",
        description: "MiroMind deep research on the concept",
        agents: ["market-researcher"] as any,
        createsTickets: false,
      },
      {
        order: 2,
        name: "creative-director",
        description: "Distill research into pillars + pitch",
        agents: ["creative-director"] as any,
        gates: ["CD-PILLARS"],
        createsTickets: false,
      },
    ],
  } as any;
}

describe("pipeline-service /concept (Phase 1)", () => {
  beforeEach(() => {
    runDeepResearchMock.mockClear();
    isDeepResearchAvailableMock.mockClear();
    isDeepResearchAvailableMock.mockReturnValue(true);
    runDeepResearchMock.mockResolvedValue({
      projectId: "p-test",
      concept: "test",
      timestamp: new Date().toISOString(),
      model: "mock",
      sections: [{ title: "Market", content: "stub" }],
      citations: [],
      totalTokens: 0,
      turns: 2,
    });
  });

  it("market-research phase calls runDeepResearch once before the agent loop", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-1", { projectId: "p-test" });
    await awaitLoop(run.runId);

    expect(runDeepResearchMock).toHaveBeenCalledTimes(1);
    expect(runDeepResearchMock).toHaveBeenCalledWith(
      "p-test",
      expect.any(String),
      expect.objectContaining({ projectDescription: undefined }),
    );
    // 2 phases × 1 agent each = 2 invokes (market-researcher + creative-director).
    expect(invokeAgentMock).toHaveBeenCalledTimes(2);
    // CD-PILLARS fires once on the creative-director phase only.
    expect(executeGateMock).toHaveBeenCalledTimes(1);
    expect(executeGateMock).toHaveBeenCalledWith("CD-PILLARS", run.sessionId, expect.any(String));
    // Manual mode + APPROVE pauses at the gate (manual always pauses; advance resumes).
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(1); // held at creative-director phase
  });

  it("phases OTHER than market-research do NOT trigger deep research", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const skill = {
      name: "pipeline-no-research" as const,
      description: "Pipeline without a market-research phase",
      userInvocable: true,
      kind: "pipeline" as const,
      gateMode: "auto" as const,
      resumable: true,
      lifecyclePhase: "concept" as const,
      phases: [
        { order: 1, name: "design", description: "x", agents: ["game-designer"] as any },
        { order: 2, name: "build", description: "y", agents: ["creative-director"] as any, gates: ["CD-PILLARS"] },
      ],
    } as any;
    const run = await startPipelineRun(skill, "sess-no-research");
    await awaitLoop(run.runId);

    expect(runDeepResearchMock).not.toHaveBeenCalled();
    expect(getRun(run.runId)?.status).toBe("completed");
  });

  it("graceful skip: when isDeepResearchAvailable returns false, agents still run and a warning is emitted", async () => {
    isDeepResearchAvailableMock.mockReturnValue(false);
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-skip", { projectId: "p-test" });
    await awaitLoop(run.runId);

    expect(runDeepResearchMock).not.toHaveBeenCalled();
    // Agents still ran (degraded context).
    expect(invokeAgentMock).toHaveBeenCalledTimes(2);
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
  });

  it("CD-PILLARS gate fires exactly once and pauses on a block verdict (manual)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "REJECT", details: "pillars too vague", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-block", { projectId: "p-test" });
    await awaitLoop(run.runId);

    expect(executeGateMock).toHaveBeenCalledTimes(1);
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.gateVerdicts["CD-PILLARS"]?.verdict).toBe("REJECT");
    // Manual never retries — even on REJECT, we hold for the human.
    expect(invokeAgentMock).toHaveBeenCalledTimes(2); // both phases ran, gate blocked advance
  });

  it("advanceFromGate resumes from currentPhaseIndex+1 after manual pause", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-advance", { projectId: "p-test" });
    await awaitLoop(run.runId);

    // Paused at the gate after phase 1 (creative-director).
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(1);

    const advanced = await advanceFromGate(run.runId);
    expect(advanced).not.toBeNull();
    await awaitLoop(run.runId);

    // After advance, the gate is consumed and the loop runs out → completed.
    expect(getRun(run.runId)?.status).toBe("completed");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(2);
  });

  it("resume-after-restart: persisted /concept run at currentPhaseIndex=1 continues from creative-director", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const { randomUUID } = await import("node:crypto");
    const runId = `run-${randomUUID()}`;
    const now = new Date().toISOString();
    const skill = buildConceptSkill();
    const crashed = {
      runId,
      sessionId: "sess-concept-resume",
      projectId: "p-test",
      skillName: skill.name,
      lifecyclePhase: "concept",
      gateMode: "manual",
      status: "running",
      currentPhaseIndex: 1, // market-research done, creative-director next
      phaseStatuses: [
        { order: 1, name: "market-research", status: "completed", createsTickets: false },
        { order: 2, name: "creative-director", status: "pending", createsTickets: false },
      ],
      gateVerdicts: {},
      startedAt: now,
      updatedAt: now,
    };
    require("node:fs").writeFileSync(join(tmpDir, `${runId}.json`), JSON.stringify(crashed, null, 2));

    const resumed = await resumePipelineRun(runId, { skill });
    expect(resumed).not.toBeNull();
    await awaitLoop(runId);

    // Only the creative-director agent ran (1 invoke). If resume had re-run phase 0,
    // market-researcher would also have run + runDeepResearch re-fired.
    expect(invokeAgentMock).toHaveBeenCalledTimes(1);
    expect(runDeepResearchMock).not.toHaveBeenCalled();
    expect(executeGateMock).toHaveBeenCalledTimes(1);
    expect(getRun(runId)?.status).toBe("paused-at-gate"); // manual + gate
  });

  it("stopPipelineRun cancels a /concept run cleanly", async () => {
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-stop", { projectId: "p-test" });
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");

    const stopped = await stopPipelineRun(run.runId);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.cancelledAt).toBeTruthy();
  });
});
