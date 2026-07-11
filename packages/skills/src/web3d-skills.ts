import type { SkillDefinition } from "@game-studio/types";

/**
 * Web3D skill definitions for Three.js and Babylon.js projects.
 *
 * These skills are engine-agnostic at the skill level; the dispatcher routes
 * phases to the threejs-specialist or babylon-specialist based on the project
 * engine, or lets either handle generic web3d work.
 */
const setupWeb3dProject: SkillDefinition = {
  name: "setup-web3d-project",
  description:
    "Scaffold a Vite + TypeScript Web3D project with the chosen renderer (Three.js or Babylon.js), a simple scene, and a jsdom headless test.",
  phases: [
    { order: 1, name: "Create Directory Structure", description: "Create src/, public/, and test/ folders", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 2, name: "Write package.json", description: "Add renderer, Vite, TypeScript, Vitest and jsdom dependencies", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 3, name: "Write vite.config.ts", description: "Configure Vite dev server and build output to dist/", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 4, name: "Create Entry Scene", description: "Write src/main.ts and a minimal renderer scene", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 5, name: "Add Headless Test Harness", description: "Write vitest setup and a minimal scene existence test", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: true,
};

const implement3dScene: SkillDefinition = {
  name: "implement-3d-scene",
  description:
    "Implement a 3D scene with renderer, scene graph, camera, lighting, and a simple mesh in Three.js or Babylon.js.",
  phases: [
    { order: 1, name: "Design Scene Structure", description: "Identify scene responsibilities, renderer setup, and required assets", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 2, name: "Write Scene Module", description: "Create src/scenes/SceneName.ts with renderer, scene, camera, and lights", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 3, name: "Wire Scene into Entry", description: "Register the scene in src/main.ts", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: true,
};

const implement3dPhysics: SkillDefinition = {
  name: "implement-3d-physics",
  description:
    "Add physics bodies, collisions, gravity, and raycasting to a Three.js or Babylon.js scene using a physics plugin (Cannon/Ammo for Three.js, Havok/Ammo for Babylon.js).",
  phases: [
    { order: 1, name: "Choose Physics Backend", description: "Select the physics engine compatible with the renderer", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 2, name: "Create Bodies", description: "Add meshes, bodies, colliders, and contact listeners", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 3, name: "Tune Parameters", description: "Set gravity, damping, restitution, and solver iteration counts", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: true,
};

const implement3dCamera: SkillDefinition = {
  name: "implement-3d-camera",
  description:
    "Implement a camera controller (orbit, first-person, or follow) for a Three.js or Babylon.js scene.",
  phases: [
    { order: 1, name: "Select Camera Style", description: "Choose orbit, first-person, or follow based on gameplay needs", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 2, name: "Implement Camera Logic", description: "Write camera input handling, bounds, and smoothing", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 3, name: "Integrate into Render Loop", description: "Hook camera updates into the animation loop", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: true,
};

const generate3dAsset: SkillDefinition = {
  name: "generate-3d-asset",
  description:
    "Generate or import a 3D asset (mesh, material, texture) for a Web3D project, including glTF/GLB workflow guidance.",
  phases: [
    { order: 1, name: "Define Asset Requirements", description: "Identify mesh, material, and texture needs for the scene", agents: ["threejs-specialist", "babylon-specialist", "technical-artist"] },
    { order: 2, name: "Generate or Source Asset", description: "Use the TextTo3D tool or import a glTF/GLB file", agents: ["threejs-specialist", "babylon-specialist", "technical-artist"] },
    { order: 3, name: "Wire into Scene", description: "Load the asset and attach it to the scene graph", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: true,
};

const web3dCliOps: SkillDefinition = {
  name: "web3d-cli-ops",
  description:
    "Use the Web3DCLI tool to init, dev, build, test, or preview a Three.js or Babylon.js Vite project.",
  phases: [
    { order: 1, name: "Select Command", description: "Choose init, dev, build, test, or preview", agents: ["threejs-specialist", "babylon-specialist"] },
    { order: 2, name: "Execute", description: "Run the Web3DCLI tool and capture output", agents: ["threejs-specialist", "babylon-specialist"] },
  ],
  userInvocable: false,
};

/** All Web3D skills in a flat list. */
export const web3dSkills: SkillDefinition[] = [
  setupWeb3dProject,
  implement3dScene,
  implement3dPhysics,
  implement3dCamera,
  generate3dAsset,
  web3dCliOps,
];

/** Web3D skills grouped by the top-level production phase. */
export const web3dOnboardingSkills: SkillDefinition[] = [setupWeb3dProject];
export const web3dImplementationSkills: SkillDefinition[] = [
  implement3dScene,
  implement3dPhysics,
  implement3dCamera,
];
export const web3dCreativeSkills: SkillDefinition[] = [generate3dAsset];
export const web3dQASkills: SkillDefinition[] = [web3dCliOps];
export const web3dReleaseSkills: SkillDefinition[] = [web3dCliOps];
