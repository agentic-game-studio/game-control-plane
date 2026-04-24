import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import type { SettingsConfig, GameEngine } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const DEFAULT_SETTINGS: SettingsConfig = {
  targetEngine: "Unity",
  assetModel: "Studio XYZ Optimized (Fast)",
  externalApiKey: "",
  webhookUrl: "",
  creditBalance: {
    current: 50000,
    burnRatePerHour: 120,
    estimatedDepletionDays: 30,
  },
};

export const settingsRouter: Router = Router();

// GET /api/settings - Get settings
settingsRouter.get("/", (_req: Request, res: Response) => {
  try {
    const data = readData<SettingsConfig>("settings.json");
    res.json({ success: true, data });
  } catch {
    // Initialize with default data if file doesn't exist
    writeData("settings.json", DEFAULT_SETTINGS);
    res.json({ success: true, data: DEFAULT_SETTINGS });
  }
});

// PATCH /api/settings - Update settings
settingsRouter.patch("/", (req: Request, res: Response) => {
  const updates = req.body as Partial<SettingsConfig>;

  try {
    const data = readData<SettingsConfig>("settings.json");
    const updatedSettings: SettingsConfig = {
      ...data,
      ...updates,
    };

    // Ensure valid engine if provided
    if (updates.targetEngine && !["Unity", "Unreal", "Godot"].includes(updates.targetEngine)) {
      res.status(400).json({ success: false, error: "Invalid target engine" });
      return;
    }

    writeData("settings.json", updatedSettings);

    // Broadcast event
    broadcastEvent({
      type: "settings:updated",
      settings: updatedSettings,
    } as WSEvent);

    res.json({ success: true, data: updatedSettings });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update settings" });
  }
});

// POST /api/settings/reset - Reset settings to defaults
settingsRouter.post("/reset", (_req: Request, res: Response) => {
  try {
    writeData("settings.json", DEFAULT_SETTINGS);

    // Broadcast event
    broadcastEvent({
      type: "settings:updated",
      settings: DEFAULT_SETTINGS,
    } as WSEvent);

    res.json({ success: true, data: DEFAULT_SETTINGS });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to reset settings" });
  }
});
