import { Router } from "express";
import type { Request, Response } from "express";
import settingsData from "../data/settings.json" with { type: "json" };
import type { SettingsConfig } from "@game-studio/types";

export const settingsRouter: Router = Router();

settingsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: settingsData as SettingsConfig });
});

settingsRouter.patch("/", (req: Request, res: Response) => {
  const updates = req.body as Partial<SettingsConfig>;
  Object.assign(settingsData, updates);
  res.json({ success: true, data: settingsData as SettingsConfig });
});
