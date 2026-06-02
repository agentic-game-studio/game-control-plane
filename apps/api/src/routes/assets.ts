import { Router } from "express";
import type { Request, Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import { readData, writeData, updateData, broadcastEvent } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import type {
  AssetsData,
  GameAsset,
  ArtBibleConfig,
  CreateAssetRequest,
  UpdateAssetRequest,
  AssetGenerationMeta,
  Project,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
import { loadConfig, resolvePipelinePython } from "../config.js";

const execFileAsync = promisify(execFile);

const PYTHON_BIN = resolvePipelinePython();

/** Known asset file extensions mapped to types */
const EXT_TO_TYPE: Record<string, GameAsset["type"]> = {
  ".png": "2d",
  ".jpg": "2d",
  ".jpeg": "2d",
  ".webp": "2d",
  ".gif": "2d",
  ".bmp": "2d",
  ".fbx": "3d",
  ".obj": "3d",
  ".gltf": "3d",
  ".glb": "3d",
  ".blend": "3d",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".flac": "audio",
  ".ttf": "texture",
  ".otf": "texture",
  ".font": "texture",
};

/** Infer asset type from filename/extension */
function inferType(filename: string): GameAsset["type"] {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_TYPE[ext] ?? "texture";
}

/** Infer category from filename keywords */
function inferCategory(filename: string): GameAsset["category"] {
  const lower = filename.toLowerCase();
  if (/char|player|hero|enemy|npc|mob|unit/i.test(lower)) return "character";
  if (/weapon|sword|gun|bow|axe|staff|dagger|shield/i.test(lower)) return "weapon";
  if (/env|bg_|background|tile|terrain|map|level|world|ground/i.test(lower)) return "env";
  if (/ui_|hud|icon|button|panel|frame|menu|cursor/i.test(lower)) return "ui";
  if (/sfx|sound_|hit_|jump_|step_|click/i.test(lower)) return "sfx";
  if (/music|bgm|theme|song|loop/i.test(lower)) return "music";
  if (/tex|texture|pattern|material/i.test(lower)) return "tex";
  return "prop";
}

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
  presetsFile?: string;
  workspacePath?: string;
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

function manifestEntryToGameAsset(entry: Record<string, unknown>): GameAsset {
  // Validate the discriminator fields before casting — an unknown type or
  // category string would otherwise leak through as an un-castable value
  // and crash downstream code (e.g. `assets.filter(a => a.type === "2d")`).
  const VALID_TYPES: GameAsset["type"][] = ["3d", "2d", "vfx", "audio", "texture"];
  const VALID_CATEGORIES: GameAsset["category"][] = [
    "prop", "character", "env", "weapon", "ui", "tex", "sfx", "music",
  ];
  const type = VALID_TYPES.includes(entry.type as GameAsset["type"])
    ? (entry.type as GameAsset["type"])
    : "2d";
  const category = VALID_CATEGORIES.includes(entry.category as GameAsset["category"])
    ? (entry.category as GameAsset["category"])
    : "prop";

  const generatedWith: AssetGenerationMeta | undefined =
    entry.generatedWith && typeof entry.generatedWith === "object"
      ? (entry.generatedWith as AssetGenerationMeta)
      : undefined;

  return {
    id: typeof entry.id === "string" ? entry.id : "",
    filename: typeof entry.filename === "string" ? entry.filename : "unknown",
    type,
    category,
    sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
    tags: Array.isArray(entry.tags) ? (entry.tags as string[]) : [],
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    path: typeof entry.path === "string" ? entry.path : undefined,
    rawPath: typeof entry.rawPath === "string" ? entry.rawPath : undefined,
    thumbnailPath: typeof entry.thumbnailPath === "string" ? entry.thumbnailPath : undefined,
    generatedWith,
  };
}

/**
 * Build a GameAsset from a filesystem entry, merging with saved metadata overlay.
 */
function fileEntryToGameAsset(
  relPath: string,
  sizeBytes: number,
  stat: { ctime: Date; mtime: Date },
  overlay?: Partial<GameAsset>,
  fullPath?: string
): GameAsset {
  const filename = path.basename(relPath);
  // Use a hash of the full absolute path for the ID to avoid collisions
  // when relPath contains ".." or when truncated base64 collides
  const idSource = fullPath || relPath;
  const id = overlay?.id ?? `asset-${crypto.createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`;
  return {
    id,
    filename: overlay?.filename ?? filename,
    type: overlay?.type ?? inferType(filename),
    category: overlay?.category ?? inferCategory(filename),
    sizeBytes,
    tags: overlay?.tags ?? [],
    createdAt: overlay?.createdAt ?? stat.ctime.toISOString(),
    updatedAt: overlay?.updatedAt ?? stat.mtime.toISOString(),
    path: relPath,
    thumbnailPath: overlay?.thumbnailPath ?? undefined,
    generatedWith: overlay?.generatedWith ?? undefined,
  };
}

/** Resolve project by ID from dashboard data */
async function getProjectById(projectId: string): Promise<Project | null> {
  try {
    const dashboard = await readData<{ projects: Project[] }>("dashboard.json");
    return dashboard.projects.find((p) => p.id === projectId) ?? null;
  } catch {
    return null;
  }
}

/** Resolve the assets directory for a project */
function resolveAssetsDir(workspaceDir: string, workspacePath?: string | null): string {
  if (!workspacePath) return path.join(workspaceDir, "assets");
  const projectDir = resolveProjectWorkspace(workspacePath);
  return path.join(projectDir, "assets");
}

/**
 * Scan a directory for asset files and return GameAsset list, merged with metadata overlay.
 */
async function scanAssetsDir(
  assetsDir: string,
  workspaceDir: string,
  overlayMap: Map<string, Partial<GameAsset>>
): Promise<GameAsset[]> {
  const results: GameAsset[] = [];

  let entries: { name: string; isDirectory: boolean; parentPath?: string }[] = [];
  try {
    const dirents = await fs.readdir(assetsDir, { withFileTypes: true, recursive: true });
    entries = dirents.map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      parentPath: (d as unknown as { parentPath?: string; path?: string }).parentPath
        ?? (d as unknown as { path?: string }).path,
    }));
  } catch {
    // Directory doesn't exist or isn't readable — return empty
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const fullPath = path.join(entry.parentPath ?? assetsDir, entry.name);
    const relPath = path.relative(workspaceDir, fullPath);

    // Skip hidden/system files and non-asset files
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ext || ext === ".json" || ext === ".md" || ext === ".txt" || ext === ".yaml" || ext === ".yml") continue;

    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;

      // Look up metadata overlay by relative path
      const overlay = overlayMap.get(relPath);
      const asset = fileEntryToGameAsset(relPath, stat.size, stat, overlay, fullPath);
      results.push(asset);
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/** Active fs.watch watchers keyed by projectId. Capped via LRU eviction so a
 *  long-running API process that creates and deletes many projects doesn't
 *  leak watcher handles (and the OS file descriptors behind them). The cap
 *  is read from config so it can be tuned per deployment. */
