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

    const name = frontmatter.name as string ?? file.replace(".md", "");
    const tools = Array.isArray(frontmatter.tools)
      ? (frontmatter.tools as string[])
      : typeof frontmatter.tools === "string"
      ? (frontmatter.tools as string).split(",").map((s) => s.trim())
      : [];

    const prompt: AgentPrompt = {
      name,
      description: (frontmatter.description as string) ?? "",
      tools: tools as string[],
      model: (frontmatter.model as string) ?? "sonnet",
      maxTurns: parseInt((frontmatter.maxTurns as string) ?? "30", 10),
      memory: (frontmatter.memory as string) ?? "user",
      disallowedTools: frontmatter.disallowedTools
        ? typeof frontmatter.disallowedTools === "string"
          ? (frontmatter.disallowedTools as string).split(",").map((s) => s.trim())
          : (frontmatter.disallowedTools as string[])
        : undefined,
      skills: frontmatter.skills
        ? Array.isArray(frontmatter.skills)
          ? (frontmatter.skills as string[])
          : []
        : undefined,
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