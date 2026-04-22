/**
 * Generate skill registry validation script.
 * Ensures all skills have required fields.
 */
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
}

if (issues.length > 0) {
  console.error("Skill registry validation failed:");
  issues.forEach((i) => console.error(" -", i));
  process.exit(1);
}

console.log(`Skill registry validated: ${allSkillNames.length} skills OK`);
console.log(`  Team skills: ${allSkillNames.filter((n) => n.startsWith("team-")).length}`);
