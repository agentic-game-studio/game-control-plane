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
vi.mock("./gdd-ingest-service.js", () => ({
  ingestGDD: vi.fn(async () => ({
    gddPath: "/tmp/gdd.md",
    sectionsFound: 8,
    totalItems: 20,
    created: 20,
    skipped: 0,
    errors: [],
    createdTitles: [],
    skippedTitles: [],
    errorCount: 0,
  })),
}));
vi.mock("./ticket-board.js", () => ({
  readTicketsBoard: vi.fn(async () => ({ columns: [{ id: "available", label: "Available", tickets: [] }] })),
  resolveProjectIdForSession: vi.fn(async () => "p-test"),
}));
vi.mock("./quest-bridge.js", () => ({
  createQuestTicket: vi.fn(async () => ({ id: "ticket-mock" })),
  moveQuestTicket: vi.fn(async () => undefined),
}));
vi.mock("./data-store.js", () => ({
  // Return a project WITH workspacePath (so /release's build hook exports) but
  // WITHOUT description (so /concept's deep-research still sees projectDescription
  // undefined, keeping that assertion green).
  readData: vi.fn(async () => ({
    projects: [{ id: "p-test", name: "Test", engine: "godot", workspacePath: "./workspace/projects/p-test" }],
  })),
}));
vi.mock("./build-service.js", () => ({
  executeGodotExport: vi.fn(async () => ({ id: "build-mock", platform: "linux" })),
}));

import {
  startPipelineRun,
  resumePipelineRun,
  advanceFromGate,
  stopPipelineRun,
  getRun,
  hasActiveRunForSession,
  listRuns,
  _setRunsDirForTest,
} from "./pipeline-service.js";
import { executeGate } from "./gate-service.js";
import { invokeAgent } from "./llm-service.js";
import { runDeepResearch, isDeepResearchAvailable } from "./deep-research-service.js";
import { ingestGDD } from "./gdd-ingest-service.js";
import { readTicketsBoard } from "./ticket-board.js";
import { createQuestTicket, moveQuestTicket } from "./quest-bridge.js";
import { executeGodotExport } from "./build-service.js";

