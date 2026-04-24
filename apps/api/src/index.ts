import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { sessionsRouter } from "./routes/sessions.js";
import { agentsRouter } from "./routes/agents.js";
import { skillsRouter } from "./routes/skills.js";
import { teamsRouter } from "./routes/teams.js";
import { gatesRouter } from "./routes/gates.js";
import { designRouter } from "./routes/design.js";
import { promptsRouter } from "./routes/prompts.js";
import { documentsRouter } from "./routes/documents.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { chatRouter } from "./routes/chat.js";
import { ticketsRouter } from "./routes/tickets.js";
import { assetsRouter } from "./routes/assets.js";
import { settingsRouter } from "./routes/settings.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { broadcast, wss, sseClients } from "./services/websocket.js";

const config = loadConfig();

const app = express();
const server = createServer(app);

// WebSocket server
const ws = new WebSocketServer({ server, path: "/ws" });
ws.on("connection", (socket) => {
  socket.on("error", (err) => console.error("WS error:", err));
});

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(authMiddleware);

// Routes
app.use("/api/sessions", sessionsRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/gates", gatesRouter);
app.use("/api/design", designRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/chat", chatRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/settings", settingsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// SSE endpoint for log streaming
app.get("/api/sessions/:sessionId/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sessionId = req.params.sessionId;
  const clientId = crypto.randomUUID();

  const client = { id: clientId, sessionId, send: (data: string) => { res.write(`data: ${data}\n\n`); } };
  sseClients.add(client);

  req.on("close", () => {
    sseClients.delete(client);
  });
});

// Error handler
app.use(errorHandler);

const PORT = config.API_PORT;
server.listen(PORT, () => {
  console.log(`[API] Server running on http://localhost:${PORT}`);
  console.log(`[API] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[API] Workspace: ${config.WORKSPACE_DIR}`);
});
