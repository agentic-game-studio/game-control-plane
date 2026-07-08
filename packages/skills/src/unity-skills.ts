import type { SkillDefinition } from "@game-studio/types";

/**
 * Unity skill definitions.
 *
 * Each skill uses the full SkillPhase object shape so the producer can
 * dispatch ordered sub-steps to the right agents.
 */
const setupUnityProject: SkillDefinition = {
  name: "setup-unity-project",
  description: "Scaffold a minimal Unity project with Assets/, ProjectSettings/, Packages/, a README, and placeholder folders for scripts, scenes, and assets.",
  phases: [
    { order: 1, name: "Create Directory Structure", description: "Create Assets/, ProjectSettings/, Packages/, and subfolders", agents: ["unity-specialist"] },
    { order: 2, name: "Write README", description: "Add project README with Unity version, folder layout, and getting started notes", agents: ["unity-specialist"] },
    { order: 3, name: "Create Manifest Stub", description: "Add Packages/manifest.json with common dependencies", agents: ["unity-specialist"] },
  ],
  userInvocable: true,
};

const implementUnityMono: SkillDefinition = {
  name: "implement-unity-mono",
  description: "Implement a MonoBehaviour-based C# script with lifecycle methods, serialized fields, and component references.",
  phases: [
    { order: 1, name: "Design Component", description: "Identify responsibilities, inputs, and dependencies", agents: ["unity-specialist"] },
    { order: 2, name: "Write C# Script", description: "Create Assets/Scripts/ComponentName.cs with MonoBehaviour hooks", agents: ["unity-specialist"] },
    { order: 3, name: "Wire into Scene", description: "Attach the component to a GameObject and configure serialized fields", agents: ["unity-specialist"] },
  ],
  userInvocable: true,
};

const implementUnityDots: SkillDefinition = {
  name: "implement-unity-dots",
  description: "Implement a DOTS/ECS system using entities, components, systems, and Burst-compiled jobs.",
  phases: [
    { order: 1, name: "Design ECS Data", description: "Define IComponentData structs and system responsibilities", agents: ["unity-dots-specialist"] },
    { order: 2, name: "Write Systems and Jobs", description: "Create ISystem implementations and IJobEntity jobs", agents: ["unity-dots-specialist"] },
    { order: 3, name: "Bake and Author", description: "Add authoring MonoBehaviours and bakers to populate entities", agents: ["unity-dots-specialist", "unity-specialist"] },
  ],
  userInvocable: true,
};

const implementUnityUrp: SkillDefinition = {
  name: "implement-unity-urp",
  description: "Implement a URP renderer feature, shader, or material effect.",
  phases: [
    { order: 1, name: "Choose URP Approach", description: "Select Shader Graph, HLSL shader, or renderer feature", agents: ["unity-specialist", "unity-shader-specialist"] },
    { order: 2, name: "Create Shader or Feature", description: "Write the shader asset or ScriptableRendererFeature implementation", agents: ["unity-shader-specialist"] },
    { order: 3, name: "Apply to Scene", description: "Assign material or configure renderer asset to use the feature", agents: ["unity-specialist", "unity-shader-specialist"] },
  ],
  userInvocable: true,
};

const automatedUnityPlaytest: SkillDefinition = {
  name: "automated-unity-playtest",
  description: "Run an automated Unity playtest via UnityCLI and report pass/fail.",
  phases: [
    { order: 1, name: "Prepare Test Build", description: "Use UnityCLI build to produce a headless or playable artifact", agents: ["unity-specialist"] },
    { order: 2, name: "Run Tests", description: "Invoke UnityCLI run-tests and capture logs", agents: ["unity-specialist"] },
  ],
  userInvocable: true,
};

const unityCliOps: SkillDefinition = {
  name: "unity-cli-ops",
  description: "Use the UnityCLI tool to create-project, build, or run-tests for a Unity project.",
  phases: [
    { order: 1, name: "Select Command", description: "Choose create-project, build, or run-tests", agents: ["unity-specialist"] },
    { order: 2, name: "Execute", description: "Run the UnityCLI tool and capture output", agents: ["unity-specialist"] },
  ],
  userInvocable: false,
};

/** All Unity skills in a flat list. */
export const unitySkills: SkillDefinition[] = [
  setupUnityProject,
  implementUnityMono,
  implementUnityDots,
  implementUnityUrp,
  automatedUnityPlaytest,
  unityCliOps,
];

/** Unity skills grouped by the top-level production phase. */
export const unityOnboardingSkills: SkillDefinition[] = [setupUnityProject];
export const unityImplementationSkills: SkillDefinition[] = [
  implementUnityMono,
  implementUnityDots,
  implementUnityUrp,
  unityCliOps,
];
export const unityQASkills: SkillDefinition[] = [automatedUnityPlaytest, unityCliOps];
export const unityReleaseSkills: SkillDefinition[] = [unityCliOps];
