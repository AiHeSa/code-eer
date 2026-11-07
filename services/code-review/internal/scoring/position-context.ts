import { matchesGlob } from 'node:path';
import type { ScoringConfiguration } from './config.js';
import { moduleFor } from './config.js';
import { projectGraph, unitId, type ProjectFile } from './project.js';
import type { PositionRole } from './position-policy.js';

export interface PositionContext {
    state: 'verified' | 'unknown';
    roles: PositionRole[];
    candidates: PositionRole[];
    evidenceIds: string[];
    reasons: string[];
}

const allRoles: PositionRole[] = ['leaf', 'intermediate', 'global', 'entry', 'public'];

function context(roles: PositionRole[], evidenceIds: string[], reasons: string[]): PositionContext {
    const strict = roles.filter((role) => role !== 'leaf');
    const selected = [...new Set(strict.length ? strict : roles)].sort();
    return {
        state: selected.length ? 'verified' : 'unknown',
        roles: selected,
        candidates: selected.length ? selected : allRoles,
        evidenceIds: [...new Set(evidenceIds)],
        reasons,
    };
}

export function filePosition(file: ProjectFile, configuration: ScoringConfiguration): PositionContext {
    const path = file.snapshot.path,
        evidence = file.collected?.evidence;
    const roles = configuration.positions.filter((item) => matchesGlob(path, item.path)).map((item) => item.role);
    const reasons = roles.length ? ['Explicit file-position contract'] : [];
    const module = moduleFor(path, configuration);
    if (module?.kind === 'public') {
        roles.push('public');
        reasons.push('Configured public module');
    }
    if (module?.entries.includes(path)) {
        roles.push('entry');
        reasons.push('Configured module entry');
    }
    const shared =
        evidence?.declarations.filter(
            (item) =>
                (item.storage === 'global' || !item.functionId) &&
                item.storage !== 'instance' &&
                !['function', 'import', 'class'].includes(item.kind) &&
                !evidence.functions.some((fn) => fn.bindingId === item.id) &&
                (item.exported || ['let', 'var'].includes(item.kind)),
        ) ?? [];
    if (evidence?.scopes.some((scope) => scope.kind === 'global') || shared.length) {
        roles.push('global');
        reasons.push('Script-global environment or shared module state');
    }
    return context(roles, [`${path}#file`, ...shared.map((item) => unitId(path, item.id))], reasons);
}

export function positionAnalyzer(files: ProjectFile[], configuration: ScoringConfiguration) {
    const { graph } = projectGraph(files);
    return (file: ProjectFile, functionId: string | null, kind: 'module' | 'instance' = 'module'): PositionContext => {
        const inherited = filePosition(file, configuration),
            path = file.snapshot.path;
        const evidence = file.collected?.evidence,
            fn = evidence?.functions.find((item) => item.id === functionId);
        if (!functionId)
            return context(
                [...inherited.roles, ...(kind === 'module' ? ['global' as const] : [])],
                inherited.evidenceIds,
                [
                    ...inherited.reasons,
                    kind === 'module'
                        ? 'Module-owned binding or initialization'
                        : 'Instance state role requires class/consumer ownership context',
                ],
            );
        const contracts = configuration.responsibilities.filter(
            (item) => matchesGlob(path, item.path) && item.name === fn?.name,
        );
        if (contracts.length > 1) throw new Error(`Ambiguous responsibility for ${path}:${fn?.name}`);
        const roles = [...inherited.roles, ...contracts.map((item) => item.role)];
        const reasons = [...inherited.reasons, ...contracts.map((item) => `Explicit ${item.role} function contract`)];
        const calls = evidence?.calls.filter((call) => call.functionId === functionId) ?? [];
        const outgoing = graph.get(unitId(path, functionId))?.size ?? 0;
        const leaf = evidence?.coverage.complete && fn?.hasBody && !calls.length;
        if (outgoing) {
            roles.push('intermediate');
            reasons.push('Resolved outgoing project call edges');
        } else if (leaf) {
            roles.push('leaf');
            reasons.push('Complete syntax with no outgoing calls; purity is not required');
        } else {
            reasons.push('Unresolved calls or incomplete syntax prevent leaf relaxation');
        }
        const valid = roles.filter((role) => role !== 'leaf' || leaf);
        return context(
            valid,
            [...inherited.evidenceIds, unitId(path, functionId), ...calls.map((call) => unitId(path, call.id))],
            reasons,
        );
    };
}
