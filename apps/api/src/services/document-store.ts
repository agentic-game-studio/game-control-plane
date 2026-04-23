import fs from "node:fs/promises";
import fsp from "node:fs";
import path from "node:path";
import type {
  DocumentCategory,
  CategoryMeta,
  DocumentEntry,
  DocumentDetail,
  GraphData,
  GraphNode,
  GraphEdge,
} from "@game-studio/types";

/** Directory-to-category mapping */
const CATEGORY_DIRS: Record<string, DocumentCategory> = {
  "design/gdd": "gdd",
  "docs/architecture": "adr",
  "design/narrative": "narrative",
  "design/levels": "level",
  "design/balance": "balance",
  "design/ux": "ux",
  "design/art": "art",
  "production/sprints": "sprint",
  "production/epics": "epic",
  "production/qa": "qa",
  "production/releases": "release",
  "prototypes": "prototype",
};

/** Category display metadata */
const CATEGORY_META: CategoryMeta[] = [
  { id: "gdd", label: "Game Design", icon: "sports_esports", color: "#0055FF", directory: "design/gdd" },
  { id: "adr", label: "Architecture", icon: "architecture", color: "#0041C8", directory: "docs/architecture" },
  { id: "narrative", label: "Narrative", icon: "auto_stories", color: "#972500", directory: "design/narrative" },
  { id: "level", label: "Level Design", icon: "map", color: "#BA061B", directory: "design/levels" },
  { id: "balance", label: "Balance", icon: "balance", color: "#737688", directory: "design/balance" },
  { id: "ux", label: "UX Specs", icon: "design_services", color: "#C13301", directory: "design/ux" },
  { id: "art", label: "Art Bible", icon: "palette", color: "#DF2B31", directory: "design/art" },
  { id: "sprint", label: "Sprints", icon: "sprint", color: "#434656", directory: "production/sprints" },
  { id: "epic", label: "Epics", icon: "rocket_launch", color: "#191B25", directory: "production/epics" },
  { id: "qa", label: "QA Reports", icon: "bug_report", color: "#BA1A1A", directory: "production/qa" },
  { id: "release", label: "Releases", icon: "new_releases", color: "#3B0900", directory: "production/releases" },
  { id: "prototype", label: "Prototypes", icon: "science", color: "#6B5B95", directory: "prototypes" },
];

/** Parse YAML frontmatter from markdown */
function parseFrontmatter(content: string): { frontmatter: Record<string, string | string[]>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const raw = match[1];
  const body = match[2];
  const result: Record<string, string | string[]> = {};

  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value.slice(1, -1).split(",").map((s) => s.trim());
    } else {
      result[key] = value;
    }
  }

  return { frontmatter: result, body };
}

/** Extract [[wikilink]] targets from markdown body */
function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([^\]]+)\]\]/g);
  const links = new Set<string>();
  for (const m of matches) {
    links.add(slugify(m[1]));
  }
  return [...links];
}

