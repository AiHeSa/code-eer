import type { collectAssessment } from '../assessment/service.js';
import type { SnapshotFile } from './snapshot.js';
import type { Semantics } from './semantics.js';
import { projectLinks } from './project-links.js';
import { compilerLinks } from './compiler-links.js';
export { resolveDependency } from './module-resolution.js';

export type CollectedFile = Awaited<ReturnType<typeof collectAssessment>>['files'][number];
export interface ProjectFile { snapshot: SnapshotFile; collected: CollectedFile | null; semantics: Semantics | null; errors: string[] }
export const unitId = (path: string, id: string) => `${path}#${id}`;

export function projectGraph(files: ProjectFile[]) {
  const resolve = projectLinks(files), compiled = compilerLinks(files), calls = new Map<string, string>();
  const graph = new Map<string, Set<string>>();
  const exposed = new Set<string>();
  for (const file of files) graph.set(`${file.snapshot.path}#module`, new Set());
  for (const file of files) {
    const evidence = file.collected?.evidence, path = file.snapshot.path;
    if (!evidence) continue;
    for (const fn of evidence.functions) {
      const id = unitId(path, fn.id); graph.set(id, new Set());
      const declaration = evidence.declarations.find((item) => item.id === fn.bindingId);
      const refs = evidence.references.filter((item) => item.targetId === fn.bindingId);
      const alias = refs.some((ref) => !evidence.calls.some((call) => call.bindingId === ref.targetId && call.callee === ref.name
        && call.range.start.line === ref.range.start.line && call.range.start.character === ref.range.start.character));
      if (!fn.bindingId || declaration?.exported || alias || path.endsWith('.vue') || evidence.scopes.some((scope) => scope.kind === 'global')
        || evidence.references.some((ref) => ref.dynamicScope) || !evidence.coverage.complete) exposed.add(id);
    }
    for (const call of evidence.calls) {
      const target = file.snapshot.language === 'js-ts' ? resolve(file, call)
        : file.collected?.semantic ? compiled(file, call) : call.targetId ? unitId(path, call.targetId) : null;
      if (target) { graph.get(call.functionId ? unitId(path, call.functionId) : `${path}#module`)?.add(target); calls.set(unitId(path, call.id), target); }
    }
  }
  const reverse = new Map([...graph.keys()].map((id) => [id, new Set<string>()]));
  for (const [source, targets] of graph) for (const target of targets) reverse.get(target)?.add(source);
  return { graph, reverse, exposed, calls };
}
