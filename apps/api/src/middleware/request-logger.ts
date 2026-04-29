import type { Request, Response, NextFunction } from "express";
import { createRequestLogger } from "../utils/logger.js";

export interface RequestLogOptions {
  logBody?: boolean;
  excludePaths?: string[];
}

const DEFAULT_EXCLUDE = ["/health", "/ws"];

export function requestLogger(options: RequestLogOptions = {}): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  const excludePaths = new Set([...DEFAULT_EXCLUDE, ...(options.excludePaths ?? [])]);

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path;

    if (excludePaths.has(path)) {
      next();
      return;
    }

    const requestId = req.headers["x-request-id"] as string
      ?? req.headers["x-correlation-id"] as string
      ?? crypto.randomUUID().slice(0, 8);

    const correlationId = req.headers["x-correlation-id"] as string | undefined;

    const startTime = Date.now();
    const reqLogger = createRequestLogger(requestId, correlationId);

    reqLogger.start(req.method, path);

    const originalEnd = res.end;
    res.end = function (
      this: Response,
      ...args: Parameters<Response["end"]>
    ): ReturnType<typeof originalEnd> {
      const durationMs = Date.now() - startTime;
      reqLogger.complete(req.method, path, res.statusCode, durationMs);
      return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
    } as typeof originalEnd;

    next();
  };
}
