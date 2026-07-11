import type { LLMTool } from "./zai-client.js";

/**
 * Unity LLM-visible tools.
 *
 * `UnityCLI` is the engine-specific Swiss Army knife: create-project, run-tests,
 * and build for supported platforms.
 */
export const UNITY_TOOLS: LLMTool[] = [
  {
    name: "UnityCLI",
    description:
      "Operate a Unity project. " +
      "create-project scaffolds a minimal Unity project structure; " +
      "run-tests executes the Unity test runner and returns results; " +
      "build produces a platform artifact (windows, macos, linux, web).",
    input_schema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute path to the Unity project root" },
        command: {
          type: "string",
          enum: ["create-project", "run-tests", "build"],
          description: "UnityCLI command to run",
        },
        name: { type: "string", description: "Project name (used only by create-project)" },
        platform: {
          type: "string",
          enum: ["windows", "macos", "linux", "web"],
          description: "Build target platform (used only by build)",
        },
      },
      required: ["projectPath", "command"],
    },
  },
];
