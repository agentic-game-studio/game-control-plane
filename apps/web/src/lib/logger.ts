/**
 * Centralized client-side logger.
 *
 * Frontend code has dozens of `console.error("Failed to fetch X:", err)`
 * call sites. Routing them through one helper gives us:
 *  - a single format (tag prefix + structured fields) so the browser
 *    devtools / Sentry-style sinks can be filtered consistently
 *  - one place to add a log level gate (e.g. hide `debug` in prod)
 *  - one place to swap the transport later (Sentry, Datadog, etc.)
 *    without grepping the codebase
 *
 * The transport is still `console.*` — this is intentional. The
 * backend has a pino logger because it does structured logging
 * server-side. The frontend doesn't need that here; a thin wrapper
 * that just normalizes format and tag prefixes is enough.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function getMinLevel(): number {
  // In dev: all levels through info. In prod: warn + error only.
  return isDev() ? LEVEL_ORDER.debug : LEVEL_ORDER.warn;
}

function formatPrefix(tag: string, level: LogLevel): string {
  return `[${tag}]`;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= getMinLevel();
}

function serializeFields(fields?: LogFields): unknown[] {
  if (!fields) return [];
  // console.error auto-formats objects nicely; the goal here is to make
  // the call site `logger.error("msg", { foo: 1 })` land in the devtools
  // as a structured entry, not a string-concatenated mess.
  return [fields];
}

export interface Logger {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
}

export function createLogger(tag: string): Logger {
  return {
    debug(msg, fields) {
      if (!shouldLog("debug")) return;
      console.debug(formatPrefix(tag, "debug"), msg, ...serializeFields(fields));
    },
    info(msg, fields) {
      if (!shouldLog("info")) return;
      console.info(formatPrefix(tag, "info"), msg, ...serializeFields(fields));
    },
    warn(msg, fields) {
      if (!shouldLog("warn")) return;
      console.warn(formatPrefix(tag, "warn"), msg, ...serializeFields(fields));
    },
    error(msg, fields) {
      if (!shouldLog("error")) return;
      console.error(formatPrefix(tag, "error"), msg, ...serializeFields(fields));
    },
  };
}
