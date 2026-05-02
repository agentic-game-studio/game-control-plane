"use client";

import { useState } from "react";
import type { AssetType } from "@game-studio/types";

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "size-asc"
  | "size-desc"
  | "newest"
  | "oldest";

const TABS: { label: string; value: AssetType | "all" }[] = [
  { label: "All Assets", value: "all" },
  { label: "2D Images", value: "2d" },
  { label: "3D Models", value: "3d" },
  { label: "Audio", value: "audio" },
  { label: "VFX", value: "vfx" },
  { label: "Texture", value: "texture" },
];

interface AssetFiltersProps {
  activeType: AssetType | "all";
  onTypeChange: (type: AssetType | "all") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  onCraftAsset: () => void;
  onGenerateAsset: () => void;
}

export function AssetFilters({
  activeType,
  onTypeChange,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  onCraftAsset,
  onGenerateAsset,
}: AssetFiltersProps) {
  const [searchValue, setSearchValue] = useState(searchQuery);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Row: Search + Sort + Actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="flex-1 flex items-center gap-2 border-2 border-black bg-white px-3 py-2 focus-within:ring-2 ring-[#0055FF] ring-offset-2 ring-offset-white transition-all">
          <span className="material-symbols-outlined text-[#737688]">search</span>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              onSearchChange(e.target.value);
            }}
            placeholder="Search assets..."
            className="w-full bg-transparent border-none outline-none font-[var(--font-terminal)] text-sm placeholder:text-[#737688]"
          />
        </div>

        <div className="relative border-2 border-black bg-white shrink-0">
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="appearance-none bg-transparent outline-none font-[var(--font-label)] text-xs font-bold uppercase py-3 pl-4 pr-10 cursor-pointer"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="size-asc">Size Small-Large</option>
            <option value="size-desc">Size Large-Small</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
            arrow_drop_down
          </span>
        </div>

        {/* Generate Asset (AI) button */}
        <button
          onClick={onGenerateAsset}
          className="border-2 border-black bg-[#0055FF] text-white font-[var(--font-label)] text-xs font-bold uppercase px-6 py-3 transition-all flex items-center justify-center gap-2 shrink-0 hover:bg-black active:translate-x-[2px] active:translate-y-[2px]"
        >
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          Generate
        </button>

        {/* Craft Asset (manual) button */}
        <button
          onClick={onCraftAsset}
          className="border-2 border-black bg-white text-black font-[var(--font-label)] text-xs font-bold uppercase px-6 py-3 transition-all flex items-center justify-center gap-2 shrink-0 hover:bg-[#f3f2ff] active:translate-x-[2px] active:translate-y-[2px]"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Manual
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onTypeChange(tab.value)}
            className={`border-2 border-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase transition-all ${
              activeType === tab.value
                ? "bg-[#0055FF] text-white"
                : "bg-white text-black hover:bg-[#f3f2ff]"
            } active:translate-x-[2px] active:translate-y-[2px]`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
