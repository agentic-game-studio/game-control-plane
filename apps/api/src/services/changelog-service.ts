/**
 * Changelog generation from completed tickets and version bumps.
 */

import { readTicketsBoard } from "./ticket-board.js";
import { readProjectVersion } from "./qa-gate-service.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// 27-L-changelog-cap-const: hoist the completed-tickets slice cap
// to a named constant. The same pattern was applied to gateVerdicts,
// toolsCache, lastGatedByProject, ticketProjectCache, and usageLog
// in earlier passes — a magic 30 inline forced any future bump to
// happen in two places. Exposed for tests to assert the cap.
const MAX_CHANGELOG_COMPLETED = 30;

export async function generateProjectChangelog(projectId: string, workspacePath: string): Promise<string> {
  const board = await readTicketsBoard(projectId);
  const completed = board.columns.find((c) => c.id === "completed")?.tickets ?? [];
  const version = readProjectVersion(resolveProjectWorkspace(workspacePath));
  const date = new Date().toISOString().slice(0, 10);

  const lines = [
    `# Changelog — ${projectId}`,
    ``,
    `## v${version} (${date})`,
    ``,
    `### Completed`,
    ...completed.slice(-MAX_CHANGELOG_COMPLETED).map((t) => `- ${t.title} (${t.area})`),
    ``,
  ];

  const changelog = lines.join("\n");
  const projectPath = resolveProjectWorkspace(workspacePath);
  const outDir = join(projectPath, "production");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "CHANGELOG.md"), changelog, "utf-8");

  return changelog;
}
