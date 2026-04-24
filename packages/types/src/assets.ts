export type AssetType = "3d" | "2d" | "vfx" | "audio" | "texture";
export type AssetCategory = "prop" | "character" | "env" | "weapon" | "ui" | "tex" | "sfx" | "music";

export interface GameAsset {
  id: string;
  filename: string;
  type: AssetType;
  category: AssetCategory;
  sizeBytes: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
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
