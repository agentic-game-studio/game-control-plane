import type { AgentDefinition, AgentRole } from "@game-studio/types";

/**
 * Babylon.js agent definitions — web-native 3D game production.
 *
 * The Babylon.js specialist is the engine-specific lead for 3D scenes,
 * physics, cameras, asset loading, and the Babylon Web3D workflow.
 */
export const babylonAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "babylon-specialist": {
    name: "babylon-specialist",
    description:
      "Babylon.js lead: scene graph, materials, lighting, physics, cameras, and browser-native 3D gameplay.",
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
