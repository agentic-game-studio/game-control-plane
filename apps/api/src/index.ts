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
import { autonomousRouter } from "./routes/autonomous.js";
import { gddRouter } from "./routes/gdd.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { broadcast, wss, sseClients } from "./services/websocket.js";
import { logger, logStartup, logShutdown } from "./utils/logger.js";
import { requestLogger } from "./middleware/request-logger.js";

const START_TIME = Date.now();

// Q2: Simple in-memory rate limiter (per-IP, sliding window)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }

  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    res.status(429).json({ success: false, error: "Rate limit exceeded — try again in a minute" });
    return;
  }
  next();
}

const config = loadConfig();

const app = express();
const server = createServer(app);

// WebSocket server — attach wss from websocket.ts to the HTTP server
server.on("upgrade", (request, socket, head) => {
  const { pathname, searchParams } = new URL(request.url ?? "/", "http://localhost");

  // S5: Validate API key on WebSocket upgrade
  const wsKey = request.headers["x-api-key"] as string | undefined
    ?? searchParams.get("apiKey");
  if (!wsKey || wsKey !== config.API_SECRET) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (socket) => {
  socket.on("error", (err) => logger.error({ error: err.message, event: "ws_error" }, "WebSocket error"));
});

// Middleware
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));
app.use(authMiddleware);
app.use(requestLogger());

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
// Q2: Rate limit LLM-heavy endpoints (must be before route handlers)
app.use("/api/chat/sessions/:sessionId/messages", rateLimiter);
app.use("/api/chat/spawn", rateLimiter);

app.use("/api/chat", chatRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/autonomous", autonomousRouter);
app.use("/api/gdd", gddRouter);
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

  // R8: Send heartbeat comment every 15 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// Error handler
app.use(errorHandler);

const PORT = config.API_PORT;
server.listen(PORT, () => {
  const uptimeSeconds = Math.round((Date.now() - START_TIME) / 1000);
  logStartup({
    pid: process.pid,
    uptimeSeconds,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    service: "game-control-plane",
    port: PORT,
    workspaceDir: config.WORKSPACE_DIR,
    cORSOrigin: config.CORS_ORIGIN,
    env: process.env.NODE_ENV ?? "development",
  });
});

// R7: Graceful shutdown
function gracefulShutdown(signal: string) {
  const uptimeSeconds = Math.round((Date.now() - START_TIME) / 1000);
  logShutdown({
    pid: process.pid,
    uptimeSeconds,
    signal,
    graceful: true,
  });
  wss.close(() => {
    server.close(() => {
      logger.info({ pid: process.pid, uptimeSeconds }, "Server closed");
      process.exit(0);
    });
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
