import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { loadConfig } from "../config.js";

function timingSafeCompare(a: string, b: string): boolean {
  // Hash both inputs to fixed-length buffers before comparing.
  // Direct length comparison leaks key length via timing.
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === "/health") return next();

  // Skip auth for thumbnail image serving — <img> tags cannot send custom headers
  if (req.path.match(/^\/api\/assets\/[^/]+\/thumbnail$/)) return next();

  const config = loadConfig();
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey || !timingSafeCompare(apiKey, config.API_SECRET)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  next();
}
