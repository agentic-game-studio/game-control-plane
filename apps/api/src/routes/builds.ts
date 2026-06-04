import { Router } from "express";
import type { Request, Response } from "express";
import {
  listBuilds,
  executeGodotExport,
  runPostExportSmokeTest,
  bumpProjectVersion,
} from "../services/build-service.js";
import { runShipThisExport, isShipThisAvailable } from "../services/shipthis-service.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { readData } from "../services/data-store.js";
import type { BuildPlatform, DashboardData, CreateBuildRequest } from "@game-studio/types";

export const buildsRouter: Router = Router();

function getProjectId(req: Request): string | null {
  const q = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const b = req.body && typeof req.body.projectId === "string" ? req.body.projectId : null;
  return q ?? b ?? null;
}

async function resolveWorkspace(projectId: string): Promise<string | null> {
  // 28-C-builds-resolve-workspace: previous shape returned
  // `project?.workspacePath ?? projectId` — a non-null string even
  // when the project didn't exist. The five downstream routes
  // (`if (!workspace) res.status(404)`) were dead checks that always
  // resolved falsy. A bogus projectId would then fall through to
  // `executeGodotExport(projectId, projectId, ...)` →
  // `resolveProjectWorkspace(projectId)` → `mkdirSync` on a fake
  // path, creating a 0-byte build record and a 500 instead of the
  // expected 404. The single fix: return null when the project is
  // not found, and let each route's existing guard do its job.
  const data = await readData<DashboardData>("dashboard.json");
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return project.workspacePath ?? null;
}

// GET /api/builds
buildsRouter.get("/", async (req: Request, res: Response) => {
  const projectId = getProjectId(req);
  const builds = await listBuilds(projectId ?? undefined);
  res.json({ success: true, data: builds });
});

// POST /api/builds — register pending build
buildsRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateBuildRequest;
  if (!body.projectId || !body.platform) {
    res.status(400).json({ success: false, error: "projectId and platform are required" });
    return;
  }
  const workspace = await resolveWorkspace(body.projectId);
  if (!workspace) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }
  const build = await executeGodotExport(body.projectId, workspace, body.platform, body.preset);
  res.status(201).json({ success: true, data: build });
});

// POST /api/builds/:id/smoke — post-export smoke test
buildsRouter.post("/:id/smoke", async (req: Request, res: Response) => {
  const projectId = getProjectId(req);
  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }
  const workspace = await resolveWorkspace(projectId);
  if (!workspace) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }
  const build = await runPostExportSmokeTest(String(req.params.id), workspace);
  if (!build) {
    res.status(404).json({ success: false, error: "Build not found" });
    return;
  }
  res.json({ success: true, data: build });
});

// POST /api/builds/export — export with optional version bump
buildsRouter.post("/export", async (req: Request, res: Response) => {
  const { projectId, platform, preset, bumpVersion } = req.body as {
    projectId?: string;
    platform?: BuildPlatform;
    preset?: string;
    bumpVersion?: boolean;
  };
  if (!projectId || !platform) {
    res.status(400).json({ success: false, error: "projectId and platform are required" });
    return;
  }
  const workspace = await resolveWorkspace(projectId);
  if (!workspace) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }
  const build = await executeGodotExport(projectId, workspace, platform, preset, !!bumpVersion);
  res.json({ success: true, data: build });
});

// POST /api/builds/ship — ShipThis cloud export
buildsRouter.post("/ship", async (req: Request, res: Response) => {
  const { projectId, platform } = req.body as { projectId?: string; platform?: "android" | "ios" };
  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }
  if (!isShipThisAvailable()) {
    res.status(503).json({ success: false, error: "ShipThis CLI not available" });
    return;
  }
  const workspace = await resolveWorkspace(projectId);
  if (!workspace) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }
  const projectPath = resolveProjectWorkspace(workspace);
  const result = await runShipThisExport(projectPath, platform ?? "android");
  if (!result.success) {
    res.status(500).json({ success: false, error: result.error, data: { output: result.output } });
    return;
  }
  res.json({ success: true, data: { output: result.output } });
});

// POST /api/builds/bump-version
buildsRouter.post("/bump-version", async (req: Request, res: Response) => {
  const { projectId, bump } = req.body as { projectId?: string; bump?: "patch" | "minor" | "major" };
  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }
  const workspace = await resolveWorkspace(projectId);
  if (!workspace) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }
  const projectPath = resolveProjectWorkspace(workspace);
  // 28-H-qa-gate-async-version-helpers: bumpProjectVersion is now async.
  const version = await bumpProjectVersion(projectPath, bump ?? "patch");
  res.json({ success: true, data: { version } });
});
