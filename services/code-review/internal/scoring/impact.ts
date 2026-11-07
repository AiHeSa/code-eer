import type { ScoringConfiguration } from './config.js';
import { moduleFor } from './config.js';
import { projectGraph, type ProjectFile } from './project.js';

function components(graph: Map<string, Set<string>>) {
  let next = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>(), ids = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>();
  const visit = (id: string): void => {
    indices.set(id, next); low.set(id, next++); stack.push(id); active.add(id);
    for (const target of graph.get(id) ?? []) {
      if (!indices.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
      else if (active.has(target)) low.set(id, Math.min(low.get(id)!, indices.get(target)!));
    }
    if (low.get(id) !== indices.get(id)) return;
    let member: string;
    do { member = stack.pop()!; active.delete(member); ids.set(member, low.get(id)!); } while (member !== id);
  };
  for (const id of graph.keys()) if (!indices.has(id)) visit(id);
  const dag = new Map([...new Set(ids.values())].map((id) => [id, new Set<number>()]));
  const sizes = new Map<number, number>();
  for (const id of ids.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  const cyclic = new Set([...ids].filter(([id, group]) => sizes.get(group)! > 1 || graph.get(id)?.has(id)).map(([id]) => id));
  for (const [source, targets] of graph) for (const target of targets)
    if (ids.get(source) !== ids.get(target)) dag.get(ids.get(source)!)?.add(ids.get(target)!);
  const memo = new Map<number, number>();
  const longest = (id: number): number => {
    if (!memo.has(id)) memo.set(id, Math.max(0, ...[...dag.get(id) ?? []].map((target) => 1 + longest(target))));
    return memo.get(id)!;
  };
  return { ids, longest, cyclic };
}

export function impactAnalyzer(files: ProjectFile[], configuration: ScoringConfiguration) {
  const { reverse, exposed } = projectGraph(files);
  const groups = components(reverse);
  return (roots: string[], currentPath: string, excludeId?: string) => {
    const visited = new Set<string>(), pending = [...roots];
    let edges = 0;
    while (pending.length && edges < 10000) {
      const id = pending.pop()!; edges++;
      if (visited.has(id)) continue;
      visited.add(id); pending.push(...reverse.get(id) ?? []);
    }
    const affected = [...visited].filter((id) => id !== excludeId);
    const paths = [...new Set(affected.map((id) => id.slice(0, id.lastIndexOf('#'))))];
    const currentModule = moduleFor(currentPath, configuration)?.id;
    const modules = new Set(paths.flatMap((path) => moduleFor(path, configuration)?.id ?? []));
    if (currentModule) modules.delete(currentModule);
    const closed = !pending.length && roots.length > 0 && ![...visited].some((id) => exposed.has(id) || groups.cyclic.has(id));
    return { methods: affected.length, files: paths.filter((path) => path !== currentPath).length,
      modules: modules.size, chainLength: Math.max(0, ...roots.map((id) => groups.ids.has(id) ? groups.longest(groups.ids.get(id)!) : 0)),
      stateCategories: 0, complete: closed, depthComplete: closed,
      evidenceIds: affected, truncated: pending.length > 0 };
  };
}
