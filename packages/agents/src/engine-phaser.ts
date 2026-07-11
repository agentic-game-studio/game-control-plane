import type { AgentDefinition, AgentRole } from "@game-studio/types";

/**
 * Phaser 3 agent definitions — 2D web-native game production.
 *
 * Mirrors the Godot agent layout so the producer can route the same
 * skill surface (scaffold → specialist → specialists) to Phaser.
 */
export const phaserAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "phaser-scaffolder": {
    name: "phaser-scaffolder",
    description:
      "Creates a complete Phaser 3 + Vite + TypeScript project from scratch — package.json, vite.config.ts, src/main.ts, scenes, and asset folders. Uses file I/O or the PhaserCLI tool.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "PhaserCLI"],
    maxTurns: 25,
    skills: ["setup-phaser-project", "phaser-cli-ops"],
    memory: "session",
    reportsTo: ["lead-programmer"],
  },
  "phaser-specialist": {
    name: "phaser-specialist",
    description:
      "Phaser 3 lead: TypeScript scenes, Arcade/Matter physics, tilemaps, input, HUD, and deployment.",
    tier: 3,
    model: "sonnet",
    tools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "Task",
      "PhaserCLI",
      "RunPhaserHeadless",
    ],
    maxTurns: 35,
    skills: [
      "setup-phaser-project",
      "implement-phaser-scene",
      "implement-phaser-physics",
      "implement-phaser-tilemap",
      "automated-phaser-playtest",
      "export-web-project",
      "phaser-cli-ops",
    ],
    memory: "session",
    reportsTo: ["lead-programmer"],
  },
  "phaser-typescript-specialist": {
    name: "phaser-typescript-specialist",
    description:
      "Phaser 3 TypeScript implementation details: strict typing, scene lifecycle, asset loading, and physics bodies.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
    maxTurns: 30,
    skills: ["implement-phaser-scene", "implement-phaser-physics"],
    memory: "session",
    reportsTo: ["phaser-specialist"],
  },
};
