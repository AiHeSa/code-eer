import type { SyntaxEvidence } from './model.js';
import { callGraph, reachable, reverseGraph } from './graph.js';

function bindingEvidence(evidence: SyntaxEvidence) {
    return evidence.declarations.map((declaration) => {
        const references = evidence.references.filter((ref) => ref.targetId === declaration.id);
        const captures = references.filter(
            (ref) => ref.functionId !== declaration.functionId && ref.functionId !== null,
        );
        const scope = evidence.scopes.find((item) => item.id === declaration.scopeId);
        const functions = [...new Set(references.flatMap((ref) => (ref.functionId ? [ref.functionId] : [])))].sort();
        return {
            declarationId: declaration.id,
            scope: scope?.kind ?? 'unknown',
            exported: declaration.exported,
            reads: references.filter((ref) => ref.access !== 'write').map((ref) => ref.id),
            writes: references.filter((ref) => ref.access !== 'read' && ref.property === null).map((ref) => ref.id),
            propertyWrites: references
                .filter((ref) => ref.access !== 'read' && ref.property !== null)
                .map((ref) => ref.id),
            capturedBy: [...new Set(captures.map((ref) => ref.functionId!))].sort(),
            directFunctionIds: functions,
            temporary: {
                status: 'unknown' as const,
                reason: 'Reference ranges are available; liveness and escape are unresolved',
            },
            escape: 'unknown' as const,
        };
    });
}

function functionEvidence(evidence: SyntaxEvidence) {
    const graph = callGraph(evidence);
    const incoming = reverseGraph(graph);
    const declarations = new Map(evidence.declarations.map((item) => [item.id, item]));
    return evidence.functions.map((fn) => {
        const refs = evidence.references.filter((item) => item.functionId === fn.id);
        const calls = evidence.calls.filter((item) => item.functionId === fn.id);
        const external = refs.filter(
            (ref) => ref.targetId === null || declarations.get(ref.targetId)?.functionId !== fn.id,
        );
        const externalWrites = external.filter((ref) => ref.access !== 'read');
        const unknown =
            !fn.hasBody ||
            calls.length > 0 ||
            external.length > 0 ||
            evidence.effects.some((item) => item.functionId === fn.id) ||
            fn.async ||
            fn.generator ||
            evidence.exits.some((item) => item.functionId === fn.id && item.kind === 'throw');
        return {
            functionId: fn.id,
            immediate: fn.immediate,
            captures: external.filter((ref) => ref.targetId !== null).map((ref) => ref.id),
            unresolvedReferences: external.filter((ref) => ref.targetId === null).map((ref) => ref.id),
            externalWrites: externalWrites.map((ref) => ref.id),
            purity: {
                status: unknown ? ('unknown' as const) : ('syntax-candidate' as const),
                reason: 'Syntax evidence only; getters, coercions, aliases and transitive effects are not proved',
            },
            impact: {
                directCallers: [...(incoming.get(fn.id) ?? [])].sort(),
                localCallers: reachable(incoming, fn.id),
                localCallees: reachable(graph, fn.id),
                unresolvedCalls: calls.filter((call) => call.targetId === null).map((call) => call.id),
                boundary: 'file-local-lexical' as const,
                externalConsumers: 'unknown' as const,
            },
        };
    });
}

export function analyzeScope(evidence: SyntaxEvidence) {
    return {
        status: evidence.coverage.level === 'syntax' ? ('partial' as const) : ('unsupported' as const),
        score: null,
        algorithmVersion: 'scope-evidence-1',
        bindings: bindingEvidence(evidence),
        functions: functionEvidence(evidence),
        pending: [
            'base-score-calibration',
            'purity-and-escape',
            'cross-file-symbols',
            'impact-chain-and-state-propagation',
        ],
    };
}
