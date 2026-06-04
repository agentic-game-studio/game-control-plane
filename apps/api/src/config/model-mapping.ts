/**
 * Model tier to LLM model mapping
 * Default: all tiers → GLM (Z.ai)
 * When KIMI_API_KEY is set: tiers route to Kimi models (Anthropic-compatible API)
 */

import { loadConfig } from "../config.js";

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
 * Uses Kimi mapping when KIMI_API_KEY is set in the validated config.
 *
 * 25-M-env-var-drift: previously read `process.env.KIMI_API_KEY`
 * directly. The 23rd pass added it to the Zod schema but missed
 * this consumer. The schema default is `""` and the consumer's
 * check (Boolean(env.trim())) is preserved: only a non-empty
 * value flips the Kimi mapping on. `loadConfig()` is called
 * per-invocation (these helpers are called once per LLM
 * request, not in a hot loop), so the validation cost is
 * negligible.
 */
export function getModelForTier(tier: string): string {
  const key = tier.toLowerCase();
  const useKimi = Boolean(loadConfig().KIMI_API_KEY?.trim());
  const map = useKimi ? KIMI_MODEL_MAPPING : MODEL_MAPPING;
  return map[key] ?? (useKimi ? KIMI_DEFAULT_MODEL : DEFAULT_MODEL);
}

/**
 * Get the context window size in tokens for a model (env override takes priority).
 *
 * 25-M-env-var-drift: same pattern as getModelForTier. The
 * Zod schema's `CONTEXT_WINDOW_TOKENS` field has type
 * `number` (coerced from string) and a default of 256_000. The
 * previous implementation read the raw string and re-parsed it
 * with Number() — that was redundant work the schema already
 * did. Pass the parsed number straight through. A non-positive
 * or NaN value (which would only happen if someone overrides
 * the schema default — `coerce.number()` accepts "0" or "abc")
 * falls back to the per-model default.
 */
export function getModelContextWindow(model: string): number {
  const envOverride = loadConfig().CONTEXT_WINDOW_TOKENS;
  if (envOverride > 0 && Number.isFinite(envOverride)) return envOverride;
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
