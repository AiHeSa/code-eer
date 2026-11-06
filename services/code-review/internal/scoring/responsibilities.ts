import { matchesGlob } from 'node:path';
import { unknownProof, type RuleResult } from './model.js';
import { rule } from './rules.js';
import type { ProjectFile } from './project.js';
import type { ScoringConfiguration } from './config.js';

export function responsibilityRules(file: ProjectFile, configuration: ScoringConfiguration): RuleResult[] {
  const path = file.snapshot.path, unitId = `${path}#file`, evidence = file.collected?.evidence;
  const functions = evidence?.functions.filter((fn) => fn.hasBody) ?? [];
  const assignments = functions.map((fn) => {
    const matches = configuration.responsibilities.filter((item) => matchesGlob(path, item.path) && item.name === fn.name);
    if (matches.length > 1) throw new Error(`Ambiguous responsibility for ${path}:${fn.name}`);
    return { fn, contract: matches[0] };
  });
  const known = Boolean(evidence?.coverage.complete && functions.length && assignments.every((item) => item.contract));
  const group = (ruleId: string, role: 'leaf' | 'entry' | null): RuleResult => {
    if (!known) return rule(unitId, ruleId, 'placement', unknownProof('Role-specific responsibility contract and semantic behavior not established'), null);
    const members = role ? assignments.filter((item) => item.contract?.role === role) : assignments;
    if (!members.length) return rule(unitId, ruleId, 'placement', { state: 'verified', evidenceIds: [], reason: 'No units have this explicitly contracted role' }, false);
    const verified = members.every(({ fn, contract }) => file.semantics?.costs.has(fn.id)
      && (role !== 'entry' || contract?.inputValidation === 'not-required' && file.semantics?.parameterCounts.get(fn.id) === 0));
    return rule(unitId, ruleId, 'placement', { state: verified ? 'verified' : 'unknown',
      evidenceIds: members.map(({ fn }) => `${path}#${fn.id}`), reason: verified
        ? 'Explicit responsibility, finite primitive behavior and entry input contract verified'
        : 'Role contract exists but behavior/input validation requires additional semantic proof' });
  };
  return [group('P-ENTRY-CONTRACT', 'entry'), group('P-LEAF-RESPONSIBILITY', 'leaf'), group('P-ROLE-MIXING', null)];
}
