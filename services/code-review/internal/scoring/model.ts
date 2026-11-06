import { z } from 'zod';

export const intervalSchema = z.strictObject({ lower: z.number().finite().min(0).max(100),
  upper: z.number().finite().min(0).max(100) }).refine((value) => value.lower <= value.upper, 'Reversed interval');
export const dimensionSchema = z.enum(['scope', 'complexity', 'placement']);
export const ruleResultSchema = z.strictObject({
  id: z.string(), ruleId: z.string(), unitId: z.string(), dimension: dimensionSchema,
  applicability: z.enum(['applicable', 'not-applicable', 'unknown']),
  execution: z.enum(['complete', 'unsupported', 'failed', 'timeout', 'cancelled']),
  verdict: z.enum(['satisfied', 'violated', 'unknown']), evidenceIds: z.array(z.string()), reason: z.string(),
  issueKeys: z.array(z.string()), priority: z.int(), suppressedBy: z.string().nullable(),
});
export const scoreSchema = z.strictObject({
  status: z.enum(['complete', 'partial', 'pending', 'not-applicable', 'failed', 'cancelled']),
  value: z.number().finite().min(0).max(100).nullable(), interval: intervalSchema.nullable(),
  ruleResultIds: z.array(z.string()), reasons: z.array(z.string()), cap: z.number().finite().min(0).max(100).nullable(),
  coverage: z.strictObject({ required: z.int().nonnegative(), resolved: z.int().nonnegative(),
    unknown: z.int().nonnegative(), unsupported: z.int().nonnegative(), failed: z.int().nonnegative(), notApplicable: z.int().nonnegative() }),
  details: z.record(z.string(), z.json()),
}).superRefine((score, context) => {
  if ((score.status === 'complete') !== (score.value !== null))
    context.addIssue({ code: 'custom', message: 'Only complete results have a value' });
  if (score.value !== null && (!score.interval || score.value < score.interval.lower || score.value > score.interval.upper))
    context.addIssue({ code: 'custom', message: 'Value must lie inside interval' });
});
export type Interval = z.infer<typeof intervalSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;
export type ProofState = 'verified' | 'disproved' | 'unknown' | 'unsupported';
export interface Proof { state: ProofState; evidenceIds: string[]; reason: string }
export const unknownProof = (reason: string): Proof => ({ state: 'unknown', evidenceIds: [], reason });
export interface UnitScores {
  id: string; groupId: string; name: string | null; kind: 'function' | 'binding' | 'module';
  scope: Score; complexity: Score; placement: Score;
}
