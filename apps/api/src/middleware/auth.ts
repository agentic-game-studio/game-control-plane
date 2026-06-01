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
  // req.headers values are string | string[] | undefined; an array value
  // (which can happen behind some proxies) would slip past the `!apiKey`
  // check after being cast. Take the first element if so.
  const rawKey = req.headers["x-api-key"];
  const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  if (!apiKey || !timingSafeCompare(apiKey, config.API_SECRET)) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  next();
}
