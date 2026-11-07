import type { Proof } from './model.js';
import { unknownProof } from './model.js';
import { budgetFor, type ScoringConfiguration } from './config.js';
import { unitId, type ProjectFile } from './project.js';
import type { ScopeInput } from './scope.js';
import type { ComplexityInput } from './complexity.js';
import type { impactAnalyzer } from './impact.js';

export interface DerivedUnit { id: string; groupId: string; name: string | null; kind: 'function' | 'binding';
  scope: ScopeInput; complexity: ComplexityInput | null; hasBody: boolean; functionId: string | null; positionKind?: 'module' | 'instance' }
const proof = (state: Proof['state'], evidenceIds: string[], reason: string): Proof => ({ state, evidenceIds, reason });

function functionUnit(file: ProjectFile, fn: NonNullable<ProjectFile['collected']>['evidence']['functions'][number],
  impact: ReturnType<typeof impactAnalyzer>, configuration: ScoringConfiguration): DerivedUnit {
  const evidence = file.collected!.evidence, path = file.snapshot.path, id = unitId(path, fn.id);
  const declaration = evidence.declarations.find((item) => item.id === fn.bindingId);
  const enclosing = evidence.scopes.find((item) => item.id === declaration?.scopeId);
  const cost = file.semantics?.costs.get(fn.id), budget = budgetFor(path, fn.name, configuration);
  const known = Boolean(cost && evidence.coverage.complete);
  const purity = file.semantics?.purity.get(fn.id) ?? (known ? proof('verified', [id], 'Finite primitive-only source model; no calls, allocations or observable writes')
    : unknownProof('Purity requires alias, coercion and transitive-effect analysis'));
  const chain = impact([id], path, id);
  chain.complete &&= purity.state === 'verified';
  const costProof = known && budget ? proof('verified', [id], 'Primitive operation upper bound evaluated against explicit budget')
    : unknownProof(!budget ? 'No explicit task budget' : 'Cost outside supported primitive source model');
  return { id, groupId: id, name: fn.name, kind: 'function', hasBody: fn.hasBody, functionId: fn.id,
    scope: { unitId: id, category: declaration ? ['module', 'global', 'static-block'].includes(enclosing?.kind ?? '') ? 'global'
      : declaration.kind === 'member' ? declaration.exported ? 'global' : 'local' : 'local' : fn.parentFunctionId ? 'local' : 'unknown',
    bonuses: { pure: purity, isolatedIife: fn.immediate === true ? known && cost?.isolated ? purity : unknownProof('Immediate function may return an alias or escape value')
      : fn.immediate === false ? proof('disproved', [id], 'Not an immediate invocation')
      : unknownProof('Immediate invocation not supported by this collector'), temporary: null }, impact: chain },
    complexity: { unitId: id, time: { ratio: known && budget ? cost!.time / budget.timeOperations : null, proof: costProof, relation: 'upper-bound' },
      space: { ratio: known && budget ? cost!.space / budget.spaceUnits : null, proof: costProof, relation: 'upper-bound' }, severe: [],
      riskCoverage: known ? proof('verified', [id], 'Finite primitive source model; resolved finite callees and no modeled resource allocation')
        : unknownProof('Termination and object/resource lifetimes unresolved') } };
}

function bindingUnit(file: ProjectFile, declaration: NonNullable<ProjectFile['collected']>['evidence']['declarations'][number],
  impact: ReturnType<typeof impactAnalyzer>): DerivedUnit {
  const evidence = file.collected!.evidence, path = file.snapshot.path, id = unitId(path, declaration.id);
  const scope = evidence.scopes.find((item) => item.id === declaration.scopeId);
  const refs = evidence.references.filter((item) => item.targetId === declaration.id);
  const captured = refs.some((item) => item.functionId !== declaration.functionId);
  const immutable = declaration.kind === 'const' && file.semantics?.primitiveBindings.has(declaration.id)
    && !refs.some((item) => item.access !== 'read') && !evidence.references.some((item) => item.dynamicScope);
  const local = ['function', 'block'].includes(scope?.kind ?? '');
  const roots = [...new Set(refs.flatMap((item) => item.functionId ? [unitId(path, item.functionId)] : []))];
  const chain = impact(roots.length ? roots : declaration.functionId ? [unitId(path, declaration.functionId)] : [], path);
  if (declaration.storage === 'instance') chain.depthComplete = false;
  chain.complete &&= Boolean(immutable && local && !captured && evidence.coverage.complete);
  chain.complete &&= refs.every((item) => item.functionId !== null && file.semantics?.purity.get(item.functionId)?.state === 'verified');
  return { id, groupId: declaration.functionId ? unitId(path, declaration.functionId) : `${path}#module`, name: declaration.name,
    kind: 'binding', hasBody: false, complexity: null, functionId: declaration.functionId, positionKind: declaration.storage === 'instance' ? 'instance' : 'module',
    scope: { unitId: id, category: declaration.storage === 'global' ? 'global' : local || declaration.storage === 'instance' ? 'local' : ['global', 'module', 'static-block'].includes(scope?.kind ?? '') ? 'global' : 'unknown',
      bonuses: { pure: null, isolatedIife: null, temporary: declaration.kind === 'parameter' ? null : local ? immutable && !captured && evidence.coverage.complete
        ? proof('verified', [id, ...refs.map((item) => unitId(path, item.id))], 'Immutable primitive local binding with no closure capture or rebinding')
        : unknownProof('Binding liveness/escape requires additional dataflow evidence') : proof('disproved', [id], 'Not a local temporary binding') }, impact: chain } };
}

export function deriveUnits(file: ProjectFile, impact: ReturnType<typeof impactAnalyzer>, configuration: ScoringConfiguration): DerivedUnit[] {
  const evidence = file.collected?.evidence;
  if (!evidence) return [];
  const functions = evidence.functions.map((fn) => functionUnit(file, fn, impact, configuration));
  const callableBindings = new Set(evidence.functions.map((fn) => fn.bindingId));
  const bindings = evidence.declarations.filter((item) => !['import', 'class', 'function'].includes(item.kind) && !callableBindings.has(item.id))
    .map((item) => bindingUnit(file, item, impact));
  return [...functions, ...bindings];
}
