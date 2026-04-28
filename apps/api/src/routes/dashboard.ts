import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import type {
  DashboardData,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const DEFAULT_DATA: DashboardData = {
  summary: {
    totalProjects: 0,
    activeDirectories: 0,
    credits: { current: 500, max: 500 },
  },
  projects: [],
  activityLog: [],
};

function normalizeProject(project: Partial<Project>): Project {
  return {
    id: project.id ?? `proj-${Date.now()}`,
    name: project.name ?? "Untitled Project",
    description: project.description ?? "",
    engine: project.engine ?? null,
    progress: project.progress ?? 0,
    status: project.status ?? "active",
    workspacePath: project.workspacePath ?? null,
    icon: project.icon ?? "folder",
    createdAt: project.createdAt ?? new Date().toISOString(),
    updatedAt: project.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeDashboardData(data: DashboardData): DashboardData {
  return {
    summary: {
      totalProjects: data.projects.length,
      activeDirectories: data.projects.filter((p) => p.workspacePath !== null).length,
      credits: data.summary.credits,
    },
    projects: data.projects.map(normalizeProject),
    activityLog: data.activityLog,
  };
}

export const dashboardRouter: Router = Router();

// GET /api/dashboard - Get all dashboard data
dashboardRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await readData<DashboardData>("dashboard.json");
    const normalized = normalizeDashboardData(data);
    res.json({ success: true, data: normalized });
  } catch {
    // Initialize with default data if file doesn't exist
    await writeData("dashboard.json", DEFAULT_DATA);
    res.json({ success: true, data: DEFAULT_DATA });
  }
});

// GET /api/dashboard/projects - List all projects
dashboardRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    const data = await readData<DashboardData>("dashboard.json");
    const normalized = normalizeDashboardData(data);
    res.json({ success: true, data: normalized.projects });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// GET /api/dashboard/projects/:id - Get project by ID
dashboardRouter.get("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await readData<DashboardData>("dashboard.json");
    const normalized = normalizeDashboardData(data);
    const project = normalized.projects.find((p) => p.id === id);
    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }
    res.json({ success: true, data: project });
  } catch {
    res.status(500).json({ success: false, error: "Failed to read project" });
  }
});

// POST /api/dashboard/projects - Create new project
dashboardRouter.post("/projects", async (req: Request, res: Response) => {
  const body = req.body as CreateProjectRequest;

  if (!body.name) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const now = new Date().toISOString();
    const newProject = normalizeProject({
      id: `proj-${Date.now()}`,
      name: body.name,
      description: body.description ?? "",
      engine: body.engine ?? null,
      progress: 0,
      status: "active",
      workspacePath: body.workspacePath ?? null,
      icon: body.icon ?? "folder",
      createdAt: now,
      updatedAt: now,
    });

    data.projects.push(newProject);
    await writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:created",
      project: newProject,
    } as WSEvent);

    res.status(201).json({ success: true, data: newProject });
  } catch {
    res.status(500).json({ success: false, error: "Failed to create project" });
  }
});

// PATCH /api/dashboard/projects/:id - Update project
dashboardRouter.patch("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateProjectRequest;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const projectIndex = data.projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    const projectId = String(id);
    const updatedProject = normalizeProject({
      ...data.projects[projectIndex],
      ...updates,
      id: projectId,
      updatedAt: new Date().toISOString(),
    });

    data.projects[projectIndex] = updatedProject;
    await writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:updated",
      project: updatedProject,
    } as WSEvent);

    res.json({ success: true, data: updatedProject });
  } catch {
    res.status(500).json({ success: false, error: "Failed to update project" });
  }
});

// DELETE /api/dashboard/projects/:id - Delete project
dashboardRouter.delete("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const projectIndex = data.projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    data.projects.splice(projectIndex, 1);
    await writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:deleted",
      projectId: id,
    } as WSEvent);

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: "Failed to delete project" });
  }
});
