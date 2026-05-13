import { Router } from "express";
import type { Request, Response } from "express";
import { DocumentStore } from "../services/document-store.js";
import { loadConfig } from "../config.js";
import { broadcast } from "../services/websocket.js";
import { readData } from "../services/data-store.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
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
  broadcast({ type: "document:updated", documentId: event.documentId, category: event.category, title: event.title });
});

// GET /documents/graph/data — knowledge graph data (MUST be before /:slug)
documentsRouter.get("/graph/data", async (req: Request, res: Response) => {
  try {
    const store = await resolveStore(req);
    const graph = await store.getGraphData();
    res.json({ success: true, data: { graph } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
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
    res.status(500).json({ success: false, error: String(err) });
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
    res.status(500).json({ success: false, error: String(err) });
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
    res.status(500).json({ success: false, error: String(err) });
  }
});
