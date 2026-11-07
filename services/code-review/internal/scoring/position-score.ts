import type { Score, Dimension } from './model.js';
import type { ScoringPolicy } from './policy.js';
import type { PositionContext } from './position-context.js';
import { result } from './score.js';
import { rule } from './rules.js';

export function positionProfiles(context: PositionContext, policy: ScoringPolicy) {
    const profiles = context.candidates.map((role) => policy.positionWeighting!.profiles[role]);
    const strictest = {
        scopePenalty: Math.max(...profiles.map((profile) => profile.scopePenalty)),
        complexityPenalty: Math.max(...profiles.map((profile) => profile.complexityPenalty)),
        importance: Math.max(...profiles.map((profile) => profile.importance)),
    };
    return context.state === 'verified' ? [strictest] : profiles;
}

export function positionRule(unitId: string, dimension: Dimension, context: PositionContext) {
    return rule(unitId, `${dimension === 'scope' ? 'S' : 'C'}-POSITION`, dimension, {
        state: context.state,
        evidenceIds: context.evidenceIds,
        reason: context.reasons.join('; '),
    });
}

export function positionDetails(baseline: Score, context: PositionContext, policy: ScoringPolicy) {
    return {
        baseline,
        positionWeighting: {
            version: policy.positionWeighting!.version,
            context: { ...context },
            profiles: positionProfiles(context, policy),
            aggregationWeight: Math.max(...positionProfiles(context, policy).map((profile) => profile.importance)),
        },
    };
}

export function positionEnvelope(scores: Score[], unitId: string, dimension: Dimension, context: PositionContext) {
    const contextRule = positionRule(unitId, dimension, context);
    const score = result(
        {
            lower: Math.min(...scores.map((item) => item.interval?.lower ?? 0)),
            upper: Math.max(...scores.map((item) => item.interval?.upper ?? 100)),
        },
        [contextRule],
    );
    score.coverage = {
        ...scores[0]!.coverage,
        required: scores[0]!.coverage.required + 1,
        resolved: scores[0]!.coverage.resolved + Number(context.state === 'verified'),
        unknown: scores[0]!.coverage.unknown + Number(context.state !== 'verified'),
    };
    score.ruleResultIds = [...scores[0]!.ruleResultIds, contextRule.id];
    score.reasons = [...new Set([...scores.flatMap((item) => item.reasons), ...score.reasons])];
    if (scores.some((item) => item.status !== 'complete')) {
        score.status = 'partial';
        score.value = null;
    }
    score.cap = scores[0]!.cap;
    return { score, contextRule };
}

export function importance(score: Score): number {
    const details = score.details['positionWeighting'];
    return details &&
        typeof details === 'object' &&
        !Array.isArray(details) &&
        typeof details['aggregationWeight'] === 'number'
        ? details['aggregationWeight']
        : 1;
}
