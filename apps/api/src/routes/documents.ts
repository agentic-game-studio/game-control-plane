import { Router } from "express";
import type { Request, Response } from "express";
import { DocumentStore } from "../services/document-store.js";
import { loadConfig } from "../config.js";
import { broadcast } from "../services/websocket.js";

export const documentsRouter: Router = Router();

const config = loadConfig();
const store = new DocumentStore(config.WORKSPACE_DIR);

// Start file watching with WebSocket broadcast
store.startWatching((event) => {
  broadcast({ type: "document:updated", documentId: event.documentId, category: event.category, title: event.title });
});

// GET /documents/graph/data — knowledge graph data (MUST be before /:slug)
documentsRouter.get("/graph/data", async (_req: Request, res: Response) => {
  try {
    const graph = await store.getGraphData();
    res.json({ success: true, data: { graph } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /documents — list all documents
documentsRouter.get("/", async (_req: Request, res: Response) => {
  try {
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
documentsRouter.post("/refresh", async (_req: Request, res: Response) => {
  store.invalidateCache();
  const documents = await store.listAll();
  for (const doc of documents) {
    broadcast({ type: "document:updated", documentId: doc.id, category: doc.category, title: doc.title });
  }
  res.json({ success: true });
});
