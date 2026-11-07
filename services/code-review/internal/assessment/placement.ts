import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileResult } from '../ast/schema.js';
import type { SyntaxEvidence } from './model.js';
import { normalizePath, within, type AssessmentConfig } from './config.js';
import { callGraph, reverseGraph } from './graph.js';

export function analyzePlacement(root: string, file: FileResult, evidence: SyntaxEvidence, config: AssessmentConfig) {
    const path = relative(root, fileURLToPath(file.uri)).split('\\').join('/');
    const module = config.modules
        .filter((item) => within(path, item.root))
        .sort((a, b) => normalizePath(b.root).length - normalizePath(a.root).length)[0];
    const entry = module?.entries.some((item) => normalizePath(item) === normalizePath(path)) ?? false;
    const graph = callGraph(evidence);
    const incoming = reverseGraph(graph);
    const functions = evidence.functions.map((fn) => {
        const calls = evidence.calls.filter((item) => item.functionId === fn.id);
        const unresolved = calls.filter((item) => item.targetId === null);
        const localCallerCount = incoming.get(fn.id)?.size ?? 0;
        const localCalleeCount = graph.get(fn.id)?.size ?? 0;
        const role =
            evidence.coverage.level !== 'syntax' || !fn.hasBody
                ? 'unknown'
                : unresolved.length
                  ? 'unknown'
                  : localCalleeCount === 0
                    ? 'leaf-candidate'
                    : localCallerCount === 0
                      ? 'entry-candidate'
                      : 'intermediate-candidate';
        return {
            functionId: fn.id,
            role,
            roleStatus: 'candidate' as const,
            evidence: { localCallerCount, localCalleeCount, unresolvedCallIds: unresolved.map((item) => item.id) },
            responsibilityFit: 'unknown' as const,
        };
    });
    return {
        status: 'partial' as const,
        score: null,
        algorithmVersion: 'placement-evidence-1',
        path,
        module: module
            ? { id: module.id, root: module.root, kind: module.kind, source: 'configuration' as const }
            : { id: null, root: null, kind: 'unknown' as const, source: 'unconfigured' as const },
        configuredFileEntry: entry,
        functions,
        imports: evidence.imports.map((item) => item.id),
        exports: evidence.exports.map((item) => item.id),
        frameworkCandidates: file.facts.filter((fact) => fact.type === 'component').map((fact) => fact.id),
        pending: [
            'cross-file-and-framework-relations',
            'module-responsibility-contracts',
            'role-fit-and-score-calibration',
        ],
    };
}
