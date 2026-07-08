import type { ProjectEngine } from "./dashboard.js";
import type { AgentRole } from "./agent.js";
import type { BuildPlatform } from "./builds.js";

/**
 * Shape of a tool definition exposed to the LLM. Mirrors LLMTool in
 * apps/api/src/llm/zai-client.ts but lives in the shared types package
 * so EngineAdapter implementations don't create a circular dependency
 * on the API package.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Result of an export operation. Web engines set deployUrl when a
 * hosting provider is configured; native engines return artifactPath only.
 */
export interface ExportResult {
  artifactPath: string;
  deployUrl?: string;
}

/** Result of a build validation check. */
export interface BuildValidationResult {
  ok: boolean;
  errors: string[];
}

/** Result of a test run. */
export interface TestResult {
  ok: boolean;
  output: string;
}

/**
 * The contract every game engine must implement. Each adapter wraps
 * the engine-specific scaffolding, tooling, testing, and export logic
 * behind a uniform interface so shared services never branch on
 * `project.engine`.
 *
 * Godot is the reference implementation (see apps/api/src/adapters/godot-adapter.ts).
 */
export interface EngineAdapter {
  /** The engine this adapter handles. */
  readonly engine: ProjectEngine;

  /** Agent role that scaffolds a new project for this engine. */
  getScaffolder(): AgentRole;

  /** Agent role that implements gameplay/features for this engine. */
  getSpecialist(): AgentRole;

  /** LLM tool definitions this engine injects into the tool loop. */
  getTools(): ToolDefinition[];

  /** System-prompt instructions injected for projects using this engine. */
  getInstructions(): string;

  /** Scaffold a new project directory. */
  scaffold(projectPath: string, name: string): Promise<void>;

  /** Validate that the project builds without errors. */
  validateBuild(projectPath: string): Promise<BuildValidationResult>;

  /** Run the engine's test suite and return pass/fail + output. */
  runTests(projectPath: string): Promise<TestResult>;

  /** Export the project for a target platform. */
  export(
    projectPath: string,
    platform: BuildPlatform,
    options?: { preset?: string; projectId?: string; version?: string; bumpVersion?: boolean },
  ): Promise<ExportResult>;

  /** Ordered QA gate chain for this engine (e.g. boot → GUT → smoke for Godot). */
  getQAChain(): string[];

  /** Start the tool bridge (MCP, dev server, etc.) if the engine uses one. */
  startToolBridge?(projectId: string, projectPath: string): Promise<{ running: boolean }>;

  /** Stop the tool bridge. */
  stopToolBridge?(projectId: string): Promise<void>;

  /** Optional one-time setup for the tool bridge (e.g., plugin install). */
  installToolBridge?(projectPath: string): Promise<{ success: boolean; pluginCopied: boolean; pluginEnabled: boolean; error?: string }>;
}

/** Thrown when getEngineAdapter is called for an engine with no registered adapter. */
export class EngineNotSupportedError extends Error {
  readonly engine: ProjectEngine;
  constructor(engine: ProjectEngine) {
    super(`No adapter registered for engine "${engine}". This engine may be recognized as a valid ProjectEngine but is not yet implemented.`);
    this.name = "EngineNotSupportedError";
    this.engine = engine;
  }
}
