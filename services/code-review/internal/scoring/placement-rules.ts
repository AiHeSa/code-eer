import type { RuleResult } from './model.js';
import { builtinModules } from 'node:module';
import { unknownProof } from './model.js';
import { rule } from './rules.js';
import { moduleFor, type ScoringConfiguration } from './config.js';
import { resolveDependency, type ProjectFile } from './project.js';
import { responsibilityRules } from './responsibilities.js';

export function placementRules(file: ProjectFile, files: Set<string>, configuration: ScoringConfiguration): RuleResult[] {
  const path = file.snapshot.path, id = `${path}#file`, module = moduleFor(path, configuration);
  const contract = configuration.contracts.find((item) => item.moduleId === module?.id);
  const issues: string[] = [], businessIssues: string[] = [], unresolved: string[] = [];
  const evidence: string[] = [];
  for (const dependency of file.semantics?.dependencies ?? []) {
    evidence.push(`${path}#${dependency.id}`);
    if (!dependency.source) { unresolved.push(dependency.id); continue; }
    if (!dependency.source.startsWith('.')) {
      const source = dependency.source.replace(/^node:/, '');
      const packageName = dependency.source.startsWith('@') ? dependency.source.split('/').slice(0, 2).join('/') : dependency.source.split('/')[0]!;
      if (!builtinModules.includes(source) && !builtinModules.includes(dependency.source) && !configuration.externalPackages.includes(packageName)) unresolved.push(dependency.id);
      else if (contract && !contract.allowExternal) issues.push(dependency.id);
      continue;
    }
    const target = resolveDependency(path, dependency.source, files), targetModule = target ? moduleFor(target, configuration) : null;
    if (!target || !targetModule) { unresolved.push(dependency.id); continue; }
    if (module?.kind === 'public' && targetModule.kind === 'business') businessIssues.push(dependency.id);
    if (contract && targetModule.id !== module?.id && !contract.allowedDependencies.includes('*') && !contract.allowedDependencies.includes(targetModule.id))
      issues.push(dependency.id);
  }
  const complete = Boolean(file.collected?.evidence.coverage.complete && file.semantics?.completeImports && contract && !unresolved.length);
  const make = (ruleId: string, violations: string[], applicable: boolean | null): RuleResult => {
    const item = rule(id, ruleId, 'placement', { state: file.collected?.evidence.coverage.complete && violations.length ? 'disproved' : complete ? 'verified' : 'unknown',
      evidenceIds: evidence, reason: violations.length ? `Forbidden static dependency: ${violations.join(', ')}`
        : complete ? 'All declared static imports satisfy the module contract' : 'Module contract or static dependency resolution incomplete' }, applicable);
    item.issueKeys = violations.map((key) => `${path}#dependency:${key}`);
    return item;
  };
  const boundary = make('P-DEPENDENCY-BOUNDARY', issues, module && contract ? true : null);
  const coupling = make('P-PUBLIC-BUSINESS-COUPLING', businessIssues, module?.kind === 'public' ? true : module?.kind === 'business' ? false : null);
  coupling.priority = 1;
  return [boundary, coupling, ...responsibilityRules(file, configuration)];
}
