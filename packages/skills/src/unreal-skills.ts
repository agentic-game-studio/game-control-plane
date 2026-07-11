import type { SkillDefinition } from "@game-studio/types";

/**
 * Unreal Engine 5 skill definitions.
 *
 * Each skill uses the full SkillPhase object shape so the producer can
 * dispatch ordered sub-steps to the right agents.
 */
const setupUnrealProject: SkillDefinition = {
  name: "setup-unreal-project",
  description: "Scaffold a minimal Unreal Engine 5 project with Content/, Source/, Config/, a README, and a placeholder .uproject manifest.",
  phases: [
    { order: 1, name: "Create Directory Structure", description: "Create Content/, Source/, Config/, and Plugins/ folders", agents: ["unreal-specialist"] },
    { order: 2, name: "Write README", description: "Add project README with UE5 version, folder layout, and getting started notes", agents: ["unreal-specialist"] },
    { order: 3, name: "Create .uproject Stub", description: "Add MyProject.uproject with engine version and modules placeholder", agents: ["unreal-specialist"] },
  ],
  userInvocable: true,
};

const implementUeBlueprint: SkillDefinition = {
  name: "implement-ue-blueprint",
  description: "Implement a Blueprint asset or Blueprint/C++ boundary: define the class, event graph, functions, and variable layout following UE5 standards.",
  phases: [
    { order: 1, name: "Design Blueprint", description: "Identify class parent, interfaces, and graph responsibilities", agents: ["ue-blueprint-specialist"] },
    { order: 2, name: "Create Asset", description: "Create the .uasset or .h/.cpp pair and register it in the project", agents: ["ue-blueprint-specialist"] },
    { order: 3, name: "Wire into Level", description: "Place or spawn the Blueprint in the target level or widget", agents: ["ue-blueprint-specialist", "unreal-specialist"] },
  ],
  userInvocable: true,
};

const implementUeGas: SkillDefinition = {
  name: "implement-ue-gas",
  description: "Implement a Gameplay Ability System feature: attributes, abilities, effects, tags, and gameplay cues.",
  phases: [
    { order: 1, name: "Design GAS Data", description: "Define attribute set, ability tags, and effect definitions", agents: ["ue-gas-specialist"] },
    { order: 2, name: "Implement Attribute Set", description: "Create C++ attribute set and add it to the avatar actor", agents: ["ue-gas-specialist"] },
    { order: 3, name: "Implement Ability/Effect", description: "Create gameplay ability and gameplay effect assets or C++ classes", agents: ["ue-gas-specialist"] },
    { order: 4, name: "Validate", description: "Run automated-ue-playtest or UnrealCLI run-tests to verify", agents: ["ue-gas-specialist", "qa-tester"] },
  ],
  userInvocable: true,
};

const implementUeReplication: SkillDefinition = {
  name: "implement-ue-replication",
  description: "Implement UE5 multiplayer replication: replicated properties, RPCs, network prediction, and bandwidth optimization.",
  phases: [
    { order: 1, name: "Design Replication", description: "Identify replicated state, server/client authority, and RPC flow", agents: ["ue-replication-specialist", "network-programmer"] },
    { order: 2, name: "Implement Replicated Properties", description: "Add DOREPLIFETIME macros and OnRep callbacks", agents: ["ue-replication-specialist"] },
    { order: 3, name: "Implement RPCs", description: "Add UFUNCTION(Server, Reliable/Client) methods with validation", agents: ["ue-replication-specialist"] },
    { order: 4, name: "Validate", description: "Run automated-ue-playtest or UnrealCLI run-tests to verify", agents: ["ue-replication-specialist", "qa-tester"] },
  ],
  userInvocable: true,
};

const automatedUePlaytest: SkillDefinition = {
  name: "automated-ue-playtest",
  description: "Run an automated Unreal playtest via UnrealCLI and report pass/fail.",
  phases: [
    { order: 1, name: "Prepare Test Build", description: "Use UnrealCLI build to produce a headless or playable artifact", agents: ["unreal-specialist"] },
    { order: 2, name: "Run Tests", description: "Invoke UnrealCLI run-tests and capture logs", agents: ["unreal-specialist"] },
  ],
  userInvocable: true,
};

const unrealCliOps: SkillDefinition = {
  name: "unreal-cli-ops",
  description: "Use the UnrealCLI tool to create-project, build, or run-tests for an Unreal project.",
  phases: [
    { order: 1, name: "Select Command", description: "Choose create-project, build, or run-tests", agents: ["unreal-specialist"] },
    { order: 2, name: "Execute", description: "Run the UnrealCLI tool and capture output", agents: ["unreal-specialist"] },
  ],
  userInvocable: false,
};

/** All Unreal skills in a flat list. */
export const unrealSkills: SkillDefinition[] = [
  setupUnrealProject,
  implementUeBlueprint,
  implementUeGas,
  implementUeReplication,
  automatedUePlaytest,
  unrealCliOps,
];

/** Unreal skills grouped by the top-level production phase. */
export const unrealOnboardingSkills: SkillDefinition[] = [setupUnrealProject];
export const unrealImplementationSkills: SkillDefinition[] = [
  implementUeBlueprint,
  implementUeGas,
  implementUeReplication,
  unrealCliOps,
];
export const unrealQASkills: SkillDefinition[] = [automatedUePlaytest, unrealCliOps];
export const unrealReleaseSkills: SkillDefinition[] = [unrealCliOps];
