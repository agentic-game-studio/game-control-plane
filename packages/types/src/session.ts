import type { AgentRole } from "./agent.js";
import type { SkillName } from "./skill.js";
import type { ReviewMode } from "./gate.js";

export type SessionStatus = "idle" | "running" | "completed" | "failed" | "paused";

export interface Checkpoint {
  id: string;
  sessionId: string;
  timestamp: string;
  phase: string;
  activeTask: string;
  completedSections: string[];
  decisions: DecisionRecord[];
  agentInvocations: AgentInvocation[];
  openQuestions: string[];
  statusBlock?: string;
}

export interface DecisionRecord {
  id: string;
  timestamp: string;
  decision: string;
  rationale?: string;
  agent?: AgentRole;
}

export interface AgentInvocation {
  id: string;
  agent: AgentRole;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  error?: string;
}

export interface SessionConfig {
  engine?: string;
  language?: string;
  reviewMode?: ReviewMode;
  pillars?: string[];
  antiPillars?: string[];
  coreFantasy?: string;
  uniqueHook?: string;
}

export interface SessionState {
  id: string;
  name: string;
  status: SessionStatus;
  config: SessionConfig;
  checkpoints: Checkpoint[];
  activeCheckpoint?: string;
  currentPhase?: string;
  activeSkill?: SkillName;
  agents: Record<string, AgentInvocation>;
  logs: LogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  agent?: string;
  skill?: string;
}
