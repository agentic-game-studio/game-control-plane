import { Router } from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { DocumentStore } from "../services/document-store.js";
import { loadConfig } from "../config.js";
import { broadcast } from "../services/websocket.js";
import { readData } from "../services/data-store.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { logger } from "../utils/logger.js";
import type { Project } from "@game-studio/types";

export const documentsRouter: Router = Router();

const config = loadConfig();

// Global store for backward compatibility (no project specified)
const globalStore = new DocumentStore(config.WORKSPACE_DIR);

// Per-project document stores keyed by projectId
const projectStores = new Map<string, DocumentStore>();

/** Look up a project by ID from dashboard.json */
async function getProjectById(projectId: string): Promise<Project | null> {
  try {
    const dashboard = await readData<{ projects: Project[] }>("dashboard.json");
    return dashboard.projects.find((p) => p.id === projectId) ?? null;
  } catch {
    return null;
  }
}

/** Get or create a DocumentStore for a project */
async function getProjectStore(projectId: string): Promise<DocumentStore | null> {
  const existing = projectStores.get(projectId);
  if (existing) return existing;

  const project = await getProjectById(projectId);
  if (!project) return null;

  let storeDir: string;
  if (project.workspacePath) {
    try {
      storeDir = resolveProjectWorkspace(project.workspacePath);
    } catch {
      storeDir = `${config.WORKSPACE_DIR}/${project.id}`;
    }
  } else {
    storeDir = `${config.WORKSPACE_DIR}/${project.id}`;
  }

  const store = new DocumentStore(storeDir);
  store.startWatching((event) => {
    broadcast({ type: "document:updated", documentId: event.documentId, category: event.category, title: event.title });
  });
  projectStores.set(projectId, store);
  return store;
}

/** 15-H-document-store-broadcast-dup: when a project store's
 * workspace dir is a subdirectory of WORKSPACE_DIR, the global
 * store's recursive watcher (rooted at WORKSPACE_DIR) ALSO fires
 * for the same file. Both stores' onChange handlers would then
 * broadcast the same `document:updated` event — every connected
 * client re-renders twice, the wiki UI re-fetches the board twice.
 *
 * The fix: the global store's onChange filters out files whose
 * absolute path falls under any active project store's workspace.
 * The empty path is the `__watcher_stopped__` sentinel, which is
 * always passed through (the watcher is gone, no overlap to dedupe).
 *
 * path.relative() is used instead of startsWith() so a project
 * store at `/workspace/foo` correctly excludes a global file at
 * `/workspace/foobar` (which would false-match the naive
 * `path.startsWith("/workspace/foo")` check).
 */
function isPathInActiveProjectStore(absolutePath: string): boolean {
  if (!absolutePath) return false;
  for (const [, store] of projectStores) {
    const projectDir = store.getWorkspaceDir();
    const rel = path.relative(projectDir, absolutePath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return true;
    }
  }
  return false;
}

/** Drop the in-memory DocumentStore for a project (called on project delete).
 * Without this, the projectStores Map grows unbounded as projects are created
 * and deleted — each entry holds an active fs.watch handle and the in-memory
 * document graph. */
export function dropProjectStore(projectId: string): boolean {
  const store = projectStores.get(projectId);
  if (!store) return false;
  store.stopWatching();
  projectStores.delete(projectId);
  return true;
}

/** Resolve store from request — project-scoped or global */
async function resolveStore(req: Request): Promise<DocumentStore> {
  const projectId = req.query.projectId as string | undefined;
  if (projectId) {
    const store = await getProjectStore(projectId);
    if (store) return store;
  }
  return globalStore;
}

// Start global file watching with WebSocket broadcast
globalStore.startWatching((event) => {
  // 15-H-document-store-broadcast-dup: skip events that fall under
  // any active project store's workspace — those will be broadcast
  // by the project store's own watcher. Sentinel events (path === "")
  // always pass through.
  if (isPathInActiveProjectStore(event.path)) return;
  broadcast({ type: "document:updated", documentId: event.documentId, category: event.category, title: event.title });
});

// GET /documents/graph/data — knowledge graph data (MUST be before /:slug)
documentsRouter.get("/graph/data", async (req: Request, res: Response) => {
  try {
    const store = await resolveStore(req);
    const graph = await store.getGraphData();
    res.json({ success: true, data: { graph } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event: "documents_graph_failed" },
      "Failed to fetch document graph data",
    );
    res.status(500).json({ success: false, error: "Failed to fetch document graph" });
  }
});

// GET /documents — list all documents
documentsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const store = await resolveStore(req);
    const documents = await store.listAll();
    const categories = store.getCategories();
    res.json({ success: true, data: { documents, categories } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event: "documents_list_failed" },
      "Failed to list documents",
    );
    res.status(500).json({ success: false, error: "Failed to list documents" });
  }
});

// GET /documents/:slug — get single document
documentsRouter.get("/:slug", async (req: Request, res: Response) => {
  try {
    const store = await resolveStore(req);
    const doc = await store.getBySlug(req.params.slug as string);
    if (!doc) {
      res.status(404).json({ success: false, error: "Document not found" });
      return;
    }
    res.json({ success: true, data: { document: doc } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), slug: req.params.slug, event: "documents_get_failed" },
      "Failed to fetch document",
    );
    res.status(500).json({ success: false, error: "Failed to fetch document" });
  }
});

// POST /documents/refresh — force cache invalidation
documentsRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const store = await resolveStore(req);
    store.invalidateCache();
    const documents = await store.listAll();
    for (const doc of documents) {
      broadcast({ type: "document:updated", documentId: doc.id, category: doc.category, title: doc.title });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event: "documents_refresh_failed" },
      "Failed to refresh document cache",
    );
    res.status(500).json({ success: false, error: "Failed to refresh documents" });
  }
});
