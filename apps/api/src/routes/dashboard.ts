import { Router } from "express";
import type { Request, Response } from "express";
import fs from "fs";
import { readData, writeData, updateData, broadcastEvent, deleteData, getOrCreateData } from "../services/data-store.js";
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
import { orphanProjectSessions, cancelSessionsForProject } from "./chat.js";
import { removeGodotMCPService, installGodotMCPPlugin, isGodotMCPPluginInstalled, isGodotMCPPluginEnabled, launchGodotEditor, findServerDir, isServerBuilt, isDependenciesInstalled, setupGodotMCPServer, getGodotMCPService } from "../services/godot-mcp-service.js";
import { dropProjectStore } from "./documents.js";
import { unwatchProjectAssets } from "./assets.js";
import { detectEngineFromWorkspace } from "../services/llm-service.js";
import { resolveProjectWorkspace, validateWorkspacePath } from "../utils/workspace.js";
import { getTicketsBoardFile, writeTicketsBoard } from "../services/ticket-board.js";
import { clearTicketProjectCacheForProject } from "../services/quest-bridge.js";
import { loadConfig } from "../config.js";
import { newId } from "../utils/ids.js";
import { ProjectNotFoundError } from "../utils/errors.js";
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
    // 11-H13: use the shared 128-bit id helper instead of Date.now() +
    // 4 chars of random. The old pattern collided on parallel project
    // creation bursts; the new one uses a full UUID.
    id: project.id ?? newId("proj"),
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
  // 16-H-dashboard-read-toctou: previously this was a manual
  // try/readData → catch/writeData(DEFAULT_DATA) pattern. Two
  // concurrent callers that both saw the file missing would
  // both enter the catch and both call writeData(DEFAULT_DATA),
  // racing each other and losing whichever write landed second
  // (and worse: clobbering any state a third caller had just
  // written between the two reads). getOrCreateData() serializes
  // the read/create through fileLocks so only one process path
  // ever performs the initial write.
  return await getOrCreateData<DashboardData>(
    "dashboard.json",
    () => structuredClone(DEFAULT_DATA),
  );
}

