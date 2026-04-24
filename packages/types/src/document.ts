/** Document categories derived from workspace directory path */
export type DocumentCategory =
  | "gdd"
  | "adr"
  | "narrative"
  | "level"
  | "balance"
  | "ux"
  | "art"
  | "sprint"
  | "epic"
  | "qa"
  | "release"
  | "prototype"
  | "other";

/** Category metadata for display in the UI */
export interface CategoryMeta {
  id: DocumentCategory;
  label: string;
  icon: string;
  color: string;
  directory: string;
}

/** Lightweight document entry for lists and graph nodes */
export interface DocumentEntry {
  id: string;
  title: string;
  filename: string;
  category: DocumentCategory;
  path: string;
  status?: string;
  links: string[];
  backlinks: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** Full document with rendered content */
export interface DocumentDetail extends DocumentEntry {
  content: string;
  frontmatter: Record<string, unknown>;
}

/** Graph data for knowledge graph visualization */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  category: DocumentCategory;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}
