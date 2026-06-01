/**
 * Externalize autonomous production decisions to workspace wiki/docs.
 */

import { existsSync, mkdirSync } from "fs";
import { promises as fs } from "fs";
import { join } from "path";
import { loadConfig } from "../config.js";

export async function externalizeProductionNote(
  projectId: string,
  category: string,
  note: string,
): Promise<void> {
  const config = loadConfig();
  const dir = join(config.WORKSPACE_DIR, projectId, "production");
  if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true });

  const decisionsPath = join(dir, "decisions.md");
  const wikiPath = join(config.WORKSPACE_DIR, "docs", "architecture", `${projectId}-production-log.md`);
  const wikiDir = join(config.WORKSPACE_DIR, "docs", "architecture");
  if (!existsSync(wikiDir)) await fs.mkdir(wikiDir, { recursive: true });

  const line = `\n## ${new Date().toISOString()} — ${category}\n\n${note.trim()}\n`;
  // Run both appends in parallel — they hit different files and have no
  // dependency on each other. Use fs.appendFile (async) rather than
  // appendFileSync so the event loop is not blocked on disk I/O during
  // a long autonomous production note dump.
  await Promise.all([
    fs.appendFile(decisionsPath, line, "utf-8"),
    fs.appendFile(wikiPath, line, "utf-8"),
  ]);
}
