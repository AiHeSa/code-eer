import { z } from 'zod';

export const coverageSchema = z.strictObject({
  projection: z.literal('selected-facts'),
  nativeNodes: z.array(z.string()).min(1), metadata: z.array(z.string()), limitations: z.array(z.string()).min(1),
});
export const syntaxSchema = z.strictObject({
  grammar: z.string(), parserVersion: z.string(), targetVersion: z.string().nullable(),
  versionConstraint: z.enum(['parser', 'best-effort', 'not-enforced']), configurationKeys: z.array(z.string()),
});
export type Coverage = z.infer<typeof coverageSchema>;
export type Syntax = z.infer<typeof syntaxSchema>;
