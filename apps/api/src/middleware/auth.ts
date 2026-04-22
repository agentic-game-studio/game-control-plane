import type { Request, Response, NextFunction } from "express";
import { loadConfig } from "../config.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check and dev mode
  if (req.path === "/health") return next();

  const config = loadConfig();
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey || apiKey !== config.API_SECRET) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  next();
}
