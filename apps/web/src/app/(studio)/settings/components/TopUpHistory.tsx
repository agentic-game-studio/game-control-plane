"use client";

import type { TopUpEntry } from "@game-studio/types";

interface TopUpHistoryProps {
  entries: TopUpEntry[];
}

export function TopUpHistory({ entries }: TopUpHistoryProps) {
  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black bg-black text-white p-3 flex items-center justify-between">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          Top-up History
        </span>
        <span className="material-symbols-outlined text-white">receipt_long</span>
      </div>
      <div className="p-0 max-h-[200px] overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-center">
            <span className="material-symbols-outlined text-[#737688] text-2xl mb-1 block">
              history
            </span>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688]">
              No top-ups yet.
            </span>
          </div>
        ) : (
          <ul className="divide-y-2 divide-black">
            {entries.slice().reverse().map((entry) => (
              <li key={entry.id} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#0055FF] text-sm">
                    generating_tokens
                  </span>
                  <span className="font-[var(--font-terminal)] text-xs uppercase">
                    +{entry.amount.toLocaleString()} Credits
                  </span>
                </div>
                <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
                  {new Date(entry.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
