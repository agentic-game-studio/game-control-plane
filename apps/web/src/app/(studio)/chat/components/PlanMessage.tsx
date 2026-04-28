"use client";

import type { ChatMessage } from "@/hooks/useCommandRoom";
import { renderMarkdown } from "@/lib/markdown";
import { formatTime } from "@/lib/format-time";

interface PlanMessageProps {
  msg: ChatMessage;
  onPlanAction: (phaseId: string, action: "execute" | "execute-all") => void;
  sender?: string;
}

export default function PlanMessage({ msg, onPlanAction, sender }: PlanMessageProps) {
  const phases = msg.planPhases ?? [];
  const pendingPhases = phases.filter((p) => p.status === "pending");
  const hasPending = pendingPhases.length > 0;
  const completedCount = phases.filter((p) => p.status === "completed").length;

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-[#2ECC71] text-white border-black";
      case "active":
        return "bg-[#0055FF] text-white border-black animate-pulse";
      default:
        return "bg-[#e7e7f5] text-[#434656] border-black";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "check_circle";
      case "active":
        return "sync";
      default:
        return "radio_button_unchecked";
    }
  };

  const getPhaseBorder = (status: string) => {
    switch (status) {
      case "completed":
        return "border-[#2ECC71]";
      case "active":
        return "border-[#0055FF]";
      default:
        return "border-black";
    }
  };

  const getPhaseBg = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-[#f0fff4]";
      case "active":
        return "bg-[#f0f4ff]";
      default:
        return "bg-[#faf8ff]";
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
            {sender ? sender.replace(/-/g, "_").toUpperCase() : "PRODUCER"}
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
          <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10 overflow-hidden">
            {/* Header bar */}
            <div className="bg-black p-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-white text-sm">assignment</span>
                <span className="font-[var(--font-label)] text-[10px] uppercase text-white tracking-widest">
                  Execution Plan
                </span>
              </div>
              {completedCount > 0 && (
                <span className="font-[var(--font-terminal)] text-[10px] text-white bg-[#2ECC71] px-2 py-0.5 border border-white">
                  {completedCount}/{phases.length} done
                </span>
              )}
            </div>

            <div className="p-5">
              {/* Plan content as markdown */}
              <div
                className="font-[var(--font-terminal)] text-[15px] mb-5 leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
              />

              {/* Phase cards */}
              {phases.length > 0 && (
                <div className="space-y-3 mt-5 pt-4 border-t-2 border-black">
                  {/* Header with progress */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-[var(--font-label)] text-xs uppercase text-[#737688] tracking-widest">
                        Phases
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 h-2 border border-black bg-white">
                          <div
                            className="h-full bg-[#0055FF] transition-all duration-500"
                            style={{ width: `${phases.length > 0 ? (completedCount / phases.length) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
                          {completedCount}/{phases.length}
                        </span>
                      </div>
                    </div>
                    {hasPending && (
                      <button
                        onClick={() => onPlanAction("all", "execute-all")}
                        className="border-2 border-black bg-black text-white px-3 py-1.5 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] retro-press shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-sm">rocket_launch</span>
                        EXECUTE ALL
                      </button>
                    )}
                  </div>

                  {phases.map((phase, index) => (
                    <div
                      key={phase.id}
                      className={`border-2 ${getPhaseBorder(phase.status)} ${getPhaseBg(phase.status)} p-3 flex items-start gap-3 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all duration-200`}
                    >
                      {/* Phase number */}
                      <div className={`w-8 h-8 shrink-0 border-2 border-black flex justify-center items-center ${
                        phase.status === "completed"
                          ? "bg-[#2ECC71] text-white"
                          : phase.status === "active"
                          ? "bg-[#0055FF] text-white"
                          : "bg-[#e7e7f5] text-[#434656]"
                      }`}>
                        <span className="font-[var(--font-terminal)] text-sm font-bold">
                          {phase.status === "completed" ? (
                            <span className="material-symbols-outlined text-sm">check</span>
                          ) : (
                            index + 1
                          )}
                        </span>
                      </div>

                      {/* Phase content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                            {phase.label}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border-2 ${getStatusStyle(phase.status)} flex items-center gap-1`}>
                            <span className="material-symbols-outlined text-[10px]">{getStatusIcon(phase.status)}</span>
                            {phase.status === "completed" ? "DONE" : phase.status === "active" ? "RUNNING" : "PENDING"}
                          </span>
                          {phase.estimatedEffort && (
                            <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] border border-black px-1.5 py-0.5 bg-white">
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

                      {/* Action button */}
                      {phase.status === "pending" && (
                        <button
                          onClick={() => onPlanAction(phase.id, "execute")}
                          className="shrink-0 border-2 border-black bg-white text-black px-3 py-1.5 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] hover:text-white hover:border-[#0055FF] retro-press shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                          EXECUTE
                        </button>
                      )}
                      {phase.status === "active" && (
                        <div className="shrink-0 flex items-center gap-1.5 border-2 border-[#0055FF] bg-[#0055FF] text-white px-2 py-1">
                          <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                          <span className="font-[var(--font-terminal)] text-[10px] font-bold">RUNNING</span>
                        </div>
                      )}
                      {phase.status === "completed" && (
                        <div className="shrink-0 flex items-center gap-1 border-2 border-[#2ECC71] bg-[#2ECC71] text-white px-2 py-1">
                          <span className="material-symbols-outlined text-sm">check</span>
                          <span className="font-[var(--font-terminal)] text-[10px] font-bold">DONE</span>
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
    </div>
  );
}
