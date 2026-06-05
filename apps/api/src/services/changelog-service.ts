/**
 * Changelog generation from completed tickets and version bumps.
 */

import { readTicketsBoard } from "./ticket-board.js";
import { readProjectVersion } from "./qa-gate-service.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { mkdir, writeFile } from "fs/promises";
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
  // 28-H-changelog-async-io: readProjectVersion is now async (28-H-qa-gate-async-version-helpers)
  // and mkdir/writeFile were converted from sync. The whole function
  // is now event-loop clean.
  const projectPath = resolveProjectWorkspace(workspacePath);
  const version = await readProjectVersion(projectPath);
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
  const outDir = join(projectPath, "production");
  // mkdir with recursive: true is a no-op if the dir already exists.
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "CHANGELOG.md"), changelog, "utf-8");

  return changelog;
}
