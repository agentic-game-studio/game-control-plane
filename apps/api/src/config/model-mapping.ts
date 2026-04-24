/**
 * Model tier to Z.ai model mapping
 */

export const MODEL_MAPPING: Record<string, string> = {
  opus: "glm-5.1",
  sonnet: "glm-4.7",
  haiku: "glm-4",
};

export const DEFAULT_ZAI_MODEL = "glm-5.1";

/**
 * Get the Z.ai model name for a given tier
 */
export function getZaiModel(tier: string): string {
  return MODEL_MAPPING[tier.toLowerCase()] ?? DEFAULT_ZAI_MODEL;
}