const executeGateMock = executeGate as unknown as ReturnType<typeof vi.fn>;
const invokeAgentMock = invokeAgent as unknown as ReturnType<typeof vi.fn>;
const runDeepResearchMock = runDeepResearch as unknown as ReturnType<typeof vi.fn>;
const isDeepResearchAvailableMock = isDeepResearchAvailable as unknown as ReturnType<typeof vi.fn>;
const ingestGDDMock = ingestGDD as unknown as ReturnType<typeof vi.fn>;
const readTicketsBoardMock = readTicketsBoard as unknown as ReturnType<typeof vi.fn>;
const createQuestTicketMock = createQuestTicket as unknown as ReturnType<typeof vi.fn>;
const moveQuestTicketMock = moveQuestTicket as unknown as ReturnType<typeof vi.fn>;
const executeGodotExportMock = executeGodotExport as unknown as ReturnType<typeof vi.fn>;

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

  it("prefetch failure is recorded on PhaseStatus.lastError but never blocks the agent loop", async () => {
    // MiroMind is a flaky external API — this is the production-flake path the
    // Phase 1 code review flagged as untested (MEDIUM #1). A rejected prefetch
    // must NOT abort the run; agents run on degraded context and the loop still
    // advances to the gate.
    runDeepResearchMock.mockRejectedValueOnce(new Error("MiroMind 503"));
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-concept-prefetch-fail", { projectId: "p-test" });
    await awaitLoop(run.runId);

    // Agents STILL ran despite the prefetch failure (graceful degradation).
    expect(invokeAgentMock).toHaveBeenCalledTimes(2);
    // The failure was recorded on the market-research phase status (display-only).
    const mrPhase = getRun(run.runId)?.phaseStatuses.find((p) => p.name === "market-research");
    expect(mrPhase?.lastError).toMatch(/pre-hook failed.*MiroMind 503/);
    // The loop was NOT blocked — it advanced to the gate normally (not "error").
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
  });

  it("hasActiveRunForSession is true while paused/running, false once terminal (409 collision guard)", async () => {
    // Phase 1 code review MEDIUM #2: a second concurrent /start for the same
    // session must 409. The guard keys on hasActiveRunForSession — covered here
    // at the service layer (the route is a thin caller).
    executeGateMock.mockResolvedValue({ gateId: "CD-PILLARS", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildConceptSkill(), "sess-collision", { projectId: "p-test" });
    await awaitLoop(run.runId);
    // Manual mode → paused-at-gate → still ACTIVE → a new /start would 409.
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(hasActiveRunForSession("sess-collision")).toBe(true);
    // A different session has no active run.
    expect(hasActiveRunForSession("sess-other")).toBe(false);

    // Advance to completion → terminal → no longer active → new /start allowed.
    await advanceFromGate(run.runId);
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("completed");
    expect(hasActiveRunForSession("sess-collision")).toBe(false);
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

/**
 * Pipeline-design tests — Phase 2. Verifies the real `/design` shape: 3 phases
 * (market-research → gdd-draft → art-architecture), 3 gates across 2 phases
 * (CD-GDD-ALIGN on gdd-draft; TD-FEASIBILITY + TD-ARCHITECTURE on the SAME
 * art-architecture phase — the multi-gate-manual case). Exercises the runner's
 * idempotent per-phase execution + gate-skip-on-advance fix.
 */

function buildDesignSkill() {
  return {
    name: "pipeline-design" as const,
    description: "/design — research → GDD → art/architecture (3 gates)",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "manual" as const,
    resumable: true,
    lifecyclePhase: "design" as const,
    phases: [
      { order: 1, name: "market-research", description: "MiroMind research", agents: ["market-researcher"] as any, createsTickets: false },
      { order: 2, name: "gdd-draft", description: "Draft GDD", agents: ["game-designer"] as any, gates: ["CD-GDD-ALIGN"], createsTickets: false },
      { order: 3, name: "art-architecture", description: "Art bible + ADRs", agents: ["creative-director", "art-director"] as any, gates: ["TD-FEASIBILITY", "TD-ARCHITECTURE"], createsTickets: false },
    ],
  } as any;
}

describe("pipeline-service /design (Phase 2)", () => {
  beforeEach(() => {
    runDeepResearchMock.mockClear();
    isDeepResearchAvailableMock.mockClear();
    ingestGDDMock.mockClear();
    isDeepResearchAvailableMock.mockReturnValue(true);
    runDeepResearchMock.mockResolvedValue({
      projectId: "p-test", concept: "test", timestamp: new Date().toISOString(), model: "mock",
      sections: [{ title: "Market", content: "stub" }], citations: [], totalTokens: 0, turns: 2,
    });
    ingestGDDMock.mockResolvedValue({
      gddPath: "/tmp/gdd.md", sectionsFound: 8, totalItems: 20, created: 20, skipped: 0,
      errors: [], createdTitles: [], skippedTitles: [], errorCount: 0,
    });
  });

  it("all 3 design gates fire once each in order; manual advances gate-by-gate through a multi-gate phase", async () => {
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildDesignSkill(), "sess-design-gates", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    // Paused at the first gate (CD-GDD-ALIGN, on the gdd-draft phase).
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(executeGateMock).toHaveBeenCalledTimes(1);

    // Advance past CD-GDD-ALIGN → reaches TD-FEASIBILITY (first gate of art-architecture).
    await advanceFromGate(run.runId);
    await awaitLoop(run.runId);
    expect(executeGateMock).toHaveBeenCalledTimes(2);

    // Advance past TD-FEASIBILITY → reaches TD-ARCHITECTURE (SECOND gate of the SAME phase).
    // This is the multi-gate-manual case the runner fix addresses.
    await advanceFromGate(run.runId);
    await awaitLoop(run.runId);
    expect(executeGateMock).toHaveBeenCalledTimes(3);

    // Advance past TD-ARCHITECTURE → completes.
    await advanceFromGate(run.runId);
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("completed");

    // Gates fired in the declared order, once each.
    const gateOrder = executeGateMock.mock.calls.map((c) => c[0]);
    expect(gateOrder).toEqual(["CD-GDD-ALIGN", "TD-FEASIBILITY", "TD-ARCHITECTURE"]);
  });

  it("gdd-draft triggers ingestGDD once and market-research triggers deep research once", async () => {
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildDesignSkill(), "sess-design-hooks", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId); // paused at CD-GDD-ALIGN
    // Both hooks already fired by the time we reach the first gate.
    expect(runDeepResearchMock).toHaveBeenCalledTimes(1); // market-research pre-hook
    expect(ingestGDDMock).toHaveBeenCalledTimes(1);        // gdd-draft post-hook
    expect(ingestGDDMock).toHaveBeenCalledWith("sess-design-hooks", "p-test", { broadcast: true });
  });

  it("a REJECT verdict holds at the gate in manual mode (GDD still ingested before the gate)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "REJECT", details: "GDD misaligned", agent: "creative-director", timestamp: new Date().toISOString() });
    const run = await startPipelineRun(buildDesignSkill(), "sess-design-block", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.gateVerdicts["CD-GDD-ALIGN"]?.verdict).toBe("REJECT");
    expect(executeGateMock).toHaveBeenCalledTimes(1); // manual never retries
    // The post-hook ran (GDD ingested) BEFORE the gate held.
    expect(ingestGDDMock).toHaveBeenCalledTimes(1);
  });

  it("resume-after-restart continues from the gdd-draft phase (currentPhaseIndex=1)", async () => {
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "creative-director", timestamp: new Date().toISOString() });
    const { randomUUID } = await import("node:crypto");
    const runId = `run-${randomUUID()}`;
    const now = new Date().toISOString();
    const skill = buildDesignSkill();
    const crashed = {
      runId,
      sessionId: "sess-design-resume",
      projectId: "p-test",
      skillName: skill.name,
      lifecyclePhase: "design",
      gateMode: "manual",
      status: "running",
      currentPhaseIndex: 1, // market-research done, gdd-draft next
      phaseStatuses: [
        { order: 1, name: "market-research", status: "completed", createsTickets: false },
        { order: 2, name: "gdd-draft", status: "pending", createsTickets: false },
        { order: 3, name: "art-architecture", status: "pending", createsTickets: false },
      ],
      gateVerdicts: {},
      startedAt: now,
      updatedAt: now,
    };
    require("node:fs").writeFileSync(join(tmpDir, `${runId}.json`), JSON.stringify(crashed, null, 2));

    const resumed = await resumePipelineRun(runId, { skill, reviewMode: "full" });
    expect(resumed).not.toBeNull();
    await awaitLoop(runId);

    // Only the gdd-draft phase ran: 1 agent (game-designer), ingestGDD once, CD-GDD-ALIGN once.
    // market-research did NOT re-run (no runDeepResearch).
    expect(invokeAgentMock).toHaveBeenCalledTimes(1);
    expect(runDeepResearchMock).not.toHaveBeenCalled();
    expect(ingestGDDMock).toHaveBeenCalledTimes(1);
    expect(executeGateMock).toHaveBeenCalledTimes(1);
    expect(getRun(runId)?.status).toBe("paused-at-gate");
  });
});

