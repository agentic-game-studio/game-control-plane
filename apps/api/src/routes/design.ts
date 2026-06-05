import { Router } from "express";
import type { Request, Response } from "express";
import { newId } from "../utils/ids.js";

export const designRouter: Router = Router();

// GET /design/gdds — list GDDs
designRouter.get("/gdds", (_req: Request, res: Response) => {
  res.json({ success: true, data: [] });
});

// POST /design/gdds — create GDD
designRouter.post("/gdds", (req: Request, res: Response) => {
  const { name, category } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }
  const gdd = {
    id: newId("gdd"),
    name,
    category: category ?? "general",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  res.json({ success: true, data: gdd });
});

// GET /design/adrs — list ADRs
designRouter.get("/adrs", (_req: Request, res: Response) => {
  res.json({ success: true, data: [] });
});

// POST /design/adrs — create ADR
designRouter.post("/adrs", (req: Request, res: Response) => {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ success: false, error: "title is required" });
    return;
  }
  const adr = {
    id: newId("adr"),
    title,
    status: "proposed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  res.json({ success: true, data: adr });
});