async function writeDemoGodotProject(projectDir: string): Promise<void> {
  // 11-M5: switched from sync to async fs. Originally `writeFileSync` /
  // `mkdirSync` were used inside a callback passed to `updateData()` —
  // an async-only path. On slow disks (Docker volumes, NFS) a 6-file
  // sync write could block the event loop for tens of ms per call,
  // serializing the entire Express server. `fs.promises` keeps the
  // ergonomics and yields properly.
  await fs.promises.mkdir(path.join(projectDir, "scenes"), { recursive: true });
  await fs.promises.mkdir(path.join(projectDir, "scripts"), { recursive: true });
  await fs.promises.mkdir(path.join(projectDir, "design"), { recursive: true });

  await fs.promises.writeFile(
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

  await fs.promises.writeFile(
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

  await fs.promises.writeFile(
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

  await fs.promises.writeFile(
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

  await fs.promises.writeFile(
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

    await updateData<DashboardData>("dashboard.json", async (data) => {
      const existing = data.projects.find((p) => p.workspacePath === workspacePath);
      if (existing) {
        demoProject = existing;
        created = false;
        return data;
      }

      const projectId = newId("proj-demo");
      const projectDir = resolveProjectWorkspace(workspacePath);
      await writeDemoGodotProject(projectDir);

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
        id: newId("log"),
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
        id: newId("ticket-demo-movement"),
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
        id: newId("ticket-demo-coins"),
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
        id: newId("ticket-demo-qa"),
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
    // 24-M-logger-event-convention: tag the failure with an `event` so
    // it can be filtered / alerted in production. The message text
    // "Failed to create demo project" leaks into the log line; pairing
    // it with a stable discriminator makes it greppable across the
    // rest of the dashboard route and the few autonomous ones that
    // share this codepath.
    logger.error(
      { error: err instanceof Error ? err.message : String(err), event: "dashboard_create_demo_failed" },
      "Failed to create demo project",
    );
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
  const result = await validateWorkspacePath(inputPath);
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

    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isDirectory()) {
        res.status(400).json({ success: false, error: "Not a valid directory" });
        return;
      }
    } catch {
      res.status(400).json({ success: false, error: "Not a valid directory" });
      return;
    }

    const dirents = await fs.promises.readdir(resolved, { withFileTypes: true });
    // 11-C1: filter dotfile/dotdir entries. The previous version
    // returned every directory name in the listing, including
    // `.ssh`, `.aws`, `.config/gh`, `.git`, `.env`, etc. The frontend
    // then offered to "open" these paths and the editor would
    // happily try to read them. Server-side blocklist so the leak
    // is independent of the UI's filter (which the API shouldn't
    // trust anyway).
    const directories = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
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
  // 21-C-dashboard-read-toctou: previously this was a manual
  // try/readData → catch/writeData(DEFAULT_DATA) pattern. Two
  // concurrent first-time GETs both saw ENOENT, both entered the
  // catch, and both wroteData(DEFAULT_DATA). Worse, a
  // `POST /api/dashboard/projects` that landed between the two
  // reads was clobbered by the second writeData. The
  // `readDashboardOrDefault` helper above was added in 16-H to
  // route this through `getOrCreateData` (per-file mutex), but
  // nothing ever called it — the dead helper was the actual fix
  // and the route never adopted it. Wire it up now.
  const data = await readDashboardOrDefault();
  res.json({ success: true, data: normalizeDashboardData(data) });
});

// GET /api/dashboard/projects - List all projects
dashboardRouter.get("/projects", async (_req: Request, res: Response) => {
  // 21-C-dashboard-read-toctou: same fix as the / route above —
  // was `try { readData } catch { res.json([]) }`. Two concurrent
  // first-time callers racing the missing-file window would each
  // see the catch path; the second writeData (in the / route)
  // clobbered the first. Use the helper so a missing file goes
  // through getOrCreateData (per-file mutex).
  const data = await readDashboardOrDefault();
  res.json({ success: true, data: normalizeDashboardData(data).projects });
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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_read_project_failed", projectId: id },
      "Failed to read project",
    );
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
    // Validate workspacePath if provided. Validation is async and does not
    // need the locked dashboard.json contents, so it happens outside the
    // updateData callback.
    const workspacePath = body.workspacePath ?? null;
    if (workspacePath) {
      const validation = await validateWorkspacePath(workspacePath);
      if (path.isAbsolute(workspacePath)) {
        if (!validation.exists) {
          res.status(400).json({ success: false, error: `Directory does not exist: ${workspacePath}` });
          return;
        }
        const config = loadConfig();
        const resolved = path.resolve(workspacePath);
        const resolvedWorkspace = path.resolve(config.WORKSPACE_DIR);
        // 10-C4: require the boundary check to use a trailing separator
        // so a sibling directory like `/app/workspace-other` does not
        // satisfy `startsWith("/app/workspace")`. The previous bare
        // `startsWith` accepted any path sharing the workspace's prefix.
        if (
          resolved !== resolvedWorkspace &&
          !resolved.startsWith(resolvedWorkspace + path.sep)
        ) {
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

    const now = new Date().toISOString();
    const newProject = normalizeProject({
      // 11-H13: pre-assign a 128-bit id (from the same helper used by
      // normalizeProject) so two concurrent POST /projects calls in the
      // same millisecond don't collide before they reach the write lock.
      id: newId("proj"),
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

    // 10-H5: route the append through updateData so two concurrent POST
    // /projects calls serialize on the per-file mutex. The previous direct
    // readData + writeData pair had a lost-update race: both callers would
    // read the same baseline and the second's writeData would clobber the
    // first's project.
    // 19-H-dashboard-double-create: idempotency check inside the
    // lock. The previous code only checked name+workspacePath after
    // creating the entry, so a user double-clicking "Create" (or a
    // frontend retry on a slow network) would push two distinct
    // projects with the same workspacePath. Worse, the
    // Godot-plugin auto-install at line 535 would race on the
    // filesystem rm+cp — concurrent installs to the same projectDir
    // could corrupt the addons/godot_mcp/ tree. Detect the dup
    // inside the mutex (read+check+append is one atomic step) and
    // return the existing project so the client gets a deterministic
    // answer. We use a closure-captured flag rather than widening
    // updateData's return type — the helper's `T → T` signature
    // shouldn't be polluted with side-channel metadata.
    let deduped: Project | null = null;
    await updateData<DashboardData>("dashboard.json", (data) => {
      // Match by workspacePath when present (most specific — two
      // projects can't share a workspace) or by name when not. The
      // dedup is intentionally lenient on name only because users
      // often want multiple projects named similarly; a strict
      // name-only match would be a foot-gun.
      const dup = data.projects.find((p) =>
        (workspacePath && p.workspacePath && p.workspacePath === workspacePath) ||
        (!workspacePath && p.name === body.name),
      );
      if (dup) {
        deduped = dup;
        return data;
      }
      data.projects.push(newProject);
      return data;
    });

    if (deduped) {
      res.json({ success: true, data: deduped, deduplicated: true });
      return;
    }

    // Auto-install Godot MCP plugin for Godot projects with workspacePath
    let pluginInstallResult: { success: boolean; pluginCopied: boolean; pluginEnabled: boolean; error?: string } | null = null;
    if (engine === "godot" && workspacePath) {
      const projectDir = resolveProjectWorkspace(workspacePath);
      pluginInstallResult = await installGodotMCPPlugin(projectDir, projectDir);
      if (!pluginInstallResult.success && pluginInstallResult.error) {
        // 24-M-logger-event-convention: tag the auto-install failure
        // with an `event` discriminator. The plugin install runs
        // fire-and-forget on project create; without a discriminator
        // these warnings get lost in the noise. Pair with the
        // existing `dashboard_godot_mcp_install_*` event names so a
        // single filter catches every plugin install attempt.
        logger.warn(
          { error: pluginInstallResult.error, projectDir, event: "dashboard_godot_mcp_auto_install_failed" },
          "Failed to auto-install Godot MCP plugin",
        );
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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_create_project_failed" },
      "Failed to create project",
    );
    res.status(500).json({ success: false, error: "Failed to create project" });
  }
});

// PATCH /api/dashboard/projects/:id - Update project
dashboardRouter.patch("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  // Validate that req.body is a plain object before we cast — a non-object
  // body (array, string, number) would still pass the cast below and
  // explode at the `in updates` check with a confusing TypeError. Refuse
  // early with a 400 so the caller gets a meaningful error.
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ success: false, error: "Request body must be a JSON object" });
    return;
  }
  const updates = req.body as UpdateProjectRequest;

  try {
    const projectId = String(id);
    // Whitelist allowed update fields to prevent arbitrary field injection
    const allowedFields = ["name", "description", "engine", "progress", "status", "workspacePath", "icon"] as const;
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in updates) safeUpdates[key] = (updates as Record<string, unknown>)[key];
    }

    // 10-H5: serialize the PATCH through the per-file mutex so a concurrent
    // PATCH or DELETE cannot lose this update. The 404 path raises a
    // typed error inside the callback so the writeData step is skipped.
    let updatedProject: Project | null = null;
    try {
      await updateData<DashboardData>("dashboard.json", (data) => {
        const projectIndex = data.projects.findIndex((p) => p.id === id);
        if (projectIndex === -1) {
          // 11-M17: typed error carrying the id (vs the previous
          // string-sentinel "__PROJECT_NOT_FOUND__" which a typo
          // would silently 500).
          throw new ProjectNotFoundError(String(id));
        }
        updatedProject = normalizeProject({
          ...data.projects[projectIndex],
          ...safeUpdates,
          id: projectId,
          updatedAt: new Date().toISOString(),
        });
        data.projects[projectIndex] = updatedProject;
        return data;
      });
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }
      throw e;
    }

    // Broadcast event
    broadcastEvent({
      type: "project:updated",
      project: updatedProject!,
    } as WSEvent);

    res.json({ success: true, data: updatedProject });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_update_project_failed", projectId: id },
      "Failed to update project",
    );
    res.status(500).json({ success: false, error: "Failed to update project" });
  }
});

