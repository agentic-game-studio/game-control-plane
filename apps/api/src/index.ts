import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import { autonomousRouter, abortAllLoops, recoverStaleLoopStates } from "./routes/autonomous.js";
import { gddRouter } from "./routes/gdd.js";
import { buildsRouter } from "./routes/builds.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { broadcast, wss, sseClients } from "./services/websocket.js";
import { shutdownAllMCPServices } from "./services/godot-mcp-service.js";
import { logger, logStartup, logShutdown } from "./utils/logger.js";
import { requestLogger } from "./middleware/request-logger.js";

const START_TIME = Date.now();

// Q2: Simple in-memory rate limiter (per-IP, sliding window).
// Limits come from env config so operators can tune for their workload
// without redeploying code.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

// Evict expired rate bucket entries every 5 minutes to prevent unbounded
// memory growth. The interval is short enough to keep the working set
// tight but long enough that a typical client doesn't get its bucket
// reaped mid-request.
const RATE_BUCKET_CLEANUP_INTERVAL_MS = 5 * 60_000;
const rateCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_BUCKET_CLEANUP_INTERVAL_MS);
rateCleanupInterval.unref();

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const { RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_BUCKET_CAP } = loadConfig();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    // LRU cap: a botnet rotating IPs can otherwise grow the map forever —
    // periodic cleanup only removes EXPIRED entries, never over-cap ones.
    if (rateBuckets.size >= RATE_LIMIT_BUCKET_CAP) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest) rateBuckets.delete(oldest);
    }
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count++;
  if (bucket.count > RATE_LIMIT_REQUESTS) {
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

  // Origin check: prevent cross-origin WebSocket hijacking. Browsers send
  // an Origin header on the upgrade request; we reject any origin not in
  // the CORS allowlist. Same-origin requests have an Origin header that
  // matches the server's own URL — we also accept those.
  const origin = request.headers.origin;
  if (origin && !corsOrigins.includes("*")) {
    const allowed = corsOrigins.some((o) => o === origin || (o !== "*" && new URL(o).origin === new URL(origin).origin));
    if (!allowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  // S5: Validate API key on WebSocket upgrade with a timing-safe comparison.
  // The previous `!==` comparison was vulnerable to a byte-by-byte timing
  // attack against the secret. The HTTP middleware already uses
  // crypto.timingSafeEqual; we mirror that here. x-api-key is
  // string | string[] | undefined under Node's IncomingHttpHeaders — some
  // proxies can produce an array value, which would have made
  // `Buffer.from(wsKey)` throw inside the original `as string` cast.
  const rawWsKey = request.headers["x-api-key"];
  const wsKeyRaw = Array.isArray(rawWsKey) ? rawWsKey[0] : rawWsKey;
  const wsKey = wsKeyRaw ?? searchParams.get("apiKey") ?? undefined;
  if (!wsKey) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const a = Buffer.from(wsKey);
  const b = Buffer.from(config.API_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
// CORS_ORIGIN accepts a single origin or a comma-separated list of allowed
// origins (e.g. "http://localhost:3000,http://localhost:4000"). A single
// origin string still works for the common dev case. An unset / empty
// config is a misconfiguration — refuse to start so a typo doesn't
// silently block all browsers.
const corsOrigins = config.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
if (corsOrigins.length === 0) {
  logger.error({ CORS_ORIGIN: config.CORS_ORIGIN, event: "cors_misconfigured" },
    "CORS_ORIGIN is empty — refusing to start. Set CORS_ORIGIN to one or more comma-separated origins.");
  throw new Error("CORS_ORIGIN must be set to at least one origin");
}
app.use(cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins }));
// 5MB default JSON body limit. The previous 50MB limit applied to every
// route, which let a single buggy or malicious client OOM the process via
// /api/chat/sessions/.../messages. Individual upload routes (e.g. asset
// thumbnail serving) can attach their own parser with a higher cap.
app.use(express.json({ limit: `${config.BODY_LIMIT_MB}mb` }));
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
app.use("/api/builds", buildsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/settings", settingsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// SSE endpoint for log streaming. The per-instance cap is read from
// config so a deployment with higher headroom can raise it without a
// code change.
app.get("/api/sessions/:sessionId/stream", (req, res) => {
  if (sseClients.size >= loadConfig().MAX_SSE_CLIENTS) {
    res.status(503).json({ success: false, error: "Too many SSE connections — try again later" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sessionId = req.params.sessionId;
  const clientId = randomUUID();

  const client = { id: clientId, sessionId, send: (data: string) => { res.write(`data: ${data}\n\n`); } };
  sseClients.add(client);

  // R8: Send heartbeat comment every 15 seconds to keep connection alive
  const SSE_HEARTBEAT_MS = 15_000;
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_MS);

  // Cleanup runs on close AND on error. A socket that dies in a way that does
  // not emit `close` (NAT timeout, broken pipe with no RST, process-level
  // kill) would otherwise leak the client and its heartbeat interval. We also
  // guard the writes with a `destroyed` flag so a late `heartbeat` callback
  // after cleanup doesn't throw on the dead socket.
  let destroyed = false;
  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    clearInterval(heartbeat);
    sseClients.delete(client);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
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

// Prune old session state files on startup (older than 30 days)
import { SessionStore } from "@game-studio/state";
const sessionStore = new SessionStore(config.WORKSPACE_DIR);
sessionStore.pruneOldSessions(30 * 24 * 60 * 60 * 1000).then((removed) => {
  if (removed > 0) logger.info({ removed, event: "session_prune" }, `Pruned ${removed} old session(s)`);
}).catch(() => { /* non-critical */ });

const recoveredLoops = recoverStaleLoopStates();
if (recoveredLoops > 0) {
  logger.info({ recoveredLoops, event: "autonomous_stale_recovery" }, `Recovered ${recoveredLoops} stale autonomous loop(s)`);
}

// R7: Graceful shutdown
async function gracefulShutdown(signal: string) {
  const uptimeSeconds = Math.round((Date.now() - START_TIME) / 1000);
  logShutdown({
    pid: process.pid,
    uptimeSeconds,
    signal,
    graceful: true,
  });

  // 1. Abort all autonomous loops
  abortAllLoops();

  // 2. Close all SSE clients
  for (const client of sseClients) {
    try { client.send(""); } catch { /* already closed */ }
  }
  sseClients.clear();

  // 3. Kill MCP child processes
  try { await shutdownAllMCPServices(); } catch { /* best effort */ }

  // 4. Clear rate limiter + workflow cleanup + WS heartbeat timers
  clearInterval(rateCleanupInterval);
  try {
    const { workflowCleanupInterval } = await import("./services/quest-bridge.js");
    clearInterval(workflowCleanupInterval);
  } catch { /* best effort */ }
  try {
    const { heartbeatInterval } = await import("./services/websocket.js");
    clearInterval(heartbeatInterval);
  } catch { /* best effort */ }

  wss.close(() => {
    server.close(() => {
      logger.info({ pid: process.pid, uptimeSeconds }, "Server closed");
      process.exit(0);
    });
  });
  // Force exit after 10s if connections don't close. The hard deadline
  // matters for SIGTERM-then-SIGKILL behavior under k8s/railway: a
  // long-tail SSE client must not hold up the pod's drain indefinitely.
  const SHUTDOWN_FORCE_EXIT_MS = 10_000;
  setTimeout(() => process.exit(1), SHUTDOWN_FORCE_EXIT_MS);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
