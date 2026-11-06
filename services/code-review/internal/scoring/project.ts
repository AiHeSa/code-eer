import { dirname, posix } from 'node:path';
import type { collectAssessment } from '../assessment/service.js';
import type { SnapshotFile } from './snapshot.js';
import type { Semantics } from './semantics.js';

export type CollectedFile = Awaited<ReturnType<typeof collectAssessment>>['files'][number];
export interface ProjectFile { snapshot: SnapshotFile; collected: CollectedFile | null; semantics: Semantics | null; errors: string[] }
export const unitId = (path: string, id: string) => `${path}#${id}`;
export function resolveDependency(path: string, source: string, files: Set<string>): string | null {
  if (!source.startsWith('.')) return null;
  const base = posix.normalize(posix.join(dirname(path), source));
  if (base === '..' || base.startsWith('../')) return null;
  const stem = base.replace(/\.[cm]?js$/, '');
  const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'].map((suffix) => stem + suffix)];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

export function projectGraph(files: ProjectFile[]) {
  const byPath = new Map(files.map((file) => [file.snapshot.path, file]));
  const paths = new Set(byPath.keys());
  const graph = new Map<string, Set<string>>();
  const exposed = new Set<string>();
  for (const file of files) {
    const evidence = file.collected?.evidence, path = file.snapshot.path;
    if (!evidence) continue;
    for (const fn of evidence.functions) {
      const id = unitId(path, fn.id); graph.set(id, new Set());
      const declaration = evidence.declarations.find((item) => item.id === fn.bindingId);
      const refs = evidence.references.filter((item) => item.targetId === fn.bindingId);
      const alias = refs.some((ref) => !evidence.calls.some((call) => call.bindingId === ref.targetId && call.callee === ref.name
        && call.range.start.line === ref.range.start.line && call.range.start.character === ref.range.start.character));
      if (!fn.bindingId || declaration?.exported || alias || evidence.scopes.some((scope) => scope.kind === 'global')
        || evidence.references.some((ref) => ref.dynamicScope) || !evidence.coverage.complete) exposed.add(id);
    }
    for (const call of evidence.calls) {
      if (!call.functionId) continue;
      let target = call.targetId ? unitId(path, call.targetId) : null;
      const imported = call.bindingId ? file.semantics?.imports.get(call.bindingId) : null;
      const mutated = evidence.references.some((ref) => ref.targetId === call.bindingId && ref.property === null && ref.access !== 'read');
      if (!target && imported && !mutated && call.kind === 'call' && /^[A-Za-z_$][\w$]*$/.test(call.callee)) {
        const resolved = resolveDependency(path, imported.source, paths);
        const fn = resolved ? byPath.get(resolved)?.semantics?.exports.get(imported.imported) : null;
        const targetEvidence = resolved ? byPath.get(resolved)?.collected?.evidence : null;
        const bindingId = targetEvidence?.functions.find((item) => item.id === fn)?.bindingId;
        const rewritten = bindingId && targetEvidence?.references.some((ref) => ref.targetId === bindingId && ref.property === null && ref.access !== 'read');
        if (fn && resolved && !rewritten) target = unitId(resolved, fn);
      }
      if (target) graph.get(unitId(path, call.functionId))?.add(target);
    }
  }
  const reverse = new Map([...graph.keys()].map((id) => [id, new Set<string>()]));
  for (const [source, targets] of graph) for (const target of targets) reverse.get(target)?.add(source);
  return { graph, reverse, exposed };
}
