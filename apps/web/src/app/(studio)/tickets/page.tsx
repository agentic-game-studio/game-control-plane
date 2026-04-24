"use client";

import { useTickets } from "@/hooks/useTickets";
import { DataLoader } from "@/components/DataLoader";
import { QuestBoard } from "./components/QuestBoard";

export default function TicketsPage() {
  const { data, loading, error, retry, acknowledgeTicket } = useTickets();

  const totalQuests = data.columns.reduce(
    (sum, col) => sum + col.tickets.length,
    0
  );

  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">checklist</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              Quest Board
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              {loading
                ? "Task Management // Loading..."
                : error
                  ? "Task Management // Connection Lost"
                  : `Task Management // ${totalQuests} Active Quests`}
            </span>
          </div>
        </div>
      </div>

      <DataLoader loading={loading} error={error} onRetry={retry}>
        <QuestBoard board={data} onAcknowledge={acknowledgeTicket} />
      </DataLoader>
    </div>
  );
}
