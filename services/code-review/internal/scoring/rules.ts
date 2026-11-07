import { ruleResultSchema, type Dimension, type Proof, type RuleResult } from './model.js';

export function rule(
    unitId: string,
    ruleId: string,
    dimension: Dimension,
    proof: Proof,
    applicable: boolean | null = true,
): RuleResult {
    return ruleResultSchema.parse({
        id: `${unitId}/${ruleId}`,
        ruleId,
        unitId,
        dimension,
        applicability: applicable === null ? 'unknown' : applicable ? 'applicable' : 'not-applicable',
        execution: proof.state === 'unsupported' ? 'unsupported' : 'complete',
        verdict: proof.state === 'verified' ? 'satisfied' : proof.state === 'disproved' ? 'violated' : 'unknown',
        evidenceIds: proof.evidenceIds,
        reason: proof.reason,
        issueKeys: [],
        priority: 0,
        suppressedBy: null,
    });
}

/** 按优先级分配问题所有权；共享证据并不自动等于同一个质量问题。 */
export function deduplicateRules(rules: RuleResult[]): RuleResult[] {
    if (new Set(rules.map((item) => item.id)).size !== rules.length) throw new Error('Duplicate rule-result IDs');
    const claimed = new Map<string, string>();
    const sorted = [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return sorted.map((item) => {
        if (item.verdict !== 'violated') return { ...item };
        const keys = item.issueKeys.map((key) => `${item.unitId}/${key}`);
        const overlap = keys.find((key) => claimed.has(key));
        if (overlap && keys.every((key) => claimed.has(key))) return { ...item, suppressedBy: claimed.get(overlap)! };
        // 部分重叠时只保留尚未记账的问题，不整条抑制仍有独立贡献的规则。
        const unique = item.issueKeys.filter((key) => !claimed.has(`${item.unitId}/${key}`));
        for (const key of keys) if (!claimed.has(key)) claimed.set(key, item.id);
        return { ...item, issueKeys: unique };
    });
}

export function scheduleRules<T extends { id: string; requires: string[] }>(rules: T[]): T[] {
    const pending = new Map(rules.map((item) => [item.id, item]));
    if (pending.size !== rules.length) throw new Error('Duplicate rule IDs');
    const ordered: T[] = [];
    const complete = new Set<string>();
    while (pending.size) {
        const ready = [...pending.values()]
            .filter((item) => item.requires.every((id) => complete.has(id)))
            .sort((a, b) => a.id.localeCompare(b.id));
        if (!ready.length) throw new Error('Cyclic or missing rule dependency');
        for (const item of ready) {
            ordered.push(item);
            complete.add(item.id);
            pending.delete(item.id);
        }
    }
    return ordered;
}
