"use client";

import { useState } from "react";
import { Modal, FormField } from "@/components/Modal";
import type { AssetType, AssetCategory } from "@game-studio/types";

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "2d", label: "2D Image" },
  { value: "3d", label: "3D Model" },
  { value: "vfx", label: "VFX" },
  { value: "texture", label: "Texture" },
];

const CATEGORIES: { value: AssetCategory; label: string }[] = [
  { value: "prop", label: "Prop" },
  { value: "character", label: "Character" },
  { value: "env", label: "Environment" },
  { value: "weapon", label: "Weapon" },
  { value: "ui", label: "UI Icon" },
  { value: "tex", label: "Texture" },
];

const SIZE_PRESETS = [
  { label: "256x256 (Icon)", w: 256, h: 256 },
  { label: "512x512 (Standard)", w: 512, h: 512 },
  { label: "1024x1024 (Texture)", w: 1024, h: 1024 },
  { label: "1024x560 (Sprite Sheet)", w: 1024, h: 560 },
  { label: "256x512 (Tall Prop)", w: 256, h: 512 },
];

interface GenerateAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath?: string;
  onGenerate: (params: {
    prompt: string;
    name: string;
    type?: string;
    category?: string;
    width?: number;
    height?: number;
    steps?: number;
    removeBg?: boolean;
    gridSize?: number;
    spriteSheet?: boolean;
    spriteCols?: number;
    spriteRows?: number;
    tags?: string[];
    workspacePath?: string;
  }) => Promise<unknown>;
  onBatchGenerate?: (presetsFile: string, workspacePath?: string) => Promise<unknown>;
  availablePresets?: string[];
}