// DELETE /api/dashboard/projects/:id - Delete project
dashboardRouter.delete("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 10-H5: serialize the delete through the per-file mutex.
    try {
      await updateData<DashboardData>("dashboard.json", (data) => {
        const projectIndex = data.projects.findIndex((p) => p.id === id);
        if (projectIndex === -1) {
          // 11-M17: typed error (see PATCH handler above)
          throw new ProjectNotFoundError(String(id));
        }
        data.projects.splice(projectIndex, 1);
        return data;
      });
    } catch (e) {
      // 11-M17: typed error (matches PATCH handler above)
      if (e instanceof ProjectNotFoundError) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }
      throw e;
    }

    // Cancel any in-flight LLM calls for sessions of this project BEFORE
    // orphaning them. Without this, a running LLM call would continue to
    // write progress messages and tool results to a project that's about
    // to be gone, leaking tokens and creating race conditions on the
    // just-orphaned sessions.
    const cancelled = cancelSessionsForProject(String(id));
    if (cancelled > 0) {
      logger.info({ projectId: id, cancelled, event: "project_delete_cancel_llm" },
        `Cancelled ${cancelled} in-flight LLM call(s) for project`);
    }

    // Orphan any chat sessions tied to this project (history is preserved
    // but the sessions become hidden from the project-scoped UI).
    await orphanProjectSessions(String(id));

    // All of the following are independent of each other and of the
    // broadcast below, so fan them out in parallel. Each is best-effort
    // and must not block the DELETE response on slow filesystem I/O.
    const projectIdStr = String(id);
    const ticketsFile = getTicketsBoardFile(projectIdStr);
    const [{ clearProjectProducerSummary }] = await Promise.all([
      import("../services/producer-summary.js").catch(() => ({ clearProjectProducerSummary: () => {} })),
    ]);
    await Promise.all([
      removeGodotMCPService(projectIdStr).catch(() => {}),
      Promise.resolve(dropProjectStore(projectIdStr)),
      Promise.resolve(unwatchProjectAssets(projectIdStr)),
      Promise.resolve(clearProjectProducerSummary(projectIdStr)),
      Promise.resolve(clearTicketProjectCacheForProject(projectIdStr)),
      deleteData(ticketsFile).catch(() => {}),
    ]);

    // Broadcast event
    broadcastEvent({
      type: "project:deleted",
      projectId: id,
    } as WSEvent);

    res.json({ success: true });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_delete_project_failed", projectId: id },
      "Failed to delete project",
    );
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
    const result = await installGodotMCPPlugin(projectDir, projectDir);

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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_install_plugin_failed", projectId: id },
      "Failed to install plugin",
    );
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
    // 28-H-godot-mcp-async-read: isGodotMCPPluginEnabled is now async.
    const enabled = await isGodotMCPPluginEnabled(projectDir);

    res.json({
      success: true,
      data: {
        installed,
        enabled,
      },
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_check_plugin_status_failed", projectId: id },
      "Failed to check plugin status",
    );
    res.status(500).json({ success: false, error: "Failed to check plugin status" });
  }
});

