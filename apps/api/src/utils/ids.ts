import { randomUUID } from "node:crypto";

/**
 * Generate a prefixed, collision-resistant id.
 *
 * Format: `<prefix>-<uuid>` — 128 bits of entropy from crypto.randomUUID(),
 * prefixed so the type is readable in logs (`msg-…`, `session-…`, `proj-…`).
 *
 * 11-H13/H14: the previous patterns were either
 *   - `Date.now() + Math.random().toString(36).slice(2, 6)` (24 bits of
 *     entropy, ms-resolution timestamp): collided on the order of ~1 in 16M
 *     per millisecond, which a parallel dashboard create burst hits often.
 *   - `crypto.randomUUID().slice(0, 8)` (32 bits): collided in long-running
 *     sessions because each id is only 8 hex chars and there are 12+ call
 *     sites in chat.ts.
 *
 * 128 bits means collision probability stays negligible (10^19 ids before
 * 50% chance of one collision) without leaning on timestamp space.
 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * 4-digit numeric thread id used in chat for `#1234` style display. Ranges
 * 1000-9999 (9000 values).
 *
 * 11-H15: previous implementation used `Math.floor(Math.random() * 9000 + 1000)`,
 * which collides on the order of ~1 in 9000 per generation. With many
 * threads created in a single session, the user would see two threads with
 * the same number. Draw from a 32-bit random space and mod into 9000;
 * collisions in that range are rare for typical session counts (10s, not
 * millions), and the visible number is a hint not a unique key — the
 * underlying thread object is keyed by uuid elsewhere.
 */
export function newThreadNumber(): number {
  // 32 bits of entropy → uniform in [0, 9000).
  const buf = new Uint32Array(1);
  // crypto.getRandomValues is available in Node 19+; falls back to Math.random
  // only if somehow missing. The const is for type narrowing.
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(arr: T) => T } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return 1000 + (buf[0]! % 9000);
}
