import { z } from 'zod';

const strings = z.array(z.string());
const script = {
    modifiers: strings.optional(),
    clause: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
    typeParameters: strings.optional(),
    heritage: strings.optional(),
    declaration: z.string().optional(),
    spread: z.string().optional(),
    declarationId: z.string().optional(),
    moduleSystem: z.literal('commonjs').optional(),
    source: z.string().nullable().optional(),
    dynamic: z.boolean().optional(),
};
const framework = {
    ...script,
    bindingResolution: z.literal('syntax').optional(),
    usage: z.string().optional(),
    evidence: strings.optional(),
    certainty: z.literal('candidate').optional(),
};
export const extensionsSchema = z.strictObject({
    'js-ts': z.strictObject(script).optional(),
    python: z
        .strictObject({
            positionalOnly: strings.optional(),
            keywordOnly: strings.optional(),
            decorators: strings.optional(),
            bases: strings.optional(),
            level: z.int().optional(),
            typeParameters: strings.optional(),
            typeComment: z.string().nullable().optional(),
            keywords: strings.optional(),
            parameterDetails: z
                .array(
                    z.strictObject({
                        name: z.string(),
                        kind: z.enum(['positionalOnly', 'positional', 'vararg', 'keywordOnly', 'kwarg']),
                        annotation: z.string().nullable(),
                        default: z.string().nullable(),
                        typeComment: z.string().nullable(),
                    }),
                )
                .optional(),
            names: z.array(z.strictObject({ name: z.string(), alias: z.string().nullable() })).optional(),
        })
        .optional(),
    go: z
        .strictObject({
            receiver: strings.optional(),
            typeParameters: strings.optional(),
            typeAlias: z.boolean().optional(),
            declaration: z.string().optional(),
            alias: z.string().optional(),
            positionUnavailable: z.string().optional(),
        })
        .optional(),
    rust: z
        .strictObject({
            generics: z.string().optional(),
            attributes: strings.optional(),
            alias: z.string().nullable().optional(),
            visibility: z.string().optional(),
            container: z.literal('impl').optional(),
            declaration: z.string().optional(),
        })
        .optional(),
    java: z
        .strictObject({
            modifiers: strings.optional(),
            typeParameters: strings.optional(),
            throws: strings.optional(),
            annotations: strings.optional(),
            extends: strings.optional(),
            implements: strings.optional(),
            permits: strings.optional(),
            components: strings.optional(),
            directive: z.string().optional(),
            declaration: z.string().optional(),
            static: z.boolean().optional(),
            wildcard: z.boolean().optional(),
        })
        .optional(),
    react: z
        .strictObject({
            ...framework,
            declarationId: z.string().optional(),
            source: z.string().nullable().optional(),
            imported: z.string().nullable().optional(),
            arguments: strings.optional(),
        })
        .optional(),
    vue: z
        .strictObject({
            ...framework,
            owner: z.string().optional(),
            language: z.string().nullable().optional(),
            src: z.string().nullable().optional(),
            attributes: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
            framework: z.literal('vue').optional(),
            tagType: z.int().optional(),
            expression: z.string().nullable().optional(),
            argument: z.string().nullable().optional(),
            modifiers: strings.optional(),
            directive: z.string().optional(),
        })
        .optional(),
});
