"use client";

import { getAgentIcon } from "@/lib/agent-icons";
import type { AgentRole } from "@game-studio/types";

export const CHAT_PERSONAS = ["producer", "creative-director", "technical-director"] as const;

type ChatPersona = (typeof CHAT_PERSONAS)[number];

interface PersonaInfo {
  label: string;
  description: string;
}

const PERSONA_INFO: Record<ChatPersona, PersonaInfo> = {
  producer: {
    label: "Producer",
    description: "Board Room orchestrator — coordinates teams, sprints, and milestones.",
  },
  "creative-director": {
    label: "Creative Director",
    description: "Vision, pillars, player experience, and scope arbitration.",
  },
  "technical-director": {
    label: "Technical Director",
    description: "Architecture, technology choices, performance, and feasibility.",
  },
};

interface AgentSelectorProps {
  currentPersona: AgentRole;
  onSelect: (persona: AgentRole) => void;
  disabled?: boolean;
}

export default function AgentSelector({ currentPersona, onSelect, disabled }: AgentSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-[#ededfb] border-2 border-black">
      {CHAT_PERSONAS.map((role) => {
        const info = PERSONA_INFO[role];
        const icon = getAgentIcon(role);
        const isActive = currentPersona === role;
        return (
          <button
            key={role}
            onClick={() => onSelect(role)}
            disabled={disabled}
            title={info.description}
            className={`flex items-center gap-1.5 px-2 py-1.5 font-[var(--font-label)] text-[10px] font-bold uppercase transition-all ${
              isActive
                ? "bg-[#0055FF] text-white border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]"
                : "bg-white text-black border-2 border-black hover:bg-[#f3f2ff]"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="material-symbols-outlined text-sm">{icon}</span>
            <span className="hidden sm:inline">{info.label}</span>
            <span className="sm:hidden">{info.label.split(" ")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function getPersonaInfo(role: AgentRole): PersonaInfo {
  return (
    (PERSONA_INFO as Record<AgentRole, PersonaInfo>)[role] ?? {
      label: role.replace(/-/g, "_").toUpperCase(),
      description: "",
    }
  );
}
