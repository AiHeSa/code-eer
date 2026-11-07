import type { Score } from './model.js';
import type { ScoringPolicy } from './policy.js';
import { unavailable, weighted } from './score.js';
import { composite, grade } from './composite.js';

export interface SourceScores { source: 'internal' | 'model'; snapshotDigest: string; policyDigest: string;
  configurationDigest?: string; positionContextDigest?: string;
  scope: Score; complexity: Score; placement: Score }
export function fuseSources(internal: SourceScores, model: SourceScores | null, policy: ScoringPolicy) {
  if (internal.source !== 'internal' || model && model.source !== 'model') throw new Error('Invalid score sources');
  if (model && (internal.snapshotDigest !== model.snapshotDigest || internal.policyDigest !== model.policyDigest))
    throw new Error('Cannot fuse different snapshots or policies');
  if (model && policy.positionWeighting && (!internal.configurationDigest || !internal.positionContextDigest
    || internal.configurationDigest !== model.configurationDigest || internal.positionContextDigest !== model.positionContextDigest))
    throw new Error('Cannot fuse missing or different configurations or position contexts');
  const dimension = (key: 'scope' | 'complexity' | 'placement') => {
    if (!model) {
      const missing = unavailable('Model source missing; internal score remains independently available');
      if (key === 'complexity') missing.cap = internal.complexity.cap;
      return missing;
    }
    const a = internal[key], b = model[key];
    if (a.value !== null && b.value !== null && Math.abs(a.value - b.value) > policy.sourceDisagreementThreshold) {
      const pending = unavailable(`Source disagreement exceeds ${policy.sourceDisagreementThreshold} points`);
      if (key === 'complexity') pending.cap = a.cap === null && b.cap === null ? null : Math.min(a.cap ?? 100, b.cap ?? 100);
      return pending;
    }
    const fused = weighted([{ score: a, weight: policy.sourceWeights.internal }, { score: b, weight: policy.sourceWeights.model }]
      .filter((item) => item.weight > 0), 'internal/model fusion');
    if (key === 'complexity') fused.cap = a.cap === null && b.cap === null ? null : Math.min(a.cap ?? 100, b.cap ?? 100);
    return fused;
  };
  const scope = dimension('scope'), complexity = dimension('complexity'), placement = dimension('placement');
  const score = composite({ scope, complexity, placement }, policy);
  return { scope, complexity, placement, composite: score, grade: grade(score, policy, model !== null) };
}
