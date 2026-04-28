import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { loadConfig } from "../config.js";

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === "/health") return next();

  const config = loadConfig();
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey || !timingSafeCompare(apiKey, config.API_SECRET)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  next();
}
