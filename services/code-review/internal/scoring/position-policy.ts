import { z } from 'zod';

export const positionRoleSchema = z.enum(['leaf', 'intermediate', 'global', 'entry', 'public']);

export type PositionRole = z.infer<typeof positionRoleSchema>;

const multiplier = z.number().finite().positive().max(4);
const profile = z.strictObject({ scopePenalty: multiplier, complexityPenalty: multiplier, importance: multiplier });
export const positionPolicySchema = z
    .strictObject({
        version: z.literal('position-weights-v1'),
        leafScope: z.literal('chain-depth-only'),
        leafDepthPenalty: z.number().finite().positive().max(100),
        unknown: z.literal('candidate-envelope-max-importance'),
        mixed: z.literal('strictest-profile'),
        profiles: z.strictObject({
            leaf: profile,
            intermediate: profile,
            global: profile,
            entry: profile,
            public: profile,
        }),
    })
    .superRefine(({ profiles }, context) => {
        for (const role of ['intermediate', 'global', 'entry', 'public'] as const)
            for (const key of ['scopePenalty', 'complexityPenalty', 'importance'] as const)
                if (profiles[role][key] < 1 || profiles[role][key] <= profiles.leaf[key])
                    context.addIssue({ code: 'custom', message: `${role}.${key} must be >= 1 and stricter than leaf` });
        if (profiles.leaf.complexityPenalty > 1 || profiles.leaf.scopePenalty > 1)
            context.addIssue({ code: 'custom', message: 'Leaf penalties must not exceed the baseline' });
    });
