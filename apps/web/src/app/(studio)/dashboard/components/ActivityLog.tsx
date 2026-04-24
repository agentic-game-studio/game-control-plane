"use client";

import type { ActivityLogEntry } from "@game-studio/types";

interface ActivityLogProps {
  entries: ActivityLogEntry[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] flex flex-col h-full">
      {/* Header */}
      <div className="border-b-2 border-black p-3 bg-black text-white">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          {`> SYS_LOG`}
        </span>
      </div>

      {/* Log Entries */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-[300px]">
        {entries.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#737688]">
            <span className="material-symbols-outlined">receipt_long</span>
            <span className="font-[var(--font-terminal)] text-xs uppercase">
              No activity recorded
            </span>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="font-[var(--font-terminal)] text-xs border-b border-[#e1e1ef] pb-2 last:border-b-0"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[#737688] whitespace-nowrap">
                  [{entry.timestamp.slice(11, 16)}]
                </span>
                <span
                  className={`font-bold uppercase text-[10px] ${
                    entry.source === "SYS"
                      ? "text-[#737688]"
                      : "text-[#434656]"
                  }`}
                >
                  {entry.source}
                </span>
              </div>
              <p className="text-[#434656] mt-0.5 pl-[52px]">{entry.message}</p>
            </div>
          ))
        )}
        <div className="font-[var(--font-terminal)] text-xs text-[#737688] mt-auto pt-2">
          _ waiting...
        </div>
      </div>
    </div>
  );
}