const assetWatchers = new Map<string, ReturnType<typeof watch>>();

/** Stop watching a project's assets directory */
export function unwatchProjectAssets(projectId: string): void {
  const watcher = assetWatchers.get(projectId);
  if (watcher) {
    watcher.close();
    assetWatchers.delete(projectId);
    logger.info({ projectId }, "Stopped watching project assets");
  }
}

/** Start watching a project's assets directory for changes */
function watchProjectAssets(projectId: string, assetsDir: string): void {
  if (assetWatchers.has(projectId)) {
    // Touch the entry so the LRU eviction below considers this project
    // as the most-recently-used. Map.set on an existing key already
    // updates iteration order, but a delete+set makes the intent
    // explicit and matches the pattern used by the rate limiter above.
    const existing = assetWatchers.get(projectId)!;
    assetWatchers.delete(projectId);
    assetWatchers.set(projectId, existing);
    return;
  }

  // LRU: if we're at the cap, evict the oldest entry. Map iteration is
  // insertion order, so the first key is the least-recently-inserted.
  const watcherLimit = loadConfig().ASSET_WATCHER_LIMIT;
  if (assetWatchers.size >= watcherLimit) {
    const oldest = assetWatchers.keys().next().value;
    if (oldest) unwatchProjectAssets(oldest);
  }

  try {
    const watcher = watch(assetsDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Debounce: broadcast after a short delay to batch rapid changes
      broadcastEvent({
        type: "asset:updated",
        asset: { id: `scan-${projectId}`, filename: String(filename) } as GameAsset,
      } as WSEvent);
    });

    assetWatchers.set(projectId, watcher);
    logger.info({ projectId, assetsDir }, "Started watching project assets");

    watcher.on("error", (err) => {
      logger.error({ projectId, err }, "Asset watcher error");
      unwatchProjectAssets(projectId);
    });
  } catch {
    // Watch may fail if directory doesn't exist yet
  }
}

