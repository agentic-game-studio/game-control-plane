/**
 * Externalize autonomous production decisions to workspace wiki/docs.
 *
 * Path-traversal protection: any path derived from user-controlled input
 * (projectId, category) is anchored to WORKSPACE_DIR via realpath + relative
 * check. We never trust the raw `..` substring, which is bypassable via
 * paths like `/etc/..` or `..foo`.
 */

import { promises as fs } from "fs";
import { realpathSync } from "node:fs";
import { resolve, relative, sep } from "path";
import { loadConfig } from "../config.js";

// 15-CR-realpath-cache: memoize realpathSync results so the sync
// syscall (which blocks the event loop for tens of ms on NFS / Docker
// bind-mounts / CIFS volumes) only runs once per path. resolveProjectWorkspace
// is called on every LLM Read/Write/Edit (via safePath), every asset
// scan, every /api/dashboard/* route, and at agent-prompt load — under
// a 60-tool-call turn that was 60+ blocking stat calls. The cache is
// process-local, has a hard size cap, and uses FIFO eviction so it
// can't grow unbounded.
const realpathCache = new Map<string, string>();
const REALPATH_CACHE_MAX = 1_000;

function cachedRealpathSync(p: string): string {
  const cached = realpathCache.get(p);
  if (cached !== undefined) return cached;
  const result = realpathSync(p);
  // FIFO eviction: delete oldest entry once we exceed the cap. Maps
  // preserve insertion order, so the first key is the oldest.
  if (realpathCache.size >= REALPATH_CACHE_MAX) {
    const firstKey = realpathCache.keys().next().value;
    if (firstKey !== undefined) realpathCache.delete(firstKey);
  }
  realpathCache.set(p, result);
  return result;
}

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

/** Tiny wrapper around the memoized realpath helper. The cache is
 * process-local and FIFO-bounded, so a sustained workload of N distinct
 * project paths stays under REALPATH_CACHE_MAX entries. */
function fsSyncRealpath(p: string): string {
  return cachedRealpathSync(p);
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
