import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { readLoggerConfig } from "../config.js";

/**
 * Extract a stable request ID from incoming headers, falling back to a
 * fresh random UUID when none is supplied. Centralized so the request
 * logger middleware and any future cross-cutting middleware (error
 * handler, request validator) agree on the same header precedence:
 * x-request-id → x-correlation-id → generated.
 *
 * 10-M6: previously this returned `randomUUID().slice(0, 8)` — that's
 * only 32 bits of entropy. With ~10 RPS sustained traffic, collisions
 * become statistically likely in roughly 12 hours. Use the full 128-bit
 * UUID; log lines and correlation IDs aren't user-visible so the extra
 * characters cost nothing.
 */
export function getRequestId(req: Request): string {
  const headerVal = req.headers["x-request-id"] ?? req.headers["x-correlation-id"];
  if (typeof headerVal === "string" && headerVal.length > 0) return headerVal;
  if (Array.isArray(headerVal) && headerVal.length > 0 && headerVal[0]) return headerVal[0];
  return randomUUID();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = join(__dirname, "../logs");
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_FILE = join(LOG_DIR, "api.log");
// 24-M-env-var-drift: read LOG_TO_FILE and RAILWAY_ENVIRONMENT_ID
// from the Zod-validated config via `readLoggerConfig()` instead of
// the inline `process.env.X` checks. The 23rd pass added both to the
// Zod schema (config.ts:62-65) but didn't migrate this consumer —
// the logger module is the one place that runs before
// `loadConfig()` is callable (it would force a circular import with
// the pino transports), so we expose a `readLoggerConfig()` side
// door in config.ts. Semantics are preserved: `LOG_TO_FILE !== "false"`
// is true for empty/unset (file logs on) and false only for the
// literal string "false"; `!RAILWAY_ENVIRONMENT_ID` is true when the
// var is unset or empty.
const { logToFile, isRailway } = readLoggerConfig();
const enableFileLogs = logToFile && !isRailway;

const transport = pino.transport({
  targets: [
    {
      level: "info",
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
    ...(enableFileLogs
      ? [
          {
            level: "info",
            target: "pino-file-transport",
            options: {
              path: LOG_FILE,
              rotation: { maxSize: 50, frequency: "daily", logging: false },
              retention: { duration: "7d", logging: false },
            },
          },
          {
            level: "error",
            target: "pino-file-transport",
            options: {
              path: join(LOG_DIR, "error.log"),
              rotation: { maxSize: 20, frequency: "daily", logging: false },
              retention: { duration: "14d", logging: false },
            },
          },
        ]
      : []),
  ],
});

export const logger = pino(
  {
    level: "info",
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  transport,
);

export const getLogger = () => logger;

export interface RunMetadata {
  pid: number;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  arch: string;
  service: string;
}

export interface StartupMetadata extends RunMetadata {
  port: number;
  workspaceDir: string;
  cORSOrigin: string;
  env: string;
}

export interface ShutdownMetadata {
  pid: number;
  uptimeSeconds: number;
  signal: string;
  graceful: boolean;
}

export function logStartup(meta: StartupMetadata): void {
  logger.info({ ...meta, event: "startup" }, "Server started");
}

export function logShutdown(meta: ShutdownMetadata): void {
  logger.info({ ...meta, event: "shutdown" }, "Server shutdown");
}

export function createRequestLogger(requestId: string, correlationId?: string) {
  return {
    start(method: string, path: string) {
      logger.info({ requestId, correlationId, method, path, event: "request_start" }, `→ ${method} ${path}`);
    },
    complete(method: string, path: string, statusCode: number, durationMs: number) {
      const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
      logger[level](
        { requestId, correlationId, method, path, statusCode, durationMs, event: "request_complete" },
        `← ${method} ${path} ${statusCode} (${durationMs}ms)`,
      );
    },
    error(method: string, path: string, error: string, durationMs: number) {
      logger.error(
        { requestId, correlationId, method, path, error, durationMs, event: "request_error" },
        `✗ ${method} ${path} failed: ${error} (${durationMs}ms)`,
      );
    },
  };
}
