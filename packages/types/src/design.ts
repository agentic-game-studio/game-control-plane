/** Game Design Document — 8 required sections from coding-standards.md */
export interface GDDDocument {
  id: string;
  name: string;
  slug: string;
  category: string;
  path: string;
  overview: string;
  playerFantasy: string;
  detailedRules: string;
  formulas: Formula[];
  edgeCases: EdgeCase[];
  dependencies: string[];
  tuningKnobs: TuningKnob[];
  acceptanceCriteria: AcceptanceCriterion[];
  status: "draft" | "review" | "approved" | "implemented";
  createdAt: string;
  updatedAt: string;
}

export interface Formula {
  name: string;
  expression: string;
  variables: Record<string, string>;
  rationale?: string;
}

export interface EdgeCase {
  scenario: string;
  handling: string;
  severity: "low" | "medium" | "high";
}

export interface TuningKnob {
  name: string;
  defaultValue: string;
  range: string;
  description: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  type: "logic" | "integration" | "visual" | "ui" | "config";
  testable: boolean;
}

/** Architecture Decision Record */
export interface ADRDocument {
  id: string;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: string;
  decision: string;
  alternatives: Alternative[];
  consequences: string;
  relatedGDDs?: string[];
  engineVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Alternative {
  option: string;
  pros: string[];
  cons: string[];
}

/** Story file for sprint planning */
export interface StoryDocument {
  id: string;
  title: string;
  epicId?: string;
  type: "logic" | "integration" | "visual" | "ui" | "config";
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  gddRequirement?: string;
  adrGuidance?: string;
  estimate?: number;
  status: "todo" | "in_progress" | "done" | "blocked";
  assignee?: string;
  sprint?: string;
}

/** Epic — collection of stories */
export interface EpicDocument {
  id: string;
  title: string;
  description: string;
  stories: string[];
  status: "draft" | "approved" | "in_progress" | "done";
  priority: "critical" | "high" | "medium" | "low";
  layer: "foundation" | "core" | "feature" | "presentation" | "polish";
}
