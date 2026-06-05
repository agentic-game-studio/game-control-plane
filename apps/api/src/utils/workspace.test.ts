/**
 * Path-traversal regression tests for `resolveProjectWorkspace`.
 *
 * The 5th-pass audit flagged a substring `..` check that was bypassable
 * with paths like `/etc/..` or `..foo`. These tests pin the new
 * realpath + relative-path implementation so any future regression
 * (reverting to substring, accidentally widening the allow) is loud.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, symlinkSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveProjectWorkspace } from "./workspace.js";
import { loadConfig, __resetConfigForTesting } from "../config.js";

describe("resolveProjectWorkspace", () => {
  let workspaceDir: string;
  let outsideDir: string;

  beforeAll(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "ws-traversal-ws-"));
    outsideDir = mkdtempSync(join(tmpdir(), "ws-traversal-out-"));

    // 11-M16: explicitly clear the cached config so the WORKSPACE_DIR
    // mutation just above is actually observed by the next loadConfig()
    // call. The previous `void loadConfig()` was a no-op when config
    // was already cached from a prior import.
    process.env.WORKSPACE_DIR = workspaceDir;
    __resetConfigForTesting();
    void loadConfig();
  });

  afterAll(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("rejects traversal attempts", () => {
    it.each([
      ["parent via relative", "../etc"],
      ["parent via deeper relative", "../../../etc"],
      ["absolute outside", "/etc/passwd"],
      ["absolute with sibling tmp", outsideDir],
      ["NUL byte", "good\0bad"],
    ])("rejects %s", (_label, input) => {
      expect(() => resolveProjectWorkspace(input)).toThrow();
    });

    it("accepts a directory literally named '..foo' (not a traversal)", () => {
      // `..foo` is a normal directory name, not a `..` parent reference.
      // A substring `..` check would reject this; the realpath+relative
      // implementation correctly accepts it.
      const result = resolveProjectWorkspace("..foo");
      expect(result).toBe(resolve(workspaceDir, "..foo"));
    });
  });

  it("accepts a normal project-relative path", () => {
    const result = resolveProjectWorkspace("my-project");
    expect(result).toBe(resolve(workspaceDir, "my-project"));
  });

  it("accepts an absolute path inside the workspace", () => {
    mkdirSync(join(workspaceDir, "abs-project"), { recursive: true });
    const result = resolveProjectWorkspace(join(workspaceDir, "abs-project"));
    expect(result).toBe(resolve(workspaceDir, "abs-project"));
  });

  it("rejects a symlink that points outside the workspace", () => {
    // Create a real file outside the workspace, then a symlink inside
    // pointing at it. resolveProjectWorkspace should refuse because
    // the realpath escapes.
    const outsideFile = join(outsideDir, "secret");
    writeFileSync(outsideFile, "do not leak");
    const linkPath = join(workspaceDir, "sneaky-link");
    symlinkSync(outsideFile, linkPath);

    expect(() => resolveProjectWorkspace("sneaky-link")).toThrow(/traversal|symlink/i);
  });

  it("allows non-existent paths (for write paths to new projects)", () => {
    // A new project that hasn't been created yet should be allowed —
    // callers that mkdir under it rely on the workspace boundary
    // holding for the to-be-created child.
    const result = resolveProjectWorkspace("not-yet-created");
    expect(result).toBe(resolve(workspaceDir, "not-yet-created"));
  });
});
