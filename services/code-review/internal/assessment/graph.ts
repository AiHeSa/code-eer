import type { SyntaxEvidence } from './model.js';

export function callGraph(evidence: SyntaxEvidence): Map<string, Set<string>> {
  const graph = new Map(evidence.functions.map((item) => [item.id, new Set<string>()]));
  for (const call of evidence.calls)
    if (call.functionId && call.targetId) graph.get(call.functionId)?.add(call.targetId);
  return graph;
}

export function reverseGraph(graph: Map<string, Set<string>>): Map<string, Set<string>> {
  const reverse = new Map([...graph.keys()].map((id) => [id, new Set<string>()]));
  for (const [source, targets] of graph) for (const target of targets) reverse.get(target)?.add(source);
  return reverse;
}

export function reachable(graph: Map<string, Set<string>>, start: string, budget = 10000) {
  const found = new Set<string>();
  const visited = new Set<string>([start]);
  const pending = [...graph.get(start) ?? []];
  let edges = 0;
  while (pending.length && edges < budget) {
    const id = pending.pop()!;
    edges++;
    found.add(id);
    if (visited.has(id)) continue;
    visited.add(id); pending.push(...graph.get(id) ?? []);
  }
  return { ids: [...found].filter((id) => id !== start).sort(), truncated: pending.length > 0, recursive: found.has(start) };
}
