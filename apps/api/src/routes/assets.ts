import { Router } from "express";
import type { Request, Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import type {
  AssetsData,
  GameAsset,
  ArtBibleConfig,
  CreateAssetRequest,
  UpdateAssetRequest,
  AssetGenerationMeta,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
import { loadConfig } from "../config.js";

const execFileAsync = promisify(execFile);

/**
 * Resolve the Python binary that has the asset-pipeline dependencies installed.
 * Prefers /usr/local/bin/python3 (Python.org install with Pillow, rembg, etc.)
 * over /opt/homebrew/bin/python3 (Homebrew which may lack pip packages).
 */
const PYTHON_BIN = process.env.PIPELINE_PYTHON ?? "/usr/local/bin/python3";

/** Interface for asset generation requests */
interface GenerateAssetRequest {
  prompt: string;
  name: string;
  type?: "2d" | "3d" | "vfx" | "audio" | "texture";
  category?: "prop" | "character" | "env" | "weapon" | "ui" | "tex" | "sfx" | "music";
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  removeBg?: boolean;
  negativePrompt?: string;
  model?: string;
  gridSize?: number;
  spriteSheet?: boolean;
  spriteCols?: number;
  spriteRows?: number;
  tags?: string[];
  presetsFile?: string;  // Path to presets YAML (relative to scripts dir)
  workspacePath?: string; // Project sub-path (e.g. "godot-test-1") — assets go to workspace/<workspacePath>/assets/
}

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

/**
 * Build a GameAsset from a manifest entry, preserving all generation metadata.
 */
function manifestEntryToGameAsset(entry: Record<string, unknown>): GameAsset {
  const generatedWith: AssetGenerationMeta | undefined = entry.generatedWith
    ? (entry.generatedWith as AssetGenerationMeta)
    : undefined;

  return {
    id: entry.id as string,
    filename: entry.filename as string,
    type: entry.type as GameAsset["type"],
    category: entry.category as GameAsset["category"],
    sizeBytes: (entry.sizeBytes as number) ?? 0,
    tags: (entry.tags as string[]) ?? [],
    createdAt: entry.createdAt as string,
    updatedAt: entry.updatedAt as string,
    path: entry.path as string | undefined,
    rawPath: entry.rawPath as string | undefined,
    thumbnailPath: entry.thumbnailPath as string | undefined,
    generatedWith,
  };
}

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

// GET /api/assets/:id/thumbnail - Serve thumbnail image file
assetsRouter.get("/:id/thumbnail", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await readData<AssetsData>("assets.json");
    const asset = data.assets.find((a) => a.id === id);
    if (!asset || !asset.thumbnailPath) {
      res.status(404).send("Not found");
      return;
    }

    const config = loadConfig();
    const workspaceDir = path.resolve(config.WORKSPACE_DIR);
    const thumbAbsPath = path.resolve(workspaceDir, asset.thumbnailPath);

    // Security: ensure the resolved path is within workspace (use trailing separator
    // to prevent prefix-matching sibling dirs like /workspace-evil)
    const workspacePrefix = workspaceDir.endsWith("/") ? workspaceDir : workspaceDir + "/";
    if (!thumbAbsPath.startsWith(workspacePrefix) && thumbAbsPath !== workspaceDir) {
      res.status(403).send("Forbidden");
      return;
    }

    try {
      const stat = await fs.stat(thumbAbsPath);
      if (!stat.isFile()) {
        res.status(404).send("Not found");
        return;
      }
    } catch {
      res.status(404).send("Not found");
      return;
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const stream = (await import("node:fs")).createReadStream(thumbAbsPath);
    stream.pipe(res);
  } catch {
    res.status(500).send("Error");
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

// POST /api/assets/generate - Generate game asset via mflux pipeline
assetsRouter.post("/generate", async (req: Request, res: Response) => {
  const body = req.body as GenerateAssetRequest;
  const config = loadConfig();
  const scriptDir = path.resolve(process.cwd(), "..", "..", "scripts", "asset-pipeline");
  const workspaceDir = path.resolve(config.WORKSPACE_DIR);
  const projectAssetsDir = body.workspacePath
    ? path.join(workspaceDir, body.workspacePath, "assets")
    : path.join(workspaceDir, "assets");

  // Support batch mode via presets file
  if (body.presetsFile) {
    const args = [
      path.join(scriptDir, "asset-pipeline.py"),
      "--presets", body.presetsFile,
      "--output-dir", projectAssetsDir,
      "--workspace-dir", workspaceDir,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(PYTHON_BIN, args, {
        cwd: scriptDir,
        timeout: 600_000, // 10 min for batch
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse manifest and register ALL generated assets in inventory
      const manifestPath = path.join(projectAssetsDir, "asset-manifest.json");
      let generated: GameAsset[] = [];
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest: Record<string, unknown>[] = JSON.parse(raw);

        // Register new assets in inventory
        const data = await readData<AssetsData>("assets.json");
        const existingIds = new Set(data.assets.map((a) => a.id));

        for (const entry of manifest) {
          if (!existingIds.has(entry.id as string)) {
            const newAsset = manifestEntryToGameAsset(entry);
            data.assets.push(newAsset);
            generated.push(newAsset);
          }
        }

        if (generated.length > 0) {
          await writeData("assets.json", data);
          // Broadcast each new asset individually so the UI refreshes
          for (const asset of generated) {
            broadcastEvent({
              type: "asset:created",
              asset,
            } as WSEvent);
          }
        }
      } catch {
        // manifest may not exist yet
      }

      res.json({
        success: true,
        data: { generated, log: stdout.slice(-2000) },
      });
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      res.status(500).json({
        success: false,
        error: "Asset generation failed",
        details: err.stderr || err.message,
      });
    }
    return;
  }

  // Single asset generation
  if (!body.prompt || !body.name) {
    res.status(400).json({
      success: false,
      error: "prompt and name are required",
    });
    return;
  }

  const args = [
    path.join(scriptDir, "asset-pipeline.py"),
    "--prompt", body.prompt,
    "--name", body.name,
    "--type", body.type ?? "2d",
    "--category", body.category ?? "prop",
    "--width", String(body.width ?? 512),
    "--height", String(body.height ?? 512),
    "--steps", String(body.steps ?? 4),
    "--output-dir", projectAssetsDir,
    "--workspace-dir", workspaceDir,
  ];

  if (body.seed !== undefined) args.push("--seed", String(body.seed));
  if (body.removeBg === false) args.push("--no-remove-bg");
  if (body.negativePrompt) args.push("--negative-prompt", body.negativePrompt);
  if (body.model) args.push("--model", body.model);
  if (body.gridSize) args.push("--grid-size", String(body.gridSize));
  if (body.spriteSheet) args.push("--sprite-sheet");
  if (body.spriteCols) args.push("--sprite-cols", String(body.spriteCols));
  if (body.spriteRows) args.push("--sprite-rows", String(body.spriteRows));
  if (body.tags?.length) args.push("--tags", ...body.tags);

  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, args, {
      cwd: scriptDir,
      timeout: 600_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Read the manifest to get the generated asset details with full metadata
    const manifestPath = path.join(projectAssetsDir, "asset-manifest.json");
    let generatedAsset: GameAsset | null = null;
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const manifest: Record<string, unknown>[] = JSON.parse(raw);
      const last = manifest[manifest.length - 1];
      if (last) {
        // Register in asset inventory with dedup check
        const data = await readData<AssetsData>("assets.json");
        const existingIds = new Set(data.assets.map((a) => a.id));
        const assetId = last.id as string;
        if (!existingIds.has(assetId)) {
          const newAsset = manifestEntryToGameAsset(last);
          data.assets.push(newAsset);
          await writeData("assets.json", data);
          broadcastEvent({
            type: "asset:created",
            asset: newAsset,
          } as WSEvent);
          generatedAsset = newAsset;
        } else {
          // Already registered — return the existing one
          generatedAsset = data.assets.find((a) => a.id === assetId) ?? null;
        }
      }
    } catch {
      // manifest may not exist yet
    }

    res.json({
      success: true,
      data: {
        asset: generatedAsset,
        log: stdout.slice(-1000),
      },
    });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    res.status(500).json({
      success: false,
      error: "Asset generation failed",
      details: err.stderr || err.message,
    });
  }
});

// GET /api/assets/generate/presets - List available preset files
assetsRouter.get("/generate/presets", async (_req: Request, res: Response) => {
  try {
    const scriptDir = path.resolve(process.cwd(), "..", "..", "scripts", "asset-pipeline");
    const files = await fs.readdir(scriptDir);
    const yamlFiles = files.filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml")
    );
    res.json({ success: true, data: yamlFiles });
  } catch {
    res.json({ success: true, data: [] });
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
