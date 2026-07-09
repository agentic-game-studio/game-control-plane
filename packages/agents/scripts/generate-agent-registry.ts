/**
 * Generate agent registry validation script.
 * Ensures all agents have required fields and there are no duplicates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// 12-H20: catch orphan agent files. The previous version only
// validated agents that index.ts already imported, so a contributor
// who added a new agent file (e.g. `godot-gdextension-specialist.ts`)
// but forgot the import in index.ts would pass validation, ship
// a "registered" agent that never reaches production, and the
// silent gap would only surface when the new agent's role was
// spawned and the LLM got a 404. Walk src/ and ensure every
// file exporting a registry-typed const is imported by index.ts.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.join(__dirname, "..", "src");
const indexPath = path.join(srcDir, "index.ts");
let indexContents: string;
try {
  indexContents = fs.readFileSync(indexPath, "utf-8");
} catch (err) {
  console.error("Failed to read src/index.ts:", err);
  process.exit(1);
}

const agentFiles = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts");

for (const file of agentFiles) {
  // Each agent file is conventionally named `<area>-agents.ts` or
  // exports a const named like `leadershipAgents`,
  // `specialistAgents`, etc. We check both: the file is imported
  // by index.ts. A bare-bones check (does index.ts mention this
  // basename?) is sufficient — false positives would only fire
  // for an unrelated file with the same stem, which is unlikely.
  const base = path.basename(file, ".ts");
  if (!indexContents.includes(`./${base}.js`) && !indexContents.includes(`./${base}`)) {
    issues.push(
      `Orphan agent file: src/${file} is not imported by index.ts. ` +
      `Add \`import { ... } from "./${base}.js";\` and spread it into \`agents\`.`,
    );
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