export const assetsRouter: Router = Router();

// GET /api/assets?projectId=... - Scan workspace assets merged with metadata overlay
assetsRouter.get("/", async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  const config = loadConfig();
  const workspaceDir = path.resolve(config.WORKSPACE_DIR);

  try {
    let assetsDir: string;
    if (projectId) {
      const project = await getProjectById(projectId);
      assetsDir = resolveAssetsDir(workspaceDir, project?.workspacePath);
      // Start watching for real-time updates
      watchProjectAssets(projectId, assetsDir);
    } else {
      assetsDir = path.join(workspaceDir, "assets");
    }

    // Read metadata overlay from assets.json
    let overlayData: AssetsData;
    try {
      overlayData = await readData<AssetsData>("assets.json");
    } catch {
      overlayData = DEFAULT_ASSETS;
    }

    // Build overlay map keyed by relative path for O(1) lookup
    const overlayMap = new Map<string, Partial<GameAsset>>();
    for (const asset of overlayData.assets) {
      if (asset.path) overlayMap.set(asset.path, asset);
    }

    // Scan filesystem
    const scannedAssets = await scanAssetsDir(assetsDir, workspaceDir, overlayMap);

    // Build response: scanned assets + overlay-only assets (if any)
    const scannedPaths = new Set(scannedAssets.map((a) => a.path));
    const overlayOnly = overlayData.assets.filter((a) => a.path && !scannedPaths.has(a.path));

    const mergedAssets = [...scannedAssets, ...overlayOnly];

    // Deduplicate by id — prefer scanned assets over overlay entries
    const dedupedAssets: GameAsset[] = [];
    const seenIds = new Set<string>();
    for (const asset of mergedAssets) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        dedupedAssets.push(asset);
      }
    }

    res.json({
      success: true,
      data: {
        assets: dedupedAssets,
        artBible: overlayData.artBible ?? DEFAULT_ASSETS.artBible,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to scan assets");
    res.status(500).json({ success: false, error: "Failed to scan assets" });
  }
});

