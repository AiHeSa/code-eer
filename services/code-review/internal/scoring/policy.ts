import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryRoot } from '../ast/root.js';

const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const ratio = z.number().finite().min(0).max(1);
const weight = z.number().finite().positive().max(1);
const score = z.number().finite().min(0).max(100);
const severe = z.strictObject({ deduction: score, dimensionCap: score, compositeCap: score });
export const policySchema = z.strictObject({
  version: z.string().min(1), status: z.literal('experimental-unvalidated'), runtimeEnabled: z.literal(true),
  range: z.tuple([z.literal(0), z.literal(100)]),
  scope: z.strictObject({ base: z.strictObject({ local: score, global: score }),
    verifiedBonuses: z.strictObject({ pure: ratio, isolatedIife: ratio, temporary: ratio }), bonusRatioCap: ratio,
    impact: z.strictObject({ methodsLog: nonnegative, filesLog: nonnegative, modulesLog: nonnegative,
      chainLength: nonnegative, stateCategories: nonnegative, cap: score }) }),
  complexity: z.strictObject({ regularWeights: z.strictObject({ time: weight, space: weight }),
    overBudgetLogPenalty: z.strictObject({ time: positive, space: positive }), requiresBudget: z.literal(true),
    verifiedSevereIssues: z.strictObject({ nontermination: severe, leak: severe }) }),
  placement: z.strictObject({ weights: z.strictObject({ 'P-DEPENDENCY-BOUNDARY': positive,
    'P-PUBLIC-BUSINESS-COUPLING': positive, 'P-ENTRY-CONTRACT': positive,
    'P-LEAF-RESPONSIBILITY': positive, 'P-ROLE-MIXING': positive }),
    violationValues: z.tuple([z.literal(0), z.literal(1)]), requiresResponsibilityContract: z.literal(true) }),
  compositeWeights: z.strictObject({ scope: weight, complexity: weight, placement: weight }),
  unknownPolicy: z.literal('propagate-interval-no-complete-value'),
  notApplicablePolicy: z.literal('reduced-scope-no-formal-grade'),
  aggregation: z.literal('equal-owned-groups-then-files-then-modules'),
  sourceWeights: z.strictObject({ internal: weight, model: weight }), sourceDisagreementThreshold: score,
  gradeLowerBounds: z.strictObject({ A: score, B: score, C: score, D: score, E: z.literal(0) }),
  requireBothSourcesForGrade: z.literal(true), displayDecimalPlaces: z.int().min(0).max(6),
}).superRefine((policy, context) => {
  for (const weights of [policy.compositeWeights, policy.sourceWeights, policy.complexity.regularWeights])
    if (Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) > 1e-10)
      context.addIssue({ code: 'custom', message: 'Weights must sum to one' });
  const { A, B, C, D, E } = policy.gradeLowerBounds;
  if (!(A > B && B > C && C > D && D > E)) context.addIssue({ code: 'custom', message: 'Grade boundaries must descend' });
});
export type ScoringPolicy = z.infer<typeof policySchema>;
export async function loadPolicy(): Promise<ScoringPolicy> {
  return policySchema.parse(JSON.parse(await readFile(join(repositoryRoot(), 'config/scoring.v0.json'), 'utf8')));
}
