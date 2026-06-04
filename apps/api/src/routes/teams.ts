import { Router } from "express";
import type { Request, Response } from "express";
import { teamSkills } from "@game-studio/skills";
import { invokeAgent } from "../services/llm-service.js";
import { broadcast } from "../services/websocket.js";
import { logger } from "../utils/logger.js";
import { newId } from "../utils/ids.js";
import type { WSEvent, AgentRole } from "@game-studio/types";
import type { LLMMessage } from "../llm/zai-client.js";
import type { SkillDefinition } from "@game-studio/types";
import { startWorkflow, advanceStage, createQuestTicket, moveQuestTicket, completeWorkflow, getWorkflow } from "../services/quest-bridge.js";
import { executeGodotExport, runPostExportSmokeTest } from "../services/build-service.js";
import { generateProjectChangelog } from "../services/changelog-service.js";
import { readData } from "../services/data-store.js";
import type { DashboardData } from "@game-studio/types";

export const teamsRouter: Router = Router();

// In-memory session history for team workflows. Sweep on access to keep
// entries bounded — long-running API processes running many team workflows
// would otherwise accumulate entries for completed sessions forever.
const TEAM_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const teamSessions: Map<string, { messages: LLMMessage[]; startedAt: string }> = new Map();

function pruneTeamSessions(): void {
  const cutoff = Date.now() - TEAM_SESSION_TTL_MS;
  for (const [id, session] of teamSessions) {
    if (Date.parse(session.startedAt) < cutoff) {
      teamSessions.delete(id);
    }
  }
}

/**
 * Get team skill by name
 */
function getTeam(teamId: string): SkillDefinition | undefined {
  return teamSkills.find((t) => t.name === `team-${teamId}` || t.name === teamId);
}

// GET /teams — list all team skills
teamsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: teamSkills });
});

// GET /teams/:team — get team details
teamsRouter.get("/:team", (req: Request, res: Response) => {
  const team = getTeam(req.params.team as string);
  if (!team) {
    res.status(404).json({ success: false, error: "Team not found" });
    return;
  }
  res.json({ success: true, data: team });
});

