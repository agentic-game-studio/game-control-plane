"use client";

import type { TicketsBoard, TicketStatus } from "@game-studio/types";
import { QuestCard } from "./QuestCard";

const COLUMNS: { id: TicketStatus; label: string; icon: string }[] = [
  { id: "available", label: "Available", icon: "inbox" },
  { id: "in_progress", label: "Processing", icon: "pending_actions" },
  { id: "qa", label: "Verify", icon: "rule" },
  { id: "completed", label: "Completed", icon: "task_alt" },
];

interface QuestBoardProps {
  board: TicketsBoard;
  onAcknowledge: (id: string) => void;
}

export function QuestBoard({ board, onAcknowledge }: QuestBoardProps) {
  return (
    <div className="flex-1 grid grid-cols-4 gap-4 min-h-0">
      {COLUMNS.map((col) => {
        const columnData = board.columns.find((c) => c.id === col.id);
        const tickets =
          columnData?.tickets.filter((t) => {
            // Hide acknowledged tickets from completed column
            if (col.id === "completed") return !t.acknowledged;
            return true;
          }) ?? [];

        return (
          <div
            key={col.id}
            className="border-2 border-black bg-white flex flex-col shadow-[4px_4px_0_0_rgba(0,0,0,1)] min-h-0"
          >
            {/* Column Header */}
            <div className="border-b-2 border-black p-3 bg-black text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">{col.icon}</span>
                <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
                  {col.label}
                </span>
              </div>
              <span className="border-2 border-white px-1.5 py-0.5 text-[10px] font-[var(--font-label)] font-bold uppercase">
                {tickets.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto min-h-0">
              {tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                  <span className="material-symbols-outlined text-[#737688]">
                    {col.icon}
                  </span>
                  <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
                    No Quests
                  </span>
                </div>
              ) : (
                tickets.map((ticket) => (
                  <QuestCard
                    key={ticket.id}
                    ticket={ticket}
                    onAcknowledge={
                      col.id === "completed" ? onAcknowledge : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
