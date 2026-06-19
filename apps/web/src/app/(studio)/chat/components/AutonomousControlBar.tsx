"use client";
import { createLogger } from "../../../../lib/logger";
import { useEffect, useCallback } from "react";
import { useAutonomousLoop } from "@/hooks/useAutonomousLoop";
const logger = createLogger("AutonomousControlBar");

interface AutonomousControlBarProps {
  /** Current project ID — used as the loop's projectId */
  projectId?: string | null;
  /** Producer session ID — the loop reads tickets from this project's board */
  producerSessionId: string | null;
  /** Called when the loop starts to auto-select the producer session */
  onLoopStarted?: (sessionId: string) => void;
}

export default function AutonomousControlBar({
  projectId,
  producerSessionId,
  onLoopStarted,
}: AutonomousControlBarProps) {
  const { status, metrics, milestone, researchStatus, connected, startLoop, stopLoop, pollStatus } = useAutonomousLoop();

  // Poll status on mount if a session was already running
  useEffect(() => {
    if (producerSessionId) {
      pollStatus(producerSessionId);
    }
  }, [producerSessionId, pollStatus]);

  const handleStart = useCallback(async () => {
    if (!producerSessionId) return;
    try {
      const sessionId = await startLoop(producerSessionId ?? "default", projectId ?? "default");
      onLoopStarted?.(sessionId);
    } catch (err) {
      logger.error("Failed to start loop", { err: err });
    }
  }, [producerSessionId, projectId, startLoop, onLoopStarted]);

  const handleStop = useCallback(async () => {
    if (!status.sessionId) return;
    try {
      await stopLoop(status.sessionId);
    } catch (err) {
      logger.error("Failed to stop loop", { err: err });
    }
  }, [status.sessionId, stopLoop]);

  // Idle state — show Start button
  if (!status.running) {
    return (
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#0a0a1a] border-b-2 border-[#2a2a4e]">
        {/* Robot icon */}
        <div className="w-6 h-6 border-2 border-[#2a2a4e] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-sm text-[#4a4a6a]">smart_toy</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#737688] leading-tight block">
            Autonomous Mode
          </span>
          <span className="font-[var(--font-terminal)] text-[9px] text-[#4a4a6a] leading-tight">
            {status.completedCount > 0 || status.failedCount > 0
              ? `Last run: ${status.completedCount} done, ${status.failedCount} failed`
              : researchStatus.phase !== "idle"
                ? researchStatus.phase === "started"
                  ? "Deep Research running..."
                  : `Research: ${researchStatus.sections ?? "?"} sections ready`
                : "Idle — seed tickets then start"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {researchStatus.phase === "started" && (
            <span className="flex items-center gap-1 font-[var(--font-terminal)] text-[9px] text-[#f39c12]">
              <span className="w-2 h-2 bg-[#f39c12] rounded-full animate-pulse" />
              Researching
            </span>
          )}
          {researchStatus.phase === "completed" && (
            <span className="flex items-center gap-1 font-[var(--font-terminal)] text-[9px] text-[#2ECC71]">
              <span className="material-symbols-outlined text-xs">check_circle</span>
              {researchStatus.sections ?? "?"} sections
            </span>
          )}
          <button
            onClick={handleStart}
            disabled={!producerSessionId}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-2 border-black font-[var(--font-label)] text-[10px] font-bold uppercase transition-colors ${
              producerSessionId
                ? "bg-[#0055FF] text-white hover:bg-black hover:text-white"
                : "bg-[#2a2a4e] text-[#4a4a6a] cursor-not-allowed"
            }`}
            title={producerSessionId ? "Start autonomous production loop" : "No producer session — open the chat first"}
          >
            <span className="material-symbols-outlined text-sm">play_arrow</span>
            Start Loop
          </button>
          {!connected && (
            <span className="font-[var(--font-terminal)] text-[9px] text-[#df2b31]">WS disconnected</span>
          )}
        </div>
      </div>
    );
  }

  // Running state
  const progressPct =
    status.iteration > 0
      ? Math.round((status.completedCount / status.iteration) * 100)
      : 0;

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#0a0a1a] border-b-2 border-[#0055FF]">
      {/* Pulsing robot */}
      <div className="relative w-6 h-6 border-2 border-[#0055FF] flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-sm text-[#0055FF]">smart_toy</span>
        {/* Pulse dot */}
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#0055FF] rounded-full animate-pulse" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#0055FF] leading-tight">
            Autonomously Producing
          </span>
          {status.currentAgentRole && (
            <span className="font-[var(--font-mono)] text-[9px] text-[#737688] uppercase bg-[#1a1a2e] px-1.5 py-0.5 border border-[#2a2a4e]">
              {status.currentAgentRole}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-[var(--font-terminal)] text-[9px] text-[#4a4a6a] leading-tight">
            {status.currentTicketId
              ? `Ticket: ${status.currentTicketId}`
              : `Iteration ${status.iteration} — standby`}
          </span>
          {milestone && (
            <span className="font-[var(--font-terminal)] text-[9px] text-[#737688]">
              {milestone}
            </span>
          )}
          {researchStatus.phase === "started" && (
            <span className="font-[var(--font-terminal)] text-[9px] text-[#f39c12]">
              Deep Research running...
            </span>
          )}
          {metrics && (
            <span className="font-[var(--font-terminal)] text-[9px] text-[#737688]">
              QA pass {metrics.qaGatePasses} / fail {metrics.qaGateFailures}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          {/* Done */}
          <div className="flex items-center gap-0.5" title="Completed">
            <div className="w-2 h-2 bg-[#2ECC71]" />
            <span className="font-[var(--font-mono)] text-[10px] text-[#2ECC71] tabular-nums">
              {status.completedCount}
            </span>
          </div>
          {/* Failed */}
          <div className="flex items-center gap-0.5" title="Failed">
            <div className="w-2 h-2 bg-[#df2b31]" />
            <span className="font-[var(--font-mono)] text-[10px] text-[#df2b31] tabular-nums">
              {status.failedCount}
            </span>
          </div>
          {/* Iteration */}
          <div className="flex items-center gap-0.5" title="Total iterations">
            <div className="w-2 h-2 bg-[#0055FF]" />
            <span className="font-[var(--font-mono)] text-[10px] text-[#737688] tabular-nums">
              {status.iteration}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-16 h-2 bg-[#2a2a4e] border border-[#3a3a5e] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#0055FF] to-[#2ECC71] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Stop */}
        <button
          onClick={handleStop}
          className="flex items-center gap-1 px-2.5 py-1 border-2 border-[#df2b31] bg-transparent text-[#df2b31] font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-[#df2b31] hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">stop</span>
          Stop
        </button>
      </div>
    </div>
  );
}