// POST /teams/:team/run — run a team workflow with real LLM
teamsRouter.post("/:team/run", async (req: Request, res: Response) => {
  const team = getTeam(req.params.team as string);
  if (!team) {
    res.status(404).json({ success: false, error: "Team not found" });
    return;
  }

  const { sessionId, input, reviewMode, projectId } = req.body as {
    sessionId?: string;
    input?: string;
    reviewMode?: string;
    projectId?: string;
  };

  // 28-H-text-field-length-cap: clamp the free-form `input` so a
  // 5MB body limit can't be used to flood the LLM with a single
  // token-burning request. The team workflow concatenates `input`
  // verbatim into the producer prompt and dispatches it to every
  // team member — a 5MB input means a 5MB × N-members LLM call.
  // The cap matches the chat /messages and tickets title/description
  // caps (50_000 chars ≈ a long user prompt, well under context).
  const MAX_INPUT = 50_000;
  if (input !== undefined && (typeof input !== "string" || input.length > MAX_INPUT)) {
    res.status(400).json({ success: false, error: `input must be a string up to ${MAX_INPUT} chars` });
    return;
  }

  const effectiveSessionId = sessionId || newId("team");
  const teamMembers = team.teamMembers || [];

  // Reject if a workflow is already in flight for this sessionId. Without this
  // guard, two concurrent /run calls with the same sessionId (or two /run
  // calls in the same millisecond with no sessionId) would both pass the
  // check, both overwrite teamSessions, and both create duplicate quest
  // tickets. We capture the timestamp before startWorkflow so we can tell
  // whether the returned workflow is one we just created (createdAt ≥ t0)
  // or a pre-existing one (createdAt < t0).
  const requestStart = Date.now();
  const workflowId = startWorkflow(effectiveSessionId);
  const existing = getWorkflow(effectiveSessionId);
  if (existing && existing.createdAt < requestStart) {
    logger.warn(
      { sessionId: effectiveSessionId, existingWorkflowId: existing.workflowId, event: "team_run_duplicate" },
      "Refusing to start team workflow — one is already in flight for this session",
    );
    res.status(409).json({
      success: false,
      error: "A team workflow is already in flight for this sessionId",
      sessionId: effectiveSessionId,
    });
    return;
  }

  // Initialize team session. Prune before write so the map doesn't grow
  // unbounded across many run() calls.
  pruneTeamSessions();
  const teamSession: { messages: LLMMessage[]; startedAt: string } = {
    messages: [],
    startedAt: new Date().toISOString(),
  };
  teamSessions.set(effectiveSessionId, teamSession);

  // Broadcast start event
  broadcast({
    type: "agent:spawned",
    agentId: `team-${team.name}`,
    agent: "producer" as AgentRole,
    sessionId: effectiveSessionId,
  } as WSEvent);

  res.json({
    success: true,
    data: {
      teamId: team.name,
      members: teamMembers,
      workflow: team.phases,
      status: "running",
      sessionId: effectiveSessionId,
      reviewMode: reviewMode ?? "lean",
    },
  });

  // Run the workflow asynchronously
  runTeamWorkflow(team, effectiveSessionId, input, teamSession, projectId).catch((error) => {
    logger.error({ team: team.name, error: error instanceof Error ? error.message : String(error), event: "team_error" }, "Workflow failed");
    teamSession.messages.push({
      role: "assistant",
      content: `Team workflow failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  });
});

/**
 * Run team workflow - orchestrates agents through phases with Quest integration
 */
async function runTeamWorkflow(
  team: SkillDefinition,
  sessionId: string,
  userInput?: string,
  teamSession?: { messages: LLMMessage[]; startedAt: string },
  projectId?: string,
): Promise<void> {
  const effectiveSession = teamSession || {
    messages: [] as LLMMessage[],
    startedAt: new Date().toISOString(),
  };

  const teamMembers = team.teamMembers || [];

  // 10-H6: don't call startWorkflow again — the caller at /:team/run
  // already created the workflow and verified there wasn't an existing
  // one. A redundant call here would silently no-op (since startWorkflow
  // refuses to clobber an existing workflow), but it muddies the audit
  // trail by emitting a spurious "workflow_already_active" warning.
  // Verify the workflow still exists before advancing — if it was
  // cleaned up by the TTL sweep, recreate it so the team workflow
  // can proceed.
  if (!getWorkflow(sessionId)) {
    startWorkflow(sessionId);
  }
  advanceStage(sessionId, "decompose");

  // Create Quest tickets for each team member upfront
  const teamTickets: Map<string, string> = new Map(); // agentRole -> ticketId
  for (const member of teamMembers) {
    const ticket = await createQuestTicket(
      sessionId,
      `${team.name.replace("team-", "")}: ${member.replace(/-/g, " ")} task`,
      member as AgentRole,
      `Part of ${team.name} team workflow. Assigned to ${member.replace(/-/g, " ")}.`,
      team.name.replace("team-", "").toUpperCase(),
      member,
    );
    teamTickets.set(member, ticket.id);
  }

  // Build task prompt for the Producer as team orchestrator
  let task = `You are the **Producer** coordinating the **${team.name.replace("team-", "").replace(/-/g, " ")}** team workflow.

## Team Members (Quest tickets already created)
${teamMembers.map((m) => `- ${m.replace(/-/g, " ")} (ticket: ${teamTickets.get(m)})`).join("\n")}

## Workflow Phases
${team.phases.map((p) => `${p.order}. ${p.name}: ${p.description} — agents: ${(p.agents ?? []).join(", ") || "all"}`).join("\n")}

## Your Task
Execute each phase IN ORDER. Use the Task tool to spawn each agent with clear instructions.
After each phase, summarize the output before moving to the next phase.
All Quest tickets have been created — agents just need to be spawned via Task tool.`;

  if (userInput) {
    task += `\n\n## User Input\n${userInput}`;
  }

  advanceStage(sessionId, "execute");

  try {
    // Use Producer as the orchestrator for team workflows
    const result = await invokeAgent(
      "producer",
      task,
      sessionId,
      undefined,
      effectiveSession.messages
    );

    // Update session with result
    effectiveSession.messages.push(
      { role: "user", content: task },
      { role: "assistant", content: result.content }
    );

    if (team.name === "team-release" && projectId) {
      advanceStage(sessionId, "verify");
      try {
        const dashboard = await readData<DashboardData>("dashboard.json");
        const project = dashboard.projects.find((p) => p.id === projectId);
        const workspacePath = project?.workspacePath ?? projectId;
        await generateProjectChangelog(projectId, workspacePath);
        const build = await executeGodotExport(projectId, workspacePath, "web", undefined, true);
        await runPostExportSmokeTest(build.id, workspacePath);
      } catch (releaseErr) {
        logger.warn(
          { projectId, error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr), event: "team_release_build_failed" },
          "team-release build step failed",
        );
      }
    }

    // 24-H-teams-fire-forget: await the per-ticket moves before
    // completing the workflow. The previous shape fired the moves
    // without `await`, then synchronously ran `completeWorkflow` and
    // `teamSessions.delete` while the ticket moves were still in
    // flight. `moveQuestTicket` does its own per-file mutex acquire
    // + write; a hung move (mutex contention, slow disk) can
    // outlive the workflow being torn down, leaving the ticket in
    // the old column and broadcasting a `workflow:complete` that
    // disagrees with the kanban state. `Promise.all` waits for all
    // moves to finish before completing the workflow.
    await Promise.all(
      [...teamTickets].map(([role, ticketId]) =>
        moveQuestTicket(ticketId, "completed", role),
      ),
    );

    // Complete workflow
    completeWorkflow(sessionId, true);

    // Clean up in-memory session
    teamSessions.delete(sessionId);

    // Broadcast completion
    broadcast({
      type: "agent:completed",
      agentId: `team-${team.name}`,
      output: result.content,
      sessionId,
    } as WSEvent);

    broadcast({
      type: "skill:phase:complete",
      skillId: team.name,
      phase: team.phases.length,
      output: result.content.slice(0, 200),
      sessionId,
    } as WSEvent);

    broadcast({
      type: "log:entry",
      sessionId,
      level: "info",
      message: `[Team] ${team.name} completed — ${teamMembers.length} agents, ${team.phases.length} phases`,
      timestamp: new Date().toISOString(),
    } as WSEvent);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // 24-H-teams-fire-forget: await the per-ticket moves before
    // completing the workflow (qa branch — see success branch for
    // the rationale).
    await Promise.all(
      [...teamTickets].map(([role, ticketId]) =>
        moveQuestTicket(ticketId, "qa", role),
      ),
    );

    completeWorkflow(sessionId, false);

    // Clean up in-memory session
    teamSessions.delete(sessionId);

    broadcast({
      type: "agent:failed",
      agentId: `team-${team.name}`,
      error: errorMessage,
      sessionId,
    } as WSEvent);

    throw error;
  }
}

// GET /teams/:team/status — get workflow status
teamsRouter.get("/:team/status", (req: Request, res: Response) => {
  const team = getTeam(req.params.team as string);
  if (!team) {
    res.status(404).json({ success: false, error: "Team not found" });
    return;
  }

  const sessionId = req.query.sessionId as string;
  const teamSession = sessionId ? teamSessions.get(sessionId) : null;

  res.json({
    success: true,
    data: {
      teamId: team.name,
      sessionId: sessionId || null,
      phasesCompleted: teamSession ? Math.floor(teamSession.messages.length / 2) : 0,
      totalPhases: team.phases.length,
      status: teamSession ? (teamSession.messages.length > 0 ? "running" : "pending") : "not_started",
    },
  });
});
