"use client";

import { TIER_DEFINITIONS, type SettingsConfig } from "@game-studio/types";

interface TierBadgeProps {
  tier: SettingsConfig["tier"];
  onUpgrade: () => void;
}

export function TierBadge({ tier, onUpgrade }: TierBadgeProps) {
  const current = TIER_DEFINITIONS.find((t) => t.id === tier);
  const nextTier = TIER_DEFINITIONS[TIER_DEFINITIONS.findIndex((t) => t.id === tier) + 1];

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black bg-black text-white p-3 flex items-center justify-between">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          Subscription Tier
        </span>
        <span className="material-symbols-outlined text-white">workspace_premium</span>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 border-2 border-black bg-[#0055FF] flex items-center justify-center text-white shrink-0">
            <span className="material-symbols-outlined text-xl">stars</span>
          </div>
          <div>
            <div className="font-[var(--font-headline)] text-lg font-bold uppercase">
              {current?.name ?? tier}
            </div>
            <div className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase">
              {current?.maxProjects} Projects / {current?.weeklyCredits.toLocaleString()} Credits/Week
            </div>
          </div>
        </div>

        <div className="border-2 border-black bg-[#f3f2ff] p-3">
          <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            Features
          </span>
          <ul className="space-y-1">
            {current?.features.map((f) => (
              <li key={f} className="flex items-center gap-2 font-[var(--font-terminal)] text-xs">
                <span className="material-symbols-outlined text-[#0055FF] text-sm">check_circle</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {nextTier && (
          <button
            onClick={onUpgrade}
            className="w-full border-2 border-black bg-black text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase tracking-wider hover:bg-[#0055FF] transition-colors shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px]"
          >
            Upgrade to {nextTier.name} — ${nextTier.priceUsd}/mo
          </button>
        )}
      </div>
    </div>
  );
}
