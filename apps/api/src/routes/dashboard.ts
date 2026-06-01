import { Router } from "express";
import type { Request, Response } from "express";
import fs from "fs";
import { readData, writeData, updateData, broadcastEvent, deleteData } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import type {
  DashboardData,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectEngine,
  Ticket,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
import { orphanProjectSessions } from "./chat.js";
import { removeGodotMCPService, installGodotMCPPlugin, isGodotMCPPluginInstalled, isGodotMCPPluginEnabled, launchGodotEditor } from "../services/godot-mcp-service.js";
import { dropProjectStore } from "./documents.js";
import { unwatchProjectAssets } from "./assets.js";
import { detectEngineFromWorkspace } from "../services/llm-service.js";
import { resolveProjectWorkspace, validateWorkspacePath } from "../utils/workspace.js";
import { getTicketsBoardFile, writeTicketsBoard } from "../services/ticket-board.js";
import { loadConfig } from "../config.js";
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

async function readDashboardOrDefault(): Promise<DashboardData> {
  try {
    return await readData<DashboardData>("dashboard.json");
  } catch {
    await writeData("dashboard.json", DEFAULT_DATA);
    return structuredClone(DEFAULT_DATA);
  }
}

function writeDemoGodotProject(projectDir: string): void {
  fs.mkdirSync(path.join(projectDir, "scenes"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "design"), { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, "project.godot"),
    [
      "; Engine configuration file.",
      "config_version=5",
      "",
      "[application]",
      'config/name="Railway Demo Platformer"',
      'run/main_scene="res://scenes/main.tscn"',
      'config/features=PackedStringArray("4.3", "Forward Plus")',
      "",
      "[display]",
      "window/size/viewport_width=960",
      "window/size/viewport_height=540",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(projectDir, "scenes/main.tscn"),
    [
      '[gd_scene load_steps=2 format=3 uid="uid://railway-demo-main"]',
      "",
      '[ext_resource type="Script" path="res://scripts/player.gd" id="1_player"]',
      "",
      '[node name="Main" type="Node2D"]',
      "",
      '[node name="Player" type="CharacterBody2D" parent="."]',
      'script = ExtResource("1_player")',
      "",
      '[node name="Camera2D" type="Camera2D" parent="Player"]',
      "enabled = true",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(projectDir, "scripts/player.gd"),
    [
      "extends CharacterBody2D",
      "",
      "const SPEED := 220.0",
      "const JUMP_VELOCITY := -360.0",
      "const GRAVITY := 980.0",
      "",
      "func _physics_process(delta: float) -> void:",
      "\tif not is_on_floor():",
      "\t\tvelocity.y += GRAVITY * delta",
      "",
      '\tvar direction := Input.get_axis("ui_left", "ui_right")',
      "\tvelocity.x = direction * SPEED",
      "",
      '\tif Input.is_action_just_pressed("ui_accept") and is_on_floor():',
      "\t\tvelocity.y = JUMP_VELOCITY",
      "",
      "\tmove_and_slide()",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(projectDir, "design/gdd.md"),
    [
      "# Railway Demo Platformer",
      "",
      "A small cloud-hosted Godot workspace seeded for hackathon judging.",
      "",
      "## Core Loop",
      "- Move through a compact level.",
      "- Collect coins.",
      "- Avoid patrol enemies.",
      "- Reach the exit before the timer ends.",
      "",
      "## Demo Notes",
      "This project lives in the Railway persistent workspace, not on a local laptop.",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(projectDir, "README.md"),
    [
      "# Railway Demo Platformer",
      "",
      "This cloud workspace was created by the Control Plane demo flow.",
      "Judges can use it to test dashboard, quests, chat context, assets, and build orchestration screens online.",
      "",
    ].join("\n"),
  );
}

// POST /api/dashboard/demo-project - Seed a judge-friendly cloud demo project
dashboardRouter.post("/demo-project", async (_req: Request, res: Response) => {
  try {
    const workspacePath = "demo-godot-platformer";
    const now = new Date().toISOString();

    // Use updateData so the read-then-check-then-create runs under the
    // dashboard.json mutex. Without this, two concurrent judges hitting
    // the endpoint in the same tick both see `existing === undefined`,
    // both call writeDemoGodotProject(), and both append to projects,
    // producing duplicate demo entries. The filesystem side effect lives
    // inside the updater so it only runs for the first caller. We capture
    // `created` + the project via closure (same pattern as the fromColumn
    // capture in quest-bridge) since updateData only returns the data.
    let demoProject: Project | null = null;
    let created = false;

    await updateData<DashboardData>("dashboard.json", (data) => {
      const existing = data.projects.find((p) => p.workspacePath === workspacePath);
      if (existing) {
        demoProject = existing;
        created = false;
        return data;
      }

      const projectId = `proj-demo-${Date.now()}`;
      const projectDir = resolveProjectWorkspace(workspacePath);
      writeDemoGodotProject(projectDir);

      const newProject = normalizeProject({
        id: projectId,
        name: "Railway Demo Platformer",
        description: "Cloud-hosted Godot sample for hackathon judges",
        engine: "godot",
        progress: 35,
        status: "active",
        workspacePath,
        icon: "sports_esports",
        createdAt: now,
        updatedAt: now,
      });

      data.projects.push(newProject);
      data.activityLog.unshift({
        id: `log-${Date.now()}`,
        timestamp: now,
        level: "info",
        source: "demo",
        message: "Seeded Railway demo project in cloud workspace",
      });
      demoProject = newProject;
      created = true;
      return data;
    });

    if (!demoProject) {
      // Should not happen — updater always sets this. Treat as failure.
      res.status(500).json({ success: false, error: "Failed to create demo project" });
      return;
    }

    // Capture into a const so TypeScript narrows the type once and the
    // remaining code doesn't have to thread the `Project | null` through
    // every reference. The closure assignment in the updater is the
    // (sole) source of this value, so after the null check above, the
    // `as Project` cast is safe.
    const project: Project = demoProject;

    if (!created) {
      res.json({ success: true, data: project });
      return;
    }

    const projectId = project.id;
    const tickets: Ticket[] = [
      {
        id: `ticket-demo-${Date.now()}-movement`,
        projectId,
        title: "Verify platformer movement feel",
        description: "Check run, jump, gravity, and camera behavior in the seeded Godot scene.",
        area: "gameplay",
        subarea: "player-controller",
        credits: 2,
        estimateHours: 1,
        status: "available",
        agentRole: "godot-specialist",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `ticket-demo-${Date.now()}-coins`,
        projectId,
        title: "Add coin pickup loop",
        description: "Create collectible coins, HUD count, and pickup feedback.",
        area: "gameplay",
        subarea: "collectibles",
        credits: 3,
        estimateHours: 2,
        status: "in_progress",
        agentRole: "gameplay-programmer",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `ticket-demo-${Date.now()}-qa`,
        projectId,
        title: "Smoke-test web export readiness",
        description: "Confirm the project has a main scene and basic boot path for export testing.",
        area: "qa",
        subarea: "smoke-test",
        credits: 2,
        estimateHours: 1,
        status: "qa",
        agentRole: "qa-tester",
        createdAt: now,
        updatedAt: now,
      },
    ];

    await writeTicketsBoard(
      {
        projectId,
        sprint: "Hackathon Demo Sprint",
        milestone: "Online Judge Demo",
        columns: [
          { id: "available", label: "Available", tickets: tickets.filter((t) => t.status === "available") },
          { id: "in_progress", label: "Processing", tickets: tickets.filter((t) => t.status === "in_progress") },
          { id: "qa", label: "Verify", tickets: tickets.filter((t) => t.status === "qa") },
          { id: "completed", label: "Archived", tickets: [] },
        ],
      },
      projectId,
    );

    broadcastEvent({
      type: "project:created",
      project,
    } as WSEvent);

    res.status(201).json({ success: true, data: project });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to create demo project");
    res.status(500).json({ success: false, error: "Failed to create demo project" });
  }
});

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

// POST /api/dashboard/browse-directory - List child directories of a path
dashboardRouter.post("/browse-directory", async (req: Request, res: Response) => {
  try {
    const { path: inputPath } = req.body as { path?: string };
    // Default to WORKSPACE_DIR (the trusted boundary) instead of os.homedir(),
    // which would otherwise expose the entire home filesystem to a UI browser.
    const workspaceDir = loadConfig().WORKSPACE_DIR;
    const dirPath = inputPath?.trim() || workspaceDir;

    // Resolve FIRST, then validate the result is inside the workspace boundary.
    // The previous substring `..` check ran on the raw input and could be
    // bypassed by paths like "/etc/.." that resolve to a parent of the
    // workspace.
    const resolved = path.resolve(dirPath);
    const resolvedWorkspace = path.resolve(workspaceDir);
    if (!resolved.startsWith(resolvedWorkspace + path.sep) && resolved !== resolvedWorkspace) {
      res.status(400).json({ success: false, error: "Path outside workspace" });
      return;
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.status(400).json({ success: false, error: "Not a valid directory" });
      return;
    }

    const dirents = fs.readdirSync(resolved, { withFileTypes: true });
    const directories = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const parentPath = path.dirname(resolved);
    // Never let the user "parent" out of the workspace.
    const safeParent = parentPath.startsWith(resolvedWorkspace + path.sep) || parentPath === resolvedWorkspace
      ? parentPath
      : null;

    res.json({
      success: true,
      data: {
        currentPath: resolved,
        parentPath: safeParent !== resolved ? safeParent : null,
        directories,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to browse directory" });
  }
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
      if (path.isAbsolute(workspacePath)) {
        // Absolute paths must exist AND be within the workspace directory
        if (!validation.exists) {
          res.status(400).json({ success: false, error: `Directory does not exist: ${workspacePath}` });
          return;
        }
        const config = loadConfig();
        const resolved = path.resolve(workspacePath);
        if (!resolved.startsWith(path.resolve(config.WORKSPACE_DIR))) {
          res.status(400).json({ success: false, error: "Absolute workspacePath must be within the workspace directory" });
          return;
        }
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
    // Whitelist allowed update fields to prevent arbitrary field injection
    const allowedFields = ["name", "description", "engine", "progress", "status", "workspacePath", "icon"] as const;
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in updates) safeUpdates[key] = (updates as Record<string, unknown>)[key];
    }
    const updatedProject = normalizeProject({
      ...data.projects[projectIndex],
      ...safeUpdates,
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

    // Drop the per-project document store (closes its fs.watch handle and
    // frees the in-memory graph). Without this, projectStores grows
    // unbounded as projects are created and deleted.
    dropProjectStore(String(id));

    // Drop the per-project assets fs.watch handle. Same reasoning as
    // dropProjectStore — the watcher entry is otherwise never cleaned up.
    unwatchProjectAssets(String(id));

    // Clean up associated data files (tickets board, autonomous loop state)
    const ticketsFile = getTicketsBoardFile(String(id));
    deleteData(ticketsFile).catch(() => {});

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