/**
 * Pipeline-sprint tests — Phase 3. Verifies /sprint reads available tickets off
 * the board, groups by area→team, dispatches each team's lead agent via the
 * Task-tool recipe (createQuestTicket + moveQuestTicket("qa")), and ends with
 * the PR-SPRINT gate.
 */

function buildSprintSkill() {
  return {
    name: "pipeline-sprint" as const,
    description: "/sprint — dispatch available tickets to feature teams",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "manual" as const,
    resumable: true,
    lifecyclePhase: "production" as const,
    phases: [
      { order: 1, name: "sprint-dispatch", description: "Dispatch", agents: ["producer"] as any, createsTickets: false },
      { order: 2, name: "sprint-review", description: "Review", agents: ["producer"] as any, gates: ["PR-SPRINT"], createsTickets: false },
    ],
  } as any;
}

describe("pipeline-service /sprint (Phase 3)", () => {
  beforeEach(() => {
    readTicketsBoardMock.mockClear();
    createQuestTicketMock.mockClear();
    moveQuestTicketMock.mockClear();
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "producer", timestamp: new Date().toISOString() });
  });

  it("sprint-dispatch reads available tickets and dispatches one agent per team area via the Task recipe", async () => {
    readTicketsBoardMock.mockResolvedValue({
      columns: [
        { id: "available", label: "Available", tickets: [
          { id: "t1", title: "Build HUD", area: "ui", status: "available" },
          { id: "t2", title: "Write intro", area: "narrative", status: "available" },
        ] },
      ],
    } as any);

    const run = await startPipelineRun(buildSprintSkill(), "sess-sprint-1", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);

    // 2 distinct areas → 2 dispatched team agents (ui-programmer, writer), each
    // via createQuestTicket (the Task-tool recipe). NOT the producer.
    expect(createQuestTicketMock).toHaveBeenCalledTimes(2);
    const dispatchedAgents = createQuestTicketMock.mock.calls.map((c) => c[2]); // agentRole arg
    expect(dispatchedAgents).toEqual(expect.arrayContaining(["ui-programmer", "writer"]));
    // Each dispatch does in_progress + qa → 2 moveQuestTicket per ticket.
    expect(moveQuestTicketMock).toHaveBeenCalledTimes(4);
    // producer ran for both phases (sprint-dispatch + sprint-review).
    expect(invokeAgentMock).toHaveBeenCalledTimes(4); // 2 dispatched + 2 producer
    expect(getRun(run.runId)?.status).toBe("paused-at-gate"); // PR-SPRINT manual pause
  });

  it("PR-SPRINT gate fires once and pauses in manual mode", async () => {
    readTicketsBoardMock.mockResolvedValue({
      columns: [{ id: "available", label: "Available", tickets: [{ id: "t1", title: "X", area: "qa", status: "available" }] }],
    } as any);
    const run = await startPipelineRun(buildSprintSkill(), "sess-sprint-gate", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    expect(executeGateMock).toHaveBeenCalledWith("PR-SPRINT", "sess-sprint-gate", expect.any(String));
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
  });

  it("sprint-dispatch with no available tickets is a graceful no-op (producer still runs, PR-SPRINT still fires)", async () => {
    readTicketsBoardMock.mockResolvedValue({ columns: [{ id: "available", label: "Available", tickets: [] }] } as any);
    const run = await startPipelineRun(buildSprintSkill(), "sess-sprint-empty", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    expect(createQuestTicketMock).not.toHaveBeenCalled(); // nothing to dispatch
    expect(getRun(run.runId)?.status).toBe("paused-at-gate"); // PR-SPRINT still fires
  });
});

