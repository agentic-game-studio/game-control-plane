/**
 * Generate skill registry validation script. Iterates the registry, calls the
 * pure `validateSkill()` from src/validate-skill.ts, and additionally checks the
 * filesystem for orphan skill files. See .omc/plans/lifecycle-pipeline.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillDefinition } from "@game-studio/types";
import { skills, allSkillNames } from "../src/index.js";
import { validateSkill } from "../src/validate-skill.js";

const issues: string[] = [];

for (const name of allSkillNames) {
  const skill = skills[name];
  if (skill.name !== name) {
    issues.push(`Skill name mismatch: ${name} (field name "${skill.name}")`);
  }
  issues.push(...validateSkill(skill, skills as unknown as Record<string, SkillDefinition>, allSkillNames));
}

// Catch orphan skill files. Without scanning the filesystem we can't tell whether
// a new skill file was added but not imported in src/index.ts.
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
  .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "validate-skill.ts");

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
console.log(`  Pipeline skills: ${allSkillNames.filter((n) => skills[n].kind === "pipeline").length}`);
