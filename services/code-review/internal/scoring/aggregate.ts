import type { Score, UnitScores } from './model.js';
import { unavailable, weighted } from './score.js';
import { composite } from './composite.js';
import type { ScoringPolicy } from './policy.js';
import { importance } from './position-score.js';

function positionedAverage(scores: Score[], label: string): Score {
    const aggregate = weighted(
        scores.map((score) => ({ score, weight: importance(score) })),
        label,
    );
    aggregate.details['positionWeighting'] = {
        aggregationWeight: scores.length ? Math.max(...scores.map(importance)) : 1,
        memberWeights: scores.map(importance),
    };
    return aggregate;
}

function aggregateCost(scores: Score[], label: string): Score {
    const aggregate = positionedAverage(scores, label);
    if (scores.some((score) => score.cap !== null || score.details['unscopedSevereRisk'] === true)) {
        aggregate.status = 'partial';
        aggregate.value = null;
        aggregate.reasons.push('Severe-risk propagation scope requires a responsibility contract');
        aggregate.details['unscopedSevereRisk'] = true;
        const caps = scores.flatMap((score) => (score.cap === null ? [] : [score.cap]));
        aggregate.cap = caps.length ? Math.min(...caps) : null;
    }
    return aggregate;
}

export function fileScores(units: UnitScores[], placement: Score, moduleExecution: Score, policy: ScoringPolicy) {
    const groups = new Map<string, Score[]>();
    for (const unit of units) {
        const group = groups.get(unit.groupId) ?? [];
        group.push(unit.scope);
        groups.set(unit.groupId, group);
    }
    const scope = positionedAverage(
        [...groups.values()].map((scores) => positionedAverage(scores, 'owned objects in function/module group')),
        'position-weighted function/module groups in file',
    );
    const costs = units
        .filter((unit) => unit.kind === 'function' && unit.complexity.status !== 'not-applicable')
        .map((unit) => unit.complexity);
    if (moduleExecution.status !== 'not-applicable') costs.push(moduleExecution);
    const complexity = costs.length
        ? aggregateCost(costs, 'source execution units; not summed runtime cost')
        : unavailable('No executable source units', 'not-applicable');
    return { scope, complexity, placement, composite: composite({ scope, complexity, placement }, policy) };
}

export function aggregateScores<T extends { scope: Score; complexity: Score; placement: Score }>(
    items: T[],
    policy: ScoringPolicy,
    label: string,
) {
    const dimension = (key: 'scope' | 'complexity' | 'placement') =>
        key === 'placement'
            ? weighted(
                  items.map((item) => ({ score: item[key], weight: 1 })),
                  label,
              )
            : positionedAverage(
                  items.map((item) => item[key]),
                  label,
              );
    const scope = dimension('scope'),
        complexity = aggregateCost(
            items.map((item) => item.complexity),
            label,
        ),
        placement = dimension('placement');
    return { scope, complexity, placement, composite: composite({ scope, complexity, placement }, policy) };
}
