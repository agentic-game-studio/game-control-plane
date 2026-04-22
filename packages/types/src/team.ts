import type { AgentRole } from "./agent.js";

export interface TeamMember {
  agent: AgentRole;
  role: string;
  phase?: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
}

export interface TeamWorkflowStep {
  order: number;
  phase: string;
  agents: AgentRole[];
  parallel: boolean;
}

export interface TeamConfig {
  id: string;
  name: string;
  members: TeamMember[];
  workflow: TeamWorkflowStep[];
  currentPhase?: number;
  status: "idle" | "running" | "completed" | "failed";
}
