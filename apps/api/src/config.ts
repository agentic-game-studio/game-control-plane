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
    API_PORT: z.coerce.number().default(3001),
    API_SECRET: z.string().min(16, "API_SECRET must be at least 16 characters — set it in .env"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    WORKSPACE_DIR: z.string().default("./workspace"),
    REVIEW_MODE: z.enum(["solo", "lean", "full"]).default("lean"),
    DEFAULT_MODEL: z.string().default("glm-5.1"),
    MAX_TOOL_CALLS: z.coerce.number().default(100),
    TOOL_CHECKPOINT_INTERVAL: z.coerce.number().default(30),
    CONTEXT_WINDOW_TOKENS: z.coerce.number().default(256_000),
    API_TIMEOUT_MS: z.coerce.number().default(120_000),
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
    GODOT_MCP_SERVER_PATH: z.string().optional().default(""),
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
    API_PORT: process.env.API_PORT ?? process.env.PORT,
    API_SECRET: process.env.API_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    WORKSPACE_DIR: process.env.WORKSPACE_DIR,
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
    LOG_TO_FILE: process.env.LOG_TO_FILE,
    RAILWAY_ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID,
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