export function GenerateAssetModal({
  isOpen,
  onClose,
  workspacePath,
  onGenerate,
  onBatchGenerate,
  availablePresets,
}: GenerateAssetModalProps) {
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>("2d");
  const [category, setCategory] = useState<AssetCategory>("prop");
  const [sizePreset, setSizePreset] = useState(1); // 512x512
  const [customWidth, setCustomWidth] = useState(512);
  const [customHeight, setCustomHeight] = useState(512);
  const [steps, setSteps] = useState(4);
  const [removeBg, setRemoveBg] = useState(true);
  const [gridSize, setGridSize] = useState("");
  const [spriteSheet, setSpriteSheet] = useState(false);
  const [spriteCols, setSpriteCols] = useState(5);
  const [spriteRows, setSpriteRows] = useState(2);
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  // Batch mode
  const [selectedPreset, setSelectedPreset] = useState("");
  const [batchMode, setBatchMode] = useState(false);

  const resetForm = () => {
    setPrompt("");
    setName("");
    setType("2d");
    setCategory("prop");
    setSizePreset(1);
    setCustomWidth(512);
    setCustomHeight(512);
    setSteps(4);
    setRemoveBg(true);
    setGridSize("");
    setSpriteSheet(false);
    setSpriteCols(5);
    setSpriteRows(2);
    setTags("");
    setError(null);
    setAdvanced(false);
    setSelectedPreset("");
    setBatchMode(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (batchMode) {
      if (!selectedPreset || !onBatchGenerate) return;
      setSubmitting(true);
      setError(null);
      try {
        await onBatchGenerate(selectedPreset, workspacePath);
        handleClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Batch generation failed"
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!prompt.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const w =
        sizePreset === -1
          ? customWidth
          : SIZE_PRESETS[sizePreset]?.w ?? 512;
      const h =
        sizePreset === -1
          ? customHeight
          : SIZE_PRESETS[sizePreset]?.h ?? 512;

      await onGenerate({
        prompt: prompt.trim(),
        name: name.trim(),
        type,
        category,
        width: w,
        height: h,
        steps,
        removeBg,
        gridSize: gridSize ? parseInt(gridSize, 10) : undefined,
        spriteSheet,
        spriteCols: spriteSheet ? spriteCols : undefined,
        spriteRows: spriteSheet ? spriteRows : undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        workspacePath,
      });
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = batchMode
    ? !!selectedPreset
    : prompt.trim().length > 0 && name.trim().length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={batchMode ? "Batch Asset Generator" : "AI Asset Generator"}
      submitLabel={
        submitting
          ? "Generating..."
          : batchMode
            ? `Run Batch (${selectedPreset || "..."})`
            : "Generate Asset"
      }
      submitDisabled={!isValid || submitting}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        {/* Error */}
        {error && (
          <div className="border-2 border-red-500 bg-red-50 px-4 py-3 font-[var(--font-terminal)] text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generating indicator */}
        {submitting && (
          <div className="border-2 border-black bg-[#f3f2ff] px-4 py-3 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-black border-t-transparent animate-spin" />
            <span className="font-[var(--font-terminal)] text-sm">
              {batchMode
                ? `Running batch from ${selectedPreset}... This may take several minutes.`
                : "Generating with mflux/FLUX2 Klein... This may take 30-60s."}
            </span>
          </div>
        )}

        {/* Mode Tabs: Single vs Batch */}
        <div className="flex gap-0 border-2 border-black">
          <button
            type="button"
            onClick={() => setBatchMode(false)}
            className={`flex-1 font-[var(--font-label)] text-xs font-bold uppercase py-2 flex items-center justify-center gap-2 transition-colors ${
              !batchMode
                ? "bg-[#0055FF] text-white"
                : "bg-white text-black hover:bg-[#f3f2ff]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">image</span>
            Single Asset
          </button>
          <button
            type="button"
            onClick={() => setBatchMode(true)}
            className={`flex-1 font-[var(--font-label)] text-xs font-bold uppercase py-2 flex items-center justify-center gap-2 transition-colors border-l-2 border-black ${
              batchMode
                ? "bg-[#0055FF] text-white"
                : "bg-white text-black hover:bg-[#f3f2ff]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">playlist_add</span>
            Batch from Presets
          </button>
        </div>

        {/* ---- BATCH MODE ---- */}
        {batchMode ? (
          <div className="flex flex-col gap-4">
            <FormField label="Select Preset File">
              <div className="relative border-2 border-black bg-white">
                <select
                  value={selectedPreset}
                  onChange={(e) => setSelectedPreset(e.target.value)}
                  className="w-full appearance-none bg-transparent outline-none font-[var(--font-terminal)] text-sm px-3 py-2 pr-10 cursor-pointer"
                >
                  <option value="">-- Select a preset --</option>
                  {(availablePresets ?? []).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
                  arrow_drop_down
                </span>
              </div>
            </FormField>

            {selectedPreset && (
              <div className="border-2 border-[#c3c5d9] bg-[#f3f2ff] px-4 py-3 flex items-start gap-3">
                <span className="material-symbols-outlined text-[#0055FF] text-lg mt-0.5">
                  info
                </span>
                <div className="font-[var(--font-terminal)] text-xs text-[#737688] leading-relaxed">
                  <strong className="text-black">Batch Pipeline:</strong> Reads all asset presets from{" "}
                  <code className="bg-white border border-black px-1">{selectedPreset}</code>, generates each
                  via mflux, removes backgrounds, post-processes (alpha-trim, grid-pad, smart sprite slicing),
                  writes Godot .import files, and registers all assets in the inventory.
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ---- SINGLE MODE (original form) ---- */}
            {/* Asset Name */}
            <FormField label="Asset Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. health-potion"
                className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
              />
            </FormField>

            {/* Prompt */}
            <FormField label="Image Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the game asset you want to generate..."
                rows={3}
                className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full resize-none"
              />
            </FormField>

            {/* Type + Category */}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Type">
                <div className="relative border-2 border-black bg-white">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as AssetType)}
                    className="w-full appearance-none bg-transparent outline-none font-[var(--font-terminal)] text-sm px-3 py-2 pr-10 cursor-pointer"
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
                    arrow_drop_down
                  </span>
                </div>
              </FormField>

              <FormField label="Category">
                <div className="relative border-2 border-black bg-white">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as AssetCategory)}
                    className="w-full appearance-none bg-transparent outline-none font-[var(--font-terminal)] text-sm px-3 py-2 pr-10 cursor-pointer"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
                    arrow_drop_down
                  </span>
                </div>
              </FormField>
            </div>

            {/* Size Preset */}
            <FormField label="Size">
              <div className="relative border-2 border-black bg-white">
                <select
                  value={sizePreset}
                  onChange={(e) => setSizePreset(parseInt(e.target.value, 10))}
                  className="w-full appearance-none bg-transparent outline-none font-[var(--font-terminal)] text-sm px-3 py-2 pr-10 cursor-pointer"
                >
                  {SIZE_PRESETS.map((s, i) => (
                    <option key={i} value={i}>
                      {s.label} ({s.w}x{s.h})
                    </option>
                  ))}
                  <option value={-1}>Custom...</option>
                </select>
                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
                  arrow_drop_down
                </span>
              </div>
            </FormField>

            {sizePreset === -1 && (
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Width (px)">
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 512)}
                    className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                  />
                </FormField>
                <FormField label="Height (px)">
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 512)}
                    className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                  />
                </FormField>
              </div>
            )}

            {/* Advanced Options Toggle */}
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              className="flex items-center gap-2 font-[var(--font-label)] text-xs font-bold uppercase text-[#737688] hover:text-black transition-colors"
            >
              <span
                className="material-symbols-outlined text-sm"
                style={{
                  transform: advanced ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                }}
              >
                chevron_right
              </span>
              Advanced Options
            </button>

            {advanced && (
              <div className="flex flex-col gap-4 border-2 border-[#c3c5d9] bg-[#f3f2ff] p-4">
                {/* Steps */}
                <FormField label="Generation Steps (higher = more quality, slower)">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value, 10) || 4)}
                    className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                  />
                </FormField>

                {/* Remove Background */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeBg}
                    onChange={(e) => setRemoveBg(e.target.checked)}
                    className="w-5 h-5 accent-[#0055FF]"
                  />
                  <span className="font-[var(--font-terminal)] text-sm">
                    Remove background (transparent PNG)
                  </span>
                </label>

                {/* Grid Size */}
                <FormField label="Grid Pad Size (optional, e.g. 128 for 128x128 tiles)">
                  <input
                    type="number"
                    value={gridSize}
                    onChange={(e) => setGridSize(e.target.value)}
                    placeholder="e.g. 128"
                    className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                  />
                </FormField>

                {/* Sprite Sheet */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={spriteSheet}
                    onChange={(e) => setSpriteSheet(e.target.checked)}
                    className="w-5 h-5 accent-[#0055FF]"
                  />
                  <span className="font-[var(--font-terminal)] text-sm">
                    Sprite sheet auto-slicing (smart bounding-box detection + grid fallback)
                  </span>
                </label>

                {spriteSheet && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Columns (grid fallback)">
                      <input
                        type="number"
                        min={1}
                        value={spriteCols}
                        onChange={(e) =>
                          setSpriteCols(parseInt(e.target.value, 10) || 1)
                        }
                        className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                      />
                    </FormField>
                    <FormField label="Rows (grid fallback)">
                      <input
                        type="number"
                        min={1}
                        value={spriteRows}
                        onChange={(e) =>
                          setSpriteRows(parseInt(e.target.value, 10) || 1)
                        }
                        className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                      />
                    </FormField>
                  </div>
                )}

                {/* Tags */}
                <FormField label="Tags (comma separated)">
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="e.g. potion, health, consumable"
                    className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2 w-full"
                  />
                </FormField>
              </div>
            )}

            {/* Pipeline info */}
            <div className="border-2 border-[#c3c5d9] bg-[#f3f2ff] px-4 py-3 flex items-start gap-3">
              <span className="material-symbols-outlined text-[#0055FF] text-lg mt-0.5">
                info
              </span>
              <div className="font-[var(--font-terminal)] text-xs text-[#737688] leading-relaxed">
                <strong className="text-black">Pipeline:</strong> mflux (FLUX2 Klein) &rarr;
                rembg (background removal) &rarr; post-process (alpha-trim, grid-pad, smart sprite slicing)
                &rarr; thumbnail (128px) &rarr; Godot .import (Nearest filter) &rarr; registered in inventory.
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