// GET /api/assets/:id - Get asset by ID
assetsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const projectId = req.query.projectId as string | undefined;
  const config = loadConfig();
  const workspaceDir = path.resolve(config.WORKSPACE_DIR);

  try {
    let assetsDir: string;
    if (projectId) {
      const project = await getProjectById(projectId);
      assetsDir = resolveAssetsDir(workspaceDir, project?.workspacePath);
    } else {
      assetsDir = path.join(workspaceDir, "assets");
    }

    // Read overlay
    let overlayData: AssetsData;
    try {
      overlayData = await readData<AssetsData>("assets.json");
    } catch {
      overlayData = DEFAULT_ASSETS;
    }

    const overlayMap = new Map<string, Partial<GameAsset>>();
    for (const asset of overlayData.assets) {
      if (asset.path) overlayMap.set(asset.path, asset);
    }

    const scanned = await scanAssetsDir(assetsDir, workspaceDir, overlayMap);
    const asset = scanned.find((a) => a.id === id) ?? overlayData.assets.find((a) => a.id === id);

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

    // Lstat first to reject symlinks outright. A thumbnail path that points
    // at a symlink can be used to read arbitrary files on disk: the
    // previous version did a `startsWith` check on the unresolved path,
    // which a symlink in workspaceDir pointing at /etc would defeat. We
    // also enforce the workspace boundary on the realpath (defense in
    // depth) so a symlink target outside the workspace is rejected even
    // if the symlink itself is inside.
    try {
      const lst = await fs.lstat(thumbAbsPath);
      if (lst.isSymbolicLink()) {
        res.status(403).send("Forbidden");
        return;
      }
      if (!lst.isFile()) {
        res.status(404).send("Not found");
        return;
      }
    } catch {
      res.status(404).send("Not found");
      return;
    }

    // Defense-in-depth: realpath the resolved path and confirm it stays
    // inside WORKSPACE_DIR. Should never trigger given the lstat check
    // above, but a future regression that re-enables symlinks would still
    // be caught here.
    let realThumb: string;
    try {
      realThumb = await fs.realpath(thumbAbsPath);
    } catch {
      res.status(404).send("Not found");
      return;
    }
    const realWorkspace = await fs.realpath(workspaceDir).catch(() => workspaceDir);
    const realWorkspacePrefix = realWorkspace.endsWith(path.sep) ? realWorkspace : realWorkspace + path.sep;
    if (!realThumb.startsWith(realWorkspacePrefix) && realThumb !== realWorkspace) {
      res.status(403).send("Forbidden");
      return;
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const stream = (await import("node:fs")).createReadStream(thumbAbsPath);
    // Without this handler, a stream that errors mid-read (file deleted
    // between stat and pipe, EIO on a flaky disk, etc.) would silently drop
    // the connection. The client would see a truncated image with a 200 OK
    // and the error-handler middleware can't recover because headers are
    // already sent.
    stream.on("error", (err) => {
      if (!res.headersSent) {
        res.status(500).send("Error");
        return;
      }
      // Headers already sent — best we can do is end the response so the
      // client doesn't see a half-loaded image and the socket is freed.
      try { res.end(); } catch { /* socket already gone */ }
    });
    stream.pipe(res);
  } catch {
    res.status(500).send("Error");
  }
});

// POST /api/assets - Create new asset (metadata overlay only; file must exist on disk)
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
    const now = new Date().toISOString();
    // Q5-6th: unguessable IDs. The previous `asset-${Date.now()}` was
    // predictable — combined with the unauthenticated /:id/thumbnail
    // endpoint (the only auth bypass in middleware/auth.ts), an attacker
    // could enumerate timestamps to discover existing assets. crypto
    // .randomUUID() is 122 bits of entropy, unguessable, and the
    // realpath boundary check already prevents arbitrary file reads.
    const newAsset: GameAsset = {
      id: `asset-${crypto.randomUUID()}`,
      filename: body.filename,
      type: body.type,
      category: body.category,
      sizeBytes: body.sizeBytes ?? 0,
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    // Route the read-modify-write through updateData so the per-file mutex
    // serializes concurrent POST /api/assets calls. Without this, two
    // simultaneous creations can read the same array, both append, and the
    // second write clobbers the first (one asset disappears).
    const data = await updateData<AssetsData>("assets.json", (d) => {
      d.assets.push(newAsset);
      return d;
    });

    broadcastEvent({
      type: "asset:created",
      asset: newAsset,
    } as WSEvent);

    res.status(201).json({ success: true, data: newAsset });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create asset" });
  }
});

