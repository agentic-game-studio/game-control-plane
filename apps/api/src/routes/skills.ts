import { Router } from "express";
import type { Request, Response } from "express";
import { skills } from "@game-studio/skills";

export const skillsRouter: Router = Router();

// GET /skills — list all skills
skillsRouter.get("/", (_req: Request, res: Response) => {
  const all = Object.entries(skills).map(([name, def]) => ({ ...def }));
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

// POST /skills/:id/invoke — invoke a skill
skillsRouter.post("/:id/invoke", async (req: Request, res: Response) => {
  const skill = skills[req.params.id as keyof typeof skills];
  if (!skill) {
    res.status(404).json({ success: false, error: "Skill not found" });
    return;
  }

  const { sessionId, args, reviewMode } = req.body as {
    sessionId?: string;
    args?: Record<string, string>;
    reviewMode?: string;
  };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  res.json({
    success: true,
    data: {
      skillId: skill.name,
      phases: skill.phases.length,
      teamMembers: skill.teamMembers,
      status: "queued",
      reviewMode: reviewMode ?? "lean",
    },
  });
});