/** Convert text to URL-safe slug */
function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export class DocumentStore {
  private workspaceDir: string;
  private cache: Map<string, DocumentEntry> | null = null;
  private watcher: fsp.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Get category for a file path relative to workspace */
  private categorize(relPath: string): DocumentCategory {
    for (const [dir, cat] of Object.entries(CATEGORY_DIRS)) {
      if (relPath.startsWith(dir)) return cat;
    }
    return "other";
  }

  /** Scan all known directories for .md files */
  private async scanFiles(): Promise<Map<string, DocumentEntry>> {
    const docs = new Map<string, DocumentEntry>();

    for (const dir of Object.keys(CATEGORY_DIRS)) {
      const fullDir = path.join(this.workspaceDir, dir);
      let files: string[];
      try {
        files = await fs.readdir(fullDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const relPath = path.join(dir, file);
        const filePath = path.join(this.workspaceDir, relPath);
        const slug = slugify(file.replace(".md", ""));
        const category = this.categorize(relPath);

        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch {
          continue;
        }

        const { frontmatter, body } = parseFrontmatter(content);
        const links = extractWikilinks(body);

        const title =
          (frontmatter.title as string) ??
          (frontmatter.name as string) ??
          file.replace(".md", "").replace(/[-_]/g, " ");

        const stat = await fs.stat(filePath).catch(() => null);

        docs.set(slug, {
          id: slug,
          title,
          filename: file,
          category,
          path: relPath,
          status: (frontmatter.status as string) ?? undefined,
          links,
          backlinks: [],
          createdAt: stat?.birthtime?.toISOString(),
          updatedAt: stat?.mtime?.toISOString(),
        });
      }
    }

    // Compute backlinks
    for (const [slug, doc] of docs) {
      for (const target of doc.links) {
        const targetDoc = docs.get(target);
        if (targetDoc && !targetDoc.backlinks.includes(slug)) {
          targetDoc.backlinks.push(slug);
        }
      }
    }

    return docs;
  }

  /** Ensure cache is populated */
  private async ensureCache(): Promise<Map<string, DocumentEntry>> {
    if (!this.cache) {
      this.cache = await this.scanFiles();
    }
    return this.cache;
  }

  /** List all documents */
  async listAll(): Promise<DocumentEntry[]> {
    const docs = await this.ensureCache();
    return [...docs.values()].sort((a, b) =>
      a.category === b.category ? a.title.localeCompare(b.title) : a.category.localeCompare(b.category)
    );
  }

  /** Get a single document by slug */
  async getBySlug(slug: string): Promise<DocumentDetail | null> {
    const docs = await this.ensureCache();
    const entry = docs.get(slug);
    if (!entry) return null;

    const filePath = path.join(this.workspaceDir, entry.path);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }

    const { frontmatter, body } = parseFrontmatter(content);

    return {
      ...entry,
      content: body.trim(),
      frontmatter: frontmatter as Record<string, unknown>,
    };
  }

  /** Get graph data (nodes + edges) derived from documents */
  async getGraphData(): Promise<GraphData> {
    const docs = await this.ensureCache();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Arrange nodes in a circle for initial layout
    const entries = [...docs.values()];
    const count = entries.length;
    const centerX = 150;
    const centerY = 150;
    const radius = Math.min(centerX, centerY) - 30;

    entries.forEach((doc, i) => {
      const angle = (2 * Math.PI * i) / count;
      nodes.push({
        id: doc.id,
        label: doc.title.slice(0, 2).toUpperCase(),
        category: doc.category,
        x: count === 1 ? centerX : centerX + radius * Math.cos(angle),
        y: count === 1 ? centerY : centerY + radius * Math.sin(angle),
      });
    });

    // Build edges from links
    for (const doc of entries) {
      for (const target of doc.links) {
        if (docs.has(target)) {
          edges.push({ source: doc.id, target });
        }
      }
    }

    // Simple force-directed refinement
    const iterations = 100;
    const width = 300;
    const height = 300;

    for (let iter = 0; iter < iterations; iter++) {
      const temp = 10 * (1 - iter / iterations);

      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 500 / (dist * dist);
          const fx = (dx / dist) * force * temp;
          const fy = (dy / dist) * force * temp;
          nodes[i].x += fx;
          nodes[i].y += fy;
          nodes[j].x -= fx;
          nodes[j].y -= fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * 0.01 * temp;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }

      // Gravity toward center
      for (const node of nodes) {
        node.x += (centerX - node.x) * 0.01 * temp;
        node.y += (centerY - node.y) * 0.01 * temp;
        // Clamp to bounds
        node.x = Math.max(20, Math.min(width - 20, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      }
    }

    return { nodes, edges };
  }

  /** Get category metadata */
  getCategories(): CategoryMeta[] {
    return CATEGORY_META;
  }

  /** Invalidate cache, forcing re-scan on next call */
  invalidateCache(): void {
    this.cache = null;
  }

  /** Start watching workspace for file changes */
  startWatching(onChange?: (event: { documentId: string; category: DocumentCategory; title: string }) => void): void {
    if (this.watcher) return;

    try {
      this.watcher = fsp.watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;

        // Check if file is in a tracked directory
        const isTracked = Object.keys(CATEGORY_DIRS).some((dir) => filename.startsWith(dir));
        if (!isTracked) return;

        // Debounce rapid changes
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
          const slug = slugify(path.basename(filename, ".md"));
          this.invalidateCache();
          if (onChange) {
            const docs = await this.ensureCache();
            const doc = docs.get(slug);
            if (doc) {
              onChange({ documentId: doc.id, category: doc.category, title: doc.title });
            }
          }
        }, 500);
      });
    } catch {
      // fs.watch not available or permission denied — non-critical
    }
  }

  /** Stop file watching */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
