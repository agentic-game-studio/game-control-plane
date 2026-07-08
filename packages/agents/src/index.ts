import type { AgentDefinition, AgentRole } from "@game-studio/types";
import { AGENT_ROLES, isAgentRole } from "@game-studio/types";
import { leadershipAgents } from "./leadership.js";
import { departmentLeadAgents } from "./department-leads.js";
import { specialistAgents } from "./specialists.js";
import { phaserAgents } from "./engine-phaser.js";
import { godotAgents } from "./engine-godot.js";
import { unityAgents } from "./engine-unity.js";
import { unrealAgents } from "./engine-unreal.js";
import { codeReviewerAgents } from "./code-reviewer.js";
import { delegationMap } from "./delegation-map.js";
import { agentTiers } from "./tiers.js";

/** All agents combined into a single registry */
export const agents: Partial<Record<AgentRole, AgentDefinition>> = {
  ...leadershipAgents,
  ...departmentLeadAgents,
  ...specialistAgents,
  ...phaserAgents,
  ...godotAgents,
  ...unityAgents,
  ...unrealAgents,
  ...codeReviewerAgents,
};

// 27-M-all-roles-derived: derive allAgentRoles from the AGENT_ROLES
// registry (the 25-L-agent-role-guard source of truth) instead of
// `Object.keys(agents) as AgentRole[]`. The cast lost its safety:
// adding a new role to the union but forgetting to add a definition
// in the registry silently dropped it from the validation script's
// output. The new shape filters the union through the runtime
// guard and the partial-record check — a drift in either direction
// (role in union without definition, definition without union
// entry) is now impossible.
export const allAgentRoles: AgentRole[] = AGENT_ROLES.filter(
  (role): role is AgentRole => isAgentRole(role) && role in agents,
);

export { delegationMap, agentTiers };