/**
 * Pipeline-release tests — Phase 4. Verifies /release: the release-build
 * post-hook calls executeGodotExport (build + changelog), final-signoff
 * (createsTickets:true) creates a ticket per agent, PR-MILESTONE fires, and a
 * build failure is graceful (non-blocking).
 */

function buildReleaseSkill() {
  return {
    name: "pipeline-release" as const,
    description: "/release — wrap team-release + export",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "manual" as const,
    resumable: true,
    lifecyclePhase: "release" as const,
    phases: [
      { order: 1, name: "release-checklist", description: "x", agents: ["release-manager"] as any, createsTickets: false },
      { order: 2, name: "qa-signoff", description: "x", agents: ["qa-lead"] as any, createsTickets: false },
      { order: 3, name: "release-build", description: "x", agents: ["devops-engineer"] as any, createsTickets: false },
      { order: 4, name: "final-signoff", description: "x", agents: ["release-manager", "producer"] as any, gates: ["PR-MILESTONE"], createsTickets: true },
    ],
  } as any;
}

describe("pipeline-service /release (Phase 4)", () => {
  beforeEach(() => {
    executeGodotExportMock.mockClear();
    executeGodotExportMock.mockResolvedValue({ id: "build-mock", platform: "linux" });
    createQuestTicketMock.mockClear();
    moveQuestTicketMock.mockClear();
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "release-manager", timestamp: new Date().toISOString() });
  });

  it("release-build post-hook calls executeGodotExport; final-signoff creates a ticket per agent; PR-MILESTONE fires", async () => {
    const run = await startPipelineRun(buildReleaseSkill(), "sess-release-1", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);

    // release-build post-hook fired executeGodotExport once with the resolved workspacePath.
    expect(executeGodotExportMock).toHaveBeenCalledTimes(1);
    expect(executeGodotExportMock).toHaveBeenCalledWith("p-test", "./workspace/projects/p-test", "linux");
    // final-signoff (createsTickets:true, 2 agents) → 2 Quest tickets.
    expect(createQuestTicketMock).toHaveBeenCalledTimes(2);
    // PR-MILESTONE gate fired once (manual pause).
    expect(executeGateMock).toHaveBeenCalledWith("PR-MILESTONE", "sess-release-1", expect.any(String));
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
  });

  it("release-build hook is graceful when executeGodotExport throws (non-blocking)", async () => {
    executeGodotExportMock.mockRejectedValueOnce(new Error("Godot not installed"));
    const run = await startPipelineRun(buildReleaseSkill(), "sess-release-fail", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);

    expect(executeGodotExportMock).toHaveBeenCalledTimes(1);
    const buildPhase = getRun(run.runId)?.phaseStatuses.find((p) => p.name === "release-build");
    expect(buildPhase?.lastError).toMatch(/post-hook failed.*Godot not installed/);
    // Build failed but the run still advanced to the PR-MILESTONE gate.
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
  });
});

