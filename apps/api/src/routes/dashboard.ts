import { Router } from "express";
import type { Request, Response } from "express";
import dashboardData from "../data/dashboard.json" with { type: "json" };
import type { DashboardData } from "@game-studio/types";

export const dashboardRouter: Router = Router();

dashboardRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: dashboardData as DashboardData });
});
