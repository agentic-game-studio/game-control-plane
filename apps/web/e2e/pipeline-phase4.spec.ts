/**
 * pipeline-phase4.spec.ts — Playwright smoke spec for Phase 4 (/slice, /polish, /release).
 *
 * Scope: the skills contracts + start/stop at the HTTP layer for the three
 * Phase 4 pipelines. The /release build hook (executeGodotExport) is fully
 * covered by the vitest suite (mocked build-service); this spec nails the
 * contract that the chat UI consumes.
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

async function contractFor(request: import("@playwright/test").APIRequestContext, skillName: string, expected: { lifecyclePhase: string; phaseCount: number; gatePhase: string; gate: string }) {
  const res = await request.get(`${API}/skills/${skillName}`, { headers: { "x-api-key": API_KEY } });
  expect(res.status()).toBe(200);
  const body: ApiResponse<{ kind?: string; gateMode?: string; lifecyclePhase?: string; phases?: Array<{ name: string; gates?: string[]; createsTickets?: boolean }> }> = await res.json();
  expect(body.success).toBe(true);
  expect(body.data?.kind).toBe("pipeline");
  expect(body.data?.gateMode).toBe("manual");
  expect(body.data?.lifecyclePhase).toBe(expected.lifecyclePhase);
  expect(body.data?.phases?.length).toBe(expected.phaseCount);
  const gatePhase = body.data?.phases?.find((p) => p.name === expected.gatePhase);
  expect(gatePhase?.gates).toEqual([expected.gate]);
  for (const phase of body.data?.phases ?? []) {
    expect((phase as Record<string, unknown>).subSkills).toBeUndefined();
  }
}

test.describe("Pipeline phase 4 smoke (/slice, /polish, /release)", () => {
  test.describe.configure({ mode: "serial" });

  test("/slice contract — 3 phases, TD-SYSTEM-BOUNDARY on prototype", async ({ request }) => {
    await contractFor(request, "pipeline-slice", { lifecyclePhase: "pre-production", phaseCount: 3, gatePhase: "prototype", gate: "TD-SYSTEM-BOUNDARY" });
  });

  test("/polish contract — 4 phases, AD-PHASE-GATE on qa-pass", async ({ request }) => {
    await contractFor(request, "pipeline-polish", { lifecyclePhase: "polish", phaseCount: 4, gatePhase: "qa-pass", gate: "AD-PHASE-GATE" });
  });

  test("/release contract — 4 phases, PR-MILESTONE on final-signoff (createsTickets)", async ({ request }) => {
    const res = await request.get(`${API}/skills/pipeline-release`, { headers: { "x-api-key": API_KEY } });
    expect(res.status()).toBe(200);
    const body: ApiResponse<{ lifecyclePhase?: string; phases?: Array<{ name: string; gates?: string[]; createsTickets?: boolean }> }> = await res.json();
    expect(body.data?.lifecyclePhase).toBe("release");
    expect(body.data?.phases?.length).toBe(4);
    const finalPhase = body.data?.phases?.find((p) => p.name === "final-signoff");
    expect(finalPhase?.gates).toEqual(["PR-MILESTONE"]);
    expect(finalPhase?.createsTickets).toBe(true);
    // release-build phase exists (the build-hook target).
    expect(body.data?.phases?.some((p) => p.name === "release-build")).toBe(true);
  });

  test("POST /start for each Phase 4 pipeline returns a runId; /stop cancels", async ({ request }) => {
    for (const skillName of ["pipeline-slice", "pipeline-polish", "pipeline-release"]) {
      const { projectId, sessionId } = await createProjectAndSession(request, skillName);
      const res = await request.post(`${API}/pipeline/start`, {
        headers: { "x-api-key": API_KEY },
        data: { skillName, sessionId, projectId },
      });
      expect(res.status()).toBe(200);
      const body: ApiResponse<{ runId: string }> = await res.json();
      expect(body.data?.runId).toMatch(/^run-[a-z0-9-]+$/);

      await new Promise((r) => setTimeout(r, 150));
      const stop = await request.post(`${API}/pipeline/runs/${body.data!.runId}/stop`, { headers: { "x-api-key": API_KEY } });
      expect([200, 404]).toContain(stop.status()); // 404 if it already completed/cancelled
      await request.delete(`${API}/dashboard/projects/${projectId}`, { headers: { "x-api-key": API_KEY } });
    }
  });
});