/**
 * Pipeline-make-game tests — Phase 5. Verifies /make-game sequences child
 * pipelines (concept → design → slice → sprint → polish → release), each with
 * parentRunId set, running children in auto + pausing the parent at the
 * inter-pipeline PR-PHASE-GATE (manual). Exercises the gate-clearing fix that
 * lets PR-PHASE-GATE repeat across phases.
 */

function buildMakeGameSkill() {
  return {
    name: "pipeline-make-game" as const,
    description: "/make-game — full-lifecycle orchestrator",
    userInvocable: true,
    kind: "pipeline" as const,
    gateMode: "manual" as const,
    resumable: true,
    lifecyclePhase: "production" as const,
    phases: [
      { order: 1, name: "concept", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 2, name: "design", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 3, name: "slice", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 4, name: "sprint", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 5, name: "polish", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 6, name: "release", description: "x", agents: ["producer"] as any, gates: ["PR-PHASE-GATE"], createsTickets: false },
    ],
  } as any;
}

describe("pipeline-service /make-game (Phase 5)", () => {
  beforeEach(() => {
    executeGateMock.mockClear();
    runDeepResearchMock.mockClear();
    ingestGDDMock.mockClear();
    executeGodotExportMock.mockClear();
    executeGateMock.mockResolvedValue({ gateId: "x", verdict: "APPROVE", details: "ok", agent: "producer", timestamp: new Date().toISOString() });
    runDeepResearchMock.mockResolvedValue({ projectId: "p-test", concept: "test", timestamp: new Date().toISOString(), model: "mock", sections: [{ title: "M", content: "x" }], citations: [], totalTokens: 0, turns: 1 });
    ingestGDDMock.mockResolvedValue({ gddPath: "/tmp/g.md", sectionsFound: 1, totalItems: 1, created: 1, skipped: 0, errors: [], createdTitles: [], skippedTitles: [], errorCount: 0 });
    executeGodotExportMock.mockResolvedValue({ id: "build-mock", platform: "linux" });
  });

  it("manual mode: runs the concept child (auto) then pauses at PR-PHASE-GATE; advance chains to design (gate re-reviewed)", async () => {
    const run = await startPipelineRun(buildMakeGameSkill(), "sess-mg-1", { projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    // Parent paused at the first inter-pipeline gate (after the concept child).
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(0);
    // The concept child ran to completion with parentRunId set.
    const children = listRuns("sess-mg-1").filter((r) => r.parentRunId === run.runId);
    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(children.some((c) => c.skillName === "pipeline-concept" && c.status === "completed")).toBe(true);
    // Gates: concept child's CD-PILLARS + parent's PR-PHASE-GATE both fired.
    const gates = executeGateMock.mock.calls.map((c) => c[0]);
    expect(gates).toEqual(expect.arrayContaining(["CD-PILLARS", "PR-PHASE-GATE"]));

    // Advance → design child runs → pauses at the NEXT PR-PHASE-GATE (re-reviewed,
    // proving the gate-clearing fix: PR-PHASE-GATE is not skipped globally).
    await advanceFromGate(run.runId);
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("paused-at-gate");
    expect(getRun(run.runId)?.currentPhaseIndex).toBe(1);
    const children2 = listRuns("sess-mg-1").filter((r) => r.parentRunId === run.runId);
    expect(children2.some((c) => c.skillName === "pipeline-design")).toBe(true);

    await stopPipelineRun(run.runId);
  });

  it("PR-PHASE-GATE fires once per phase (6 times), not once globally — gate-clearing fix", async () => {
    // Auto mode so the parent advances through every phase; count PR-PHASE-GATE reviews.
    const run = await startPipelineRun(buildMakeGameSkill(), "sess-mg-gatecount", { gateMode: "auto", projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("completed");
    const prPhaseGateCount = executeGateMock.mock.calls.filter((c) => c[0] === "PR-PHASE-GATE").length;
    expect(prPhaseGateCount).toBe(6); // one per lifecycle phase, not 1
  });

  it("auto mode: runs all 6 child pipelines end-to-end and completes", async () => {
    const run = await startPipelineRun(buildMakeGameSkill(), "sess-mg-auto", { gateMode: "auto", projectId: "p-test", reviewMode: "full" });
    await awaitLoop(run.runId);
    expect(getRun(run.runId)?.status).toBe("completed");
    // All 6 child pipelines ran, each with parentRunId set.
    const children = listRuns("sess-mg-auto").filter((r) => r.parentRunId === run.runId);
    const childSkills = new Set(children.map((c) => c.skillName));
    expect(childSkills).toEqual(new Set(["pipeline-concept", "pipeline-design", "pipeline-slice", "pipeline-sprint", "pipeline-polish", "pipeline-release"]));
    // The release child exported a build (proves the chain reached the final stage).
    expect(executeGodotExportMock).toHaveBeenCalled();
  });

  it("make-game does NOT declare subSkills on any phase (registry-forbidden)", () => {
    const skill = buildMakeGameSkill();
    expect(skill.phases.every((p: { subSkills?: unknown }) => !p.subSkills)).toBe(true);
  });

  it("stopPipelineRun cascades cancellation to active child runs (no orphans)", async () => {
    // Slow the agent so the concept child is still mid-run when we stop the parent.
    invokeAgentMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { content: "slow" };
    });
    const run = await startPipelineRun(buildMakeGameSkill(), "sess-mg-cascade", { projectId: "p-test", reviewMode: "full" });
    // Let the concept child spawn + reach its (slow) agent before stopping.
    await new Promise((r) => setTimeout(r, 80));
    const activeChildren = listRuns("sess-mg-cascade").filter(
      (r) => r.parentRunId === run.runId && (r.status === "running" || r.status === "paused-at-gate"),
    );
    expect(activeChildren.length).toBeGreaterThanOrEqual(1); // concept child is running

    await stopPipelineRun(run.runId);
    expect(getRun(run.runId)?.status).toBe("cancelled");
    // Allow the cascade + child loops to settle.
    await new Promise((r) => setTimeout(r, 80));
    const stillActive = listRuns("sess-mg-cascade").filter(
      (r) => r.parentRunId === run.runId && (r.status === "running" || r.status === "paused-at-gate"),
    );
    expect(stillActive.length).toBe(0); // child was cascade-cancelled, not orphaned
  });
});
