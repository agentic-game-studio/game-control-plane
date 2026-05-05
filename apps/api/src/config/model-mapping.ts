/**
 * Model tier to Z.ai model mapping
 */

export const MODEL_MAPPING: Record<string, string> = {
  opus: "glm-5.1",
  sonnet: "glm-4.7",
  haiku: "glm-4.7-flash",
};

export const DEFAULT_ZAI_MODEL = "glm-5.1";

/**
 * Context window size in tokens for each Z.ai model
 * Overridable via CONTEXT_WINDOW_TOKENS env var
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "glm-5.1": 200_000,
  "glm-4.7": 200_000,
  "glm-4.7-flash": 128_000,
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Token thresholds for context management (converted from char-based)
 * chars / CHARS_PER_TOKEN_ESTIMATE ≈ tokens
 */
export const MAX_CONTEXT_TOKENS = 125_000;
export const SUMMARIZE_TOKEN_THRESHOLD = 100_000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Get the Z.ai model name for a given tier
 */
export function getZaiModel(tier: string): string {
  return MODEL_MAPPING[tier.toLowerCase()] ?? DEFAULT_ZAI_MODEL;
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
