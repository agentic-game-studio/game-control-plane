export type AssetType = "3d" | "2d" | "vfx" | "audio" | "texture" | "screenshot";
export type AssetCategory = "prop" | "character" | "env" | "weapon" | "ui" | "tex" | "sfx" | "music";

/** Supported image generation backends */
export type AssetGenerator = "mflux" | "gpt-image-2";

/** Generation metadata preserved from the AI pipeline */
export interface AssetGenerationMeta {
  tool: string;
  model: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed?: number | null;
  negativePrompt?: string | null;
  /** Which image generator was used (mflux or gpt-image-2) */
  generator?: AssetGenerator;
}

export interface GameAsset {
  id: string;
  filename: string;
  type: AssetType;
  category: AssetCategory;
  sizeBytes: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Relative path to the final asset file (workspace-relative) */
  path?: string;
  /** Relative path to the raw generated image (workspace-relative) */
  rawPath?: string;
  /** Relative path to thumbnail preview image (workspace-relative) */
  thumbnailPath?: string;
  /**
   * Server-computed signed thumbnail URL (10-L1). Includes an HMAC of
   * the asset id; the unauthenticated `/:id/thumbnail` route rejects
   * requests missing a valid signature. Frontends should prefer this
   * over constructing the URL from `id`.
   */
  signedThumbnailUrl?: string;
  /** AI generation metadata (if AI-generated) */
  generatedWith?: AssetGenerationMeta;
}

export interface CreateAssetRequest {
  filename: string;
  type: AssetType;
  category: AssetCategory;
  sizeBytes?: number;
  tags?: string[];
}

export interface UpdateAssetRequest {
  filename?: string;
  type?: AssetType;
  category?: AssetCategory;
  sizeBytes?: number;
  tags?: string[];
}

export interface ArtBibleConfig {
  baseTextureRes: number;
  maxPolycount: number;
  enforcePalette: boolean;
  strictOrthographic: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface AssetsData {
  assets: GameAsset[];
  artBible: ArtBibleConfig;
}
