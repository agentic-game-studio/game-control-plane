"use client";

import { getAgentIcon } from "@/lib/agent-icons";
import type { AgentRole } from "@game-studio/types";
import { getPersonaInfo } from "./AgentSelector";

interface CurrentAgentHeaderProps {
  persona: AgentRole;
}

export default function CurrentAgentHeader({ persona }: CurrentAgentHeaderProps) {
  const icon = getAgentIcon(persona);
  const info = getPersonaInfo(persona);

  return (
    <div className="shrink-0 border-b-2 border-black bg-white px-4 py-3 flex items-center gap-3">
      <div className="w-10 h-10 border-2 border-black bg-[#0055FF] text-white flex items-center justify-center shrink-0 shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="font-[var(--font-label)] text-sm font-bold uppercase truncate">
          {info.label}
        </div>
        <div className="font-[var(--font-terminal)] text-[10px] text-[#737688] truncate">
          {info.description}
        </div>
      </div>
      <span className="ml-auto px-2 py-0.5 border border-black bg-[#ededfb] font-[var(--font-terminal)] text-[9px] uppercase">
        Active
      </span>
    </div>
  );
}
