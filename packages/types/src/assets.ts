export type AssetType = "3d" | "2d" | "vfx" | "audio" | "texture";
export type AssetCategory = "prop" | "character" | "env" | "weapon" | "ui" | "tex" | "sfx" | "music";

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
