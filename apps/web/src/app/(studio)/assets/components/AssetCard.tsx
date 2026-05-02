"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { GameAsset, AssetType, AssetCategory } from "@game-studio/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TYPE_ICONS: Record<AssetType, string> = {
  "3d": "view_in_ar",
  "2d": "image",
  vfx: "auto_awesome",
  audio: "music_note",
  texture: "texture",
};

const TYPE_LABELS: Record<AssetType, string> = {
  "3d": "3D",
  "2d": "2D",
  vfx: "VFX",
  audio: "AUDIO",
  texture: "TEX",
};

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  prop: "bg-[#0055FF] text-white",
  character: "bg-[#df2b31] text-white",
  env: "bg-[#c13301] text-white",
  weapon: "bg-black text-white",
  ui: "bg-[#b6c4ff] text-black",
  tex: "bg-[#e1e1ef] text-black",
  sfx: "bg-[#972500] text-white",
  music: "bg-[#0041c8] text-white",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface AssetCardProps {
  asset: GameAsset;
  onDelete?: (id: string) => void;
}

export function AssetCard({ asset, onDelete }: AssetCardProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [imgError, setImgError] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  const handleCopyPath = useCallback(() => {
    const p = asset.path ?? `assets/${asset.type}/${asset.filename}`;
    navigator.clipboard.writeText(p).catch(() => {});
    closeContextMenu();
  }, [asset, closeContextMenu]);

  const handleOpenLocation = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  // Build thumbnail URL: if the asset has a thumbnailPath, serve it via the API
  const thumbnailSrc =
    asset.thumbnailPath && !imgError
      ? `${API_BASE}/api/assets/${asset.id}/thumbnail`
      : null;

  return (
    <>
      <div
        ref={cardRef}
        onContextMenu={handleContextMenu}
        className="border-2 border-black bg-white flex flex-col group cursor-pointer hover:-translate-y-1 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all"
      >
        {/* Thumbnail Area */}
        <div className="aspect-square border-b-2 border-black bg-[#e1e1ef] relative overflow-hidden flex items-center justify-center p-4">
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={asset.filename}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="material-symbols-outlined text-6xl text-[#737688] select-none">
              {TYPE_ICONS[asset.type]}
            </span>
          )}

          {/* AI Generated Badge */}
          {asset.generatedWith && (
            <div className="absolute top-2 left-2 border-2 border-black bg-[#0055FF] text-white px-1.5 py-0.5 font-[var(--font-label)] text-[10px] uppercase font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-xs">auto_awesome</span>
              AI
            </div>
          )}

          {/* Type Badge */}
          <div className="absolute top-2 right-2 border-2 border-black bg-white px-1.5 py-0.5 font-[var(--font-label)] text-[10px] uppercase font-bold">
            {TYPE_LABELS[asset.type]}
          </div>

          {/* Hover Actions */}
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(asset.id);
                }}
                className="w-10 h-10 border-2 border-white bg-white text-black flex items-center justify-center hover:bg-[#df2b31] hover:text-white hover:border-[#df2b31] transition-colors"
                title="Delete"
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-2 flex flex-col gap-1">
          <div className="font-[var(--font-terminal)] text-sm font-bold truncate">
            {asset.filename}
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="border-2 border-black px-1 text-[10px] font-[var(--font-label)] uppercase bg-[#faf8ff]">
              {formatBytes(asset.sizeBytes)}
            </span>
            <span
              className={`border-2 border-black px-1 text-[10px] font-[var(--font-label)] uppercase ${CATEGORY_COLORS[asset.category]}`}
            >
              {asset.category}
            </span>
          </div>
          {/* Generation metadata summary */}
          {asset.generatedWith && (
            <div className="font-[var(--font-terminal)] text-[10px] text-[#737688] truncate">
              {asset.generatedWith.model} &middot; {asset.generatedWith.width}x{asset.generatedWith.height} &middot; {asset.generatedWith.steps} steps
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleCopyPath}
            className="w-full text-left px-3 py-2 font-[var(--font-terminal)] text-xs uppercase hover:bg-[#0055FF] hover:text-white transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">content_copy</span>
            Copy Path
          </button>
          <button
            onClick={handleOpenLocation}
            className="w-full text-left px-3 py-2 font-[var(--font-terminal)] text-xs uppercase hover:bg-[#0055FF] hover:text-white transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">folder_open</span>
            Open Location
          </button>
        </div>
      )}
    </>
  );
}
