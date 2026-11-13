import { z } from 'zod';
import { rangeSchema } from './location.js';

export const semanticLocationSchema = z.strictObject({ uri: z.string(), range: rangeSchema });
const frameworkBindingSchema = z.strictObject({
    name: z.string(),
    range: rangeSchema,
    definition: semanticLocationSchema.nullable(),
    type: z.string().nullable(),
});

export const semanticSchema = z.strictObject({
    provider: z.string(),
    version: z.string(),
    status: z.enum(['complete', 'partial', 'failed']),
    symbols: z.array(
        z.strictObject({
            id: z.string(),
            name: z.string(),
            kind: z.string(),
            range: rangeSchema,
            definition: semanticLocationSchema,
            type: z.string().nullable(),
        }),
    ),
    references: z.array(
        z.strictObject({
            name: z.string(),
            range: rangeSchema,
            declaration: z.boolean(),
            targetId: z.string().nullable(),
            definition: semanticLocationSchema.nullable(),
            type: z.string().nullable(),
        }),
    ),
    diagnostics: z.array(
        z.strictObject({
            message: z.string(),
            severity: z.enum(['error', 'warning', 'info']),
            range: rangeSchema.nullable(),
        }),
    ),
    limitations: z.array(z.string()),
    framework: z
        .discriminatedUnion('kind', [
            z.strictObject({
                kind: z.literal('react'),
                elements: z.array(
                    frameworkBindingSchema.extend({
                        kind: z.enum(['component', 'intrinsic', 'namespaced']),
                        propsType: z.string().nullable(),
                        attributes: z.array(frameworkBindingSchema),
                    }),
                ),
            }),
            z.strictObject({
                kind: z.literal('vue'),
                bindings: z.array(
                    frameworkBindingSchema.extend({
                        kind: z.enum(['setup', 'for', 'slot', 'global', 'event', 'unresolved']),
                        declaration: z.boolean(),
                    }),
                ),
                components: z.array(frameworkBindingSchema),
            }),
        ])
        .optional(),
    imports: z
        .array(
            z.strictObject({
                source: z.string(),
                resolved: z.boolean(),
                uris: z.array(z.string()),
                name: z.string().optional(),
            }),
        )
        .optional(),
});

export type SemanticResult = z.infer<typeof semanticSchema>;

export type SemanticLocation = z.infer<typeof semanticLocationSchema>;
export type FrameworkBinding = z.infer<typeof frameworkBindingSchema>;
export type ReactSemantics = Extract<NonNullable<SemanticResult['framework']>, { kind: 'react' }>;
export type VueSemantics = Extract<NonNullable<SemanticResult['framework']>, { kind: 'vue' }>;

export const semanticId = (location: SemanticLocation) =>
    `${location.uri}#${location.range.start.line}:${location.range.start.character}-${location.range.end.line}:${location.range.end.character}`;
