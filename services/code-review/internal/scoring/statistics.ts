import type { evaluateProject } from './engine.js';
import { projectGraph, type ProjectFile } from './project.js';
import type { ScoringPolicy } from './policy.js';

export function statistics(project: ProjectFile[], result: ReturnType<typeof evaluateProject>, policy: ScoringPolicy) {
  const reasons: Record<string, number> = {};
  for (const rule of result.rules) if (rule.applicability !== 'not-applicable' && rule.verdict === 'unknown' && !rule.suppressedBy)
    reasons[rule.reason] = (reasons[rule.reason] ?? 0) + 1;
  const knownPosition = result.rules.filter((rule) => rule.dimension === 'placement' && rule.applicability === 'applicable'
    && rule.execution === 'complete' && rule.verdict !== 'unknown' && !rule.suppressedBy);
  const weight = (id: string) => policy.placement.weights[id as keyof ScoringPolicy['placement']['weights']];
  const total = knownPosition.reduce((sum, rule) => sum + weight(rule.ruleId), 0);
  const violations = knownPosition.filter((rule) => rule.verdict === 'violated').reduce((sum, rule) => sum + weight(rule.ruleId), 0);
  const hotspot = project.filter((file) => file.collected).map((file) => {
    const evidence = file.collected!.evidence;
    return { path: file.snapshot.path, functions: evidence.functions.length, loops: evidence.loops.length,
      maxLoopDepth: Math.max(0, ...evidence.loops.map((item) => item.depth)), calls: evidence.calls.length,
      unresolvedCalls: evidence.calls.filter((item) => item.resolution === 'unresolved').length,
      propertyWrites: evidence.references.filter((item) => item.property && item.access !== 'read').length };
  }).sort((a, b) => b.maxLoopDepth - a.maxLoopDepth || b.unresolvedCalls - a.unresolvedCalls).slice(0, 12);
  return { files: project.length, parsedFiles: project.filter((file) => file.collected).length,
    semanticCoverage: { staticCallsResolved: projectGraph(project).calls.size,
      queriedFiles: project.filter((file) => file.collected?.semantic).length,
      failedFiles: project.filter((file) => file.collected?.semantic?.status === 'failed').length,
      typedReferences: project.reduce((sum, file) => sum + (file.collected?.semantic?.references.filter((ref) => ref.type !== null).length ?? 0), 0),
      resolvedDefinitions: project.reduce((sum, file) => sum + (file.collected?.semantic?.references.filter((ref) => ref.definition !== null).length ?? 0), 0),
      totalCalls: project.reduce((sum, file) => sum + (file.collected?.evidence.calls.length ?? 0), 0),
      purityProofs: project.reduce((sum, file) => sum + (file.semantics?.purity.size ?? 0), 0) },
    failedFiles: result.files.filter((file) => file.errors.length).length,
    syntaxFiles: result.files.filter((file) => file.syntaxCoverage === 'syntax').length,
    structureOnlyFiles: result.files.filter((file) => file.syntaxCoverage === 'structure').length,
    units: result.files.reduce((sum, file) => sum + file.units.length, 0), rules: result.rules.length,
    resolvedRules: result.rules.filter((rule) => rule.applicability === 'applicable' && rule.execution === 'complete' && rule.verdict !== 'unknown').length,
    costModelsResolved: result.files.reduce((sum, file) => sum + file.costModelsResolved, 0),
    budgetedCompleteFunctionScores: result.files.flatMap((file) => file.units).filter((unit) => unit.complexity.status === 'complete').length,
    knownStaticPlacement: { value: total ? 100 * (1 - violations / total) : null, rules: knownPosition.length,
      verdict: 'Conditional statistic of resolved static-import rules; not the complete P score' },
    pendingReasons: reasons, structuralHotspots: hotspot };
}
