import { z } from 'zod';
import { isAbsolute, matchesGlob } from 'node:path';
import { assessmentConfigSchema, normalizePath, within } from '../assessment/config.js';
import { positionRoleSchema } from './position-policy.js';

export const scoringConfigurationSchema = z.strictObject({
  modules: assessmentConfigSchema.shape.modules,
  externalPackages: z.array(z.string().min(1)).default([]),
  positions: z.array(z.strictObject({ path: z.string().min(1), role: positionRoleSchema })).default([]),
  contracts: z.array(z.strictObject({ moduleId: z.string(), allowedDependencies: z.array(z.string()),
    allowExternal: z.boolean().default(false) })).default([]),
  budgets: z.array(z.strictObject({ path: z.string().min(1), name: z.string().optional(),
    timeOperations: z.number().finite().positive(), spaceUnits: z.number().finite().positive() })).default([]),
  responsibilities: z.array(z.strictObject({ path: z.string().min(1), name: z.string().min(1),
    role: z.enum(['leaf', 'entry', 'intermediate']), inputValidation: z.enum(['required', 'not-required']).default('required') })).default([]),
}).superRefine((value, context) => {
  const parsed = assessmentConfigSchema.safeParse({ modules: value.modules });
  if (!parsed.success) context.addIssue({ code: 'custom', message: parsed.error.message });
  const ids = new Set(value.modules.map((item) => item.id));
  const contracts = new Set<string>();
  for (const contract of value.contracts) {
    if (!ids.has(contract.moduleId) || contracts.has(contract.moduleId)
      || contract.allowedDependencies.some((id) => id !== '*' && !ids.has(id)))
      context.addIssue({ code: 'custom', message: 'Contracts must reference unique known module IDs' });
    contracts.add(contract.moduleId);
  }
});
export const evaluationInputSchema = z.strictObject({
  root: z.string().refine(isAbsolute), files: z.array(z.string()).max(10000).default([]),
  include: z.array(z.string()).default(['**/*']), exclude: z.array(z.string()).default(['tests/fixtures/**']),
  tests: z.boolean().default(true), configuration: scoringConfigurationSchema.prefault({}),
});
export type ScoringConfiguration = z.infer<typeof scoringConfigurationSchema>;
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;
export function moduleFor(path: string, configuration: ScoringConfiguration) {
  return configuration.modules.filter((item) => within(path, item.root))
    .sort((a, b) => normalizePath(b.root).length - normalizePath(a.root).length)[0];
}
export function budgetFor(path: string, name: string | null, configuration: ScoringConfiguration) {
  const candidates = configuration.budgets.filter((item) => matchesGlob(path, item.path) && (item.name === undefined || item.name === name));
  if (candidates.length > 1) throw new Error(`Ambiguous cost budget for ${path}:${name}`);
  return candidates[0];
}
