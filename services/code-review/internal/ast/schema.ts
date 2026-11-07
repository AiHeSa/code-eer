import { z } from 'zod';
import { extensionsSchema } from './extensions.js';
import { coverageSchema, syntaxSchema } from './coverage-schema.js';
import { rangeSchema } from './location.js';
import { semanticSchema } from './semantic-schema.js';

export { rangeSchema, positionSchema } from './location.js';

export const VERSION = '1.0';
export const languageSchema = z.enum(['js-ts', 'python', 'java', 'go', 'rust']);
export const factTypes = [
    'function',
    'method',
    'constructor',
    'type',
    'module',
    'import',
    'export',
    'component',
    'templateElement',
    'attribute',
    'directive',
    'binding',
] as const;
export const factTypeSchema = z.enum(factTypes);
export const capabilitySchema = z.enum(['syntax', 'structure', 'symbols', 'types', 'framework']);
export const issueSchema = z.strictObject({
    code: z.string(),
    message: z.string(),
    file: z.string().optional(),
    range: rangeSchema.nullable().default(null),
});
const base = {
    id: z.string().min(1),
    parentId: z.string().nullable(),
    role: z.string(),
    order: z.int().nonnegative(),
    range: rangeSchema.nullable(),
    origin: z.strictObject({ backend: languageSchema, nativeType: z.string(), adapterVersion: z.literal(VERSION) }),
    extensions: extensionsSchema,
    name: z.string().nullable(),
};
export const factSchema = z.discriminatedUnion('type', [
    z.strictObject({
        ...base,
        type: z.enum(['function', 'method', 'constructor']),
        parameters: z.array(z.string()),
        returns: z.array(z.string()),
        async: z.boolean(),
        bodyRange: rangeSchema.nullable(),
    }),
    z.strictObject({
        ...base,
        type: z.enum([
            'type',
            'module',
            'import',
            'export',
            'component',
            'templateElement',
            'attribute',
            'directive',
            'binding',
        ]),
    }),
]);
export const fileSchema = z.strictObject({
    uri: z.string(),
    language: languageSchema,
    framework: z.enum(['react', 'vue']).nullable(),
    digest: z.string(),
    facts: z.array(factSchema),
    coverage: coverageSchema,
    syntax: syntaxSchema,
    diagnostics: z.array(issueSchema.extend({ source: z.string(), severity: z.enum(['error', 'warning', 'info']) })),
    executed: z.array(capabilitySchema),
    skipped: z.array(issueSchema),
    errors: z.array(issueSchema),
    semantic: semanticSchema.optional(),
});
export const analysisSchema = z.strictObject({
    schemaVersion: z.literal(VERSION),
    status: z.enum(['complete', 'partial', 'failed', 'cancelled']),
    backend: languageSchema,
    version: z.string(),
    files: z.array(fileSchema),
    configuration: z.record(z.string(), z.json()),
    findings: z.array(z.never()),
    errors: z.array(issueSchema),
    skipped: z.array(issueSchema),
});
export const capabilitiesSchema = z.strictObject({
    schemaVersion: z.literal(VERSION),
    backend: languageSchema,
    version: z.string(),
    runtime: z.string(),
    available: z.boolean(),
    capabilities: z.array(capabilitySchema),
    factTypes: z.array(factTypeSchema),
    frameworks: z.array(z.enum(['react', 'vue'])),
    errors: z.array(issueSchema),
    coverage: coverageSchema,
    syntax: syntaxSchema,
    frameworkCoverage: z.strictObject({ react: coverageSchema.optional(), vue: coverageSchema.optional() }),
});

export type Language = z.infer<typeof languageSchema>;

export type Fact = z.infer<typeof factSchema>;

export type FileResult = z.infer<typeof fileSchema>;

export type Analysis = z.infer<typeof analysisSchema>;

export type Capabilities = z.infer<typeof capabilitiesSchema>;

export type Issue = z.infer<typeof issueSchema>;

export type Range = z.infer<typeof rangeSchema>;
