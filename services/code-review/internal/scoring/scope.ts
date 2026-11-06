import type { ScoringPolicy } from './policy.js';
import { type Proof, type RuleResult } from './model.js';
import { rule } from './rules.js';
import { clamp, result } from './score.js';

export interface ScopeInput {
  unitId: string; category: 'local' | 'global' | 'unknown';
  bonuses: { pure: Proof | null; isolatedIife: Proof | null; temporary: Proof | null };
  impact: { methods: number; files: number; modules: number; chainLength: number; stateCategories: number;
    complete: boolean; evidenceIds: string[] };
}

export function scoreScope(input: ScopeInput, policy: ScoringPolicy) {
  const rules: RuleResult[] = [rule(input.unitId, 'S-BASE', 'scope', { state: input.category === 'unknown' ? 'unknown' : 'verified',
    evidenceIds: [input.unitId], reason: input.category === 'unknown' ? 'Base scope category unresolved' : `Known ${input.category} scope` })];
  const base = input.category === 'unknown' ? { lower: Math.min(...Object.values(policy.scope.base)), upper: Math.max(...Object.values(policy.scope.base)) }
    : { lower: policy.scope.base[input.category], upper: policy.scope.base[input.category] };
  let bonusLower = 0, bonusUpper = 0;
  for (const key of ['pure', 'isolatedIife', 'temporary'] as const) {
    const proof = input.bonuses[key];
    if (!proof) continue;
    rules.push(rule(input.unitId, `S-${key}`, 'scope', proof));
    if (proof.state === 'verified') bonusLower += policy.scope.verifiedBonuses[key];
    if (proof.state !== 'disproved') bonusUpper += policy.scope.verifiedBonuses[key];
  }
  const impact = input.impact, coefficients = policy.scope.impact;
  if (Object.values(impact).some((value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) throw new Error('Invalid impact counts');
  const deduction = Math.min(coefficients.cap, coefficients.methodsLog * Math.log2(1 + impact.methods)
    + coefficients.filesLog * Math.log2(1 + impact.files) + coefficients.modulesLog * Math.log2(1 + impact.modules)
    + coefficients.chainLength * impact.chainLength + coefficients.stateCategories * impact.stateCategories);
  rules.push(rule(input.unitId, 'S-IMPACT', 'scope', { state: impact.complete ? 'verified' : 'unknown', evidenceIds: impact.evidenceIds,
    reason: impact.complete ? 'Closed impact boundary' : 'Cross-file consumers, aliases or dynamic propagation remain unresolved' }));
  const interval = { lower: clamp(base.lower * (1 + Math.min(policy.scope.bonusRatioCap, bonusLower)) - (impact.complete ? deduction : coefficients.cap)),
    upper: clamp(base.upper * (1 + Math.min(policy.scope.bonusRatioCap, bonusUpper)) - deduction) };
  return { score: result(interval, rules, { base, bonusRatio: { lower: bonusLower, upper: bonusUpper },
    impactDeduction: { lower: deduction, upper: impact.complete ? deduction : coefficients.cap } }), rules };
}