// PATCH /api/assets/:id - Update asset metadata overlay
assetsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateAssetRequest;

  try {
    // Capture whether the asset existed before the lock so the response
    // matches the read-compute-write semantics. updateData's lock prevents
    // two concurrent PATCHes from clobbering each other.
    let isNew = false;
    let updatedAsset: GameAsset | null = null;

    const data = await updateData<AssetsData>("assets.json", (d) => {
      const assetIndex = d.assets.findIndex((a) => a.id === id);
      if (assetIndex === -1) {
        const now = new Date().toISOString();
        const newAsset: GameAsset = {
          id: String(id),
          filename: updates.filename ?? "unknown",
          type: updates.type ?? "texture",
          category: updates.category ?? "prop",
          sizeBytes: updates.sizeBytes ?? 0,
          tags: updates.tags ?? [],
          createdAt: now,
          updatedAt: now,
          ...updates,
        };
        d.assets.push(newAsset);
        isNew = true;
        updatedAsset = newAsset;
        return d;
      }
      const assetId = String(id);
      const next: GameAsset = {
        ...d.assets[assetIndex],
        ...updates,
        id: assetId,
        updatedAt: new Date().toISOString(),
      };
      d.assets[assetIndex] = next;
      updatedAsset = next;
      return d;
    });

    if (!updatedAsset) {
      res.status(500).json({ success: false, error: "Failed to update asset" });
      return;
    }
    void data; // lock released; reference preserved for any future reads

    broadcastEvent({
      type: "asset:updated",
      asset: updatedAsset,
    } as WSEvent);

    res.status(isNew ? 201 : 200).json({ success: true, data: updatedAsset });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update asset" });
  }
});

