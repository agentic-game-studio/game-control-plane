import type { LLMTool } from "./zai-client.js";

/**
 * Web3D LLM-visible tools for Three.js and Babylon.js projects.
 *
 * `Web3DCLI` is the engine-specific project command wrapper (init, dev, build,
 * test, preview). `TextTo3D` is a placeholder for future 3D asset generation
 * providers and currently returns a "not yet implemented" message unless a
 * provider is explicitly configured.
 */
export const WEB3D_TOOLS: LLMTool[] = [
  {
    name: "Web3DCLI",
    description:
      "Operate a Vite + TypeScript Web3D project using Three.js or Babylon.js. " +
      "init creates the project scaffold; dev starts the Vite dev server; " +
      "build produces a static dist/ export; test runs Vitest + jsdom headless; " +
      "preview serves the built dist/ for verification.",
    input_schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the Web3D project root" },
        command: {
          type: "string",
          enum: ["init", "dev", "build", "test", "preview"],
          description: "Web3DCLI command to run",
        },
        framework: {
          type: "string",
          enum: ["threejs", "babylon"],
          description: "Web3D renderer framework (Three.js or Babylon.js)",
        },
        name: { type: "string", description: "Project name (used only by init)" },
        scene: { type: "string", description: "Optional scene name to create during init (e.g., 'BootScene')" },
        port: { type: "number", description: "Port for dev/preview server (default: 5173)" },
      },
      required: ["projectPath", "command", "framework"],
    },
  },
  {
    name: "TextTo3D",
    description:
      "Generate a 3D asset from a text prompt using a configured provider. " +
      "Returns the asset path when a provider is configured; otherwise returns " +
      "'not yet implemented'. Use for placeholder 3D meshes, materials, or scenes.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the 3D asset to generate" },
        name: { type: "string", description: "Asset name, slug-safe (e.g. 'player-ship')" },
        provider: {
          type: "string",
          enum: ["default"],
          description: "Optional provider override. Currently no providers are enabled by default.",
        },
        format: {
          type: "string",
          enum: ["glb", "gltf", "obj"],
          description: "Output format (default: glb)",
        },
      },
      required: ["prompt", "name"],
    },
  },
];
