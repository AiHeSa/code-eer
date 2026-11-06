import type { Score } from './model.js';
import type { ScoringPolicy } from './policy.js';
import { weighted } from './score.js';

export function composite(scores: { scope: Score; complexity: Score; placement: Score }, policy: ScoringPolicy): Score {
  const result = weighted((['scope', 'complexity', 'placement'] as const).filter((key) => policy.compositeWeights[key] > 0)
    .map((key) => ({ score: scores[key], weight: policy.compositeWeights[key] })), 'S/C/P fixed weights');
  const cap = scores.complexity.cap;
  result.details['rawInterval'] = result.interval;
  if (cap !== null) {
    result.cap = cap;
    if (result.value !== null) result.value = Math.min(cap, result.value);
    if (result.interval) result.interval = { lower: Math.min(cap, result.interval.lower), upper: Math.min(cap, result.interval.upper) };
  }
  return result;
}

export function grade(score: Score, policy: ScoringPolicy, sourcesComplete = false) {
  const boundaries = Object.entries(policy.gradeLowerBounds);
  const possibleGrades = boundaries.filter(([, lower], index) => score.interval && score.interval.upper >= lower
    && (index === 0 || score.interval.lower < boundaries[index - 1]![1])).map(([name]) => name);
  const eligible = sourcesComplete && score.status === 'complete' && score.value !== null;
  return { value: eligible ? boundaries.find(([, lower]) => score.value! >= lower)?.[0] ?? null : null,
    status: eligible ? 'experimental' : 'pending', possibleGrades,
    reason: eligible ? 'Experimental policy; not quality calibrated' : 'Complete comparable internal and model results are required' };
}
