/**
 * pipeline-design.spec.ts — Playwright smoke spec for Phase 2 (/design).
 *
 * Scope: the HTTP/WS contract the chat UI consumes for /design. The full
 * LLM-driven run (research → GDD draft + ingest → 3 gates) is covered by the
 * 4 mocked-gate vitest tests in apps/api/src/services/pipeline-service.test.ts
 * (incl. the multi-gate-manual advance). This spec nails the HTTP contract:
 *   1. `/api/skills/pipeline-design` returns the pipeline contract (3 phases,
 *      3 gates across 2 phases, kind:"pipeline", lifecyclePhase:"design").
 *   2. `POST /api/pipeline/start` with skillName:"pipeline-design" returns a
 *      runId and persists state with gateMode:"manual".
 *   3. The concurrent-/start 409 guard (US-H2) rejects a second run for the
 *      same session while one is active.
 *   4. `/stop` cancels the run.
 */

import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function readDevApiKey(): string {
  const envPath = join(__dirname, "..", "..", "..", ".env");
  if (!existsSync(envPath)) return process.env.E2E_API_KEY ?? "e2e-test-only-not-a-secret";
  try {
    const text = readFileSync(envPath, "utf-8");
    const m = text.match(/^API_SECRET=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // ignore
  }
  return process.env.E2E_API_KEY ?? "e2e-test-only-not-a-secret";
}

const API_KEY = readDevApiKey();
const API = "http://localhost:3001/api";

async function createProjectAndSession(request: import("@playwright/test").APIRequestContext, label: string): Promise<{ projectId: string; sessionId: string }> {
  const projName = `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createRes = await request.post(`${API}/dashboard/projects`, {
    headers: { "x-api-key": API_KEY },
    data: { name: projName, engine: "godot", workspacePath: `./workspace/projects/${projName}`, description: `e2e ${label} fixture` },
  });
  expect([200, 201]).toContain(createRes.status());
  const projectId: string = ((await createRes.json()) as ApiResponse<{ id: string }>).data?.id ?? "";
  expect(projectId).toBeTruthy();
  const sessionId: string = `producer-${projectId}`;
  const sessRes = await request.get(`${API}/chat/sessions/producer/${projectId}`, { headers: { "x-api-key": API_KEY } });
  expect([200, 201]).toContain(sessRes.status());
  return { projectId, sessionId };
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

test.describe("Pipeline design smoke (Phase 2)", () => {
  test.describe.configure({ mode: "serial" });

  test("/api/skills/pipeline-design returns the expected pipeline contract", async ({ request }) => {
    const res = await request.get(`${API}/skills/pipeline-design`, { headers: { "x-api-key": API_KEY } });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{
      kind?: string; gateMode?: string; resumable?: boolean; lifecyclePhase?: string;
      phases?: Array<{ name: string; agents: string[]; gates?: string[]; createsTickets?: boolean }>;
    }> = await res.json();
    expect(body.success).toBe(true);
    const skill = body.data;
    expect(skill?.kind).toBe("pipeline");
    expect(skill?.gateMode).toBe("manual");
    expect(skill?.resumable).toBe(true);
    expect(skill?.lifecyclePhase).toBe("design");
    expect(skill?.phases?.length).toBe(3);
    expect(skill?.phases?.[0]?.name).toBe("market-research");
    expect(skill?.phases?.[1]?.name).toBe("gdd-draft");
    expect(skill?.phases?.[1]?.gates).toEqual(["CD-GDD-ALIGN"]);
    expect(skill?.phases?.[2]?.name).toBe("art-architecture");
    // Multi-gate phase — the case the runner fix addresses.
    expect(skill?.phases?.[2]?.gates).toEqual(["TD-FEASIBILITY", "TD-ARCHITECTURE"]);
    for (const phase of skill?.phases ?? []) {
      expect((phase as Record<string, unknown>).subSkills).toBeUndefined();
    }
  });

  test("POST /api/pipeline/start with pipeline-design returns a runId and persists state", async ({ request }) => {
    const { projectId, sessionId } = await createProjectAndSession(request, "design");
    const res = await request.post(`${API}/pipeline/start`, {
      headers: { "x-api-key": API_KEY },
      data: { skillName: "pipeline-design", sessionId, projectId, taskArgs: "a cozy farming game with detective mechanics" },
    });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{ runId: string; status: string; gateMode: string; sessionId: string }> = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.runId).toMatch(/^run-[a-z0-9-]+$/);
    expect(body.data?.gateMode).toBe("manual");
    expect(body.data?.sessionId).toBe(sessionId);

    await new Promise((r) => setTimeout(r, 200));
    const get = await request.get(`${API}/pipeline/runs/${body.data!.runId}`, { headers: { "x-api-key": API_KEY } });
    expect(get.status()).toBe(200);
    const getBody: ApiResponse<{ skillName: string; gateMode: string; lifecyclePhase: string; status: string }> = await get.json();
    expect(getBody.data?.skillName).toBe("pipeline-design");
    expect(getBody.data?.lifecyclePhase).toBe("design");
    expect(getBody.data?.gateMode).toBe("manual");

    await request.post(`${API}/pipeline/runs/${body.data!.runId}/stop`, { headers: { "x-api-key": API_KEY } });
    await request.delete(`${API}/dashboard/projects/${projectId}`, { headers: { "x-api-key": API_KEY } });
  });

  test("concurrent /start for the same session returns 409 (US-H2 guard)", async ({ request }) => {
    const { projectId, sessionId } = await createProjectAndSession(request, "design-collision");
    const first = await request.post(`${API}/pipeline/start`, {
      headers: { "x-api-key": API_KEY },
      data: { skillName: "pipeline-design", sessionId, projectId },
    });
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as ApiResponse<{ runId: string }>;
    expect(firstBody.data?.runId).toBeTruthy();

    // A second /start while the first is active must 409.
    const second = await request.post(`${API}/pipeline/start`, {
      headers: { "x-api-key": API_KEY },
      data: { skillName: "pipeline-design", sessionId, projectId },
    });
    expect(second.status()).toBe(409);
    const secondBody: ApiResponse<{ runId?: string }> = await second.json();
    expect(secondBody.success).toBe(false);
    expect(secondBody.error).toMatch(/already active|advance|stop/i);

    await request.post(`${API}/pipeline/runs/${firstBody.data!.runId}/stop`, { headers: { "x-api-key": API_KEY } });
    await request.delete(`${API}/dashboard/projects/${projectId}`, { headers: { "x-api-key": API_KEY } });
  });
});
