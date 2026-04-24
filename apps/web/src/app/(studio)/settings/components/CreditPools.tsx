"use client";

import { useMemo } from "react";
import type { SettingsConfig } from "@game-studio/types";

interface CreditPoolsProps {
  credits: SettingsConfig["credits"];
  onInsertCoin: () => void;
}

export function CreditPools({ credits, onInsertCoin }: CreditPoolsProps) {
  const resetDate = useMemo(() => {
    const d = new Date(credits.subscription.resetAt);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).toUpperCase();
  }, [credits.subscription.resetAt]);

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black bg-black text-white p-3 flex items-center justify-between">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          Credit Management
        </span>
        <span className="material-symbols-outlined text-white">attach_money</span>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {/* Subscription Credits */}
        <div className="text-center">
          <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            Subscription Credits
          </span>
          <div className="bg-black text-[#0055FF] p-4">
            <span className="font-[var(--font-headline)] text-5xl font-black tracking-tighter block">
              {credits.subscription.current.toLocaleString()}
            </span>
          </div>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase mt-1 block">
            Resets On: {resetDate}
          </span>
        </div>

        {/* On-top Credits */}
        <div className="text-center">
          <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            On-top Credits
          </span>
          <div className="bg-black text-[#0055FF] p-4">
            <span className="font-[var(--font-headline)] text-5xl font-black tracking-tighter block">
              {credits.onTop.current.toLocaleString()}
            </span>
          </div>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase mt-1 block">
            No Expiration
          </span>
        </div>

        {/* Insert Coin */}
        <button
          onClick={onInsertCoin}
          className="w-full border-2 border-black bg-[#0055FF] text-white px-4 py-3 font-[var(--font-label)] text-xs font-bold uppercase tracking-wider hover:bg-black transition-colors shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">generating_tokens</span>
          Insert Coin
        </button>

        {/* Burn Rate */}
        <div className="border-t-2 border-black pt-3">
          <span className="font-[var(--font-terminal)] text-xs uppercase text-black">
            Burn Rate: {credits.burnRatePerHour}/HR
          </span>
        </div>
      </div>
    </div>
  );
}
