/**
 * Externalize autonomous production decisions to workspace wiki/docs.
 *
 * Path-traversal protection: any path derived from user-controlled input
 * (projectId, category) is anchored to WORKSPACE_DIR via realpath + relative
 * check. We never trust the raw `..` substring, which is bypassable via
 * paths like `/etc/..` or `..foo`.
 */

import { existsSync, mkdirSync } from "fs";
import { promises as fs } from "fs";
import { join, resolve, relative, sep } from "path";
import { loadConfig } from "../config.js";

/** Resolve a project's workspacePath to an absolute filesystem path.
 *
 * The function enforces two invariants regardless of input shape:
 * 1. The resolved path must lie inside WORKSPACE_DIR.
 * 2. If the resolved path already exists, its realpath (after following
 *    symlinks) must also lie inside WORKSPACE_DIR. This blocks symlink-based
 *    escapes where, e.g., `workspace/godot-test-1` is a symlink to `/etc`.
 */
export function resolveProjectWorkspace(workspacePath: string): string {
  if (!workspacePath) throw new Error("workspacePath is required");

  const config = loadConfig();
  const workspaceDir = resolve(config.WORKSPACE_DIR);

  // Forbid NUL bytes early — `path.resolve` would otherwise silently strip
  // them, masking an attack.
  if (workspacePath.includes("\0")) {
    throw new Error(`Path contains NUL byte: ${workspacePath}`);
  }

  const resolved = resolve(workspaceDir, workspacePath);
  // First pass: compare the unresolved `resolved` against the unresolved
  // `workspaceDir`. This catches the obvious escapes (`../etc`, `/etc/...`)
  // without needing the workspace to exist on disk yet.
  const rel = relative(workspaceDir, resolved);
  if (!(rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !pathIsAbsolute(rel)))) {
    throw new Error(`Path traversal not allowed: ${workspacePath}`);
  }

  // Second pass: if the resolved path exists, realpath it AND realpath the
  // workspace root, then compare the two realpaths. On macOS, `mkdtempSync`
  // returns paths under `/var/folders/...` that are symlinks to
  // `/private/var/folders/...`; comparing the unresolved workspaceDir against
  // a realpathed child would falsely flag every child as a symlink escape.
  // Conversely, comparing two realpathed paths handles the case where the
  // workspace root itself is a symlink (e.g. CI mounts).
  let realWorkspaceDir: string;
  try {
    realWorkspaceDir = fsSyncRealpath(workspaceDir);
  } catch {
    // Workspace dir doesn't exist yet — first-pass check above is the
    // only defense, and it's already passed.
    return resolved;
  }

  let realResolved: string;
  try {
    realResolved = fsSyncRealpath(resolved);
  } catch {
    // Path doesn't exist on disk (e.g. a project not yet created). The
    // first-pass check has already verified the unresolved form is inside
    // the workspace, so it's safe to return.
    return resolved;
  }

  const relReal = relative(realWorkspaceDir, realResolved);
  if (relReal.startsWith(".." + sep) || relReal === ".." || pathIsAbsolute(relReal)) {
    throw new Error(`Path traversal not allowed (symlink escape): ${workspacePath}`);
  }
  return resolved;
}

/** Tiny wrapper around `realpathSync` so we don't have to import the sync
 * API in a function that otherwise uses async fs only. */
function fsSyncRealpath(p: string): string {
  // node:fs.realpathSync is sync, throws on ENOENT. Fine to use here —
  // this is only called from a path validation step, not a hot path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { realpathSync } = require("node:fs") as typeof import("node:fs");
  return realpathSync(p);
}

function pathIsAbsolute(p: string): boolean {
  return /^([/\\]|[a-zA-Z]:[\\/])/.test(p);
}

/** Validate that a workspace path is usable for a project.
 * Returns an object describing whether the path is valid and why not.
 */
export async function validateWorkspacePath(workspacePath: string): Promise<{
  valid: boolean;
  resolved: string;
  exists: boolean;
  isDirectory: boolean;
  error?: string;
}> {
  try {
    const resolved = resolveProjectWorkspace(workspacePath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (statErr) {
      return {
        valid: false,
        resolved,
        exists: false,
        isDirectory: false,
        error: pathIsAbsolute(workspacePath)
          ? "Directory does not exist"
          : undefined,
      };
    }

    if (!stat.isDirectory()) {
      return {
        valid: false,
        resolved,
        exists: true,
        isDirectory: false,
        error: "Path exists but is not a directory",
      };
    }

    return { valid: true, resolved, exists: true, isDirectory: true };
  } catch (err) {
    return {
      valid: false,
      resolved: "",
      exists: false,
      isDirectory: false,
      error: err instanceof Error ? err.message : "Invalid path",
    };
  }
}

// Suppress unused-var warning: keep existsSync/mkdirSync/join re-exports for
// back-compat with existing importers.
void existsSync;
void mkdirSync;
void join;
