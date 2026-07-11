import type { ProjectEngine } from "@game-studio/types";

/**
 * Input contract for a capability block.
 */
export interface BlockInput {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Output contract for a capability block.
 */
export interface BlockOutput {
  name: string;
  type: string;
  description: string;
}

/**
 * Manifest describing a reusable game capability.
 */
export interface BlockManifest {
  name: string;
  description: string;
  inputs: BlockInput[];
  outputs: BlockOutput[];
  dependencies: string[];
  engines: ProjectEngine[];
}

/**
 * Engine-specific implementation of a capability block.
 */
export interface BlockImplementation {
  engine: ProjectEngine;
  filePath: string;
  code: string;
}

/**
 * A capability block with all loaded engine implementations.
 */
export interface CapabilityBlock {
  manifest: BlockManifest;
  implementations: BlockImplementation[];
}
