import fs from "node:fs/promises";
import path from "node:path";
import type { SessionState, Checkpoint, SessionConfig, LogEntry } from "@game-studio/types";

const SESSION_STATE_DIR = "production/session-state";

/** Per-session FIFO mutex to serialize read-modify-write cycles and prevent
 * lost updates when concurrent callers (autonomous loop + chat send + log
 * stream) all touch the same session. Mirrors the pattern in
 * `apps/api/src/services/data-store.ts` for `updateData`. The map stores
 * the *current* lock promise; the next caller takes that as `prev` and
 * installs its own `lock` as the new current. Comparison in the finally
 * block uses the same `lock` reference that was set, so a later caller
 * that has already installed a new lock will not have its entry removed. */
const sessionLocks = new Map<string, Promise<void>>();

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release: () => void;
  const lock = new Promise<void>((r) => { release = r; });
  sessionLocks.set(sessionId, lock);
  try {
    await prev;
    return await fn();
  } finally {
    release!();
    if (sessionLocks.get(sessionId) === lock) {
      sessionLocks.delete(sessionId);
    }
  }
}

export class SessionStore {
  constructor(private workspaceDir: string) {}

  private sessionPath(sessionId: string): string {
    return path.join(this.workspaceDir, SESSION_STATE_DIR, `${sessionId}.json`);
  }

  private checkpointDir(sessionId: string): string {
    return path.join(this.workspaceDir, SESSION_STATE_DIR, sessionId);
  }

  async create(name: string, config: SessionConfig = {}): Promise<SessionState> {
    const session: SessionState = {
      id: crypto.randomUUID(),
      name,
      status: "idle",
      config,
      checkpoints: [],
      agents: {},
      logs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(this.sessionPath(session.id)), { recursive: true });
    await this.save(session);
    return session;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    try {
      const content = await fs.readFile(this.sessionPath(sessionId), "utf-8");
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  async save(session: SessionState): Promise<void> {
    session.updatedAt = new Date().toISOString();
    const targetPath = this.sessionPath(session.id);
    // Atomic write: stage to .tmp then rename. Avoids half-written JSON
    // corrupting the session if the process is killed mid-write. Also catches
    // write errors explicitly — without this a failed write would propagate
    // as an uncaught rejection that crashes the API.
    const tmpPath = targetPath + ".tmp";
    try {
      await fs.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf-8");
      await fs.rename(tmpPath, targetPath);
    } catch (writeErr) {
      await fs.unlink(tmpPath).catch(() => {});
      throw writeErr;
    }
  }

  async list(): Promise<SessionState[]> {
    const dir = path.join(this.workspaceDir, SESSION_STATE_DIR);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const sessions: SessionState[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        sessions.push(JSON.parse(content) as SessionState);
      } catch {
        // skip invalid files
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createCheckpoint(sessionId: string, phase: string, activeTask: string): Promise<Checkpoint> {
    return withSessionLock(sessionId, async () => {
      const session = await this.get(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);

      const checkpoint: Checkpoint = {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        phase,
        activeTask,
        completedSections: [],
        decisions: [],
        agentInvocations: [],
        openQuestions: [],
      };

      session.checkpoints.push(checkpoint);
      session.activeCheckpoint = checkpoint.id;
      await this.save(session);

      // Also save checkpoint file
      const cpDir = this.checkpointDir(sessionId);
      await fs.mkdir(cpDir, { recursive: true });
      await fs.writeFile(
        path.join(cpDir, `${checkpoint.id}.json`),
        JSON.stringify(checkpoint, null, 2),
        "utf-8"
      );

      return checkpoint;
    });
  }

  async addLog(sessionId: string, entry: Omit<LogEntry, "timestamp">): Promise<void> {
    // Without this lock, two concurrent addLog calls (e.g. from the
    // autonomous loop and a chat send) would each read the same baseline,
    // append their own entry, and one log line would be lost.
    return withSessionLock(sessionId, async () => {
      const session = await this.get(sessionId);
      if (!session) return;
      session.logs.push({ ...entry, timestamp: new Date().toISOString() });
      // Keep last 1000 log entries
      if (session.logs.length > 1000) {
        session.logs = session.logs.slice(-1000);
      }
      await this.save(session);
    });
  }

  async delete(sessionId: string): Promise<void> {
    // Route the delete through withSessionLock so a concurrent
    // createCheckpoint / addLog running for the same sessionId can't
    // observe the file deletion mid-flight and orphan-write a .tmp
    // that's never renamed (the previous free-form delete happened
    // outside the lock; the lock was only cleared after the file was
    // already gone, so a contender could pass `await prev`, then
    // see a missing file and write a stale .tmp that never promotes).
    await withSessionLock(sessionId, async () => {
      await fs.rm(this.sessionPath(sessionId), { force: true });
      await fs.rm(this.checkpointDir(sessionId), { recursive: true, force: true });
    });
    sessionLocks.delete(sessionId);
  }

  /** Clean up session files older than maxAgeMs. Returns number of sessions removed. */
  async pruneOldSessions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const dir = path.join(this.workspaceDir, SESSION_STATE_DIR);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return 0;
    }

    const now = Date.now();
    let removed = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(dir, file);
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          const sessionId = file.replace(".json", "");
          await this.delete(sessionId);
          removed++;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    return removed;
  }
}
