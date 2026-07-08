import type { LLMTool } from "./zai-client.js";

/**
 * Phaser 3 LLM-visible tools.
 *
 * `PhaserCLI` is the engine-specific Swiss Army knife: init, dev, build, test,
 * preview. `RunPhaserHeadless` exposes the headless renderer harness for QA.
 */
export const PHASER_TOOLS: LLMTool[] = [
  {
    name: "PhaserCLI",
    description:
      "Operate a Phaser 3 + Vite + TypeScript project. " +
      "init creates the project scaffold; dev starts the Vite dev server; " +
      "build produces a static dist/ export; test runs Vitest + jsdom headless; " +
      "preview serves the built dist/ for verification.",
    input_schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the Phaser project root" },
        command: {
          type: "string",
          enum: ["init", "dev", "build", "test", "preview"],
          description: "PhaserCLI command to run",
        },
        name: { type: "string", description: "Project name (used only by init)" },
        scene: { type: "string", description: "Optional scene name to create during init (e.g., 'BootScene')" },
        port: { type: "number", description: "Port for dev/preview server (default: 5173)" },
      },
      required: ["projectPath", "command"],
    },
  },
  {
    name: "RunPhaserHeadless",
    description:
      "Run a Phaser 3 scene in HEADLESS renderer mode using jsdom/vitest. " +
      "Returns pass/fail and any logs. Use for automated playtesting and QA gates.",
    input_schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the Phaser project root" },
        scene: { type: "string", description: "Scene module path to load (e.g., 'src/scenes/BootScene.ts')" },
        testName: { type: "string", description: "Human-readable test name" },
      },
      required: ["projectPath"],
    },
  },
];
