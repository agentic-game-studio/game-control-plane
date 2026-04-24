"use client";

import { useState, useCallback } from "react";
import type { ArtBibleConfig } from "@game-studio/types";

interface ArtBiblePanelProps {
  config: ArtBibleConfig;
  onSave: (updates: Partial<ArtBibleConfig>) => Promise<unknown>;
}

export function ArtBiblePanel({ config, onSave }: ArtBiblePanelProps) {
  const [values, setValues] = useState(config);
  const [saving, setSaving] = useState(false);

  const updateValue = useCallback(
    <K extends keyof ArtBibleConfig>(key: K, value: ArtBibleConfig[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        baseTextureRes: values.baseTextureRes,
        maxPolycount: values.maxPolycount,
        enforcePalette: values.enforcePalette,
        strictOrthographic: values.strictOrthographic,
        snapToGrid: values.snapToGrid,
        gridSize: values.gridSize,
      });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    values.baseTextureRes !== config.baseTextureRes ||
    values.maxPolycount !== config.maxPolycount ||
    values.enforcePalette !== config.enforcePalette ||
    values.strictOrthographic !== config.strictOrthographic ||
    values.snapToGrid !== config.snapToGrid ||
    values.gridSize !== config.gridSize;

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] flex flex-col h-full">
      {/* Header */}
      <div className="border-b-2 border-black p-3 bg-black text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">menu_book</span>
          <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
            Art Bible
          </span>
        </div>
        <span className="border-2 border-white px-1 text-[10px] font-[var(--font-label)] font-bold uppercase">
          Global
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-6 overflow-y-auto flex-1">
        {/* Base Texture Resolution */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center border-b-2 border-black pb-1">
            <label className="font-[var(--font-label)] text-[10px] uppercase font-bold tracking-wider">
              Base Texture Res
            </label>
            <span className="font-[var(--font-terminal)] text-sm">
              {values.baseTextureRes}x{values.baseTextureRes}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={64}
              max={2048}
              step={64}
              value={values.baseTextureRes}
              onChange={(e) =>
                updateValue("baseTextureRes", parseInt(e.target.value, 10))
              }
              className="flex-1 accent-[#0055FF] h-2"
            />
          </div>
        </div>

        {/* Max Polycount */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center border-b-2 border-black pb-1">
            <label className="font-[var(--font-label)] text-[10px] uppercase font-bold tracking-wider">
              Max Polycount
            </label>
            <span className="font-[var(--font-terminal)] text-sm">
              {values.maxPolycount} tris
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={100}
              max={10000}
              step={100}
              value={values.maxPolycount}
              onChange={(e) =>
                updateValue("maxPolycount", parseInt(e.target.value, 10))
              }
              className="flex-1 accent-[#0055FF] h-2"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => updateValue("enforcePalette", !values.enforcePalette)}
              className={`relative w-5 h-5 border-2 border-black flex items-center justify-center transition-colors ${
                values.enforcePalette
                  ? "bg-[#0055FF] border-[#0055FF]"
                  : "bg-white group-hover:bg-[#f3f2ff]"
              }`}
            >
              {values.enforcePalette && (
                <span className="material-symbols-outlined text-white text-sm">
                  check
                </span>
              )}
            </div>
            <span className="font-[var(--font-label)] text-xs uppercase font-bold">
              Enforce Palette
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() =>
                updateValue("strictOrthographic", !values.strictOrthographic)
              }
              className={`relative w-5 h-5 border-2 border-black flex items-center justify-center transition-colors ${
                values.strictOrthographic
                  ? "bg-[#0055FF] border-[#0055FF]"
                  : "bg-white group-hover:bg-[#f3f2ff]"
              }`}
            >
              {values.strictOrthographic && (
                <span className="material-symbols-outlined text-white text-sm">
                  check
                </span>
              )}
            </div>
            <span className="font-[var(--font-label)] text-xs uppercase font-bold">
              Strict Orthographic
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => updateValue("snapToGrid", !values.snapToGrid)}
              className={`relative w-5 h-5 border-2 border-black flex items-center justify-center transition-colors ${
                values.snapToGrid
                  ? "bg-[#0055FF] border-[#0055FF]"
                  : "bg-white group-hover:bg-[#f3f2ff]"
              }`}
            >
              {values.snapToGrid && (
                <span className="material-symbols-outlined text-white text-sm">
                  check
                </span>
              )}
            </div>
            <span className="font-[var(--font-label)] text-xs uppercase font-bold">
              Snap to Grid ({values.gridSize}px)
            </span>
          </label>
        </div>

        {/* Grid Size (only shown when snapToGrid is on) */}
        {values.snapToGrid && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center border-b-2 border-black pb-1">
              <label className="font-[var(--font-label)] text-[10px] uppercase font-bold tracking-wider">
                Grid Size
              </label>
              <span className="font-[var(--font-terminal)] text-sm">
                {values.gridSize}px
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={64}
              step={1}
              value={values.gridSize}
              onChange={(e) =>
                updateValue("gridSize", parseInt(e.target.value, 10))
              }
              className="w-full accent-[#0055FF] h-2"
            />
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="p-4 border-t-2 border-black shrink-0">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`w-full border-2 border-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase flex justify-center items-center gap-2 transition-all active:translate-x-[2px] active:translate-y-[2px] ${
            hasChanges
              ? "bg-white text-black hover:bg-black hover:text-white"
              : "bg-[#f3f2ff] text-[#737688] cursor-not-allowed"
          }`}
        >
          <span className="material-symbols-outlined text-sm">save</span>
          {saving ? "Saving..." : "Save Constraints"}
        </button>
      </div>
    </div>
  );
}
