import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import type {
  DashboardData,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectEngine,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
import { orphanProjectSessions } from "./chat.js";
import { removeGodotMCPService, installGodotMCPPlugin, isGodotMCPPluginInstalled, isGodotMCPPluginEnabled, launchGodotEditor } from "../services/godot-mcp-service.js";
import { detectEngineFromWorkspace } from "../services/llm-service.js";
import { resolveProjectWorkspace, validateWorkspacePath } from "../utils/workspace.js";
import path from "node:path";

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

// POST /api/dashboard/validate-path - Validate a workspace path
dashboardRouter.post("/validate-path", async (req: Request, res: Response) => {
  const { path: inputPath } = req.body as { path?: string };
  if (!inputPath) {
    res.status(400).json({ success: false, error: "path is required" });
    return;
  }
  const result = validateWorkspacePath(inputPath);
  res.json({ success: true, data: result });
});

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

    // Validate workspacePath if provided
    const workspacePath = body.workspacePath ?? null;
    if (workspacePath) {
      const validation = validateWorkspacePath(workspacePath);
      if (path.isAbsolute(workspacePath) && !validation.exists) {
        res.status(400).json({ success: false, error: `Directory does not exist: ${workspacePath}` });
        return;
      }
      if (validation.error && validation.error.includes("traversal")) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }
    }

    // Auto-detect engine from workspacePath if provided and engine not specified
    let engine: ProjectEngine | null = body.engine ?? null;
    if (!engine && workspacePath) {
      const detected = await detectEngineFromWorkspace(workspacePath);
      if (detected) {
        engine = detected as ProjectEngine;
      }
    }

    const newProject = normalizeProject({
      id: `proj-${Date.now()}`,
      name: body.name,
      description: body.description ?? "",
      engine,
      progress: 0,
      status: "active",
      workspacePath,
      icon: body.icon ?? "folder",
      createdAt: now,
      updatedAt: now,
    });

    data.projects.push(newProject);
    await writeData("dashboard.json", data);

    // Auto-install Godot MCP plugin for Godot projects with workspacePath
    let pluginInstallResult: { success: boolean; pluginCopied: boolean; pluginEnabled: boolean; error?: string } | null = null;
    if (engine === "godot" && workspacePath) {
      const projectDir = resolveProjectWorkspace(workspacePath);
      pluginInstallResult = installGodotMCPPlugin(projectDir, projectDir);
      if (!pluginInstallResult.success && pluginInstallResult.error) {
        logger.warn({ error: pluginInstallResult.error, projectDir }, "Failed to auto-install Godot MCP plugin");
      }
    }

    // Broadcast event
    broadcastEvent({
      type: "project:created",
      project: newProject,
    } as WSEvent);

    res.status(201).json({
      success: true,
      data: newProject,
      pluginInstall: pluginInstallResult,
    });
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

    // Orphan any chat sessions tied to this project (history is preserved
    // but the sessions become hidden from the project-scoped UI).
    await orphanProjectSessions(String(id));

    // Stop Godot MCP service if running for this project
    await removeGodotMCPService(String(id)).catch(() => {});

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

// POST /api/dashboard/projects/:id/install-plugin - Install Godot MCP plugin
dashboardRouter.post("/projects/:id/install-plugin", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === id);

    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    if (project.engine !== "godot") {
      res.status(400).json({ success: false, error: "Project is not a Godot project" });
      return;
    }

    if (!project.workspacePath) {
      res.status(400).json({ success: false, error: "Project has no workspace path configured" });
      return;
    }

    const projectDir = resolveProjectWorkspace(project.workspacePath);
    const result = installGodotMCPPlugin(projectDir, projectDir);

    if (result.success) {
      res.json({
        success: true,
        data: {
          pluginCopied: result.pluginCopied,
          pluginEnabled: result.pluginEnabled,
        },
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch {
    res.status(500).json({ success: false, error: "Failed to install plugin" });
  }
});

// GET /api/dashboard/projects/:id/plugin-status - Check Godot MCP plugin status
dashboardRouter.get("/projects/:id/plugin-status", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === id);

    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    if (project.engine !== "godot") {
      res.status(400).json({ success: false, error: "Project is not a Godot project" });
      return;
    }

    if (!project.workspacePath) {
      res.json({
        success: true,
        data: {
          installed: false,
          enabled: false,
          error: "Project has no workspace path configured",
        },
      });
      return;
    }

    const projectDir = resolveProjectWorkspace(project.workspacePath);
    const installed = isGodotMCPPluginInstalled(projectDir);
    const enabled = isGodotMCPPluginEnabled(projectDir);

    res.json({
      success: true,
      data: {
        installed,
        enabled,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: "Failed to check plugin status" });
  }
});

// GET /api/dashboard/server-status - Check Godot MCP server status
dashboardRouter.get("/server-status", async (_req: Request, res: Response) => {
  try {
    const { findServerDir, isServerBuilt, isDependenciesInstalled } = await import("../services/godot-mcp-service.js");
    const serverDir = findServerDir();
    if (!serverDir) {
      res.json({
        success: true,
        data: {
          found: false,
          installed: false,
          built: false,
          error: "Server directory not found",
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        found: true,
        installed: isDependenciesInstalled(serverDir),
        built: isServerBuilt(serverDir),
        serverDir,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: "Failed to check server status" });
  }
});

// POST /api/dashboard/setup-server - Setup Godot MCP server (install + build)
dashboardRouter.post("/setup-server", async (_req: Request, res: Response) => {
  try {
    const { setupGodotMCPServer } = await import("../services/godot-mcp-service.js");
    const result = setupGodotMCPServer();

    if (result.success) {
      res.json({
        success: true,
        data: {
          installed: result.installed,
          built: result.built,
        },
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch {
    res.status(500).json({ success: false, error: "Failed to setup server" });
  }
});

// GET /api/dashboard/projects/:id/mcp-health - Check Godot MCP connection health
dashboardRouter.get("/projects/:id/mcp-health", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === id);

    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    if (project.engine !== "godot") {
      res.status(400).json({ success: false, error: "Project is not a Godot project" });
      return;
    }

    const { getGodotMCPService } = await import("../services/godot-mcp-service.js");
    const godotService = getGodotMCPService(String(id));

    if (!godotService?.running()) {
      res.json({
        success: true,
        data: {
          status: "not_running",
          message: "MCP service not started. Open the chat to start it.",
        },
      });
      return;
    }

    const health = await godotService.healthCheck();
    res.json({
      success: true,
      data: {
        status: health.godotConnected ? "connected" : "disconnected",
        serverRunning: health.serverRunning,
        godotConnected: health.godotConnected,
        projectInfo: health.projectInfo,
        error: health.error,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: "Failed to check MCP health" });
  }
});

// POST /api/dashboard/projects/:id/launch-editor - Launch Godot editor for a project
dashboardRouter.post("/projects/:id/launch-editor", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<DashboardData>("dashboard.json");
    const project = data.projects.find((p) => p.id === id);

    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    if (project.engine !== "godot") {
      res.status(400).json({ success: false, error: "Project is not a Godot project" });
      return;
    }

    const projectDir = project.workspacePath
      ? resolveProjectWorkspace(project.workspacePath)
      : null;

    if (!projectDir) {
      res.status(400).json({ success: false, error: "Project has no workspace path" });
      return;
    }

    const result = launchGodotEditor(projectDir);
    res.json({ success: result.success, data: result });
  } catch {
    res.status(500).json({ success: false, error: "Failed to launch editor" });
  }
});
