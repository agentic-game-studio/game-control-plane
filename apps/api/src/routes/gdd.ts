/**
 * gdd.ts — Game Design Document ingestion route.
 *
 * Parses a GDD markdown file and creates Kanban tickets for every
 * implementable item found. Deduplicates against existing open tickets.
 *
 * Route:
 *   POST /api/gdd/ingest  — parse GDD and seed ticket queue
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "../config.js";
import { createQuestTicket } from "../services/quest-bridge.js";
import { readTicketsBoard } from "../services/ticket-board.js";
import { broadcast } from "../services/websocket.js";
import { ingestProducerSummaryFact } from "../services/producer-summary.js";
import type { TicketsBoard, WSEvent } from "@game-studio/types";
import type { AgentRole } from "@game-studio/types";

export const gddRouter: Router = Router();

const config = loadConfig();

// ─── Area / assignee mapping ─────────────────────────────────────────────────

const AREA_MAP: Record<string, { area: string; subarea: string; assignee: AgentRole }> = {
  player:         { area: "engineering", subarea: "player",         assignee: "godot-specialist" },
  movement:       { area: "engineering", subarea: "player",         assignee: "godot-specialist" },
  camera:         { area: "engineering", subarea: "camera",         assignee: "godot-specialist" },
  physics:        { area: "engineering", subarea: "physics",         assignee: "godot-specialist" },
  combat:         { area: "engineering", subarea: "combat",          assignee: "godot-specialist" },
  enemy:          { area: "engineering", subarea: "enemy",           assignee: "godot-specialist" },
  tilemap:        { area: "engineering", subarea: "tilemap",        assignee: "godot-specialist" },
  level:          { area: "engineering", subarea: "level",          assignee: "godot-specialist" },
  saving:         { area: "engineering", subarea: "save-system",     assignee: "godot-specialist" },
  audio:          { area: "engineering", subarea: "audio",          assignee: "sound-designer"    },
  "ui/hud":       { area: "engineering", subarea: "ui",              assignee: "godot-specialist" },
  "ui/menu":      { area: "engineering", subarea: "ui",              assignee: "godot-specialist" },
  writing:        { area: "content",     subarea: "writing",        assignee: "writer"            },
  narrative:       { area: "content",     subarea: "narrative",       assignee: "writer"            },
  dialogue:        { area: "content",     subarea: "dialogue",        assignee: "writer"            },
  "art/sprites":   { area: "art",         subarea: "sprites",         assignee: "art-director"      },
  "art/backgrounds": { area: "art",       subarea: "backgrounds",    assignee: "art-director"      },
  "art/animations":  { area: "art",       subarea: "animations",     assignee: "art-director"      },
  "art/tilesets":  { area: "art",         subarea: "tilesets",       assignee: "art-director"      },
  "art/vfx":       { area: "art",         subarea: "vfx",             assignee: "art-director"      },
  sfx:             { area: "art",         subarea: "sfx",             assignee: "sound-designer"    },
  music:           { area: "art",         subarea: "music",           assignee: "sound-designer"    },
  testing:         { area: "qa",           subarea: "testing",         assignee: "qa-tester"        },
  balance:         { area: "design",       subarea: "balance",         assignee: "creative-director" },
  "game-design":   { area: "design",       subarea: "game-design",     assignee: "creative-director" },
  difficulty:      { area: "design",       subarea: "difficulty",      assignee: "creative-director" },
};

function resolveTicketMeta(section: string): { area: string; subarea: string; assignee: AgentRole } {
  const key = section.toLowerCase().trim();
  for (const [k, v] of Object.entries(AREA_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return { area: "engineering", subarea: "misc", assignee: "godot-specialist" };
}

// ─── GDD section patterns ────────────────────────────────────────────────────

interface ParsedItem {
  title: string;
  description: string;
  section: string;
  priority: "P0" | "P1" | "P2";
}

// Very simple section-based parser — splits on ## and extracts bullet lists
function parseGDDSections(content: string): Map<string, ParsedItem[]> {
  const sections = new Map<string, ParsedItem[]>();
  const lines = content.split("\n");

  let currentSection = "overview";
  let currentItems: ParsedItem[] = [];
  let currentDescription = "";
  let inList = false;
  let currentPriority: "P0" | "P1" | "P2" = "P1";
  let currentTitle = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ## Section heading
    if (trimmed.startsWith("## ")) {
      // Save previous section
      if (currentTitle && currentItems.length > 0) {
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      if (currentItems.length > 0) {
        sections.set(currentSection, currentItems);
      }
      currentSection = trimmed.slice(3).toLowerCase().replace(/[^a-z0-9]/g, "-");
      currentItems = [];
      currentDescription = "";
      inList = false;
      currentTitle = "";
      continue;
    }

    // ### Subsection (becomes the item title)
    if (trimmed.startsWith("### ")) {
      if (currentTitle) {
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      currentTitle = trimmed.slice(4).trim();
      currentDescription = "";
      inList = false;
      currentPriority = "P1";
      continue;
    }

    // Priority markers
    if (trimmed.startsWith("[P0]") || trimmed.startsWith("[P1]") || trimmed.startsWith("[P2]")) {
      currentPriority = trimmed.slice(0, 3) as "P0" | "P1" | "P2";
      const rest = trimmed.replace(/^\[[AP0-9]+\]\s*/, "").trim();
      if (rest) {
        if (currentTitle) {
          currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
        }
        currentTitle = rest;
        currentDescription = "";
        inList = false;
      }
      continue;
    }

    // Bullet list items
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2).trim();
      if (!text) continue;
      // Check for embedded priorities
      if (text.startsWith("[P0]") || text.startsWith("[P1]") || text.startsWith("[P2]")) {
        currentPriority = text.slice(0, 3) as "P0" | "P1" | "P2";
        const rest = text.replace(/^\[[AP0-9]+\]\s*/, "").trim();
        if (currentTitle) {
          currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
        }
        currentTitle = rest;
        currentDescription = "";
        inList = true;
      } else if (!currentTitle) {
        // First bullet is the item title
        currentTitle = text;
        currentPriority = "P1";
        inList = true;
      } else if (inList) {
        // Continuation of current item's bullet list
        currentDescription += (currentDescription ? " " : "") + text;
      }
      continue;
    }

    // Empty line — breaks bullet list continuation
    if (!trimmed) {
      if (currentTitle && currentItems.length > 0) {
        const last = currentItems[currentItems.length - 1];
        if (last.title !== currentTitle) {
          currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
        }
      } else if (currentTitle) {
        // Standalone heading with description below
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      currentTitle = "";
      currentDescription = "";
      inList = false;
      continue;
    }

    // Paragraph text — append as description
    if (currentTitle) {
      currentDescription += (currentDescription ? " " : "") + trimmed;
    }
  }

  // Flush last item
  if (currentTitle) {
    currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
  }
  if (currentItems.length > 0) {
    sections.set(currentSection, currentItems);
  }

  return sections;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

