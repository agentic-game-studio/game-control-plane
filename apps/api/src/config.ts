import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  ZAI_API_KEY: z.string().min(1, "ZAI_API_KEY is required"),
  ZAI_BASE_URL: z.string().url().default("https://api.z.ai/api/anthropic"),
  API_PORT: z.coerce.number().default(3001),
  API_SECRET: z.string().min(8).default("dev-secret"),
  WORKSPACE_DIR: z.string().default("./workspace"),
  REVIEW_MODE: z.enum(["solo", "lean", "full"]).default("lean"),
  DEFAULT_MODEL: z.string().default("glm-5.1"),
  MAX_TOOL_CALLS: z.coerce.number().default(100),
  TOOL_CHECKPOINT_INTERVAL: z.coerce.number().default(30),
});

let configState: z.infer<typeof envSchema>;

export function loadConfig() {
  if (configState) return configState;

  const raw = {
    ZAI_API_KEY: process.env.ZAI_API_KEY ?? "",
    ZAI_BASE_URL: process.env.ZAI_BASE_URL,
    API_PORT: process.env.API_PORT,
    API_SECRET: process.env.API_SECRET,
    WORKSPACE_DIR: process.env.WORKSPACE_DIR,
    REVIEW_MODE: process.env.REVIEW_MODE,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL,
    MAX_TOOL_CALLS: process.env.MAX_TOOL_CALLS,
    TOOL_CHECKPOINT_INTERVAL: process.env.TOOL_CHECKPOINT_INTERVAL,
  };

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    throw new Error(`Invalid environment:\n${errors.join("\n")}`);
  }

  configState = result.data;
  return configState;
}

export type Config = z.infer<typeof envSchema>;