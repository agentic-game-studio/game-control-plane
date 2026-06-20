import type { SkillDefinition, SkillName } from "@game-studio/types";
import { skillsByPhase } from "./skills-by-phase.js";
import { teamSkills } from "./team-skills.js";
import { pipelineSkills } from "./pipeline-skills.js";
import { skillModelTiers } from "./skill-model-tier.js";

/** Flat registry of all skills */
export const skills: Record<SkillName, SkillDefinition> = {} as Record<SkillName, SkillDefinition>;

for (const phaseSkills of Object.values(skillsByPhase)) {
  for (const skill of phaseSkills) {
    skills[skill.name] = skill;
  }
}

for (const skill of teamSkills) {
  skills[skill.name] = skill;
}

for (const skill of pipelineSkills) {
  skills[skill.name] = skill;
}

export const allSkillNames: SkillName[] = Object.keys(skills) as SkillName[];

export { skillsByPhase, teamSkills, pipelineSkills, skillModelTiers };
export { validateSkill, gatherSubSkills, LIFECYCLE_PHASES } from "./validate-skill.js";
