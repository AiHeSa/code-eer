import type { ScoringPolicy } from './policy.js';
import type { RuleResult } from './model.js';
import { deduplicateRules } from './rules.js';
import { result } from './score.js';

export function scorePlacement(input: RuleResult[], policy: ScoringPolicy) {
  const rules = deduplicateRules(input);
  let denominator = 0, minimumPenalty = 0, maximumPenalty = 0, knownWeight = 0;
  for (const item of rules) {
    if (item.suppressedBy || item.applicability === 'not-applicable') continue;
    const weight = policy.placement.weights[item.ruleId as keyof ScoringPolicy['placement']['weights']];
    if (!weight) throw new Error(`Unknown placement rule ${item.ruleId}`);
    denominator += weight;
    if (item.execution !== 'complete' || item.verdict === 'unknown' || item.applicability === 'unknown') maximumPenalty += weight;
    else { knownWeight += weight; if (item.verdict === 'violated') { minimumPenalty += weight; maximumPenalty += weight; } }
  }
  return { score: result({ lower: denominator ? 100 * (1 - maximumPenalty / denominator) : 0,
    upper: denominator ? 100 * (1 - minimumPenalty / denominator) : 100 }, rules,
  { denominator, minimumPenalty, maximumPenalty, knownWeight,
    knownRulesOnlyScore: knownWeight ? 100 * (1 - minimumPenalty / knownWeight) : null }), rules };
}
