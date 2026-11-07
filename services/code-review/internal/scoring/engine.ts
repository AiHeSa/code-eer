import type { ScoringPolicy } from './policy.js';
import type { ScoringConfiguration } from './config.js';
import type { RuleResult, UnitScores } from './model.js';
import { positionedScope } from './position-scope.js';
import { positionedComplexity } from './position-complexity.js';
import { positionAnalyzer } from './position-context.js';
import { scorePlacement } from './placement.js';
import { placementRules } from './placement-rules.js';
import { deriveUnits } from './derive.js';
import { impactAnalyzer } from './impact.js';
import { unavailable } from './score.js';
import { aggregateScores, fileScores } from './aggregate.js';
import { moduleFor } from './config.js';
import type { ProjectFile } from './project.js';
import { moduleScore } from './module-score.js';

function scoreFile(file: ProjectFile, project: ProjectFile[], impact: ReturnType<typeof impactAnalyzer>,
  policy: ScoringPolicy, configuration: ScoringConfiguration, positionFor: ReturnType<typeof positionAnalyzer>) {
  const rules: RuleResult[] = [], units: UnitScores[] = [];
  for (const input of deriveUnits(file, impact, configuration)) {
    const context = positionFor(file, input.functionId, input.positionKind);
    const scope = positionedScope(input.scope, context, policy);
    const complexity = input.complexity && input.hasBody ? positionedComplexity(input.complexity, context, policy) : null;
    rules.push(...scope.rules, ...complexity?.rules ?? []);
    units.push({ id: input.id, groupId: input.groupId, name: input.name, kind: input.kind, scope: scope.score,
      complexity: complexity?.score ?? unavailable('No independent execution body', 'not-applicable'),
      placement: unavailable('Position contribution owned by file-level contract') });
  }
  const position = scorePlacement(placementRules(file, new Set(project.map((item) => item.snapshot.path)), configuration, Boolean(policy.positionWeighting)), policy);
  rules.push(...position.rules);
  const evidence = file.collected?.evidence;
  const execution = moduleScore(file, configuration, policy, positionFor(file, null)); rules.push(...execution.rules);
  const scores = fileScores(units, position.score, execution.score, policy);
  if (file.collected?.semantic && file.collected.semantic.status !== 'complete' && scores.composite.status === 'complete') {
    scores.composite.status = 'partial'; scores.composite.value = null; scores.composite.reasons.push('Semantic compiler diagnostics or unresolved occurrences remain');
  }
  if (!file.collected) for (const key of ['scope', 'complexity', 'placement', 'composite'] as const) scores[key] = unavailable(file.errors.join('; ') || 'No AST facts', 'failed');
  return { path: file.snapshot.path, language: file.snapshot.language, digest: file.snapshot.digest,
    moduleId: moduleFor(file.snapshot.path, configuration)?.id ?? 'unconfigured', units, ...scores, rules, errors: file.errors,
    syntaxCoverage: evidence?.coverage.level ?? null, costModelsResolved: file.semantics?.costs.size ?? 0 };
}

export function evaluateProject(files: ProjectFile[], policy: ScoringPolicy, configuration: ScoringConfiguration) {
  const impact = impactAnalyzer(files, configuration);
  const positionFor = positionAnalyzer(files, configuration);
  const results = files.map((file) => scoreFile(file, files, impact, policy, configuration, positionFor));
  const groups = new Map<string, typeof results>();
  for (const file of results) { const group = groups.get(file.moduleId) ?? []; group.push(file); groups.set(file.moduleId, group); }
  const modules = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, members]) => ({ id, files: members.map((file) => file.path),
    ...aggregateScores(members, policy, 'files within module; S/C position importance, P equal') }));
  return { files: results, modules, repository: aggregateScores(modules, policy, 'modules within repository; S/C position importance, P equal'),
    rules: results.flatMap((file) => file.rules), findings: results.flatMap((file) => file.rules
      .filter((rule) => rule.dimension === 'placement' && rule.verdict === 'violated' && !rule.suppressedBy)
      .map((rule) => ({ file: file.path, ruleId: rule.ruleId, evidenceIds: rule.evidenceIds, reason: rule.reason }))) };
}
