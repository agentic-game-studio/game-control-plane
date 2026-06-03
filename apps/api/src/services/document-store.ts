import fs from "node:fs/promises";
import fsp from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
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

/** Extract [[wikilink]] targets from markdown body. Supports the
 * `[[link|alias]]` form (Obsidian-style) — only the link portion before
 * the pipe is used as the slug. Without this, `[[foo|bar]]` was being
 * slugified to `foobar`, corrupting the link graph. */
function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
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

// 12-H19: module-level registry of files THIS process is about to
// write. Document stores are instantiated per-workspace in routes/
// documents.ts (global store + per-project store), so a single
// instance variable would only cover one of them. The LLM Write
// tool lives in a different module that doesn't (and shouldn't)
// know which store is currently active. A module-level map is the
// simplest cross-instance handoff: any store's watcher consults
// the same registry, and any writer (LLM tool, route handler)
// registers the path it intends to write.
const recentSelfWrites = new Map<string, number>();
const SELF_WRITE_TTL_MS = 3_000;

/**
 * 12-H19: register that the current process is about to write
 * `filePath`. Any active DocumentStore's watcher will ignore events
 * for this path for the next SELF_WRITE_TTL_MS (covering the
 * write+rename+close cycle plus a small grace window for fs.watch
 * delivery latency). Path is normalised to its basename so the
 * registry survives different working-directory invocations.
 */
export function markDocumentSelfWrite(filePath: string): void {
  recentSelfWrites.set(path.basename(filePath), Date.now());
}

/** 12-H19: test/cleanup hook for the self-write registry. */
export function _clearDocumentSelfWrites(): void {
  recentSelfWrites.clear();
}

export class DocumentStore {
  private workspaceDir: string;
  private cache: Map<string, DocumentEntry> | null = null;
  private watcher: fsp.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 14-H3-scan-files-race: while scanFiles() is in flight, cache the
  // promise so a burst of concurrent first-time callers (e.g. a wiki
  // page load that fans out to listAll / getAllCategories /
  // getGraph concurrently, plus an SSE-triggered reload) doesn't all
  // re-scan the workspace independently. The losing scans used to
  // throw their work away after also having walked every CATEGORY_DIR
  // twice — wasteful and racy on the cache mutation. setCache()
  // overwrites this.cache on resolution; the last writer wins, but
  // the data is identical so it's safe.
  private scanPromise: Promise<Map<string, DocumentEntry>> | null = null;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Expose the watched directory so routes can detect overlap
   * between the global store and per-project stores (which would
   * otherwise double-broadcast the same `document:updated` event).
   * Without this accessor, the route layer has no way to filter
   * the global store's events against active project store dirs. */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /** Get category for a file path relative to workspace */
  private categorize(relPath: string): DocumentCategory {
    const normalized = relPath.startsWith("docs/") ? relPath.slice(5) : relPath;
    for (const [dir, cat] of Object.entries(CATEGORY_DIRS)) {
      if (normalized.startsWith(dir)) return cat;
    }
    return "other";
  }

