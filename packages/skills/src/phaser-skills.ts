import type { SkillDefinition } from "@game-studio/types";

/**
 * Phaser 3 skill definitions.
 *
 * Each skill uses the full SkillPhase object shape so the producer can
 * dispatch ordered sub-steps to the right agents.
 */
const setupPhaserProject: SkillDefinition = {
  name: "setup-phaser-project",
  description: "Scaffold a Phaser 3 + Vite + TypeScript project with a boot scene, asset folders, and a headless test harness.",
  phases: [
    { order: 1, name: "Create Directory Structure", description: "Create src/, public/, and test/ folders", agents: ["phaser-scaffolder"] },
    { order: 2, name: "Write package.json", description: "Add phaser, vite, typescript, vitest and jsdom dependencies", agents: ["phaser-scaffolder"] },
    { order: 3, name: "Write vite.config.ts", description: "Configure Vite dev server and build output to dist/", agents: ["phaser-scaffolder"] },
    { order: 4, name: "Create Boot Scene", description: "Write src/main.ts and src/scenes/BootScene.ts", agents: ["phaser-scaffolder"] },
    { order: 5, name: "Add Headless Test Harness", description: "Write vitest setup and a minimal scene test", agents: ["phaser-scaffolder"] },
  ],
  userInvocable: true,
};

const implementPhaserScene: SkillDefinition = {
  name: "implement-phaser-scene",
  description: "Implement a Phaser 3 scene class with preload, create, and update lifecycle methods, plus asset loading.",
  phases: [
    { order: 1, name: "Design Scene Structure", description: "Identify scene responsibilities and required assets", agents: ["phaser-specialist"] },
    { order: 2, name: "Write Scene Class", description: "Create src/scenes/SceneName.ts with preload, create, update", agents: ["phaser-specialist", "phaser-typescript-specialist"] },
    { order: 3, name: "Wire Scene into Game", description: "Register the scene in src/main.ts game config", agents: ["phaser-specialist"] },
  ],
  userInvocable: true,
};

const implementPhaserPhysics: SkillDefinition = {
  name: "implement-phaser-physics",
  description: "Wire Arcade or Matter physics bodies, collisions, gravity, and velocity in a Phaser 3 scene.",
  phases: [
    { order: 1, name: "Choose Physics System", description: "Select Arcade or Matter based on gameplay needs", agents: ["phaser-specialist"] },
    { order: 2, name: "Create Bodies", description: "Add sprites, bodies, colliders, and overlap checks", agents: ["phaser-specialist", "phaser-typescript-specialist"] },
    { order: 3, name: "Tune Parameters", description: "Set gravity, bounce, drag, and velocity limits", agents: ["phaser-specialist"] },
  ],
  userInvocable: true,
};

const implementPhaserTilemap: SkillDefinition = {
  name: "implement-phaser-tilemap",
  description: "Load and render a Tiled tilemap in Phaser 3, including layers, tilesets, and collision data.",
  phases: [
    { order: 1, name: "Import Tilemap Assets", description: "Load .json tilemap and tileset image in preload", agents: ["phaser-specialist"] },
    { order: 2, name: "Create Layers", description: "Add background, foreground, collision layers", agents: ["phaser-specialist"] },
    { order: 3, name: "Set Collision", description: "Enable collision for tile indexes and player body", agents: ["phaser-specialist"] },
  ],
  userInvocable: true,
};

const automatedPhaserPlaytest: SkillDefinition = {
  name: "automated-phaser-playtest",
  description: "Run a headless Phaser 3 scene test and report pass/fail and logs.",
  phases: [
    { order: 1, name: "Run Vitest", description: "Execute npm run test with jsdom environment", agents: ["phaser-specialist"] },
    { order: 2, name: "Collect Logs", description: "Capture console output and scene state assertions", agents: ["phaser-specialist"] },
  ],
  userInvocable: true,
};

const exportWebProject: SkillDefinition = {
  name: "export-web-project",
  description: "Export a Phaser 3 web project to a static dist/ artifact and, when configured, deploy it.",
  phases: [
    { order: 1, name: "Build", description: "Run vite build to produce dist/", agents: ["phaser-specialist"] },
    { order: 2, name: "Verify Artifact", description: "Check dist/ contains index.html and assets", agents: ["phaser-specialist"] },
    { order: 3, name: "Deploy", description: "Upload to configured deployment provider if available", agents: ["phaser-specialist", "devops-engineer"] },
  ],
  userInvocable: true,
};

const phaserCliOps: SkillDefinition = {
  name: "phaser-cli-ops",
  description: "Use the PhaserCLI tool to init, dev, build, test, or preview a Phaser 3 project.",
  phases: [
    { order: 1, name: "Select Command", description: "Choose init, dev, build, test, or preview", agents: ["phaser-scaffolder", "phaser-specialist"] },
    { order: 2, name: "Execute", description: "Run the PhaserCLI tool and capture output", agents: ["phaser-scaffolder", "phaser-specialist"] },
  ],
  userInvocable: false,
};

/** All Phaser skills in a flat list. */
export const phaserSkills: SkillDefinition[] = [
  setupPhaserProject,
  implementPhaserScene,
  implementPhaserPhysics,
  implementPhaserTilemap,
  automatedPhaserPlaytest,
  exportWebProject,
  phaserCliOps,
];

/** Phaser skills grouped by the top-level production phase. */
export const phaserOnboardingSkills: SkillDefinition[] = [setupPhaserProject];
export const phaserImplementationSkills: SkillDefinition[] = [
  implementPhaserScene,
  implementPhaserPhysics,
  implementPhaserTilemap,
  phaserCliOps,
];
export const phaserQASkills: SkillDefinition[] = [automatedPhaserPlaytest, phaserCliOps];
export const phaserReleaseSkills: SkillDefinition[] = [exportWebProject, phaserCliOps];
