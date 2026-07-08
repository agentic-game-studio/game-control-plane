/**
 * GodotEngineAdapter — reference implementation of the EngineAdapter contract.
 *
 * Wraps the existing Godot-specific services (MCP lifecycle, QA gates, build
 * export) so shared services can dispatch through getEngineAdapter() instead of
 * branching on project.engine.
 */

import type {
  BuildPlatform,
  BuildValidationResult,
  EngineAdapter,
  ExportResult,
  ProjectEngine,
  TestResult,
  ToolDefinition,
} from "@game-studio/types";
import fsPromises from "fs/promises";
import { join, relative } from "path";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { runBootCheckGate, runGUTGate } from "../services/qa-gate-service.js";
import {
  getGodotInstructions,
  getGodotMCPToolDefinitions,
  getOrCreateGodotMCPService,
  installGodotMCPPlugin,
  launchGodotEditor,
  removeGodotMCPService,
} from "../services/godot-mcp-service.js";
import { runGodotExport } from "../services/build-service.js";

export class GodotEngineAdapter implements EngineAdapter {
  readonly engine: ProjectEngine = "godot";

  getScaffolder(): "godot-scaffolder" {
    return "godot-scaffolder";
  }

  getSpecialist(): "godot-specialist" {
    return "godot-specialist";
  }

  getTools(): ToolDefinition[] {
    // Shape is identical; cast avoids a redundant per-tool map.
    return getGodotMCPToolDefinitions() as ToolDefinition[];
  }

  getInstructions(): string {
    return getGodotInstructions() ?? "";
  }

  async scaffold(): Promise<void> {
    // Scaffolding is driven by the godot-scaffolder agent via the skill/tool
    // loop; the adapter does not need to implement it directly.
  }

  async validateBuild(projectPath: string): Promise<BuildValidationResult> {
    const result = await runBootCheckGate(projectPath);
    return {
      ok: result.passed,
      errors: result.errors ?? [],
    };
  }

  async runTests(projectPath: string): Promise<TestResult> {
    const result = await runGUTGate(projectPath);
    return {
      ok: result.passed && !result.skipped,
      output: result.output ?? "",
    };
  }

  async export(
    projectPath: string,
    platform: BuildPlatform,
    options?: {
      preset?: string;
      projectId?: string;
      version?: string;
      bumpVersion?: boolean;
    },
  ): Promise<ExportResult> {
    const projectId = options?.projectId ?? "project";
    const version = options?.version ?? "0.1.0";
    const artifactName = `${projectId}-${platform}-v${version}-${Date.now()}.pck`;
    const buildsDir = join(projectPath, "builds");
    await fsPromises.mkdir(buildsDir, { recursive: true });
    const artifactAbs = join(buildsDir, artifactName);

    await runGodotExport(projectPath, platform, {
      preset: options?.preset,
      artifactAbs,
    });

    return { artifactPath: relative(projectPath, artifactAbs) };
  }

  getQAChain(): string[] {
    return ["boot-check", "gut", "smoke", "regression"];
  }

  async startToolBridge(
    projectId: string,
    workspacePath: string,
  ): Promise<{ running: boolean }> {
    const service = await getOrCreateGodotMCPService(projectId, {
      projectPath: workspacePath,
      mode: "lite",
    });

    // Fire-and-forget editor launch; the loop must not block on Godot startup.
    const projectDir = resolveProjectWorkspace(workspacePath);
    launchGodotEditor(projectDir).then((launchResult) => {
      if (launchResult.success) {
        // launchGodotEditor and getOrCreateGodotMCPService log their own outcomes.
      }
    }).catch(() => {
      // non-fatal
    });

    return { running: service.running() };
  }

  async stopToolBridge(projectId: string): Promise<void> {
    await removeGodotMCPService(projectId);
  }

  async installToolBridge(
    projectPath: string,
  ): Promise<{ success: boolean; pluginCopied: boolean; pluginEnabled: boolean; error?: string }> {
    return installGodotMCPPlugin(projectPath, projectPath);
  }
}
