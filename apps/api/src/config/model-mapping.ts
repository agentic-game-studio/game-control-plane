/**
 * Model tier to LLM model mapping
 * Default: all tiers → GLM (Z.ai)
 * When KIMI_API_KEY is set: tiers route to Kimi models (Anthropic-compatible API)
 */

export const MODEL_MAPPING: Record<string, string> = {
  opus: "glm-5.1",
  sonnet: "glm-4.7",
  haiku: "glm-4.7-flash",
};

/** Kimi tier mapping when KIMI_API_KEY is configured */
export const KIMI_MODEL_MAPPING: Record<string, string> = {
  opus: "kimi-for-coding",
  sonnet: "kimi-k2.6",
  haiku: "kimi-k2-turbo-preview",
};

export const DEFAULT_MODEL = "glm-5.1";
export const KIMI_DEFAULT_MODEL = "kimi-for-coding";

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
  "glm-5.0": 200_000,
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
 * Get the LLM model name for a given tier.
 * Uses Kimi mapping when KIMI_API_KEY is set in the environment.
 */
export function getModelForTier(tier: string): string {
  const key = tier.toLowerCase();
  const useKimi = Boolean(process.env.KIMI_API_KEY?.trim());
  const map = useKimi ? KIMI_MODEL_MAPPING : MODEL_MAPPING;
  return map[key] ?? (useKimi ? KIMI_DEFAULT_MODEL : DEFAULT_MODEL);
}

/** Get the context window size in tokens for a model (env override takes priority) */
export function getModelContextWindow(model: string): number {
  const envOverride = process.env.CONTEXT_WINDOW_TOKENS;
  if (envOverride) {
    const val = Number(envOverride);
    if (val > 0 && Number.isFinite(val)) return val;
  }
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
