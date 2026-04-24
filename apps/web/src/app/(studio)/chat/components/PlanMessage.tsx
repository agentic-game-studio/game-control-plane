"use client";

import { useState } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";
import { renderMarkdown } from "@/lib/markdown";

interface PlanMessageProps {
  msg: ChatMessage;
  onPlanAction: (phaseId: string, action: "execute" | "execute-all") => void;
  sender?: string;
}

export default function PlanMessage({ msg, onPlanAction, sender }: PlanMessageProps) {
  const phases = msg.planPhases ?? [];
  const pendingPhases = phases.filter((p) => p.status === "pending");
  const hasPending = pendingPhases.length > 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500 text-white";
      case "active":
        return "bg-yellow-500 text-black";
      default:
        return "bg-[#e7e7f5] text-[#434656]";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "DONE";
      case "active":
        return "RUNNING";
      default:
        return "PENDING";
    }
  };

  return (
    <div className="flex gap-4 w-full max-w-4xl self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">assignment</span>
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">
            {sender ? sender.replace(/-/g, "_").toUpperCase() : "GAME_DIRECTOR"}
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{msg.timestamp}</span>
        </div>
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
          <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10">
            {/* Plan content as markdown */}
            <div
              className="font-[var(--font-terminal)] text-base mb-4"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />

            {/* Phase cards */}
            {phases.length > 0 && (
              <div className="space-y-3 mt-4 pt-4 border-t-2 border-black">
                <div className="flex items-center justify-between">
                  <span className="font-[var(--font-label)] text-xs uppercase text-[#737688] tracking-widest">
                    Phases ({phases.filter((p) => p.status === "completed").length}/{phases.length})
                  </span>
                  {hasPending && (
                    <button
                      onClick={() => onPlanAction("all", "execute-all")}
                      className="border-2 border-black bg-black text-white px-3 py-1 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] retro-press shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
                    >
                      EXECUTE ALL
                    </button>
                  )}
                </div>

                {phases.map((phase, index) => (
                  <div
                    key={phase.id}
                    className="border-2 border-black bg-[#faf8ff] p-3 flex items-start gap-3"
                  >
                    {/* Phase number */}
                    <div className="w-8 h-8 shrink-0 border-2 border-black bg-[#e7e7f5] flex justify-center items-center">
                      <span className="font-[var(--font-terminal)] text-sm font-bold">{index + 1}</span>
                    </div>

                    {/* Phase content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                          {phase.label}
                        </span>
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusColor(phase.status)}`}>
                          {getStatusLabel(phase.status)}
                        </span>
                        {phase.estimatedEffort && (
                          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
                            {phase.estimatedEffort}
                          </span>
                        )}
                      </div>
                      {phase.description && (
                        <p className="font-[var(--font-terminal)] text-xs text-[#434656]">
                          {phase.description}
                        </p>
                      )}
                    </div>

                    {/* Execute button */}
                    {phase.status === "pending" && (
                      <button
                        onClick={() => onPlanAction(phase.id, "execute")}
                        className="shrink-0 border-2 border-[#0055FF] text-[#0055FF] px-3 py-1 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] hover:text-white retro-press shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
                      >
                        EXECUTE
                      </button>
                    )}
                    {phase.status === "active" && (
                      <div className="shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[#0055FF] animate-spin text-sm">sync</span>
                        <span className="font-[var(--font-terminal)] text-[10px] text-[#0055FF]">RUNNING</span>
                      </div>
                    )}
                    {phase.status === "completed" && (
                      <div className="shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-green-600 text-sm">check_circle</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
