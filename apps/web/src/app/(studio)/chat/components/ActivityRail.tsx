"use client";

import type { ActivityItem } from "@/hooks/useCommandRoom";

interface ActivityRailProps {
  items: ActivityItem[];
}

const KIND_STYLES: Record<ActivityItem["kind"], { badge: string; icon: string }> = {
  spawned: { badge: "bg-[#0055FF] text-white", icon: "play_arrow" },
  completed: { badge: "bg-[#2ECC71] text-white", icon: "check_circle" },
  failed: { badge: "bg-[#df2b31] text-white", icon: "error" },
  status: { badge: "bg-black text-white", icon: "notes" },
};

export default function ActivityRail({ items }: ActivityRailProps) {
  if (items.length === 0) return null;

  return (
    <aside className="hidden xl:flex xl:w-80 shrink-0 border-l-2 border-black bg-[#fcfcff] flex-col">
      <div className="px-4 py-3 border-b-2 border-black bg-[#191b25] text-white">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">timeline</span>
          <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.18em]">
            Activity
          </span>
        </div>
        <p className="font-[var(--font-terminal)] text-[10px] text-white/70 mt-1">
          Recent orchestration events, Claude Code-style
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.slice(0, 10).map((item) => {
          const style = KIND_STYLES[item.kind];
          return (
            <div key={item.id} className="border-2 border-black bg-white shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <div className="px-3 py-2 flex items-start gap-2">
                <span className="material-symbols-outlined text-sm mt-0.5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 border border-black font-[var(--font-terminal)] text-[9px] uppercase ${style.badge}`}>
                      {item.kind}
                    </span>
                    <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate">
                      {item.title}
                    </span>
                  </div>
                  <p className="font-[var(--font-terminal)] text-[10px] text-[#434656] mt-1 line-clamp-3 break-words">
                    {item.detail}
                  </p>
                  <div className="font-[var(--font-terminal)] text-[9px] text-[#737688] mt-2 uppercase">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
