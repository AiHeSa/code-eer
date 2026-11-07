import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollectedFile } from './project.js';
import type { Dependency } from './semantics.js';
import type { Range } from '../ast/schema.js';

function owned(uri: string, root: string): string | null {
    if (!uri.startsWith('file:')) return null;
    const path = relative(root, fileURLToPath(uri)).split('\\').join('/');
    return path && !path.startsWith('..') && !/(^|\/)(\.cache|node_modules|target|build)(\/|$)/.test(path)
        ? path
        : null;
}

const within = (inner: Range, outer: Range) =>
    inner.start.line >= outer.start.line &&
    inner.end.line <= outer.end.line &&
    (inner.start.line !== outer.start.line || inner.start.character >= outer.start.character) &&
    (inner.end.line !== outer.end.line || inner.end.character <= outer.end.character);

export function nativeDependencies(file: CollectedFile, root: string): Dependency[] {
    const output = new Map<string, Dependency>(),
        own = owned(file.uri, root),
        semantic = file.semantic;
    for (const [index, ref] of (semantic?.references ?? []).entries()) {
        const target = ref.definition ? owned(ref.definition.uri, root) : null;
        if (target && target !== own && !output.has(target))
            output.set(target, {
                id: `semantic-dependency:${index}`,
                range: ref.range,
                source: target,
                targetPath: target,
            });
    }
    for (const item of file.evidence.imports) {
        const info = semantic?.imports?.find((entry) => entry.source === item.source.replace(/\.\*$/, ''));
        const refs = semantic?.references.filter((ref) => within(ref.range, item.range)) ?? [];
        const uris = info?.uris ?? refs.flatMap((ref) => (ref.definition ? [ref.definition.uri] : []));
        const targets = [...new Set(uris.flatMap((uri) => owned(uri, root) ?? []))].filter((target) => target !== own);
        const resolved = info?.resolved ?? Boolean(refs.length && refs.every((ref) => ref.definition !== null));
        if (resolved && targets.length)
            for (const target of targets) {
                if (!output.has(target))
                    output.set(target, {
                        id: `${item.id}:${target}`,
                        range: item.range,
                        source: item.source,
                        targetPath: target,
                    });
            }
        else if (!targets.length)
            output.set(item.id, {
                id: item.id,
                range: item.range,
                source: item.source,
                verifiedExternal: resolved && semantic?.status !== 'failed',
            });
        else if (!resolved) output.set(item.id, { id: item.id, range: item.range, source: item.source });
    }
    return [...output.values()];
}
