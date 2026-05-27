/**
 * Externalize autonomous production decisions to workspace wiki/docs.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config.js";

export async function externalizeProductionNote(
  projectId: string,
  category: string,
  note: string,
): Promise<void> {
  const config = loadConfig();
  const dir = join(config.WORKSPACE_DIR, projectId, "production");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const decisionsPath = join(dir, "decisions.md");
  const wikiPath = join(config.WORKSPACE_DIR, "docs", "architecture", `${projectId}-production-log.md`);
  const wikiDir = join(config.WORKSPACE_DIR, "docs", "architecture");
  if (!existsSync(wikiDir)) mkdirSync(wikiDir, { recursive: true });

  const line = `\n## ${new Date().toISOString()} — ${category}\n\n${note.trim()}\n`;
  appendFileSync(decisionsPath, line, "utf-8");
  appendFileSync(wikiPath, line, "utf-8");
}
