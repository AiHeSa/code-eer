import type { SyntaxEvidence } from './model.js';
import { callGraph, reachable } from './graph.js';

export function analyzeComplexity(evidence: SyntaxEvidence) {
  const graph = callGraph(evidence);
  const functions = evidence.functions.map((fn) => {
    const loops = evidence.loops.filter((item) => item.functionId === fn.id);
    const branches = evidence.branches.filter((item) => item.functionId === fn.id);
    const exits = evidence.exits.filter((item) => item.functionId === fn.id);
    const calls = evidence.calls.filter((item) => item.functionId === fn.id);
    const allocations = evidence.allocations.filter((item) => item.functionId === fn.id);
    const path = reachable(graph, fn.id);
    return { functionId: fn.id, loops: loops.map((item) => item.id),
      loopForest: loops.map((item) => ({ loopId: item.id, parentLoopId: item.parentLoopId })),
      maxLoopDepth: Math.max(0, ...loops.map((item) => item.depth)),
      branchIds: branches.map((item) => item.id), exitIds: exits.map((item) => item.id),
      // A structural indicator, not McCabe complexity: CFG and exception edges are not built yet.
      decisionSites: branches.length, callsInLoops: calls.filter((item) => item.loopIds.length > 0).map((item) => item.id),
      recursive: path.recursive ? 'detected-local-cycle' as const : 'not-detected' as const,
      recursionCoverageTruncated: path.truncated,
      allocations: allocations.map((item) => item.id), allocationsInLoops: allocations.filter((item) => item.loopIds.length > 0).map((item) => item.id),
      time: { expression: null, status: 'unknown' as const }, space: { expression: null, status: 'unknown' as const },
      termination: { status: 'unknown' as const, candidates: loops.filter((item) =>
        (item.kind === 'ForStatement' && item.condition === null) || item.condition === 'true').map((item) => item.id) },
      memoryLeak: { status: 'unknown' as const, reason: 'Allocation does not establish retention or lifecycle violation' } };
  });
  return { status: evidence.coverage.level === 'syntax' ? 'partial' as const : 'unsupported' as const,
    score: null, algorithmVersion: 'complexity-evidence-1', functions,
    moduleExecution: { loops: evidence.loops.filter((item) => item.functionId === null).map((item) => item.id),
      calls: evidence.calls.filter((item) => item.functionId === null).map((item) => item.id),
      allocations: evidence.allocations.filter((item) => item.functionId === null).map((item) => item.id) },
    pending: ['cost-expression-and-input-size', 'control-flow-and-termination', 'peak-liveness-and-retention', 'task-budgets-and-score-calibration'] };
}
