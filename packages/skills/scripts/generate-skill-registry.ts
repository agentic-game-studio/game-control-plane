/**
 * Generate skill registry validation script.
 * Ensures all skills have required fields and that subSkills references
 * resolve to a real, registered skill (no dangling pointers, no cycles).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skills, allSkillNames } from "../src/index.js";

const issues: string[] = [];

for (const name of allSkillNames) {
  const skill = skills[name];
  if (!skill.name || skill.name !== name) {
    issues.push(`Skill name mismatch: ${name}`);
  }
  if (!skill.description) {
    issues.push(`Skill ${name} missing description`);
  }
  if (!Array.isArray(skill.phases)) {
    issues.push(`Skill ${name} missing phases array`);
  }
  // 12-C18: validate subSkills references. A skill that lists
  // subSkill names which don't exist in the registry would fail at
  // runtime when the orchestrator tries to delegate. Catch the typo
  // here, at registry-generation time, instead.
  //
  // Also: cycle detection. subSkills cascades are resolved by following
  // the chain, so a cycle (A → B → A) would loop forever. Walk the
  // chain per root skill and bail if we see the same name twice.
  if (skill.subSkills !== undefined) {
    if (!Array.isArray(skill.subSkills)) {
      issues.push(`Skill ${name} has non-array subSkills: ${typeof skill.subSkills}`);
    } else {
      for (const sub of skill.subSkills) {
        if (typeof sub !== "string") {
          issues.push(`Skill ${name} has non-string subSkill entry: ${String(sub)}`);
          continue;
        }
        if (!allSkillNames.includes(sub)) {
          issues.push(`Skill ${name} references unknown subSkill: ${sub}`);
        }
      }
      // Cycle check on this skill's full subSkill tree.
      const visited = new Set<string>([name]);
      const stack: string[] = [name];
      while (stack.length > 0) {
        const current = stack.pop()!;
        const subList = skills[current]?.subSkills;
        if (!Array.isArray(subList)) continue;
        for (const sub of subList) {
          if (typeof sub !== "string") continue;
          if (visited.has(sub)) {
            issues.push(`subSkills cycle detected: ${name} -> ... -> ${sub} -> ${visited.has(sub) ? "..." : sub}`);
            // Stop walking this branch — the cycle is real, no need
            // to surface every node that participates in it.
            stack.length = 0;
            break;
          }
          visited.add(sub);
          stack.push(sub);
        }
      }
    }
  }
}

// 12-H20: catch orphan skill files. Same rationale as the agent
// check — without scanning the filesystem we can't tell whether a
// new skill file was added but not imported in src/index.ts.
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

const skillFiles = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts");

for (const file of skillFiles) {
  const base = path.basename(file, ".ts");
  if (!indexContents.includes(`./${base}.js`) && !indexContents.includes(`./${base}`)) {
    issues.push(
      `Orphan skill file: src/${file} is not imported by index.ts. ` +
      `Add \`import { ... } from "./${base}.js";\` and spread it into \`skills\`.`,
    );
  }
}

if (issues.length > 0) {
  console.error("Skill registry validation failed:");
  issues.forEach((i) => console.error(" -", i));
  process.exit(1);
}

console.log(`Skill registry validated: ${allSkillNames.length} skills OK`);
console.log(`  Team skills: ${allSkillNames.filter((n) => n.startsWith("team-")).length}`);