// GET /api/dashboard/server-status - Check Godot MCP server status
dashboardRouter.get("/server-status", async (_req: Request, res: Response) => {
  try {
    // 25-M-dynamic-import-cleanup: all three symbols are now
    // statically imported at the top of this file. The previous
    // dynamic import was paid on every /server-status hit
    // (UI polls this every 10s on the dashboard). The module
    // is already loaded for the rest of the route, so the
    // dynamic path was pure overhead.
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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_check_server_status_failed" },
      "Failed to check server status",
    );
    res.status(500).json({ success: false, error: "Failed to check server status" });
  }
});

// POST /api/dashboard/setup-server - Setup Godot MCP server (install + build)
dashboardRouter.post("/setup-server", async (_req: Request, res: Response) => {
  try {
    // 25-M-dynamic-import-cleanup: setupGodotMCPServer is now
    // statically imported at the top of this file.
    // 28-H-godot-mcp-async-exec: now async — await the call.
    const result = await setupGodotMCPServer();

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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_setup_server_failed" },
      "Failed to setup server",
    );
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

    // 25-M-dynamic-import-cleanup: getGodotMCPService is now
    // statically imported at the top of this file.
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
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_check_mcp_health_failed", projectId: id },
      "Failed to check MCP health",
    );
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

    const result = await launchGodotEditor(projectDir);
    res.json({ success: result.success, data: result });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "dashboard_launch_editor_failed", projectId: id },
      "Failed to launch editor",
    );
    res.status(500).json({ success: false, error: "Failed to launch editor" });
  }
});
