import type { AgentDefinition, AgentRole } from "@game-studio/types";

/**
 * Three.js agent definitions — web-native 3D game production.
 *
 * The Three.js specialist is the engine-specific lead for 3D scenes,
 * WebGL/WebGPU rendering, physics integration, and asset workflows.
 */
export const threejsAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "threejs-specialist": {
    name: "threejs-specialist",
    description:
      "Three.js lead: WebGL/WebGPU rendering, scenes, cameras, lighting, loaders, and browser-native 3D gameplay.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Web3DCLI"],
    maxTurns: 35,
    skills: [
      "setup-web3d-project",
      "implement-3d-scene",
      "implement-3d-physics",
      "implement-3d-camera",
      "generate-3d-asset",
      "web3d-cli-ops",
    ],
    memory: "session",
    reportsTo: ["lead-programmer"],
  },
};
