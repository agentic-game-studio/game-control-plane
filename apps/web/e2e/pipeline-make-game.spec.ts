/**
 * pipeline-make-game.spec.ts — Playwright smoke spec for Phase 5 (/make-game).
 *
 * Scope: the skills contract (6 phases, each gated by PR-PHASE-GATE) + start/stop.
 * The child-pipeline chaining + the gate-clearing fix are covered by the vitest
 * suite (pipeline-service /make-game tests: manual chaining, PR-PHASE-GATE fires
 * 6×, auto end-to-end across all 6 children).
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

test.describe("Pipeline make-game smoke (Phase 5)", () => {
  test.describe.configure({ mode: "serial" });

  test("/api/skills/pipeline-make-game returns the expected orchestrator contract", async ({ request }) => {
    const res = await request.get(`${API}/skills/pipeline-make-game`, { headers: { "x-api-key": API_KEY } });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{
      kind?: string; gateMode?: string; resumable?: boolean; lifecyclePhase?: string;
      phases?: Array<{ name: string; gates?: string[]; agents?: string[]; createsTickets?: boolean }>;
    }> = await res.json();
    expect(body.success).toBe(true);
    const skill = body.data;
    expect(skill?.kind).toBe("pipeline");
    expect(skill?.gateMode).toBe("manual");
    expect(skill?.resumable).toBe(true);
    // 6 lifecycle stages, each gated by PR-PHASE-GATE (the inter-pipeline approval).
    expect(skill?.phases?.length).toBe(6);
    expect(skill?.phases?.map((p) => p.name)).toEqual(["concept", "design", "slice", "sprint", "polish", "release"]);
    for (const phase of skill?.phases ?? []) {
      expect(phase.gates).toEqual(["PR-PHASE-GATE"]);
      expect((phase as Record<string, unknown>).subSkills).toBeUndefined();
    }
  });

  test("POST /api/pipeline/start with pipeline-make-game returns a runId and persists state", async ({ request }) => {
    const { projectId, sessionId } = await createProjectAndSession(request, "makegame");
    const res = await request.post(`${API}/pipeline/start`, {
      headers: { "x-api-key": API_KEY },
      data: { skillName: "pipeline-make-game", sessionId, projectId },
    });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{ runId: string; status: string; gateMode: string }> = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.runId).toMatch(/^run-[a-z0-9-]+$/);
    expect(body.data?.gateMode).toBe("manual");

    await new Promise((r) => setTimeout(r, 200));
    const get = await request.get(`${API}/pipeline/runs/${body.data!.runId}`, { headers: { "x-api-key": API_KEY } });
    expect(get.status()).toBe(200);
    const getBody: ApiResponse<{ skillName: string }> = await get.json();
    expect(getBody.data?.skillName).toBe("pipeline-make-game");

    await request.post(`${API}/pipeline/runs/${body.data!.runId}/stop`, { headers: { "x-api-key": API_KEY } });
    await request.delete(`${API}/dashboard/projects/${projectId}`, { headers: { "x-api-key": API_KEY } });
  });
});
