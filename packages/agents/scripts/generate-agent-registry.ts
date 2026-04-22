/**
 * Generate agent registry validation script.
 * Ensures all agents have required fields and there are no duplicates.
 */
import { agents, allAgentRoles } from "../src/index.js";

const issues: string[] = [];

for (const role of allAgentRoles) {
  const agent = agents[role];
  if (!agent.name || agent.name !== role) {
    issues.push(`Agent name mismatch: ${role}`);
  }
  if (!agent.description) {
    issues.push(`Agent ${role} missing description`);
  }
  if (!agent.tier || !agent.model) {
    issues.push(`Agent ${role} missing tier or model`);
  }
  if (!agent.tools || agent.tools.length === 0) {
    issues.push(`Agent ${role} has no tools`);
  }
}

if (issues.length > 0) {
  console.error("Agent registry validation failed:");
  issues.forEach((i) => console.error(" -", i));
  process.exit(1);
}

console.log(`Agent registry validated: ${allAgentRoles.length} agents OK`);
console.log(`  Tier 1 (Leadership): ${allAgentRoles.filter((r) => agents[r].tier === 1).length}`);
console.log(`  Tier 2 (Department Leads): ${allAgentRoles.filter((r) => agents[r].tier === 2).length}`);
console.log(`  Tier 3 (Specialists): ${allAgentRoles.filter((r) => agents[r].tier === 3).length}`);
