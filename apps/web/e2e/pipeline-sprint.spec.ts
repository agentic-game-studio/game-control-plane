/**
 * pipeline-sprint.spec.ts — Playwright smoke spec for Phase 3 (/sprint).
 *
 * Scope: the HTTP/WS contract for /sprint. The dispatch logic (board-read →
 * area→team grouping → Task-recipe dispatch) is fully covered by the vitest
 * suite (sprint-dispatcher.test.ts + pipeline-service /sprint tests). This spec
 * nails the skills contract + start/stop at the HTTP layer.
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

test.describe("Pipeline sprint smoke (Phase 3)", () => {
  test.describe.configure({ mode: "serial" });

  test("/api/skills/pipeline-sprint returns the expected pipeline contract", async ({ request }) => {
    const res = await request.get(`${API}/skills/pipeline-sprint`, { headers: { "x-api-key": API_KEY } });
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
    expect(skill?.lifecyclePhase).toBe("production");
    expect(skill?.phases?.length).toBe(2);
    expect(skill?.phases?.[0]?.name).toBe("sprint-dispatch");
    expect(skill?.phases?.[1]?.name).toBe("sprint-review");
    expect(skill?.phases?.[1]?.gates).toEqual(["PR-SPRINT"]);
  });

  test("POST /api/pipeline/start with pipeline-sprint returns a runId and persists state", async ({ request }) => {
    const { projectId, sessionId } = await createProjectAndSession(request, "sprint");
    const res = await request.post(`${API}/pipeline/start`, {
      headers: { "x-api-key": API_KEY },
      data: { skillName: "pipeline-sprint", sessionId, projectId },
    });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{ runId: string; status: string; gateMode: string }> = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.runId).toMatch(/^run-[a-z0-9-]+$/);
    expect(body.data?.gateMode).toBe("manual");

    await new Promise((r) => setTimeout(r, 200));
    const get = await request.get(`${API}/pipeline/runs/${body.data!.runId}`, { headers: { "x-api-key": API_KEY } });
    expect(get.status()).toBe(200);
    const getBody: ApiResponse<{ skillName: string; lifecyclePhase: string }> = await get.json();
    expect(getBody.data?.skillName).toBe("pipeline-sprint");
    expect(getBody.data?.lifecyclePhase).toBe("production");

    await request.post(`${API}/pipeline/runs/${body.data!.runId}/stop`, { headers: { "x-api-key": API_KEY } });
    await request.delete(`${API}/dashboard/projects/${projectId}`, { headers: { "x-api-key": API_KEY } });
  });
});
