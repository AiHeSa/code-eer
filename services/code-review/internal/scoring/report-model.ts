import { z } from 'zod';
import { languageSchema } from '../ast/schema.js';
import { scoreSchema, ruleResultSchema } from './model.js';
import { policySchema } from './policy.js';
import { scoringConfigurationSchema } from './config.js';

const dimensions = { scope: scoreSchema, complexity: scoreSchema, placement: scoreSchema, composite: scoreSchema };
const unit = z.strictObject({ id: z.string(), groupId: z.string(), name: z.string().nullable(),
  kind: z.enum(['function', 'binding', 'module']), scope: scoreSchema, complexity: scoreSchema, placement: scoreSchema });
export const evaluationReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), engineVersion: z.enum(['scoring-engine-1', 'scoring-engine-2', 'scoring-engine-3', 'scoring-engine-4']), runId: z.string().uuid(),
  source: z.literal('internal'), calibration: z.literal('experimental-unvalidated'),
  status: z.enum(['complete', 'partial', 'failed']), policy: policySchema, configuration: scoringConfigurationSchema,
  manifest: z.strictObject({ root: z.string(), gitHead: z.string().nullable(), sourceDigest: z.string(),
    policyDigest: z.string(), configurationDigest: z.string(), positionContextDigest: z.string().optional(), selection: z.strictObject({ include: z.array(z.string()), exclude: z.array(z.string()),
      files: z.array(z.string()), tests: z.boolean() }),
    files: z.array(z.strictObject({ path: z.string(), language: languageSchema, digest: z.string() })),
    parserVersions: z.record(z.string(), z.string()), startedAt: z.string(), completedAt: z.string(), stable: z.literal(true) }),
  files: z.array(z.strictObject({ path: z.string(), language: languageSchema, digest: z.string(), moduleId: z.string(), units: z.array(unit),
    ...dimensions, rules: z.array(ruleResultSchema), errors: z.array(z.string()), syntaxCoverage: z.enum(['syntax', 'structure']).nullable(),
    costModelsResolved: z.int().nonnegative() })),
  modules: z.array(z.strictObject({ id: z.string(), files: z.array(z.string()), ...dimensions })),
  repository: z.strictObject(dimensions), rules: z.array(ruleResultSchema),
  findings: z.array(z.strictObject({ file: z.string(), ruleId: z.string(), evidenceIds: z.array(z.string()), reason: z.string() })),
  grade: z.strictObject({ value: z.string().nullable(), status: z.string(), possibleGrades: z.array(z.string()), reason: z.string() }),
  statistics: z.record(z.string(), z.json()), errors: z.array(z.string()),
  artifacts: z.strictObject({ report: z.string(), evidence: z.string() }).nullable(),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
