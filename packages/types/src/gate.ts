import type { AgentRole } from "./agent.js";

export type ReviewMode = "solo" | "lean" | "full";

export type GateVerdict =
  | "APPROVE"
  | "READY"
  | "CONCERNS"
  | "REJECT"
  | "NOT_READY"
  | "READY"
  | "BLOCKED"
  | "VIABLE"
  | "REALISTIC"
  | "ON_TRACK"
  | "ADEQUATE";

export interface GateResult {
  gateId: string;
  verdict: GateVerdict;
  details?: string;
  agent: AgentRole;
  timestamp: string;
  concerns?: string[];
  blockers?: string[];
}

export interface GateDefinition {
  id: string;
  name: string;
  agent: AgentRole;
  domain: string;
  trigger: string;
  contextFields: string[];
  prompt: string;
  verdicts: string[];
  requiredArtifacts: string[];
}

export interface GateStatus {
  gateId: string;
  sessionId: string;
  verdict?: GateVerdict;
  timestamp?: string;
  details?: string;
  mode: ReviewMode;
}
