import type { ContextUsage } from "@game-studio/types";

/**
 * Producer LLM history budget — keep aligned with MAX_CONTEXT_CHARS in
 * apps/api/src/routes/chat.ts (pruneConversationHistory).
 */
export const PRODUCER_CONTEXT_WINDOW_CHARS = 500_000;

/** Default producer model class (glm-5.1) — UI bar compares estimated usage to this. */
export const PRODUCER_MODEL_CONTEXT_TOKENS = 200_000;

/** Rough chars→tokens for the Context bar only (no tokenizer on the client). */
export const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 4;

/** Fill percent from real API-reported token usage (ground truth) */
export function contextFillPercentFromUsage(contextUsage: ContextUsage | undefined | null): number {
  if (!contextUsage || !contextUsage.contextWindowTokens) return 0;
  return Math.min(100, Math.round(
    (contextUsage.lastInputTokens / contextUsage.contextWindowTokens) * 100
  ));
}

/** Approximate serialized size of persisted conversationHistory entries.
 * Mirrors the server's `pruneConversationHistory` estimator in
 * apps/api/src/routes/chat.ts:215 — every non-text content block
 * (tool_use, tool_result, image, etc.) is estimated at
 * NON_TEXT_BLOCK_ESTIMATE_CHARS. The previous client shape returned
 * 0 for any non-string content, so the UI's "12% full" could mask a
 * server-side "40%+ and pruning" — pruning still happened, but the
 * bar lied about how close to the wall the session was. */
const NON_TEXT_BLOCK_ESTIMATE_CHARS = 1000;

export function countConversationHistoryChars(
  history: Array<{ content?: unknown }> | undefined | null
): number {
  if (!history?.length) return 0;
  return history.reduce((sum, m) => {
    const c = m.content;
    if (typeof c === "string") return sum + c.length;
    if (Array.isArray(c)) {
      return (
        sum +
        c.reduce((s, item) => {
          if (item && typeof item === "object" && item !== null && "type" in item) {
            const block = item as { type: unknown; text?: unknown };
            if (block.type === "text" && typeof block.text === "string") {
              return s + block.text.length;
            }
          }
          return s + NON_TEXT_BLOCK_ESTIMATE_CHARS;
        }, 0)
      );
    }
    return sum;
  }, 0);
}

export function estimateConversationTokensFromHistory(
  history: Array<{ content?: unknown }> | undefined | null
): number {
  const chars = countConversationHistoryChars(history);
  return Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE);
}

/** Fill % of producer model window from persisted history (token estimate). */
export function producerModelContextFillPercent(
  history: Array<{ content?: unknown }> | undefined | null
): number {
  const est = estimateConversationTokensFromHistory(history);
  return Math.min(100, Math.round((est / PRODUCER_MODEL_CONTEXT_TOKENS) * 100));
}
