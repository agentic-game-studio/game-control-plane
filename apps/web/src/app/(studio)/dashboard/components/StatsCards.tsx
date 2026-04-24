"use client";

import type { DashboardData } from "@game-studio/types";

interface StatsCardsProps {
  data: DashboardData;
}

export function StatsCards({ data }: StatsCardsProps) {
  const { summary } = data;
  const creditPercent = summary.credits.max > 0
    ? Math.round((summary.credits.current / summary.credits.max) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total Projects */}
      <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
        <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3 tracking-wider">
          Total Projects
        </div>
        <div className="font-[var(--font-terminal)] text-4xl font-bold">
          {data.projects.length}
        </div>
      </div>

      {/* Active Directories */}
      <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
        <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3 tracking-wider">
          Active Directories
        </div>
        <div className="font-[var(--font-terminal)] text-4xl font-bold">
          {summary.activeDirectories}
        </div>
      </div>

      {/* Available Credits */}
      <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
        <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3 tracking-wider">
          Available Credits
        </div>
        <div className="font-[var(--font-terminal)] text-2xl font-bold mb-2">
          {summary.credits.current} / {summary.credits.max}
        </div>
        <div className="w-full h-4 border-2 border-black bg-[#f3f2ff] relative overflow-hidden">
          <div
            className="h-full bg-black stripe-pattern transition-all duration-300"
            style={{ width: `${creditPercent}%` }}
          />
        </div>
        <div className="font-[var(--font-terminal)] text-xs text-[#737688] mt-1">
          HP: {creditPercent}%
        </div>
      </div>
    </div>
  );
}
