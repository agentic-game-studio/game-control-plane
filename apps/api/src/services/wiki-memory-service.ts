/**
 * Externalize autonomous production decisions to workspace wiki/docs.
 */

import { existsSync, mkdirSync } from "fs";
import { promises as fs } from "fs";
import { join, resolve, relative, sep } from "path";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

/** Reject user-controlled path segments that could escape the workspace.
 * Whitelist: letters, digits, dash, underscore, dot. Anything else
 * (slashes, backslashes, NUL, .., etc.) is rejected. The category is
 * typically a short slug like "milestone-gate", so a restrictive
 * charset is appropriate. */
function sanitizeSegment(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`externalizeProductionNote: ${label} is required`);
  }
  if (value.length > 128) {
    throw new Error(`externalizeProductionNote: ${label} is too long (max 128 chars)`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`externalizeProductionNote: ${label} contains invalid characters (allowed: A-Z a-z 0-9 . _ -)`);
  }
  if (value === "." || value === "..") {
    throw new Error(`externalizeProductionNote: ${label} cannot be "." or ".."`);
  }
  return value;
}

/** Resolve a path under the workspace and verify the result is still
 * inside it. Defends against symlink-based escapes where, e.g.,
 * `workspace/docs` is a symlink to /etc. */
function safeUnderWorkspace(candidate: string, workspaceDir: string): string {
  const resolved = resolve(workspaceDir, candidate);
  const rel = relative(workspaceDir, resolved);
  if (rel === "" || rel.startsWith(".." + sep) || rel === ".." || /^([/\\]|[a-zA-Z]:[\\/])/.test(rel)) {
    throw new Error(`externalizeProductionNote: path escapes workspace: ${candidate}`);
  }
  return resolved;
}

export async function externalizeProductionNote(
  projectId: string,
  category: string,
  note: string,
): Promise<void> {
  // Sanitize user-controlled path segments FIRST, before they reach `join`.
  // A projectId of "../../etc" or category of "x/y" would otherwise produce
  // a path outside WORKSPACE_DIR — and the file-write side effect (real
  // appendFile to a path the process can reach) is the security issue.
  const safeProjectId = sanitizeSegment(projectId, "projectId");
  const safeCategory = sanitizeSegment(category, "category");

  if (typeof note !== "string") {
    throw new Error("externalizeProductionNote: note must be a string");
  }

  const config = loadConfig();
  const workspaceDir = resolve(config.WORKSPACE_DIR);

  const dir = safeUnderWorkspace(join(workspaceDir, safeProjectId, "production"), workspaceDir);
  if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true });

  const decisionsPath = safeUnderWorkspace(join(dir, "decisions.md"), workspaceDir);
  const wikiPath = safeUnderWorkspace(
    join(workspaceDir, "docs", "architecture", `${safeProjectId}-production-log.md`),
    workspaceDir,
  );
  const wikiDir = safeUnderWorkspace(join(workspaceDir, "docs", "architecture"), workspaceDir);
  if (!existsSync(wikiDir)) await fs.mkdir(wikiDir, { recursive: true });

  const line = `\n## ${new Date().toISOString()} — ${safeCategory}\n\n${note.trim()}\n`;
  // Run both appends in parallel — they hit different files and have no
  // dependency on each other. Use fs.appendFile (async) rather than
  // appendFileSync so the event loop is not blocked on disk I/O during
  // a long autonomous production note dump.
  //
  // Q9-12: use allSettled so one disk failure (EACCES on the decisions
  // log, ENOSPC on the wiki) doesn't take down the other. With Promise.all
  // a single rejection short-circuits and the second file is never written
  // — a half-logged note is worse than a logged failure.
  const results = await Promise.allSettled([
    fs.appendFile(decisionsPath, line, "utf-8"),
    fs.appendFile(wikiPath, line, "utf-8"),
  ]);
  // Surface non-fatal write failures so an operator can investigate
  // without the error being silent. Both files are best-effort, so
  // we don't throw — we just log the first rejection.
  for (const result of results) {
    if (result.status === "rejected") {
      // 23-M-wiki-memory-event-convention: add the `event:`
      // discriminator used by the rest of the codebase. An operator
      // grepping for `event:"wiki_memory_append_failed"` (the
      // natural namespace) would have found nothing — they had to
      // grep the literal log message, which is fragile across
      // refactors of the message string.
      logger.warn(
        {
          err: result.reason instanceof Error ? result.reason.message : String(result.reason),
          event: "wiki_memory_append_failed",
        },
        "wiki-memory appendFile failed — note partially persisted",
      );
    }
  }
}
