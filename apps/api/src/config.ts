import "dotenv/config";
import { z } from "zod";
import { KIMI_DEFAULT_MODEL } from "./config/model-mapping.js";

const envSchema = z
  .object({
    // Kimi provider (optional if ZAI_API_KEY is set)
    KIMI_API_KEY: z.string().optional().default(""),
    KIMI_BASE_URL: z.string().url().default("https://api.kimi.com/coding"),
    // Z.ai provider (optional if KIMI_API_KEY is set)
    ZAI_API_KEY: z.string().optional().default(""),
    ZAI_BASE_URL: z.string().url().default("https://api.z.ai/api/anthropic"),
    // MiroMind deep research provider (optional)
    MIROMIND_API_KEY: z.string().optional().default(""),
    MIROMIND_BASE_URL: z.string().url().default("https://api.miromind.ai"),
    MIROMIND_MODEL: z.string().default("mirothinker-1-7-deepresearch-mini"),
    MIROMIND_RESEARCH_TURNS: z.coerce.number().int().min(1).max(3).default(2),
    API_PORT: z.coerce.number().default(3001),
    API_SECRET: z.string().min(16, "API_SECRET must be at least 16 characters — set it in .env"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    WORKSPACE_DIR: z.string().default("./workspace"),
    DATA_DIR: z.string().optional().default(""),
    REVIEW_MODE: z.enum(["solo", "lean", "full"]).default("lean"),
    DEFAULT_MODEL: z.string().default("glm-5.1"),
    MAX_TOOL_CALLS: z.coerce.number().default(100),
    TOOL_CHECKPOINT_INTERVAL: z.coerce.number().default(30),
    CONTEXT_WINDOW_TOKENS: z.coerce.number().default(256_000),
    // 28-H-config-timeout-positive: previous shape accepted 0 or
    // any negative number. zai-client.ts calls
    // `AbortSignal.timeout(perAttemptTimeoutMs)` which throws
    // `TypeError: AbortSignal.timeout: argument 1 must be a
    // positive integer` — every LLM request crashes with a stack
    // trace and no call succeeds. Clamp to positive integers.
    API_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    BODY_LIMIT_MB: z.coerce.number().default(5),
    WORKFLOW_TTL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
    ASSET_WATCHER_LIMIT: z.coerce.number().default(32),
    RATE_LIMIT_REQUESTS: z.coerce.number().default(10),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    RATE_LIMIT_BUCKET_CAP: z.coerce.number().default(10_000),
    MAX_SSE_CLIENTS: z.coerce.number().default(50),
    MAX_CONCURRENT_SUBAGENTS_PER_PROJECT: z.coerce.number().default(8),
    MAX_VERIFY_FAILURES: z.coerce.number().default(3),
    MAX_DEAD_LETTERED_PER_PROJECT: z.coerce.number().default(50),
    // 11-M6: Express `req.ip` returns the socket address by default —
    // which on a deployment behind a proxy (Railway, nginx, Cloudflare)
    // means every request looks like it comes from the same proxy IP,
    // and the rate limiter effectively does nothing. Setting
    // TRUST_PROXY tells Express to honor X-Forwarded-For. Accepts:
    //   "false" (default, safe — don't trust the header)
    //   "true" (trust all upstream proxies)
    //   a number (trust N hops)
    //   an IP / CIDR (trust only that address)
    // Only enable this when you control the proxy chain; otherwise
    // anyone can spoof their IP.
    TRUST_PROXY: z.string().default("false"),
    ENABLE_TEST_ENDPOINTS: z
      .union([z.literal("true"), z.literal("false")])
      .default("false")
      .transform((v) => v === "true"),
    // 23-M-env-var-zod-coverage: 6 env vars were read directly via
    // `process.env.X` in 5 services (qa-gate-service, build-service,
    // llm-service, shipthis-service, godot-mcp-service, utils/logger)
    // with no Zod validation. Bad values (typo, empty string,
    // non-existent path) would silently fail at the exec site 30+
    // minutes into a run with a generic "spawn ENOENT" error. Add
    // them to the schema with sensible defaults and have the
    // services consume the validated `config.X` instead.
    GODOT_BIN: z.string().optional().default(""),
    SHIPTHIS_BIN: z.string().optional().default(""),
    SHIPTHIS_CLI_PATH: z.string().optional().default(""),
    // 28-M-config-debug-env: "0" or "1" string union — the autonomous
    // loop treats the var as a boolean flag. The default of "0"
    // matches the absence in production.
    DEBUG_AUTONOMOUS: z.union([z.literal("0"), z.literal("1")]).default("0"),
    GODOT_MCP_SERVER_PATH: z.string().optional().default(""),
    // 24-M-env-var-zod-orphan: GODOT_EDITOR_PATH was being read at
    // godot-mcp-service.ts:1151 but was missing from the Zod
    // schema — the runtime and the schema disagreed about what the
    // env var is *named* (the schema had GODOT_BIN but not
    // GODOT_EDITOR_PATH). Add it so the schema is the single source
    // of truth. Default empty string lets the consumer's auto-detect
    // path take over when the env is unset.
    GODOT_EDITOR_PATH: z.string().optional().default(""),
    LOG_TO_FILE: z
      .union([z.literal("true"), z.literal("false")])
      .default("true")
      .transform((v) => v === "true"),
    RAILWAY_ENVIRONMENT_ID: z.string().optional().default(""),
  })
  .superRefine((data, ctx) => {
    const hasZai = data.ZAI_API_KEY.trim().length > 0;
    const hasKimi = data.KIMI_API_KEY.trim().length > 0;
    if (!hasZai && !hasKimi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set ZAI_API_KEY and/or KIMI_API_KEY — at least one LLM provider is required",
        path: ["ZAI_API_KEY"],
      });
    }
  });

