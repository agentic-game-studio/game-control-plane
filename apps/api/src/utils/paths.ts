import os from "node:os";

/**
 * Resolve the user's home directory, falling back across HOME / USERPROFILE /
 * os.homedir() and returning null if none of them yield a non-empty value.
 *
 * The previous pattern was `process.env.HOME ?? ""` which silently degraded
 * to `path.join("", "...")` and produced a relative path that would never
 * resolve to a real Godot binary. Callers are expected to handle the null
 * case (skip the candidate) and try the next one in their fallback chain.
 */
export function resolveHomeDir(): string | null {
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    os.homedir(),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) return candidate;
  }
  return null;
}
