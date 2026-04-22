import { z } from "zod";

export const reviewModeSchema = z.enum(["solo", "lean", "full"]);
export type ReviewMode = z.infer<typeof reviewModeSchema>;

export const sessionConfigSchema = z.object({
  engine: z.string().optional(),
  language: z.string().optional(),
  reviewMode: reviewModeSchema.optional().default("lean"),
  pillars: z.array(z.string()).optional(),
  antiPillars: z.array(z.string()).optional(),
  coreFantasy: z.string().optional(),
  uniqueHook: z.string().optional(),
});

export const agentDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  model: z.enum(["opus", "sonnet", "haiku"]),
  tools: z.array(z.string()),
  maxTurns: z.number(),
  disallowedTools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  memory: z.enum(["user", "project", "session"]),
  delegates: z.array(z.string()).optional(),
  reportsTo: z.array(z.string()).optional(),
});

export const skillDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  phases: z.array(
    z.object({
      order: z.number(),
      name: z.string(),
      description: z.string(),
      agents: z.array(z.string()),
      parallel: z.boolean().optional(),
      gates: z.array(z.string()).optional(),
    })
  ),
  model: z.enum(["opus", "sonnet", "haiku"]).optional(),
  userInvocable: z.boolean(),
  args: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        required: z.boolean().optional(),
        default: z.string().optional(),
      })
    )
    .optional(),
  gates: z.array(z.string()).optional(),
  teamMembers: z.array(z.string()).optional(),
});

export const gddSectionSchema = z.object({
  overview: z.string(),
  playerFantasy: z.string(),
  detailedRules: z.string(),
  formulas: z
    .array(
      z.object({
        name: z.string(),
        expression: z.string(),
        variables: z.record(z.string()),
        rationale: z.string().optional(),
      })
    )
    .optional(),
  edgeCases: z
    .array(
      z.object({
        scenario: z.string(),
        handling: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      })
    )
    .optional(),
  dependencies: z.array(z.string()).optional(),
  tuningKnobs: z
    .array(
      z.object({
        name: z.string(),
        defaultValue: z.string(),
        range: z.string(),
        description: z.string(),
      })
    )
    .optional(),
  acceptanceCriteria: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        type: z.enum(["logic", "integration", "visual", "ui", "config"]),
        testable: z.boolean(),
      })
    )
    .optional(),
});
