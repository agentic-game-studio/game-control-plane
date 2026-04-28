import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import type {
  AssetsData,
  GameAsset,
  ArtBibleConfig,
  CreateAssetRequest,
  UpdateAssetRequest,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const DEFAULT_ASSETS: AssetsData = {
  assets: [],
  artBible: {
    baseTextureRes: 256,
    maxPolycount: 1500,
    enforcePalette: true,
    strictOrthographic: false,
    snapToGrid: true,
    gridSize: 8,
  },
};

export const assetsRouter: Router = Router();

// GET /api/assets - Get all assets
assetsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await readData<AssetsData>("assets.json");
    res.json({ success: true, data });
  } catch {
    // Initialize with default data if file doesn't exist
    await writeData("assets.json", DEFAULT_ASSETS);
    res.json({ success: true, data: DEFAULT_ASSETS });
  }
});

// GET /api/assets/:id - Get asset by ID
assetsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await readData<AssetsData>("assets.json");
    const asset = data.assets.find((a) => a.id === id);
    if (!asset) {
      res.status(404).json({ success: false, error: "Asset not found" });
      return;
    }
    res.json({ success: true, data: asset });
  } catch {
    res.status(500).json({ success: false, error: "Failed to read asset" });
  }
});

// POST /api/assets - Create new asset
assetsRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateAssetRequest;

  if (!body.filename || !body.type || !body.category) {
    res.status(400).json({
      success: false,
      error: "filename, type, and category are required",
    });
    return;
  }

  try {
    const data = await readData<AssetsData>("assets.json");
    const now = new Date().toISOString();

    const newAsset: GameAsset = {
      id: `asset-${Date.now()}`,
      filename: body.filename,
      type: body.type,
      category: body.category,
      sizeBytes: body.sizeBytes ?? 0,
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    data.assets.push(newAsset);
    await writeData("assets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "asset:created",
      asset: newAsset,
    } as WSEvent);

    res.status(201).json({ success: true, data: newAsset });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create asset" });
  }
});

// PATCH /api/assets/:id - Update asset
assetsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateAssetRequest;

  try {
    const data = await readData<AssetsData>("assets.json");
    const assetIndex = data.assets.findIndex((a) => a.id === id);

    if (assetIndex === -1) {
      res.status(404).json({ success: false, error: "Asset not found" });
      return;
    }

    const assetId = String(id);
    const updatedAsset: GameAsset = {
      ...data.assets[assetIndex],
      ...updates,
      id: assetId, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString(),
    };

    data.assets[assetIndex] = updatedAsset;
    await writeData("assets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "asset:updated",
      asset: updatedAsset,
    } as WSEvent);

    res.json({ success: true, data: updatedAsset });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update asset" });
  }
});

// DELETE /api/assets/:id - Delete asset
assetsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<AssetsData>("assets.json");
    const assetIndex = data.assets.findIndex((a) => a.id === id);

    if (assetIndex === -1) {
      res.status(404).json({ success: false, error: "Asset not found" });
      return;
    }

    data.assets.splice(assetIndex, 1);
    await writeData("assets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "asset:deleted",
      assetId: id,
    } as WSEvent);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete asset" });
  }
});

// PATCH /api/assets/art-bible - Update art bible config
assetsRouter.patch("/art-bible", async (req: Request, res: Response) => {
  const updates = req.body as Partial<ArtBibleConfig>;

  try {
    const data = await readData<AssetsData>("assets.json");
    const updatedArtBible: ArtBibleConfig = {
      ...data.artBible,
      ...updates,
    };

    data.artBible = updatedArtBible;
    await writeData("assets.json", data);

    res.json({ success: true, data: { artBible: updatedArtBible } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update art bible" });
  }
});
