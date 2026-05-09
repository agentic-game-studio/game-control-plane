"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAssets } from "@/hooks/useAssets";
import { useSettings } from "@/hooks/useSettings";
import { useProject } from "@/contexts/ProjectContext";
import { DataLoader } from "@/components/DataLoader";
import { ProjectGuard } from "@/components/ProjectGuard";
import { AssetCard } from "./components/AssetCard";
import { AssetFilters, type SortOption } from "./components/AssetFilters";
import { NewAssetModal } from "./components/NewAssetModal";
import { GenerateAssetModal } from "./components/GenerateAssetModal";
import { apiFetch } from "@/lib/api";
import type { AssetType } from "@game-studio/types";

const GRID_SLOTS = 10;

export default function AssetsPage() {
  return (
    <ProjectGuard>
      <AssetsPageInner />
    </ProjectGuard>
  );
}

function AssetsPageInner() {
  const { currentProject } = useProject();

  const {
    data,
    loading,
    error,
    retry,
    rescan,
    createAsset,
    deleteAsset,
    generateAsset,
    generateAssetBatch,
  } = useAssets(currentProject?.id);

  const { data: settings } = useSettings();

  const [activeType, setActiveType] = useState<AssetType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [availablePresets, setAvailablePresets] = useState<string[]>([]);

  // Fetch available presets when the generate modal opens
  useEffect(() => {
    if (isGenerateModalOpen) {
      apiFetch<string[]>("/api/assets/generate/presets")
        .then((data) => setAvailablePresets(data))
        .catch(() => setAvailablePresets([]));
    }
  }, [isGenerateModalOpen]);

  const handleBatchGenerate = useCallback(
    async (presetsFile: string, workspacePath?: string) => {
      return generateAssetBatch(presetsFile, workspacePath);
    },
    [generateAssetBatch]
  );

  const filteredAssets = useMemo(() => {
    // Deduplicate by id to prevent duplicate key errors
    const seen = new Set<string>();
    let result = data.assets.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
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
        <div className="flex items-center justify-between">
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
                    : `RESOURCE MANAGEMENT // ${data.assets.length} Assets Scanned`}
              </span>
            </div>
          </div>
          <button
            onClick={rescan}
            disabled={loading}
            className="flex items-center gap-2 border-2 border-black bg-white px-3 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] hover:text-white transition-colors disabled:opacity-50"
            title="Rescan workspace folder"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            Rescan
          </button>
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
            onCraftAsset={() => setIsManualModalOpen(true)}
            onGenerateAsset={() => setIsGenerateModalOpen(true)}
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

      {/* Manual Asset Modal */}
      <NewAssetModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSubmit={createAsset}
      />

      {/* AI Generate Asset Modal */}
      <GenerateAssetModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        workspacePath={currentProject?.workspacePath ?? undefined}
        onGenerate={generateAsset}
        onBatchGenerate={handleBatchGenerate}
        availablePresets={availablePresets}
      />
    </div>
  );
}
