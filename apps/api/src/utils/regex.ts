/**
 * Escape every regex metacharacter in a literal string so it can be
 * embedded into a `new RegExp(...)` source as a literal match. Mirrors
 * the standard MDN-recommended character class; missing the escape on
 * a single metacharacter (most commonly a `.` in a path) would change
 * the match semantics silently.
 *
 * Extracted from chat.ts and llm-service.ts in 31-M-duplicate-escape
 * to eliminate the divergent-fix bait of two identical definitions.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
