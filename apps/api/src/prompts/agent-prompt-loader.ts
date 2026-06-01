import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";

export interface AgentPrompt {
  name: string;
  description: string;
  tools: string[];
  model: string;
  maxTurns: number;
  memory: string;
  disallowedTools?: string[];
  skills?: string[];
  systemPrompt: string;
}

/**
 * Parse YAML frontmatter from markdown files.
 * Example:
 * ---
 * name: creative-director
 * tools: Read, Glob, Grep, Write
 * ---
 * Content here...
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string | string[]>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const raw = match[1];
  const body = match[2];

  const result: Record<string, string | string[]> = {};
  const lines = raw.split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Handle inline arrays like [brainstorm, design-review]
    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value.slice(1, -1).split(",").map((s) => s.trim());
    } else {
      result[key] = value;
    }
  }

  return { frontmatter: result, body };
}

let agentPrompts: Map<string, AgentPrompt> | null = null;

export async function loadAgentPrompts(): Promise<Map<string, AgentPrompt>> {
  if (agentPrompts) return agentPrompts;

  const config = loadConfig();
  const agentsDir = path.join(config.WORKSPACE_DIR, ".claude/agents");

  const files = await fs.readdir(agentsDir).catch(() => [] as string[]);
  agentPrompts = new Map();

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = path.join(agentsDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Coerce frontmatter values defensively. The previous version used
    // `as string` everywhere, which let a bad frontmatter like
    // `name: [foo, bar]` surface in the agent registry as a malformed
    // joined string. Helpers below reduce that surface area.
    const fmString = (key: string, fallback = ""): string => {
      const v = frontmatter[key];
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.join(", ");
      return fallback;
    };
    const fmList = (key: string): string[] | undefined => {
      const v = frontmatter[key];
      if (!v) return undefined;
      if (Array.isArray(v)) return v;
      if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
      return undefined;
    };
    const name = fmString("name") || file.replace(".md", "");

    const prompt: AgentPrompt = {
      name,
      description: fmString("description"),
      tools: fmList("tools") ?? [],
      model: fmString("model", "sonnet"),
      maxTurns: parseInt(fmString("maxTurns", "30"), 10),
      memory: fmString("memory", "user"),
      disallowedTools: fmList("disallowedTools"),
      skills: fmList("skills"),
      systemPrompt: body.trim(),
    };

    agentPrompts.set(name, prompt);
  }

  return agentPrompts;
}

/**
 * Get system prompt for a specific agent role.
 * This is what gets injected into LLM calls as the system message.
 */
export async function getAgentSystemPrompt(role: string): Promise<string> {
  const prompts = await loadAgentPrompts();
  const prompt = prompts.get(role);

  if (!prompt) {
    return `You are a ${role} agent. No detailed prompt found.`;
  }

  // Build system prompt combining frontmatter metadata + markdown body
  return `${prompt.systemPrompt}

---
AGENT CONFIGURATION:
- Role: ${prompt.name}
- Model: ${prompt.model}
- Max Turns: ${prompt.maxTurns}
- Memory: ${prompt.memory}
${prompt.disallowedTools ? `- Disallowed Tools: ${prompt.disallowedTools.join(", ")}` : ""}
${prompt.skills ? `- Skills: ${prompt.skills.join(", ")}` : ""}
- Tools: ${prompt.tools.join(", ")}
---`;
}

/**
 * Get all available agent roles.
 */
export async function getAvailableAgents(): Promise<string[]> {
  const prompts = await loadAgentPrompts();
  return [...prompts.keys()].sort();
}