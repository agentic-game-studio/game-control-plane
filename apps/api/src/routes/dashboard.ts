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
    activeAgents: 8,
    credits: { current: 500, max: 500 },
  },
  projects: [],
  activityLog: [],
};

export const dashboardRouter: Router = Router();

// GET /api/dashboard - Get all dashboard data
dashboardRouter.get("/", (_req: Request, res: Response) => {
  try {
    const data = readData<DashboardData>("dashboard.json");
    res.json({ success: true, data });
  } catch {
    // Initialize with default data if file doesn't exist
    writeData("dashboard.json", DEFAULT_DATA);
    res.json({ success: true, data: DEFAULT_DATA });
  }
});

// GET /api/dashboard/projects - List all projects
dashboardRouter.get("/projects", (_req: Request, res: Response) => {
  try {
    const data = readData<DashboardData>("dashboard.json");
    res.json({ success: true, data: data.projects });
  } catch {
    res.json({ success: true, data: [] });
  }
});

// GET /api/dashboard/projects/:id - Get project by ID
dashboardRouter.get("/projects/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === id);
    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to read project" });
  }
});

// POST /api/dashboard/projects - Create new project
dashboardRouter.post("/projects", (req: Request, res: Response) => {
  const body = req.body as CreateProjectRequest;

  if (!body.name || !body.engine) {
    res.status(400).json({ success: false, error: "name and engine are required" });
    return;
  }

  try {
    const data = readData<DashboardData>("dashboard.json");
    const now = new Date().toISOString();
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name: body.name,
      description: body.description ?? "",
      engine: body.engine,
      progress: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    data.projects.push(newProject);
    data.summary.totalProjects = data.projects.length;
    writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:created",
      project: newProject,
    } as WSEvent);

    res.status(201).json({ success: true, data: newProject });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create project" });
  }
});

// PATCH /api/dashboard/projects/:id - Update project
dashboardRouter.patch("/projects/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateProjectRequest;

  try {
    const data = readData<DashboardData>("dashboard.json");
    const projectIndex = data.projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    const projectId = String(id);
    const updatedProject: Project = {
      ...data.projects[projectIndex],
      ...updates,
      id: projectId, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString(),
    };

    data.projects[projectIndex] = updatedProject;
    writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:updated",
      project: updatedProject,
    } as WSEvent);

    res.json({ success: true, data: updatedProject });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update project" });
  }
});

// DELETE /api/dashboard/projects/:id - Delete project
dashboardRouter.delete("/projects/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = readData<DashboardData>("dashboard.json");
    const projectIndex = data.projects.findIndex((p) => p.id === id);

    if (projectIndex === -1) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    data.projects.splice(projectIndex, 1);
    data.summary.totalProjects = data.projects.length;
    writeData("dashboard.json", data);

    // Broadcast event
    broadcastEvent({
      type: "project:deleted",
      projectId: id,
    } as WSEvent);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete project" });
  }
});
