"use client";

import { useState, useMemo } from "react";
import { useAssets } from "@/hooks/useAssets";
import { useSettings } from "@/hooks/useSettings";
import { DataLoader } from "@/components/DataLoader";
import { AssetCard } from "./components/AssetCard";
import { AssetFilters, type SortOption } from "./components/AssetFilters";
import { NewAssetModal } from "./components/NewAssetModal";
import type { AssetType } from "@game-studio/types";

const GRID_SLOTS = 10;

export default function AssetsPage() {
  const {
    data,
    loading,
    error,
    retry,
    createAsset,
    deleteAsset,
  } = useAssets();

  const { data: settings } = useSettings();

  const [activeType, setActiveType] = useState<AssetType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Craft Asset temporarily locked
  const canCraft = false;

  const filteredAssets = useMemo(() => {
    let result = [...data.assets];

    // Filter by type
    if (activeType !== "all") {
      result = result.filter((a) => a.type === activeType);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.filename.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.filename.localeCompare(b.filename);
        case "name-desc":
          return b.filename.localeCompare(a.filename);
        case "size-asc":
          return a.sizeBytes - b.sizeBytes;
        case "size-desc":
          return b.sizeBytes - a.sizeBytes;
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [data.assets, activeType, searchQuery, sortBy]);

  const emptySlots = Math.max(0, GRID_SLOTS - filteredAssets.length);

  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
              grid_on
            </span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              ASSET LIBRARY
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              {loading
                ? "RESOURCE MANAGEMENT // Scanning..."
                : error
                  ? "RESOURCE MANAGEMENT // Connection Lost"
                  : `RESOURCE MANAGEMENT // ${data.assets.length} Assets Indexed`}
            </span>
          </div>
        </div>
      </div>

      <DataLoader loading={loading} error={error} onRetry={retry}>
        <div className="flex-1 flex flex-col gap-6 min-h-0 overflow-hidden">
          {/* Filters */}
          <AssetFilters
            activeType={activeType}
            onTypeChange={setActiveType}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onCraftAsset={() => setIsModalOpen(true)}
            canCraft={canCraft}
          />

          {/* Grid */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onDelete={deleteAsset}
                />
              ))}
              {Array.from({ length: emptySlots }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="border-2 border-dashed border-[#c3c5d9] bg-[#f3f2ff] flex flex-col aspect-square justify-center items-center opacity-50"
                >
                  <span className="material-symbols-outlined text-[#737688] text-3xl">
                    add
                  </span>
                  <span className="font-[var(--font-label)] text-xs uppercase mt-2 text-[#737688]">
                    Empty Slot
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DataLoader>

      {/* Craft Asset Modal */}
      <NewAssetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={createAsset}
      />
    </div>
  );
}
