import { scoreSchema, type Interval, type RuleResult, type Score } from './model.js';

export const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** 只有全部有效规则已判定且区间收敛为一点，才发布完整数值。 */
export function result(
    interval: Interval,
    rules: RuleResult[],
    details: Score['details'] = {},
    cap: number | null = null,
): Score {
    const active = rules.filter((item) => item.applicability !== 'not-applicable' && !item.suppressedBy);
    const resolved = active.filter(
        (item) => item.applicability === 'applicable' && item.execution === 'complete' && item.verdict !== 'unknown',
    );
    const point = Math.abs(interval.upper - interval.lower) < 1e-9;
    const complete = active.length > 0 && resolved.length === active.length && point;
    return scoreSchema.parse({
        status: complete ? 'complete' : active.length ? 'partial' : 'not-applicable',
        value: complete ? interval.lower : null,
        interval: active.length ? interval : null,
        ruleResultIds: rules.map((item) => item.id),
        cap,
        details,
        reasons: [
            ...new Set([
                ...active.filter((item) => !resolved.includes(item)).map((item) => item.reason),
                ...(!point && active.length && resolved.length === active.length
                    ? ['Only conservative numeric bounds are available']
                    : []),
            ]),
        ],
        coverage: {
            required: active.length,
            resolved: resolved.length,
            unknown: active.filter(
                (item) =>
                    item.execution === 'complete' && (item.verdict === 'unknown' || item.applicability === 'unknown'),
            ).length,
            unsupported: active.filter((item) => item.execution === 'unsupported').length,
            failed: active.filter((item) => ['failed', 'timeout', 'cancelled'].includes(item.execution)).length,
            notApplicable: rules.filter((item) => item.applicability === 'not-applicable').length,
        },
    });
}

export function unavailable(reason: string, status: 'pending' | 'failed' | 'not-applicable' = 'pending'): Score {
    return scoreSchema.parse({
        status,
        value: null,
        interval: status === 'not-applicable' ? null : { lower: 0, upper: 100 },
        reasons: [reason],
        ruleResultIds: [],
        cap: null,
        details: {},
        coverage: {
            required: status === 'not-applicable' ? 0 : 1,
            resolved: 0,
            unknown: status === 'pending' ? 1 : 0,
            failed: status === 'failed' ? 1 : 0,
            unsupported: 0,
            notApplicable: status === 'not-applicable' ? 1 : 0,
        },
    });
}

/** 未知成员保留在聚合分母中，避免只统计成功项而抬高评分。 */
export function weighted(scores: { score: Score; weight: number }[], label: string): Score {
    if (!scores.length) return unavailable('No evaluation units');
    if (scores.some((item) => !Number.isFinite(item.weight) || item.weight <= 0))
        throw new Error('Invalid aggregation weight');
    const denominator = scores.reduce((sum, item) => sum + item.weight, 0);
    const interval = { lower: 0, upper: 0 };
    for (const { score, weight } of scores) {
        interval.lower += ((score.interval?.lower ?? 0) * weight) / denominator;
        interval.upper += ((score.interval?.upper ?? 100) * weight) / denominator;
    }
    const coverage = scores.reduce(
        (sum, item) =>
            Object.fromEntries(
                Object.keys(sum).map((key) => [
                    key,
                    sum[key as keyof typeof sum] + item.score.coverage[key as keyof typeof sum],
                ]),
            ) as Score['coverage'],
        { required: 0, resolved: 0, unknown: 0, unsupported: 0, failed: 0, notApplicable: 0 },
    );
    const complete = scores.every((item) => item.score.status === 'complete');
    return scoreSchema.parse({
        status: complete ? 'complete' : 'partial',
        value: complete ? clamp(interval.lower) : null,
        interval: { lower: clamp(interval.lower), upper: clamp(interval.upper) },
        coverage,
        reasons: [...new Set(scores.flatMap((item) => item.score.reasons))],
        ruleResultIds: [],
        cap: null,
        details: {
            aggregation: label,
            count: scores.length,
            denominator,
            incomplete: scores.filter((item) => item.score.status !== 'complete').length,
        },
    });
}
