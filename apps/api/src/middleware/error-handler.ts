import type { Request, Response, NextFunction } from "express";
import { logger, getRequestId } from "../utils/logger.js";
import { loadConfig } from "../config.js";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestId = getRequestId(req);

  logger.error(
    {
      requestId,
      method: req.method,
      path: req.path,
      error: err.message,
      stack: err.stack,
      event: "error",
    },
    `[Error] ${req.method} ${req.path}`,
  );

  // Handle entity too large errors from body parser. Quote the actual
  // configured limit (BODY_LIMIT_MB) rather than a hardcoded string so the
  // 413 response stays accurate when an operator tunes the cap up or down.
  if ("type" in err && err.type === "entity.too.large") {
    const limit = loadConfig().BODY_LIMIT_MB;
    return res.status(413).json({
      success: false,
      error: `Request body too large. Maximum size is ${limit}MB.`,
    });
  }

  res.status(500).json({ success: false, error: "Internal server error" });
}
