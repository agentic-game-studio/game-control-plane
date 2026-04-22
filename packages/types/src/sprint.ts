import type { StoryDocument } from "./design.js";

export type SprintStatus = "planned" | "active" | "completed";

export interface SprintTask {
  id: string;
  storyId?: string;
  title: string;
  assignee?: string;
  estimate?: number;
  status: "todo" | "in_progress" | "done" | "blocked";
}

export interface SprintPlan {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  stories: string[];
  tasks: SprintTask[];
  velocity?: number;
  status: SprintStatus;
  goals: string[];
}

export interface Milestone {
  id: string;
  name: string;
  targetDate: string;
  criteria: string[];
  stories: string[];
  progress: number;
  status: "planned" | "at_risk" | "on_track" | "completed";
}
