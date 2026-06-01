import path from "path";
import fs from "fs";
import { loadConfig } from "../config.js";

/**
 * Resolve a project's workspacePath to an absolute filesystem path.
 *
 * - Absolute paths (starts with /) are used as-is after normalization.
 * - Relative paths are resolved against WORKSPACE_DIR (existing behavior).
 * - Path traversal via ".." is always blocked.
 */
export function resolveProjectWorkspace(workspacePath: string): string {
  if (!workspacePath) throw new Error("workspacePath is required");

  if (workspacePath.includes("..")) {
    throw new Error(`Path traversal not allowed: ${workspacePath}`);
  }

  const resolved = path.isAbsolute(workspacePath)
    ? path.resolve(workspacePath)
    : path.resolve(loadConfig().WORKSPACE_DIR, workspacePath);

  return resolved;
}

/**
 * Validate that a workspace path is usable for a project.
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
      stat = await fs.promises.stat(resolved);
    } catch (statErr) {
      return {
        valid: false,
        resolved,
        exists: false,
        isDirectory: false,
        error: path.isAbsolute(workspacePath)
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
