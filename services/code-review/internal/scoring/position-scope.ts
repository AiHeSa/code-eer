import type { ScoringPolicy } from './policy.js';
import { scoreScope, type ScopeInput } from './scope.js';
import type { PositionContext } from './position-context.js';
import { positionDetails, positionProfiles, positionRule } from './position-score.js';
import { clamp, result } from './score.js';
import { rule } from './rules.js';

function leafScore(input: ScopeInput, policy: ScoringPolicy) {
  const complete = input.impact.depthComplete ?? input.impact.complete;
  const upper = clamp(100 - policy.positionWeighting!.leafDepthPenalty
    * policy.positionWeighting!.profiles.leaf.scopePenalty * input.impact.chainLength);
  const depth = rule(input.unitId, 'S-CHAIN-DEPTH', 'scope', { state: complete ? 'verified' : 'unknown',
    evidenceIds: [input.unitId, ...input.impact.evidenceIds], reason: complete ? 'Closed caller-chain depth; encapsulation is not required for leaves'
      : 'Known caller-chain depth is a lower bound; external consumers or cycles remain unresolved' });
  return { score: result({ lower: complete ? upper : 0, upper }, [depth]), rules: [depth] };
}

export function positionedScope(input: ScopeInput, context: PositionContext, policy: ScoringPolicy) {
  const baseline = scoreScope(input, policy);
  if (!policy.positionWeighting) return baseline;
  const leaf = leafScore(input, policy), strict = positionProfiles(context, policy).map((profile) => ({
    lower: clamp(100 - profile.scopePenalty * (100 - baseline.score.interval!.lower)),
    upper: clamp(100 - profile.scopePenalty * (100 - baseline.score.interval!.upper)),
  }));
  const leafOnly = context.state === 'verified' && context.roles.every((role) => role === 'leaf');
  const bounds = leafOnly ? [leaf.score.interval!] : context.state === 'unknown' ? [...strict, leaf.score.interval!] : strict;
  const baselineRules = leafOnly ? baseline.rules.map((item) => ({ ...item, applicability: 'not-applicable' as const,
    reason: `Baseline audit only; leaf scope does not require ${item.ruleId}` })) : baseline.rules;
  const rules = [...baselineRules, ...(leafOnly || context.state === 'unknown' ? leaf.rules : []), positionRule(input.unitId, 'scope', context)];
  return { score: result({ lower: Math.min(...bounds.map((item) => item.lower)), upper: Math.max(...bounds.map((item) => item.upper)) },
    rules, { ...positionDetails(baseline.score, context, policy), scopeMode: leafOnly ? 'chain-depth-only' : 'weighted-baseline',
      depthPenalty: policy.positionWeighting.leafDepthPenalty * policy.positionWeighting.profiles.leaf.scopePenalty }), rules };
}