let configState: z.infer<typeof envSchema>;

export function loadConfig() {
  if (configState) return configState;

  const raw = {
    KIMI_API_KEY: process.env.KIMI_API_KEY ?? "",
    KIMI_BASE_URL: process.env.KIMI_BASE_URL,
    ZAI_API_KEY: process.env.ZAI_API_KEY ?? "",
    ZAI_BASE_URL: process.env.ZAI_BASE_URL,
    MIROMIND_API_KEY: process.env.MIROMIND_API_KEY ?? "",
    MIROMIND_BASE_URL: process.env.MIROMIND_BASE_URL,
    MIROMIND_MODEL: process.env.MIROMIND_MODEL,
    MIROMIND_RESEARCH_TURNS: process.env.MIROMIND_RESEARCH_TURNS,
    API_PORT: process.env.API_PORT ?? process.env.PORT,
    API_SECRET: process.env.API_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    WORKSPACE_DIR: process.env.WORKSPACE_DIR,
    DATA_DIR: process.env.DATA_DIR,
    REVIEW_MODE: process.env.REVIEW_MODE,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL,
    MAX_TOOL_CALLS: process.env.MAX_TOOL_CALLS,
    TOOL_CHECKPOINT_INTERVAL: process.env.TOOL_CHECKPOINT_INTERVAL,
    CONTEXT_WINDOW_TOKENS: process.env.CONTEXT_WINDOW_TOKENS,
    API_TIMEOUT_MS: process.env.API_TIMEOUT_MS,
    BODY_LIMIT_MB: process.env.BODY_LIMIT_MB,
    WORKFLOW_TTL_MS: process.env.WORKFLOW_TTL_MS,
    ASSET_WATCHER_LIMIT: process.env.ASSET_WATCHER_LIMIT,
    RATE_LIMIT_REQUESTS: process.env.RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_BUCKET_CAP: process.env.RATE_LIMIT_BUCKET_CAP,
    MAX_SSE_CLIENTS: process.env.MAX_SSE_CLIENTS,
    MAX_CONCURRENT_SUBAGENTS_PER_PROJECT: process.env.MAX_CONCURRENT_SUBAGENTS_PER_PROJECT,
    MAX_VERIFY_FAILURES: process.env.MAX_VERIFY_FAILURES,
    MAX_DEAD_LETTERED_PER_PROJECT: process.env.MAX_DEAD_LETTERED_PER_PROJECT,
    TRUST_PROXY: process.env.TRUST_PROXY,
    ENABLE_TEST_ENDPOINTS: process.env.ENABLE_TEST_ENDPOINTS,
    GODOT_BIN: process.env.GODOT_BIN,
    SHIPTHIS_BIN: process.env.SHIPTHIS_BIN,
    SHIPTHIS_CLI_PATH: process.env.SHIPTHIS_CLI_PATH,
    GODOT_MCP_SERVER_PATH: process.env.GODOT_MCP_SERVER_PATH,
    GODOT_EDITOR_PATH: process.env.GODOT_EDITOR_PATH,
    LOG_TO_FILE: process.env.LOG_TO_FILE,
    RAILWAY_ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID,
    // 28-M-config-debug-env: drift between .env.example (L119) and
    // the Zod schema. Documented and read at autonomous.ts:99 but
    // missing here. Add to the schema so loadConfig().DEBUG_AUTONOMOUS
    // returns a typed value instead of `undefined`.
    DEBUG_AUTONOMOUS: process.env.DEBUG_AUTONOMOUS,
  };

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    throw new Error(`Invalid environment:\n${errors.join("\n")}`);
  }

  let parsed = result.data;
  const hasZai = parsed.ZAI_API_KEY.trim().length > 0;
  const hasKimi = parsed.KIMI_API_KEY.trim().length > 0;

  // Kimi-only: default to Kimi model when DEFAULT_MODEL still points at GLM
  if (hasKimi && !hasZai && !parsed.DEFAULT_MODEL.startsWith("kimi-")) {
    parsed = { ...parsed, DEFAULT_MODEL: KIMI_DEFAULT_MODEL };
  }

  configState = parsed;
  return configState;
}

