import { Router } from "express";
import type { Request, Response } from "express";
import assetsData from "../data/assets.json" with { type: "json" };
import type { AssetsData, ArtBibleConfig } from "@game-studio/types";

export const assetsRouter: Router = Router();

assetsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: assetsData as AssetsData });
});

assetsRouter.patch("/art-bible", (req: Request, res: Response) => {
  const updates = req.body as Partial<ArtBibleConfig>;
  const data = assetsData as AssetsData;
  Object.assign(data.artBible, updates);
  res.json({ success: true, data: { artBible: data.artBible } });
});
