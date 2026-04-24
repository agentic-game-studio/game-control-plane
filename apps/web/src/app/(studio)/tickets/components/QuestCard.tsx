"use client";

import type { Ticket } from "@game-studio/types";

interface QuestCardProps {
  ticket: Ticket;
  onAcknowledge?: (id: string) => void;
}

export function QuestCard({ ticket, onAcknowledge }: QuestCardProps) {
  const isWorking = !!ticket.assignee;
  const isCompleted = ticket.status === "completed";
  const showClose = isCompleted && !ticket.acknowledged;

  return (
    <div className="border-2 border-black bg-white p-3 flex flex-col gap-2 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all">
      {/* Title */}
      <div className="font-[var(--font-terminal)] text-sm font-bold leading-tight">
        {ticket.title}
      </div>

      {/* Area / Subarea */}
      <div className="flex gap-2 flex-wrap">
        <span className="border-2 border-black px-1.5 py-0.5 text-[10px] font-[var(--font-label)] uppercase bg-[#f3f2ff]">
          {ticket.area}
        </span>
        <span className="border-2 border-black px-1.5 py-0.5 text-[10px] font-[var(--font-label)] uppercase bg-[#e1e1ef]">
          {ticket.subarea}
        </span>
      </div>

      {/* Assignee + Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {ticket.assignee ? (
            <>
              <div className="w-6 h-6 border-2 border-black bg-black flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-xs">
                  smart_toy
                </span>
              </div>
              <span className="font-[var(--font-terminal)] text-xs font-bold truncate max-w-[100px]">
                {ticket.assignee?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            </>
          ) : (
            <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase">
              Unassigned
            </span>
          )}
        </div>

        <span
          className={`px-1.5 py-0.5 text-[10px] font-[var(--font-label)] uppercase font-bold border-2 ${
            isWorking
              ? "bg-[#0055FF] text-white border-[#0055FF]"
              : "bg-[#f3f2ff] text-[#737688] border-black"
          }`}
        >
          {isWorking ? "Working" : "Pending"}
        </span>
      </div>

      {/* Close button for completed */}
      {showClose && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(ticket.id)}
          className="mt-1 w-full border-2 border-black bg-white px-3 py-1.5 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-[#df2b31] hover:text-white hover:border-[#df2b31] transition-colors flex items-center justify-center gap-1 active:translate-x-[2px] active:translate-y-[2px]"
        >
          <span className="material-symbols-outlined text-xs">check</span>
          Close
        </button>
      )}
    </div>
  );
}
