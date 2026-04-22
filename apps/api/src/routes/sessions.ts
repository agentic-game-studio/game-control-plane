import { Router } from "express";
import type { Request, Response } from "express";
import { SessionStore } from "@game-studio/state";
import { loadConfig } from "../config.js";
import { broadcast } from "../services/websocket.js";

export const sessionsRouter: Router = Router();

const config = loadConfig();
const store = new SessionStore(config.WORKSPACE_DIR);

// GET /sessions — list all sessions
sessionsRouter.get("/", async (_req: Request, res: Response) => {
  const sessions = await store.list();
  res.json({ success: true, data: sessions });
});

// POST /sessions — create new session
sessionsRouter.post("/", async (req: Request, res: Response) => {
  const { name, config: sessionConfig } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }
  const session = await store.create(name, sessionConfig);
  broadcast({ type: "session:status", sessionId: session.id, status: session.status });
  res.json({ success: true, data: session });
});

// GET /sessions/:id — get session
sessionsRouter.get("/:id", async (req: Request, res: Response) => {
  const session = await store.get(req.params.id as string);
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }
  res.json({ success: true, data: session });
});

// DELETE /sessions/:id — delete session
sessionsRouter.delete("/:id", async (req: Request, res: Response) => {
  await store.delete(req.params.id as string);
  res.json({ success: true });
});

// POST /sessions/:id/checkpoint — force checkpoint
sessionsRouter.post("/:id/checkpoint", async (req: Request, res: Response) => {
  const { phase, activeTask } = req.body as { phase?: string; activeTask?: string };
  if (!phase || !activeTask) {
    res.status(400).json({ success: false, error: "phase and activeTask are required" });
    return;
  }
  const id = req.params.id as string;
  const checkpoint = await store.createCheckpoint(id, phase, activeTask);
  broadcast({ type: "checkpoint:saved", checkpointId: checkpoint.id, sessionId: id });
  res.json({ success: true, data: checkpoint });
});

// POST /sessions/:id/logs — add log entry
sessionsRouter.post("/:id/logs", async (req: Request, res: Response) => {
  const body = req.body as { level?: string; message?: string; agent?: string; skill?: string };
  const { level, message, agent, skill } = body;
  if (!level || !message) {
    res.status(400).json({ success: false, error: "level and message are required" });
    return;
  }
  const id = req.params.id as string;
  const logLevel = level as "info" | "warn" | "error" | "debug";
  await store.addLog(id, { level: logLevel, message, agent, skill });
  broadcast({
    type: "log:entry",
    sessionId: id,
    level: logLevel,
    message,
    timestamp: new Date().toISOString(),
  });
  res.json({ success: true });
});
