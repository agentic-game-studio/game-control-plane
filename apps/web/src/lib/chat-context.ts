/**
 * Producer LLM history budget — keep aligned with MAX_CONTEXT_CHARS in
 * apps/api/src/routes/chat.ts (pruneConversationHistory).
 */
export const PRODUCER_CONTEXT_WINDOW_CHARS = 500_000;

/** Default producer model class (glm-5.1) — UI bar compares estimated usage to this. */
export const PRODUCER_MODEL_CONTEXT_TOKENS = 200_000;

/** Rough chars→tokens for the Context bar only (no tokenizer on the client). */
export const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 4;

/** Approximate serialized size of persisted conversationHistory entries */
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
          if (item && typeof item === "object" && item !== null && "content" in item) {
            const inner = (item as { content: unknown }).content;
            return s + (typeof inner === "string" ? inner.length : 0);
          }
          return s;
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