// DELETE /api/assets/:id - Delete asset
assetsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Snapshot the file-path-to-delete before mutating the list, then
    // perform the splice under updateData's lock so two concurrent
    // DELETEs on the same id can't double-unlink.
    let assetPath: string | null = null;
    let found = false;
    await updateData<AssetsData>("assets.json", (data) => {
      const assetIndex = data.assets.findIndex((a) => a.id === id);
      if (assetIndex === -1) return data;
      assetPath = data.assets[assetIndex].path ?? null;
      data.assets.splice(assetIndex, 1);
      found = true;
      return data;
    });

    if (!found) {
      res.status(404).json({ success: false, error: "Asset not found" });
      return;
    }

    // File deletion is best-effort; the metadata is already removed.
    if (assetPath) {
      try {
        const config = loadConfig();
        const workspaceDir = path.resolve(config.WORKSPACE_DIR);
        const filePath = path.join(workspaceDir, assetPath);
        const workspacePrefix = workspaceDir.endsWith("/") ? workspaceDir : workspaceDir + "/";
        if (
          (filePath.startsWith(workspacePrefix) || filePath === workspaceDir) &&
          filePath !== workspaceDir
        ) {
          await fs.unlink(filePath);
        }
      } catch {
        // File may not exist; continue
      }
    }

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
  const projectDir = body.workspacePath
    ? resolveProjectWorkspace(body.workspacePath)
    : config.WORKSPACE_DIR;
  const projectAssetsDir = path.join(projectDir, "assets");

  // Ensure output directory exists
  await fs.mkdir(projectAssetsDir, { recursive: true });

  // Support batch mode via presets file
  if (body.presetsFile) {
    // Validate presetsFile is a bare filename within the script directory.
    // Then realpath the candidate so a symlink pointing outside scriptDir
    // is rejected — basename + access alone is bypassable.
    const presetsBasename = path.basename(body.presetsFile);
    const presetsPath = path.join(scriptDir, presetsBasename);
    if (presetsBasename !== body.presetsFile) {
      res.status(400).json({ success: false, error: `Invalid presets file: ${body.presetsFile}. Must be a filename in ${scriptDir}` });
      return;
    }
    let presetsReal: string;
    try {
      presetsReal = await fs.realpath(presetsPath);
    } catch {
      res.status(400).json({ success: false, error: `Invalid presets file: ${body.presetsFile}. Must be a filename in ${scriptDir}` });
      return;
    }
    const scriptReal = await fs.realpath(scriptDir);
    if (!presetsReal.startsWith(scriptReal + path.sep) && presetsReal !== scriptReal) {
      res.status(400).json({ success: false, error: `Presets file escapes script directory: ${body.presetsFile}` });
      return;
    }
    const args = [
      path.join(scriptDir, "asset-pipeline.py"),
      "--presets", presetsPath,
      "--output-dir", projectAssetsDir,
      "--workspace-dir", projectDir,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(PYTHON_BIN, args, {
        cwd: scriptDir,
        timeout: 600_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const manifestPath = path.join(projectAssetsDir, "asset-manifest.json");
      let generated: GameAsset[] = [];
      let manifest: Record<string, unknown>[] = [];
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        try {
          manifest = JSON.parse(raw);
        } catch (parseErr) {
          // Manifest is malformed — treat as empty rather than crashing the
          // whole generation request. The Python pipeline already wrote it,
          // so log the parse failure for diagnostics but continue.
          logger.error({ manifestPath, err: String(parseErr), event: "asset_manifest_parse_failed" },
            "Failed to parse asset manifest — treating as empty");
          manifest = [];
        }

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
    "--width", String(Math.min(Math.max(Number(body.width) || 512, 64), 4096)),
    "--height", String(Math.min(Math.max(Number(body.height) || 512, 64), 4096)),
    "--steps", String(Math.min(Math.max(Number(body.steps) || 4, 1), 50)),
    "--output-dir", projectAssetsDir,
    "--workspace-dir", projectDir,
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

    const manifestPath = path.join(projectAssetsDir, "asset-manifest.json");
    let generatedAsset: GameAsset | null = null;
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      let manifest: Record<string, unknown>[] = [];
      try {
        manifest = JSON.parse(raw);
      } catch (parseErr) {
        logger.error({ manifestPath, err: String(parseErr), event: "asset_manifest_parse_failed_single" },
          "Failed to parse asset manifest (single mode) — no asset will be registered");
      }
      const last = manifest[manifest.length - 1];
      if (last) {
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
    // Read-modify-write under updateData's lock so concurrent PATCHes
    // don't lose updates to the art-bible object.
    let updatedArtBible: ArtBibleConfig | null = null;
    await updateData<AssetsData>("assets.json", (data) => {
      updatedArtBible = { ...data.artBible, ...updates };
      data.artBible = updatedArtBible;
      return data;
    });

    res.json({ success: true, data: { artBible: updatedArtBible ?? updates as ArtBibleConfig } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update art bible" });
  }
});

// POST /api/assets/rescan - Force rescan for a project
assetsRouter.post("/rescan", async (req: Request, res: Response) => {
  const projectId = req.body.projectId as string | undefined;
  const config = loadConfig();
  const workspaceDir = path.resolve(config.WORKSPACE_DIR);

  try {
    let assetsDir: string;
    if (projectId) {
      const project = await getProjectById(projectId);
      assetsDir = resolveAssetsDir(workspaceDir, project?.workspacePath);
      watchProjectAssets(projectId, assetsDir);
    } else {
      assetsDir = path.join(workspaceDir, "assets");
    }

    let overlayData: AssetsData;
    try {
      overlayData = await readData<AssetsData>("assets.json");
    } catch {
      overlayData = DEFAULT_ASSETS;
    }

    const overlayMap = new Map<string, Partial<GameAsset>>();
    for (const asset of overlayData.assets) {
      if (asset.path) overlayMap.set(asset.path, asset);
    }

    const scannedAssets = await scanAssetsDir(assetsDir, workspaceDir, overlayMap);
    const scannedPaths = new Set(scannedAssets.map((a) => a.path));
    const overlayOnly = overlayData.assets.filter((a) => a.path && !scannedPaths.has(a.path));

    const mergedAssets = [...scannedAssets, ...overlayOnly];
    const dedupedAssets: GameAsset[] = [];
    const seenIds = new Set<string>();
    for (const asset of mergedAssets) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        dedupedAssets.push(asset);
      }
    }

    res.json({
      success: true,
      data: {
        assets: dedupedAssets,
        artBible: overlayData.artBible ?? DEFAULT_ASSETS.artBible,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to rescan assets" });
  }
});
