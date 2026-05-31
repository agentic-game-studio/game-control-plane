import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = join(__dirname, "../logs");
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_FILE = join(LOG_DIR, "api.log");

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
