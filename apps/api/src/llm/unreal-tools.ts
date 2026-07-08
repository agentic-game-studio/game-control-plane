import type { LLMTool } from "./zai-client.js";

/**
 * Unreal Engine 5 LLM-visible tools.
 *
 * `UnrealCLI` is the engine-specific Swiss Army knife: create-project,
 * run-tests, and build.
 */
export const UNREAL_TOOLS: LLMTool[] = [
  {
    name: "UnrealCLI",
    description:
      "Operate an Unreal Engine 5 project. " +
      "create-project scaffolds a new UE5 project; run-tests executes the project's test suite; " +
      "build compiles the project for a target platform (windows, macos, linux).",
    input_schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the Unreal project root" },
        command: {
          type: "string",
          enum: ["create-project", "run-tests", "build"],
          description: "UnrealCLI command to run",
        },
        name: { type: "string", description: "Project name (used only by create-project)" },
        platform: {
          type: "string",
          enum: ["windows", "macos", "linux"],
          description: "Target platform (used only by build)",
        },
      },
      required: ["projectPath", "command"],
    },
  },
];
