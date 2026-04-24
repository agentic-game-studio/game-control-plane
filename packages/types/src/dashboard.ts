export type ProjectEngine = "unity" | "unreal" | "godot" | "phaser" | "threejs";
export type ProjectStatus = "active" | "paused" | "archived";

export type ProjectIcon =
  | "folder"
  | "sports_esports"
  | "code"
  | "brush"
  | "music_note"
  | "map"
  | "psychology"
  | "bug_report"
  | "description"
  | "stadia_controller"
  | "view_in_ar"
  | "animation";

export interface Project {
  id: string;
  name: string;
  description: string;
  engine: ProjectEngine | null;
  progress: number;
  status: ProjectStatus;
  workspacePath: string | null;
  icon: ProjectIcon;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  engine?: ProjectEngine;
  workspacePath?: string | null;
  icon?: ProjectIcon;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  engine?: ProjectEngine | null;
  progress?: number;
  status?: ProjectStatus;
  workspacePath?: string | null;
  icon?: ProjectIcon;
}

export interface CreditSummary {
  current: number;
  max: number;
}

export interface DashboardSummary {
  totalProjects: number;
  activeDirectories: number;
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

export const DEFAULT_DATA: DashboardData = {
  summary: {
    totalProjects: 0,
    activeDirectories: 0,
    credits: { current: 100, max: 100 },
  },
  projects: [],
  activityLog: [],
};
