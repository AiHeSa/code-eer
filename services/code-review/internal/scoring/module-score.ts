import { unknownProof, type RuleResult, type Score } from './model.js';
import { unavailable } from './score.js';
import { scoreComplexity } from './complexity.js';
import { budgetFor, type ScoringConfiguration } from './config.js';
import type { ScoringPolicy } from './policy.js';
import type { ProjectFile } from './project.js';

export function moduleScore(file: ProjectFile, configuration: ScoringConfiguration, policy: ScoringPolicy): { score: Score; rules: RuleResult[] } {
  const model = file.semantics?.moduleCost;
  if (model && !model.time && !model.space) return { score: unavailable('No own module initialization operations', 'not-applicable'), rules: [] };
  const budget = budgetFor(file.snapshot.path, '<module>', configuration);
  const known = Boolean(model && file.collected?.evidence.coverage.complete);
  const unitId = `${file.snapshot.path}#module`;
  const proof = known && budget ? { state: 'verified' as const, evidenceIds: [unitId], reason: model!.model }
    : unknownProof(!budget ? 'No explicit module initialization budget' : 'Module initialization model unresolved');
  return scoreComplexity({ unitId, time: { ratio: known && budget ? model!.time / budget.timeOperations : null, proof, relation: 'upper-bound' },
    space: { ratio: known && budget ? model!.space / budget.spaceUnits : null, proof, relation: 'upper-bound' }, severe: [],
    riskCoverage: known ? { state: 'verified', evidenceIds: [unitId], reason: model!.model } : unknownProof('Module initialization lifetimes unresolved') }, policy);
}
