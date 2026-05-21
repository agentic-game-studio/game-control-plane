import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.headers["x-request-id"] as string
    ?? req.headers["x-correlation-id"] as string
    ?? "unknown";

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

  // Handle entity too large errors from body parser
  if ("type" in err && err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Request body too large. Maximum size is 50MB.",
    });
  }

  res.status(500).json({ success: false, error: "Internal server error" });
}
