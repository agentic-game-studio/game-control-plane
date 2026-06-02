/**
 * Stale loop state recovery test.
 *
 * `recoverStaleLoopStates` is the file-system level cleanup that
 * prevents a zombie 'running' loop from blocking new /start calls
 * after an API restart. We simulate a stale state file and assert
 * the function flips it to 'idle' + bumps the recovered count.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("recoverStaleLoopStates", () => {
  let workspaceDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "ws-recover-"));
    sessionsDir = join(workspaceDir, "production", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    process.env.WORKSPACE_DIR = workspaceDir;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    delete process.env.WORKSPACE_DIR;
    vi.resetModules();
  });

  it("flips stale 'running' loop states to 'idle' and counts them", async () => {
    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const freshHeartbeat = new Date().toISOString();

    const sessionA = join(sessionsDir, "session-A");
    const sessionB = join(sessionsDir, "session-B");
    mkdirSync(sessionA);
    mkdirSync(sessionB);

    writeFileSync(
      join(sessionA, "loop-state.json"),
      JSON.stringify({
        sessionId: "session-A",
        projectId: "P",
        status: "running",
        startedAt: staleHeartbeat,
        lastHeartbeat: staleHeartbeat,
        currentIteration: 1,
        maxIterations: 100,
        completedCount: 0,
        failedCount: 0,
        iterations: [],
      }),
    );
    writeFileSync(
      join(sessionB, "loop-state.json"),
      JSON.stringify({
        sessionId: "session-B",
        projectId: "P",
        status: "running",
        startedAt: freshHeartbeat,
        lastHeartbeat: freshHeartbeat,
        currentIteration: 1,
        maxIterations: 100,
        completedCount: 0,
        failedCount: 0,
        iterations: [],
      }),
    );

    // Re-import after env change so the module's `const config =
    // loadConfig()` picks up the new WORKSPACE_DIR.
    const { recoverStaleLoopStates } = await import(
      "./autonomous.js?recover-test"
    );
    const recovered = recoverStaleLoopStates();

    expect(recovered).toBeGreaterThanOrEqual(1);

    // A's state should now be idle.
    const aState = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(sessionA, "loop-state.json"),
        "utf-8",
      ),
    );
    expect(aState.status).toBe("idle");
  });

  it("returns 0 when there are no stale loops", async () => {
    const { recoverStaleLoopStates } = await import(
      "./autonomous.js?recover-empty-test"
    );
    expect(recoverStaleLoopStates()).toBe(0);
  });
});
