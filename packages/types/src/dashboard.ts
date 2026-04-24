export type ProjectEngine = "unity" | "unreal" | "godot";
export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string;
  engine: ProjectEngine;
  progress: number;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  engine: ProjectEngine;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  engine?: ProjectEngine;
  progress?: number;
  status?: ProjectStatus;
}

export interface CreditSummary {
  current: number;
  max: number;
}

export interface DashboardSummary {
  totalProjects: number;
  activeAgents: number;
  credits: CreditSummary;
}

export type LogLevel = "info" | "warn" | "error";

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface DashboardData {
  summary: DashboardSummary;
  projects: Project[];
  activityLog: ActivityLogEntry[];
}
