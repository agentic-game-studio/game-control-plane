import { Router } from "express";
import type { Request, Response } from "express";
import { teamSkills } from "@game-studio/skills";
import { invokeAgent } from "../services/llm-service.js";
import { broadcast } from "../services/websocket.js";
import type { WSEvent, AgentRole } from "@game-studio/types";
import type { LLMMessage } from "../llm/zai-client.js";
import type { SkillDefinition } from "@game-studio/types";

export const teamsRouter: Router = Router();

// In-memory session history for team workflows
const teamSessions: Map<string, { messages: LLMMessage[]; startedAt: string }> = new Map();

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

  const { sessionId, input, reviewMode } = req.body as {
    sessionId?: string;
    input?: string;
    reviewMode?: string;
  };

  const effectiveSessionId = sessionId || `team-${Date.now()}`;
  const teamMembers = team.teamMembers || [];

  // Initialize team session
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
  runTeamWorkflow(team, effectiveSessionId, input, teamSession).catch((error) => {
    console.error(`Team workflow ${team.name} failed:`, error);
    teamSession.messages.push({
      role: "assistant",
      content: `Team workflow failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  });
});

/**
 * Run team workflow - orchestrates agents through phases
 */
async function runTeamWorkflow(
  team: SkillDefinition,
  sessionId: string,
  userInput?: string,
  teamSession?: { messages: LLMMessage[]; startedAt: string }
): Promise<void> {
  const effectiveSession = teamSession || {
    messages: [] as LLMMessage[],
    startedAt: new Date().toISOString(),
  };

  const teamMembers = team.teamMembers || [];

  // Build initial task
  let task = `You are coordinating the **${team.name.replace("team-", "").replace(/-/g, " ")}** team workflow.

## Team Members
${teamMembers.map((m) => `- ${m.replace(/-/g, " ")}`).join("\n")}

## Workflow Phases
${team.phases.map((p) => `${p.order}. ${p.name}: ${p.description}`).join("\n")}

## Your Task
Coordinate the team to complete this workflow. Spawn agents as needed using the Task tool, collect their outputs, and synthesize a final response.

Start by analyzing the task and spawning the appropriate team members.`;

  if (userInput) {
    task += `\n\n## User Input\n${userInput}`;
  }

  try {
    // Use creative-director as the orchestrator for team workflows
    const result = await invokeAgent(
      "creative-director",
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

    // Log entry
    broadcast({
      type: "log:entry",
      sessionId,
      level: "info",
      message: `[Team] ${team.name} completed`,
      timestamp: new Date().toISOString(),
    } as WSEvent);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
