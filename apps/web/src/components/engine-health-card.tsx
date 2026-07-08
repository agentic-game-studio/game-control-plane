"use client";

import type { ProjectEngine } from "@game-studio/types";

export interface EngineHealth {
  engine: ProjectEngine;
  healthy: boolean;
  message?: string;
}

interface EngineHealthCardProps {
  health: EngineHealth[];
}

export function EngineHealthCard({ health }: EngineHealthCardProps) {
  return (
    <div className="border-2 border-black bg-[#faf8ff] p-4">
      <h3 className="mb-3 font-[var(--font-label)] text-xs font-bold uppercase">Engine Health</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {health.map(({ engine, healthy, message }) => (
          <div
            key={engine}
            className={`border-2 p-2 ${
              healthy
                ? "border-[#2ECC71] bg-[#2ECC71]/10"
                : "border-[#df2b31] bg-[#df2b31]/10"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`material-symbols-outlined text-sm ${
                  healthy ? "text-[#2ECC71]" : "text-[#df2b31]"
                }`}
              >
                {healthy ? "check_circle" : "cancel"}
              </span>
              <span className="font-[var(--font-label)] text-[10px] font-bold uppercase">
                {engine}
              </span>
            </div>
            {message && (
              <span className="mt-1 block font-[var(--font-terminal)] text-[9px] opacity-80">
                {message}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
