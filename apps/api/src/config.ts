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
    ENABLE_TEST_ENDPOINTS: z
      .union([z.literal("true"), z.literal("false")])
      .default("false")
      .transform((v) => v === "true"),
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
    ENABLE_TEST_ENDPOINTS: process.env.ENABLE_TEST_ENDPOINTS,
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

export type Config = z.infer<typeof envSchema>;
