"use client";

import { useState } from "react";
import { Modal, FormField } from "@/components/Modal";
import type { AssetType, AssetCategory, CreateAssetRequest } from "@game-studio/types";

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "3d", label: "3D Model" },
  { value: "2d", label: "2D Image" },
  { value: "audio", label: "Audio" },
  { value: "vfx", label: "VFX" },
  { value: "texture", label: "Texture" },
];

const CATEGORIES: { value: AssetCategory; label: string }[] = [
  { value: "prop", label: "Prop" },
  { value: "character", label: "Character" },
  { value: "env", label: "Environment" },
  { value: "weapon", label: "Weapon" },
  { value: "ui", label: "UI" },
  { value: "tex", label: "Texture" },
  { value: "sfx", label: "SFX" },
  { value: "music", label: "Music" },
];

interface NewAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (request: CreateAssetRequest) => Promise<unknown>;
}

export function NewAssetModal({ isOpen, onClose, onSubmit }: NewAssetModalProps) {
  const [filename, setFilename] = useState("");
  const [type, setType] = useState<AssetType>("3d");
  const [category, setCategory] = useState<AssetCategory>("prop");
  const [sizeBytes, setSizeBytes] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setFilename("");
    setType("3d");
    setCategory("prop");
    setSizeBytes("");
    setTags("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!filename.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        filename: filename.trim(),
        type,
        category,
        sizeBytes: sizeBytes ? parseInt(sizeBytes, 10) : 0,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = filename.trim().length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Asset"
      submitLabel={submitting ? "Creating..." : "Create Asset"}
      submitDisabled={!isValid || submitting}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Filename">
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="e.g. Iron_Sword.obj"
            className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2"
          />
        </FormField>

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

        <FormField label="Size (Bytes)">
          <input
            type="number"
            value={sizeBytes}
            onChange={(e) => setSizeBytes(e.target.value)}
            placeholder="e.g. 1240000"
            className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2"
          />
        </FormField>

        <FormField label="Tags (comma separated)">
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. weapon, medieval, iron"
            className="border-2 border-black bg-white px-3 py-2 font-[var(--font-terminal)] text-sm outline-none focus:ring-2 ring-[#0055FF] ring-offset-2"
          />
        </FormField>
      </div>
    </Modal>
  );
}
