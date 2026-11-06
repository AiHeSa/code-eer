import { z } from 'zod';
import { factTypeSchema, type FileResult } from './schema.js';
import { syntaxSchema } from './coverage-schema.js';

export const rawNodeSchema = z.object({
  id: z.string(), parent: z.string().nullable().default(null), type: factTypeSchema,
  nativeType: z.string(), name: z.string().nullable().default(null),
  start: z.int().nonnegative().nullable(), end: z.int().nonnegative().nullable(),
  role: z.string().default('member'), parameters: z.array(z.string()).default([]),
  returns: z.array(z.string()).default([]), async: z.boolean().default(false),
  bodyStart: z.int().nonnegative().nullable().default(null), bodyEnd: z.int().nonnegative().nullable().default(null),
  data: z.record(z.string(), z.json()).default({}),
});
export const rawResultSchema = z.object({
  version: z.string(), runtime: z.string(), encoding: z.enum(['utf8', 'utf16']),
  nodes: z.array(rawNodeSchema), diagnostics: z.array(z.object({
    message: z.string(), code: z.string(), start: z.int().nonnegative().nullable(), end: z.int().nonnegative().nullable(),
  })), skipped: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  framework: z.enum(['react', 'vue']).nullable().default(null),
  structureComplete: z.boolean().default(true),
  syntax: syntaxSchema.optional(),
});
export type RawNode = z.infer<typeof rawNodeSchema>;
export type RawResult = z.infer<typeof rawResultSchema>;
export type ParsedResult = RawResult & { relatedFiles?: FileResult[] };
