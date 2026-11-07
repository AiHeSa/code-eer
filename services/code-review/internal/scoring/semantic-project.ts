import { API } from 'typescript/async';
import type * as ts from 'typescript/ast';
import { scriptContext, location } from '../assessment/context.js';
import { collectDeclarations } from '../assessment/declarations.js';
import { deriveCost } from './cost.js';
import { projectGraph, unitId, type ProjectFile } from './project.js';
import { semanticScripts } from './semantic-scripts.js';
import { evaluateNative } from './native-evaluate.js';

function effects(files: ProjectFile[], calls: Map<string, string>) {
  const owners = new Map(files.flatMap((file) => (file.collected?.evidence.functions ?? []).map((fn) => [unitId(file.snapshot.path, fn.id), file] as const)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of files) for (const fn of file.collected?.evidence.functions ?? []) {
      const semantics = file.semantics, id = unitId(file.snapshot.path, fn.id);
      if (!semantics || semantics.purity.has(fn.id) || !semantics.localPure.has(fn.id) || !file.collected!.evidence.coverage.complete) continue;
      const outgoing = file.collected!.evidence.calls.filter((call) => call.functionId === fn.id);
      const targets = outgoing.map((call) => calls.get(unitId(file.snapshot.path, call.id)));
      if (!targets.every((target) => target && owners.get(target)?.semantics?.purity.has(target.slice(target.lastIndexOf('#') + 1)))) continue;
      semantics.purity.set(fn.id, { state: 'verified', evidenceIds: [id, ...targets as string[]],
        reason: 'Observable-effect-free syntax and transitively verified static callees; cost and escape proofs are separate' });
      changed = true;
    }
  }
}

async function scriptCosts(file: ProjectFile, script: ReturnType<typeof semanticScripts>['scripts'][number],
  files: Map<string, ProjectFile>, calls: Map<string, string>, api: API) {
  await using lease = await api.createSourceFile(script.path, script.source);
  const context = scriptContext(lease.sourceFile, file.snapshot.source, script.offset, script.prefix);
  collectDeclarations(context);
  let changed = false;
  for (const [node, id] of context.functionNodes) {
    if (file.semantics!.costs.has(id)) continue;
    const cost = deriveCost(node as ts.FunctionLikeDeclaration, (call) => {
      const target = calls.get(unitId(file.snapshot.path, location(context, call, 'call').id));
      if (!target) return null;
      const split = target.lastIndexOf('#');
      return files.get(target.slice(0, split))?.semantics?.costs.get(target.slice(split + 1)) ?? null;
    });
    if (cost) { file.semantics!.costs.set(id, cost); changed = true; }
  }
  return changed;
}

function nativeCosts(file: ProjectFile, files: Map<string, ProjectFile>, calls: Map<string, string>): boolean {
  let changed = false;
  for (const [id, model] of file.semantics!.nativeModels!) {
    if (file.semantics!.costs.has(id)) continue;
    const cost = evaluateNative(model, (call) => {
      const target = calls.get(unitId(file.snapshot.path, call)); if (!target) return null;
      const split = target.lastIndexOf('#'); return files.get(target.slice(0, split))?.semantics?.costs.get(target.slice(split + 1)) ?? null;
    });
    if (cost) { file.semantics!.costs.set(id, cost); changed = true; }
  }
  return changed;
}

export async function completeProjectSemantics(files: ProjectFile[], checkpoint: () => void) {
  const { calls } = projectGraph(files), byPath = new Map(files.map((file) => [file.snapshot.path, file]));
  effects(files, calls);
  const candidates = files.filter((file) => file.semantics && file.collected?.evidence.calls.length);
  await using api = new API();
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of candidates) {
      checkpoint();
      if (file.semantics?.nativeModels) { changed = nativeCosts(file, byPath, calls) || changed; continue; }
      for (const script of semanticScripts(file.snapshot.path, file.snapshot.source).scripts)
        changed = await scriptCosts(file, script, byPath, calls, api) || changed;
    }
  }
}
