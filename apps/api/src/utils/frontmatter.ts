/**
 * YAML-ish frontmatter parser shared by the agent prompt loader and
 * the document store. Two consumers historically reimplemented the
 * same logic (agent-prompt-loader.ts:27 and document-store.ts:48),
 * and the duplication was a divergent-fix risk: a future change to
 * quoted-value handling, list parsing, or a security fix in one
 * helper would silently leave the other consumer behind. Now both
 * import this single implementation.
 *
 * Grammar: a leading `---` line, then `key: value` lines (one per
 * line), then a closing `---` line, then the markdown body. Values
 * are string or `[a, b, c]` (inline array). Lists are trimmed and
 * surrounding quotes are stripped from each element so a value like
 * `[foo, "bar", baz]` becomes `["foo", "bar", "baz"]` rather than
 * the older shape of `["foo", '"bar"', "baz"]` (the embedded quotes
 * previously leaked into agent `tools` lists and silently failed to
 * match the allowlist intersection).
 *
 * This is intentionally a small subset of YAML — quote-aware value
 * parsing, list-of-maps, and escape sequences are out of scope. If
 * a workspace file uses them, the value will be parsed as a string
 * with the literal characters preserved.
 */
export interface ParsedFrontmatter {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const raw = match[1];
  const body = match[2];
  const result: Record<string, string | string[]> = {};

  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    } else {
      result[key] = value;
    }
  }

  return { frontmatter: result, body };
}
