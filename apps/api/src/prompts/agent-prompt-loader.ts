import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { parseFrontmatter } from "../utils/frontmatter.js";

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

let agentPrompts: Map<string, AgentPrompt> | null = null;
// 12-H23: cap the per-file size for agent prompt markdown. The
// `.claude/agents/` directory is a workspace path that can be
// modified by anyone with write access to the workspace, including
// a compromised sub-agent that an LLM tool wrote a 500MB log to
// under that path thinking it was a scratch directory. Without a
// cap, fs.readFile allocates the whole file into memory and the
// concatenated `systemPrompt` then gets injected into every LLM
// call — a single 500MB file would OOM the API process AND, if
// it survived, burn the entire context window on first use.
//
// 256 KiB is generous: even the longest existing agent prompt
// (the autonomous-producer) is ~12 KiB. The cap is per-file, so
// a workspace with 50 prompts could still load 12.5 MiB total
// — well under any reasonable memory budget.
const MAX_AGENT_PROMPT_BYTES = 256 * 1024;

export async function loadAgentPrompts(): Promise<Map<string, AgentPrompt>> {
  if (agentPrompts) return agentPrompts;

  const config = loadConfig();
  const agentsDir = path.join(config.WORKSPACE_DIR, ".claude/agents");

  const files = await fs.readdir(agentsDir).catch(() => [] as string[]);
  agentPrompts = new Map();

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = path.join(agentsDir, file);
    // 12-H23: pre-flight stat the file. fs.readFile would still
    // work for a multi-GB file, but a stat-based cap is O(1) and
    // skips the malloc+read for any oversized file. Skip-and-warn
    // rather than throw: one oversized file shouldn't disable the
    // whole agent registry.
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      // Race with deletion, permission flip, etc. — skip this
      // entry but keep loading the rest.
      continue;
    }
    if (stat.size > MAX_AGENT_PROMPT_BYTES) {
      // Surface the size in the log so an operator can see WHICH
      // file is over budget, not just that "an agent failed to
      // load". The file is left on disk untouched — a user can
      // fix the file (trim it) and the next API restart will
      // pick it up.
      logger.warn(
        { file, sizeBytes: stat.size, capBytes: MAX_AGENT_PROMPT_BYTES, event: "agent_prompt_oversize" },
        "Skipping oversized agent prompt file",
      );
      continue;
    }
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