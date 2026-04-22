import type { AgentDefinition, AgentRole } from "@game-studio/types";
import { leadershipAgents } from "./leadership.js";
import { departmentLeadAgents } from "./department-leads.js";
import { specialistAgents } from "./specialists.js";
import { godotAgents } from "./engine-godot.js";
import { unityAgents } from "./engine-unity.js";
import { unrealAgents } from "./engine-unreal.js";
import { delegationMap } from "./delegation-map.js";
import { agentTiers } from "./tiers.js";

/** All agents combined into a single registry */
export const agents: Partial<Record<AgentRole, AgentDefinition>> = {
  ...leadershipAgents,
  ...departmentLeadAgents,
  ...specialistAgents,
  ...godotAgents,
  ...unityAgents,
  ...unrealAgents,
};

export const allAgentRoles: AgentRole[] = Object.keys(agents) as AgentRole[];

export { delegationMap, agentTiers };
