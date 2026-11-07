import type { ScoringPolicy } from './policy.js';
import { scoreComplexity, type ComplexityInput } from './complexity.js';
import type { PositionContext } from './position-context.js';
import { positionDetails, positionEnvelope, positionProfiles } from './position-score.js';

export function positionedComplexity(input: ComplexityInput, context: PositionContext, policy: ScoringPolicy) {
    const baseline = scoreComplexity(input, policy);
    if (!policy.positionWeighting) return baseline;
    const variants = positionProfiles(context, policy).map((profile) =>
        scoreComplexity(input, {
            ...policy,
            complexity: {
                ...policy.complexity,
                overBudgetLogPenalty: {
                    time: policy.complexity.overBudgetLogPenalty.time * profile.complexityPenalty,
                    space: policy.complexity.overBudgetLogPenalty.space * profile.complexityPenalty,
                },
            },
        }),
    );
    const effective = positionEnvelope(
        variants.map((item) => item.score),
        input.unitId,
        'complexity',
        context,
    );
    effective.score.details = {
        ...variants[0]!.score.details,
        ...positionDetails(baseline.score, context, policy),
        variantIntervals: variants.map((item) => item.score.interval),
    };
    return { score: effective.score, rules: [...variants[0]!.rules, effective.contextRule] };
}