  /** Scan all known directories for .md files */
  private async scanFiles(): Promise<Map<string, DocumentEntry>> {
    const docs = new Map<string, DocumentEntry>();

    for (const dir of Object.keys(CATEGORY_DIRS)) {
      const candidates = [
        { fullDir: path.join(this.workspaceDir, dir), relDir: dir },
        { fullDir: path.join(this.workspaceDir, "docs", dir), relDir: path.join("docs", dir) },
      ];

      for (const { fullDir, relDir } of candidates) {
        let files: string[];
        try {
          files = await fs.readdir(fullDir);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.endsWith(".md")) continue;

          const relPath = path.join(relDir, file);
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

          // Frontmatter values are typed `string | string[]`; coerce to
          // string before using as a title or status. Arrays are joined
          // with a space so a malformed `tags: [foo, bar]` frontmatter
          // still produces a renderable title rather than throwing.
          const pickString = (val: string | string[] | undefined): string | undefined => {
            if (typeof val === "string") return val;
            if (Array.isArray(val)) return val.join(" ");
            return undefined;
          };
          const title =
            pickString(frontmatter.title) ??
            pickString(frontmatter.name) ??
            file.replace(".md", "").replace(/[-_]/g, " ");

          const stat = await fs.stat(filePath).catch(() => null);

          docs.set(slug, {
            id: slug,
            title,
            filename: file,
            category,
            path: relPath,
            status: pickString(frontmatter.status),
            links,
            backlinks: [],
            createdAt: stat?.birthtime?.toISOString(),
            updatedAt: stat?.mtime?.toISOString(),
          });
        }
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
    if (this.cache) return this.cache;
    if (!this.scanPromise) {
      // 14-H3-scan-files-race: coalesce concurrent first-time scans.
      // On error, clear the in-flight promise so the next caller
      // retries from scratch — otherwise a transient readdir failure
      // (e.g. workspace dir briefly missing during a rename) would
      // poison all future ensureCache() calls.
      this.scanPromise = this.scanFiles()
        .then((docs) => {
          this.cache = docs;
          return docs;
        })
        .finally(() => {
          this.scanPromise = null;
        });
    }
    return this.scanPromise;
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
    // Cap document body size. Without this, a single 1GB markdown file
    // under workspace/ would be loaded into memory by the wiki viewer
    // and the JSON response would balloon the WS event payload. 2MB is
    // generous for a markdown design doc and well above what the wiki
    // UI renders — anything larger is almost certainly a binary that
    // landed in the wrong directory. Reject with a clear error rather
    // than truncating, so the user knows to move or split the file.
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.size > 2 * 1024 * 1024) {
      logger.warn({
        event: "document_too_large",
        slug,
        sizeBytes: stat.size,
        path: entry.path,
      }, `Refusing to serve document ${slug} (${stat.size} bytes exceeds 2MB cap)`);
      return null;
    }
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
  startWatching(onChange?: (event: { documentId: string; category: DocumentCategory; title: string; /** Absolute path of the changed file (workspace-relative path joined onto workspaceDir). Lets callers detect overlap with other stores' watches. */ path: string }) => void): void {
    if (this.watcher) return;

    try {
      this.watcher = fsp.watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;

        // 12-H19: skip self-writes. fs.watch on the workspace fires
        // for the very file we just wrote via markDocumentSelfWrite()
        // — re-broadcasting that change costs every connected client
        // a wasted /api/documents refetch and triggers a re-render
        // storm in the wiki UI. Drop the event if the basename was
        // registered within the last SELF_WRITE_TTL_MS.
        const selfWriteAt = recentSelfWrites.get(path.basename(filename));
        if (selfWriteAt !== undefined) {
          if (Date.now() - selfWriteAt < SELF_WRITE_TTL_MS) {
            return;
          }
          recentSelfWrites.delete(path.basename(filename));
        }

        // Check if file is in a tracked directory (direct or docs/ prefixed)
        const isTracked = Object.keys(CATEGORY_DIRS).some(
          (dir) => filename.startsWith(dir) || filename.startsWith(`docs/${dir}`)
        );
        if (!isTracked) return;

        // Debounce rapid changes
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
          try {
            const slug = slugify(path.basename(filename, ".md"));
            this.invalidateCache();
            if (onChange) {
              const docs = await this.ensureCache();
              const doc = docs.get(slug);
              if (doc) {
                // 15-H-document-store-broadcast-dup: emit the absolute
                // path alongside the metadata so the route layer can
                // filter the global store's events against active
                // project store directories (a project whose workspace
                // is under WORKSPACE_DIR is watched by BOTH stores,
                // and fs.watch on the parent fires for the child's
                // changes too).
                onChange({
                  documentId: doc.id,
                  category: doc.category,
                  title: doc.title,
                  path: path.join(this.workspaceDir, filename),
                });
              }
            }
          } catch {
            // Non-critical — debounced callback error shouldn't crash the watcher
          }
        }, 500);
      });
      // Handle watcher errors (ENOSPC, EPERM when a watched dir is moved
      // or deleted, etc.). Without the broadcast, a frontend that
      // relied on live updates would silently drift until the next
      // /api/documents poll. Callers re-arm by calling startWatching
      // again — typically on the next /api/documents GET.
      this.watcher.on("error", (err) => {
        logger.warn({
          err: (err as NodeJS.ErrnoException).code ?? (err as Error).message,
          workspaceDir: this.workspaceDir,
          event: "document_watcher_error",
        }, "Document store watcher stopped after error — re-arm by calling startWatching()");
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        this.watcher = null;
        if (onChange) {
          // 15-H-document-store-broadcast-dup: include the sentinel
          // `path` (empty string) so the type matches the onChange
          // contract. The route layer filters by path === "" (always
          // pass) for the stopped sentinel.
          onChange({ documentId: "", category: "design" as DocumentCategory, title: "__watcher_stopped__", path: "" });
        }
      });
    } catch (err) {
      // 10-H10: `fs.watch` with `recursive: true` is unsupported on Linux
      // (throws ENOSYS) and Android. On those platforms there's no
      // cheap way to watch a deep tree, so the watcher is logged as
      // unavailable and the UI falls back to its existing poll refresh
      // on /api/documents.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOSYS" || code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
        logger.warn({
          workspaceDir: this.workspaceDir,
          code,
          event: "document_watcher_unsupported",
        }, "fs.watch recursive unsupported on this platform — document updates will rely on the UI's poll refresh");
        return;
      }
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
