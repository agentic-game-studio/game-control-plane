import { Router } from "express";
import type { Request, Response } from "express";
import { skills } from "@game-studio/skills";
import { invokeAgent, detectEngineFromWorkspace, type ProjectContext } from "../services/llm-service.js";
import { SessionStore } from "@game-studio/state";
import { loadConfig } from "../config.js";
import { broadcast } from "../services/websocket.js";
import { readData } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import type { WSEvent, SkillName, DashboardData } from "@game-studio/types";

export const skillsRouter: Router = Router();

const config = loadConfig();
const store = new SessionStore(config.WORKSPACE_DIR);

// GET /skills — list all skills
skillsRouter.get("/", (_req: Request, res: Response) => {
  const all = Object.entries(skills).map(([, def]) => ({ ...def }));
  res.json({ success: true, data: all });
});

// GET /skills/:id — get skill definition
skillsRouter.get("/:id", (req: Request, res: Response) => {
  const skill = skills[req.params.id as keyof typeof skills];
  if (!skill) {
    res.status(404).json({ success: false, error: "Skill not found" });
    return;
  }
  res.json({ success: true, data: skill });
});

// POST /skills/:id/invoke — invoke a skill with real ZAI API
skillsRouter.post("/:id/invoke", async (req: Request, res: Response) => {
  const skill = skills[req.params.id as keyof typeof skills];
  if (!skill) {
    res.status(404).json({ success: false, error: "Skill not found" });
    return;
  }

  const { sessionId, projectId, args, reviewMode } = req.body as {
    sessionId?: string;
    projectId?: string;
    args?: Record<string, string>;
    reviewMode?: string;
  };

  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const session = await store.get(sessionId);
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  // Start the skill invocation asynchronously
  const skillId = skill.name;
  let currentPhase = 0;

  // Build task description from args
  const taskArgs = args
    ? Object.entries(args)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")
    : "No additional arguments provided.";

  // Resolve project context if projectId is provided
  async function getProjectCtx(pid: string): Promise<ProjectContext | undefined> {
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === pid);
    if (!project) return undefined;
    let engine = project.engine;
    if (!engine && project.workspacePath) {
      const detected = await detectEngineFromWorkspace(project.workspacePath);
      if (detected) engine = detected as "godot" | "unreal" | "unity" | "phaser" | "threejs";
    }
    return { name: project.name, description: project.description, engine, workspacePath: project.workspacePath, projectId: project.id };
  }

  const projectContext = projectId ? await getProjectCtx(projectId) : undefined;

  // Execute phases sequentially if skill has phases
  if (skill.phases.length > 0) {
    const runPhases = async () => {
      for (const phase of skill.phases) {
        currentPhase = phase.order;

        broadcast({
          type: "skill:phase:complete",
          skillId,
          phase: currentPhase,
          output: `Starting phase: ${phase.name}`,
          sessionId,
        } as WSEvent);

        // Execute each agent in the phase
        for (const agentRole of phase.agents) {
          const task = `SKILL: ${skillId}
PHASE: ${phase.name} (${phase.order}/${skill.phases.length})
DESCRIPTION: ${phase.description}

TASK ARGUMENTS:
${taskArgs}

Execute this phase of the skill workflow.`;

          const result = await invokeAgent(
            agentRole as import("@game-studio/types").AgentRole,
            task,
            sessionId,
            undefined,
            undefined,
            undefined,
            true,
            1,
            projectContext,
          );

          // Add log entry for the result
          await store.addLog(sessionId, {
            level: "info",
            message: `[${agentRole}] Phase ${currentPhase}: ${result.content.slice(0, 200)}...`,
            agent: agentRole,
            skill: skillId,
          });

          broadcast({
            type: "skill:phase:complete",
            skillId,
            phase: currentPhase,
            output: result.content,
            sessionId,
          } as WSEvent);

          // Check for gates
          if (phase.gates && reviewMode !== "solo") {
            broadcast({
              type: "log:entry",
              sessionId,
              level: "info",
              message: `Gate check required: ${phase.gates.join(", ")}`,
              agent: agentRole,
              skill: skillId,
              timestamp: new Date().toISOString(),
            } as WSEvent);
          }
        }

        // ── Sub-skills: invoke each after the phase's agents finish ──
        if (phase.subSkills && phase.subSkills.length > 0) {
          for (const subSkillName of phase.subSkills) {
            const subSkill = skills[subSkillName as keyof typeof skills];
            if (!subSkill) {
              await store.addLog(sessionId, {
                level: "warn",
                message: `Sub-skill "${subSkillName}" not found — skipping`,
                skill: skillId,
              });
              continue;
            }

            broadcast({
              type: "skill:phase:complete",
              skillId,
              phase: currentPhase,
              output: `Starting sub-skill: ${subSkillName}`,
              sessionId,
            } as WSEvent);

            // Recursively run the sub-skill's phases (all of them sequentially)
            for (const subPhase of subSkill.phases) {
              for (const subAgent of subPhase.agents) {
                const subTask = `SKILL: ${subSkillName}
PHASE: ${subPhase.name} (${subPhase.order}/${subSkill.phases.length})
DESCRIPTION: ${subPhase.description}

PARENT SKILL: ${skillId}
PARENT PHASE: ${phase.name}

TASK ARGUMENTS:
${taskArgs}

Execute this sub-skill phase. The parent skill (${skillId}) is composing multiple sub-skills into a complete implementation.`;

                const subResult = await invokeAgent(
                  subAgent as import("@game-studio/types").AgentRole,
                  subTask,
                  sessionId,
                  undefined,
                  undefined,
                  undefined,
                  true,
                  1,
                  projectContext,
                );

                await store.addLog(sessionId, {
                  level: "info",
                  message: `[${subAgent}] Sub-skill ${subSkillName} phase ${subPhase.order}: ${subResult.content.slice(0, 200)}...`,
                  agent: subAgent,
                  skill: subSkillName,
                });

                broadcast({
                  type: "skill:phase:complete",
                  skillId: subSkillName,
                  phase: subPhase.order,
                  output: subResult.content,
                  sessionId,
                } as WSEvent);
              }
            }
          }
        }
      }

      // Update session status
      await store.save({ ...session, status: "completed", updatedAt: new Date().toISOString() });
      broadcast({
        type: "session:status",
        sessionId,
        status: "completed",
      } as WSEvent);
    };

    // Start running phases in background
    runPhases().catch((err) => {
      logger.error({ skillId, error: String(err), event: "skill_error" }, `${skillId} failed`);
      store.addLog(sessionId, {
        level: "error",
        message: `Skill failed: ${String(err)}`,
        skill: skillId,
      });
    });
  } else {
    // Simple skill with no phases — run directly
    const task = `SKILL: ${skillId}
DESCRIPTION: ${skill.description}

TASK ARGUMENTS:
${taskArgs}

Execute this skill.`;

    // Use creative-director as default orchestrator for simple skills
    const result = await invokeAgent(
      "creative-director",
      task,
      sessionId,
      undefined,
      undefined,
      undefined,
      true,
      1,
      projectContext,
    );

    await store.addLog(sessionId, {
      level: "info",
      message: result.content.slice(0, 500),
      skill: skillId,
    });

    broadcast({
      type: "skill:phase:complete",
      skillId,
      phase: 1,
      output: result.content,
      sessionId,
    } as WSEvent);
  }

  res.json({
    success: true,
    data: {
      skillId,
      phases: skill.phases.length,
      teamMembers: skill.teamMembers,
      status: "running",
      reviewMode: reviewMode ?? "lean",
      sessionId,
    },
  });
});
