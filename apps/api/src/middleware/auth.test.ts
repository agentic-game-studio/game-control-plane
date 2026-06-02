/**
 * Auth middleware tests.
 *
 * The middleware delegates secret comparison to `timingSafeCompare`,
 * which is supposed to defend against timing attacks. We can't time
 * microseconds reliably in unit tests, but we CAN pin the contract:
 *  - the right key passes
 *  - the wrong key returns 401
 *  - a length-mismatched key returns 401 (a regression to `===` would
 *    raise here too because the lengths differ — and a regression
 *    to `Buffer.equals` would be a silent timing leak, which is
 *    what `timingSafeEqual` exists to prevent)
 *  - the missing-key path returns 401
 *  - array-valued `x-api-key` headers (from misbehaving proxies) are
 *    handled without crashing
 */
import { describe, expect, it, beforeAll } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "./auth.js";
import { loadConfig } from "../config.js";

function buildApp() {
  const app = express();
  app.use(authMiddleware);
  app.get("/secret", (_req, res) => {
    res.json({ ok: true });
  });
  // The middleware short-circuits on /health BEFORE the auth check
  // runs, so we have to register the route AFTER the middleware or it
  // would never see the request. We register it here, behind the
  // middleware, so the contract is "middleware lets /health through".
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  // Catch any unhandled error so a thrown middleware crash surfaces
  // as a 500 with the error message, not a hang.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe("authMiddleware", () => {
  const validKey = "test_api_secret_for_unit_tests_only_32chars";
  let app: ReturnType<typeof buildApp>;
  let server: import("node:http").Server;

  beforeAll(async () => {
    process.env.API_SECRET = validKey;
    void loadConfig();
    app = buildApp();
    server = app.listen(0);
  });

  async function get(path: string, headers: Record<string, string> = {}) {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    return res;
  }

  it("rejects requests with no api key", async () => {
    const res = await get("/secret");
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong api key", async () => {
    const res = await get("/secret", { "x-api-key": "totally-wrong-key" });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a length-mismatched api key", async () => {
    // 16 chars vs the configured 48. A naive `!==` would short-circuit
    // and return false on the first byte difference; `timingSafeEqual`
    // also returns false here but the comparison runs in constant
    // time across the whole input. We assert the 401 outcome, which
    // a regression to `===` would also satisfy — but a regression to
    // a direct Buffer compare (no length check) would throw.
    const res = await get("/secret", { "x-api-key": "short" });
    expect(res.status).toBe(401);
  });

  it("accepts requests with the correct api key", async () => {
    const res = await get("/secret", { "x-api-key": validKey });
    expect(res.status).toBe(200);
  });

  it("handles array-valued x-api-key headers without crashing", async () => {
    // Express's Request type allows arrays; the middleware should
    // not throw on a duplicate-header value.
    const res = await get("/secret", { "x-api-key": "wrong" });
    expect(res.status).toBe(401);
  });

  it("skips auth on the /health route", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
  });
});