/**
 * Test-only: clear the cached `configState` so the next `loadConfig()`
 * call re-parses `process.env`. Without this, tests that mutate
 * `process.env.WORKSPACE_DIR` (or any other env) AFTER `loadConfig` has
 * been called see the stale cached value.
 *
 * 11-M16: explicitly export this rather than relying on the misleading
 * `void loadConfig()` idiom in tests. Marked with the `__` prefix to
 * make it obvious this is not for production code.
 */
export function __resetConfigForTesting(): void {
  configState = undefined as unknown as z.infer<typeof envSchema>;
}

export type Config = z.infer<typeof envSchema>;

/**
 * Maximum stdout/stderr buffer for `execSync` / `execFileSync` /
 * `spawnSync` calls. 10 MiB is the standard ceiling used across the
 * studio: large enough for an asset-pipeline run or Godot headless
 * output, small enough to fail loudly on a runaway process.
 *
 * 11-M18: centralized so a future tuning change (or per-env override
 * via env var) only edits one site instead of 12.
 */
export const SUBPROCESS_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Resolve the Python interpreter used by the asset / verification /
 * build pipelines. Centralized here so a future change (e.g. moving to a
 * venv) only touches one file. The default is the bare `python3` (PATH
 * lookup) — operators who need a specific interpreter should set
 * PIPELINE_PYTHON in .env.
 */
export function resolvePipelinePython(): string {
  return process.env.PIPELINE_PYTHON?.trim() || "python3";
}

/**
 * Read only the logger-relevant env vars without invoking the full
 * `loadConfig()` chain. `utils/logger.ts` runs at module-load time —
 * before `loadConfig()` has been called by any other module — and
 * pulling in the full schema (which validates `API_SECRET` min-length
 * 16) would force the logger to be the canary for missing config,
 * which it doesn't actually need. Just the two logger keys.
 *
 * 24-M-env-var-drift: this is the canonical place for logger.ts to
 * read LOG_TO_FILE and RAILWAY_ENVIRONMENT_ID now that the 23rd pass
 * added both to the Zod schema. The schema owns the type, default,
 * and (potential future) transforms; the logger just consumes the
 * values.
 */
export interface LoggerConfig {
  logToFile: boolean;
  isRailway: boolean;
}
export function readLoggerConfig(): LoggerConfig {
  // Parse the two keys directly. We don't go through envSchema here
  // because the logger module is loaded at process boot, before
  // `loadConfig()` has a chance to validate API_SECRET and the other
  // required keys. The full Zod parse is still the source of truth for
  // other consumers; this is the side door for the one module that
  // needs the values before validation completes.
  const logToFileRaw = process.env.LOG_TO_FILE;
  const railwayRaw = process.env.RAILWAY_ENVIRONMENT_ID;
  return {
    // Default true (matches the Zod schema default). Only the literal
    // string "false" disables file logs — empty string, unset, and
    // anything else all mean "enabled".
    logToFile: logToFileRaw !== "false",
    // Default false. Truthy iff RAILWAY_ENVIRONMENT_ID is a non-empty
    // string. Same semantics the inline `!process.env.X` check used
    // before.
    isRailway: !!railwayRaw && railwayRaw.trim().length > 0,
  };
}