async function getExistingTicketTitles(board: TicketsBoard): Promise<Set<string>> {
  const titles = new Set<string>();
  for (const col of board.columns) {
    if (col.id === "completed") continue;
    for (const t of col.tickets) {
      titles.add(t.title.toLowerCase());
    }
  }
  return titles;
}

// ─── Route ───────────────────────────────────────────────────────────────────

// POST /api/gdd/ingest
gddRouter.post("/ingest", async (req: Request, res: Response) => {
  const { sessionId, projectId } = req.body as { sessionId?: string; projectId?: string };

  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  // Locate GDD file
  const projectSlug = projectId ?? "default";
  const gddPath = join(config.WORKSPACE_DIR, projectSlug, "gdd", "game.md");
  const altPaths = [
    gddPath,
    join(config.WORKSPACE_DIR, projectSlug, "docs", "gdd.md"),
    join(config.WORKSPACE_DIR, projectSlug, "docs", "game.md"),
    join(config.WORKSPACE_DIR, projectSlug, "GDD.md"),
    join(config.WORKSPACE_DIR, projectSlug, "game-design.md"),
  ];

  let gddContent = "";
  let usedPath = "";

  for (const p of altPaths) {
    if (existsSync(p)) {
      try {
        gddContent = readFileSync(p, "utf-8");
        usedPath = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  if (!gddContent) {
    res.status(404).json({
      success: false,
      error: "GDD file not found",
      details: `Tried: ${altPaths.join(", ")}`,
    });
    return;
  }

  // Parse sections and items
  const sections = parseGDDSections(gddContent);

  if (sections.size === 0) {
    res.status(422).json({ success: false, error: "Could not parse any sections from GDD. Ensure it uses ## headings." });
    return;
  }

  // Deduplicate against existing open tickets
  let board: TicketsBoard;
  try {
    board = await readTicketsBoard(projectSlug);
  } catch {
    board = { projectId: projectSlug, sprint: "Sprint 1", milestone: "Milestone 1", columns: [
      { id: "available", label: "Available", tickets: [] },
      { id: "in_progress", label: "Processing", tickets: [] },
      { id: "qa", label: "Verify", tickets: [] },
      { id: "completed", label: "Archived", tickets: [] },
    ]};
  }
  const existingTitles = await getExistingTicketTitles(board);
  void existingTitles; // used in loop below

  const results = {
    created: [] as string[],
    skipped: [] as string[],
    errors: [] as string[],
  };

  let totalItems = 0;
  for (const [section, items] of Array.from(sections.entries())) {
    for (const item of items) {
      totalItems++;
      if (existingTitles.has(item.title.toLowerCase())) {
        results.skipped.push(item.title);
        continue;
      }

      try {
        const meta = resolveTicketMeta(section);
        const ticket = await createQuestTicket(
          sessionId,
          item.title,
          meta.assignee,
          item.description || `From GDD section: ${section}`,
          meta.area,
          meta.subarea,
          projectSlug,
        );
        results.created.push(ticket.title);
        void ticket; // ticket already written by createQuestTicket
      } catch (err) {
        results.errors.push(`${item.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Broadcast summary
  broadcast({
    type: "gdd:ingested",
    sessionId,
    projectId: projectSlug,
    total: totalItems,
    created: results.created.length,
    skipped: results.skipped.length,
    errors: results.errors.length,
  } as WSEvent);

  void ingestProducerSummaryFact(projectSlug, {
    kind: "gdd_ingested",
    at: new Date().toISOString(),
    detail: `total=${totalItems} created=${results.created.length} skipped=${results.skipped.length} errors=${results.errors.length}`,
  });

  res.json({
    success: true,
    data: {
      gddPath: usedPath,
      sectionsFound: sections.size,
      totalItems,
      created: results.created.length,
      skipped: results.skipped.length,
      skippedTitles: results.skipped.slice(0, 20),
      errors: results.errors,
      createdTitles: results.created,
    },
  });
});
