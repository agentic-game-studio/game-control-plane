/**
 * Model tier to LLM model mapping
 * Hybrid: opus → Kimi K2.6, sonnet/haiku → GLM 5.1 (Z.ai)
 */

export const MODEL_MAPPING: Record<string, string> = {
  opus: "kimi-for-coding",
  sonnet: "glm-5.1",
  haiku: "glm-5.1",
};

export const DEFAULT_MODEL = "kimi-for-coding";

/**
 * Context window size in tokens for each model
 * Overridable via CONTEXT_WINDOW_TOKENS env var
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "kimi-for-coding": 256_000,
  "kimi-k2.6": 256_000,
  "kimi-k2.5": 256_000,
  "kimi-k2-turbo-preview": 128_000,
  "glm-5.1": 200_000,
  "glm-4.7": 200_000,
  "glm-4.7-flash": 128_000,
};

export const DEFAULT_CONTEXT_WINDOW = 256_000;

/**
 * Token thresholds for context management (converted from char-based)
 * chars / CHARS_PER_TOKEN_ESTIMATE ≈ tokens
 */
export const MAX_CONTEXT_TOKENS = 125_000;
export const SUMMARIZE_TOKEN_THRESHOLD = 100_000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Get the LLM model name for a given tier
 */
export function getModelForTier(tier: string): string {
  return MODEL_MAPPING[tier.toLowerCase()] ?? DEFAULT_MODEL;
}

/** Get the context window size in tokens for a model (env override takes priority) */
export function getModelContextWindow(model: string): number {
  const envOverride = process.env.CONTEXT_WINDOW_TOKENS;
  if (envOverride) {
    const val = Number(envOverride);
    if (val > 0) return val;
  }
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
