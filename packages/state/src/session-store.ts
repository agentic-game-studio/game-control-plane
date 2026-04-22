import fs from "node:fs/promises";
import path from "node:path";
import type { SessionState, Checkpoint, SessionConfig, LogEntry } from "@game-studio/types";

const SESSION_STATE_DIR = "production/session-state";

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
    await fs.writeFile(this.sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
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
  }

  async addLog(sessionId: string, entry: Omit<LogEntry, "timestamp">): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    session.logs.push({ ...entry, timestamp: new Date().toISOString() });
    // Keep last 1000 log entries
    if (session.logs.length > 1000) {
      session.logs = session.logs.slice(-1000);
    }
    await this.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await fs.rm(this.sessionPath(sessionId), { force: true });
    await fs.rm(this.checkpointDir(sessionId), { recursive: true, force: true });
  }
}
