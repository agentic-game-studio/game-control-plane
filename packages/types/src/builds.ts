import type { ProjectEngine } from "./dashboard.js";

export type BuildPlatform = "windows" | "macos" | "linux" | "web" | "android" | "ios";
export type BuildStatus = "pending" | "building" | "success" | "failed";

export interface GameBuild {
  id: string;
  projectId: string;
  version: string;
  platform: BuildPlatform;
  preset?: string;
  artifactPath?: string;
  status: BuildStatus;
  smokeTestPassed?: boolean;
  changelog?: string;
  engine?: ProjectEngine;
  deployUrl?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface CreateBuildRequest {
  projectId: string;
  version?: string;
  platform: BuildPlatform;
  preset?: string;
  engine?: ProjectEngine;
}

export interface BuildsData {
  builds: GameBuild[];
}
