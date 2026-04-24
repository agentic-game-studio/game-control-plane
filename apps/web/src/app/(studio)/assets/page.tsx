"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { AssetsData, GameAsset, ArtBibleConfig, CreateAssetRequest } from "@game-studio/types";
import { DataLoader } from "@/components/DataLoader";
import { Modal, FormField } from "@/components/Modal";

const typeColors: Record<string, string> = {
  "3d": "bg-white",
  "2d": "bg-white",
  vfx: "bg-tertiary-container",
  audio: "bg-surface-container",
  texture: "bg-surface-container",
};

const categoryColors: Record<string, string> = {
  prop: "bg-primary-container text-white",
  character: "bg-secondary-container text-white",
  env: "bg-secondary-container text-white",
  weapon: "bg-surface-variant text-white",
  ui: "bg-on-surface text-white",
  tex: "bg-on-surface text-white",
  sfx: "bg-tertiary-container text-white",
  music: "bg-tertiary-container text-white",
};

const formatBytes = (bytes: number) => {
  if (bytes >= 1000000) return `${(bytes / 1000000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const typeIcons: Record<string, string> = {
  "3d": "view_in_ar",
  "2d": "terminal",
  vfx: "auto_awesome",
  audio: "music_note",
  texture: "texture",
};

export default function AssetsPage() {
  const [data, setData] = useState<AssetsData | null>(null);
  const [artBible, setArtBible] = useState<ArtBibleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    filename: "",
    type: "3d" as "3d" | "2d" | "vfx" | "audio" | "texture",
    category: "prop" as "prop" | "character" | "env" | "weapon" | "ui" | "tex" | "sfx" | "music",
    sizeBytes: 100000,
  });

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const assetsData = await apiFetch<AssetsData>("/api/assets");
      setData(assetsData);
      setArtBible(assetsData.artBible);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load assets";
      setError(message);
      console.error("Failed to fetch assets data:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData, retryCount]);

  useEffect(() => {
    if (data) {
      const interval = setInterval(() => fetchData(false), 60000);
      return () => clearInterval(interval);
    }
  }, [data, fetchData]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  const handleSaveArtBible = async () => {
    if (!artBible) return;
    try {
      await apiFetch<{ artBible: ArtBibleConfig }>("/api/assets/art-bible", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artBible),
      });
    } catch (error) {
      console.error("Failed to save art bible:", error);
    }
  };

  const handleCreateAsset = async () => {
    if (!formData.filename) return;
    setCreating(true);
    try {
      const newAsset = await apiFetch<GameAsset>("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setData((prev) =>
        prev ? { ...prev, assets: [...prev.assets, newAsset] } : prev
      );
      setShowCreateModal(false);
      setFormData({ filename: "", type: "3d", category: "prop", sizeBytes: 100000 });
    } catch (err) {
      console.error("Failed to create asset:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    try {
      await apiFetch(`/api/assets/${id}`, { method: "DELETE" });
      setData((prev) =>
        prev
          ? { ...prev, assets: prev.assets.filter((a) => a.id !== id) }
          : prev
      );
      setDeleteId(null);
    } catch (err) {
      console.error("Failed to delete asset:", err);
    }
  };

  return (
    <>
    <DataLoader loading={loading} error={error} onRetry={handleRetry}>
    <div className="flex flex-col h-full">
      {/* Crafting Input Bar */}
      <header className="p-[var(--spacing-md)] border-b-2 border-on-surface bg-surface-container-lowest flex items-center gap-[var(--spacing-md)] z-10 shrink-0">
        <div className="flex-1 flex items-center gap-2 border-2 border-on-surface bg-white p-2">
          <span className="material-symbols-outlined text-on-surface ml-2">manufacturing</span>
          <input
            className="w-full bg-transparent border-none outline-none font-[var(--font-terminal)] text-base placeholder:text-outline p-0"
            placeholder="Prompt a new asset (e.g. 'Low poly health potion')..."
            type="text"
          />
        </div>
        <div className="relative border-2 border-on-surface bg-white shrink-0">
          <select className="appearance-none bg-transparent outline-none font-[var(--font-label)] text-xs font-bold uppercase py-3 pl-4 pr-10 cursor-pointer">
            <option value="retro_3d">Retro 3D (PS1)</option>
            <option value="pixel_art">Pixel Art (16-bit)</option>
            <option value="cel_shaded">Cel Shaded</option>
            <option value="high_res">High Res UI</option>
          </select>
          <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
            arrow_drop_down
          </span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary-container text-on-primary border-2 border-on-surface font-[var(--font-label)] text-xs font-bold uppercase px-6 py-3 hover:bg-on-surface hover:text-on-primary retro-press transition-all flex items-center gap-2 shrink-0"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          ADD_ASSET
        </button>
      </header>

      {/* Layout Wrapper */}
      <div className="flex flex-1 overflow-hidden">
        {/* Inventory Grid */}
        <section className="flex-1 p-[var(--spacing-gutter)] overflow-y-auto bg-surface relative">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[var(--spacing-md)]">
            {data?.assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onDelete={() => setDeleteId(asset.id)} />
            ))}
            {[...Array(5)].map((_, i) => (
              <div
                key={`empty-${i}`}
                className="border-2 border-outline-variant bg-surface-container border-dashed flex flex-col aspect-square justify-center items-center opacity-50"
              >
                {i === 0 && (
                  <>
                    <span className="material-symbols-outlined text-outline text-3xl">add</span>
                    <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-2 text-outline">
                      Empty Slot
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Art Bible Sidebar */}
        <aside className="w-80 border-l-2 border-on-surface bg-surface-container-lowest overflow-y-auto flex flex-col shrink-0">
          <div className="p-[var(--spacing-md)] border-b-2 border-on-surface bg-on-surface text-white flex items-center justify-between sticky top-0 z-10">
            <h2 className="font-[var(--font-terminal)] text-base font-bold uppercase tracking-tight flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">menu_book</span>
              Art Bible
            </h2>
            <span className="border-2 border-white px-1 text-[10px] font-[var(--font-label)] font-bold uppercase">
              Global
            </span>
          </div>
          <div className="p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-lg)]">
            {/* Resolution Slider */}
            <div className="flex flex-col gap-[var(--spacing-sm)]">
              <div className="flex justify-between items-center border-b-2 border-black pb-1">
                <label className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Base Texture Res
                </label>
                <span className="font-[var(--font-terminal)] text-sm">
                  {artBible ? `${artBible.baseTextureRes}x${artBible.baseTextureRes}` : "—"}
                </span>
              </div>
              <div className="relative w-full h-4 border-2 border-on-surface bg-surface mt-2 cursor-pointer">
                <input
                  type="range"
                  min="64"
                  max="2048"
                  step="64"
                  value={artBible?.baseTextureRes ?? 256}
                  onChange={(e) =>
                    setArtBible((prev) =>
                      prev ? { ...prev, baseTextureRes: parseInt(e.target.value) } : null
                    )
                  }
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="absolute left-0 top-0 h-full bg-primary-container border-r-2 border-on-surface"
                  style={{
                    width: `${((artBible?.baseTextureRes ?? 256) - 64) / (2048 - 64) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Poly Limit Slider */}
            <div className="flex flex-col gap-[var(--spacing-sm)]">
              <div className="flex justify-between items-center border-b-2 border-black pb-1">
                <label className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Max Polycount
                </label>
                <span className="font-[var(--font-terminal)] text-sm">
                  {artBible ? `${artBible.maxPolycount} tris` : "—"}
                </span>
              </div>
              <div className="relative w-full h-4 border-2 border-on-surface bg-surface mt-2 cursor-pointer">
                <input
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                  value={artBible?.maxPolycount ?? 1500}
                  onChange={(e) =>
                    setArtBible((prev) =>
                      prev ? { ...prev, maxPolycount: parseInt(e.target.value) } : null
                    )
                  }
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="absolute left-0 top-0 h-full bg-primary-container border-r-2 border-on-surface"
                  style={{
                    width: `${((artBible?.maxPolycount ?? 1500) - 100) / (5000 - 100) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-[var(--spacing-sm)] mt-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`relative w-5 h-5 border-2 border-on-surface ${artBible?.enforcePalette ? "bg-primary-container" : "bg-white"} group-hover:bg-surface-variant flex items-center justify-center`}
                >
                  {artBible?.enforcePalette && <div className="w-3 h-3 bg-white" />}
                </div>
                <input
                  type="checkbox"
                  checked={artBible?.enforcePalette ?? false}
                  onChange={(e) =>
                    setArtBible((prev) =>
                      prev ? { ...prev, enforcePalette: e.target.checked } : null
                    )
                  }
                  className="sr-only"
                />
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Enforce Palette
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`relative w-5 h-5 border-2 border-on-surface ${artBible?.strictOrthographic ? "bg-primary-container" : "bg-white"} group-hover:bg-surface-variant flex items-center justify-center`}
                >
                  {artBible?.strictOrthographic && <div className="w-3 h-3 bg-white" />}
                </div>
                <input
                  type="checkbox"
                  checked={artBible?.strictOrthographic ?? false}
                  onChange={(e) =>
                    setArtBible((prev) =>
                      prev ? { ...prev, strictOrthographic: e.target.checked } : null
                    )
                  }
                  className="sr-only"
                />
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Strict Orthographic
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`relative w-5 h-5 border-2 border-on-surface ${artBible?.snapToGrid ? "bg-primary-container" : "bg-white"} group-hover:bg-surface-variant flex items-center justify-center`}
                >
                  {artBible?.snapToGrid && <div className="w-3 h-3 bg-white" />}
                </div>
                <input
                  type="checkbox"
                  checked={artBible?.snapToGrid ?? false}
                  onChange={(e) =>
                    setArtBible((prev) =>
                      prev ? { ...prev, snapToGrid: e.target.checked } : null
                    )
                  }
                  className="sr-only"
                />
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Snap to Grid ({artBible?.gridSize ?? 8}px)
                </span>
              </label>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveArtBible}
              className="mt-8 border-2 border-on-surface bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-on-surface hover:text-white transition-colors flex justify-center items-center gap-2 w-full retro-press"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              Save Constraints
            </button>
          </div>
        </aside>
      </div>
      </div>
    </DataLoader>

    {/* Create Asset Modal */}
    <Modal
      isOpen={showCreateModal}
      onClose={() => setShowCreateModal(false)}
      title="New Asset"
      onSubmit={handleCreateAsset}
      submitLabel="Create"
      submitDisabled={!formData.filename || creating}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Filename *">
          <input
            type="text"
            value={formData.filename}
            onChange={(e) => setFormData((f) => ({ ...f, filename: e.target.value }))}
            className="border-2 border-black p-2 font-[var(--font-terminal)] text-sm w-full"
            placeholder="New_Asset.fbx"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type">
            <select
              value={formData.type}
              onChange={(e) => setFormData((f) => ({ ...f, type: e.target.value as typeof formData.type }))}
              className="border-2 border-black p-2 font-[var(--font-terminal)] text-sm w-full"
            >
              <option value="3d">3D</option>
              <option value="2d">2D</option>
              <option value="vfx">VFX</option>
              <option value="audio">Audio</option>
              <option value="texture">Texture</option>
            </select>
          </FormField>
          <FormField label="Category">
            <select
              value={formData.category}
              onChange={(e) => setFormData((f) => ({ ...f, category: e.target.value as typeof formData.category }))}
              className="border-2 border-black p-2 font-[var(--font-terminal)] text-sm w-full"
            >
              <option value="prop">Prop</option>
              <option value="character">Character</option>
              <option value="env">Environment</option>
              <option value="weapon">Weapon</option>
              <option value="ui">UI</option>
              <option value="tex">Texture</option>
              <option value="sfx">SFX</option>
              <option value="music">Music</option>
            </select>
          </FormField>
        </div>
        <FormField label="Size (bytes)">
          <input
            type="number"
            value={formData.sizeBytes}
            onChange={(e) => setFormData((f) => ({ ...f, sizeBytes: parseInt(e.target.value) || 0 }))}
            className="border-2 border-black p-2 font-[var(--font-terminal)] text-sm w-full"
          />
        </FormField>
      </div>
    </Modal>

    {/* Delete Confirmation Modal */}
    <Modal
      isOpen={!!deleteId}
      onClose={() => setDeleteId(null)}
      title="Delete Asset"
      onSubmit={() => deleteId && handleDeleteAsset(deleteId)}
      submitLabel="Delete"
    >
      <p className="font-[var(--font-terminal)] text-sm">
        Are you sure you want to delete this asset? This action cannot be undone.
      </p>
    </Modal>
    </>
  );
}

function AssetCard({ asset, onDelete }: { asset: GameAsset; onDelete: () => void }) {
  const icon = typeIcons[asset.type] ?? "view_in_ar";
  const categoryColor = categoryColors[asset.category] ?? "bg-surface-variant";

  return (
    <div className="border-2 border-on-surface bg-surface-container-lowest flex flex-col group cursor-pointer hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(25,27,37,1)] transition-all relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute top-2 left-2 w-6 h-6 border-2 border-black bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white hover:border-red-500 z-10"
      >
        <span className="material-symbols-outlined text-xs">delete</span>
      </button>
      <div className="aspect-square border-b-2 border-on-surface relative overflow-hidden flex items-center justify-center p-4">
        <div
          className={`w-full h-full opacity-60 flex items-center justify-center ${typeColors[asset.type] ?? "bg-surface-variant"}`}
        >
          <span className="material-symbols-outlined text-5xl text-outline">{icon}</span>
        </div>
        <div className="absolute top-2 right-2 border-2 border-on-surface bg-white px-1 py-0.5 font-[var(--font-label)] text-[10px] font-bold uppercase">
          {asset.type.toUpperCase()}
        </div>
      </div>
      <div className="p-[var(--spacing-sm)] flex flex-col gap-1">
        <div className="font-[var(--font-terminal)] text-sm font-bold truncate">
          {asset.filename}
        </div>
        <div className="flex gap-2">
          <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-surface">
            {formatBytes(asset.sizeBytes)}
          </span>
          <span className={`border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase ${categoryColor}`}>
            {asset.category}
          </span>
        </div>
      </div>
    </div>
  );
}
