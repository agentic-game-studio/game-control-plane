import { Router } from "express";
import type { Request, Response } from "express";
import { teamSkills } from "@game-studio/skills";

export const teamsRouter: Router = Router();

// GET /teams — list all team skills
teamsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: teamSkills });
});

// POST /teams/:team/run — run a team workflow
teamsRouter.post("/:team/run", async (req: Request, res: Response) => {
  const team = teamSkills.find((t) => t.name === `team-${req.params.team}`);
  if (!team) {
    res.status(404).json({ success: false, error: "Team not found" });
    return;
  }

  const { sessionId, input, reviewMode } = req.body;
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  res.json({
    success: true,
    data: {
      teamId: team.name,
      members: team.teamMembers,
      workflow: team.phases,
      status: "running",
      reviewMode: reviewMode ?? "lean",
    },
  });
});
