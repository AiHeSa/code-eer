import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { VERSION, fileSchema, type Fact, type FileResult, type Language, type Range } from './schema.js';
import { coverageFor, syntaxFor } from './coverage.js';
import type { RawNode, RawResult } from './raw.js';

export function rangeAt(
    source: string,
    start: number | null,
    end: number | null,
    encoding: 'utf8' | 'utf16' = 'utf16',
): Range | null {
    if (start === null || end === null) return null;
    const size = encoding === 'utf8' ? Buffer.byteLength(source) : source.length;
    if (start > end || end > size) throw new Error('Parser returned an invalid source range');
    const point = (offset: number) => {
        const prefix =
            encoding === 'utf8'
                ? new TextDecoder('utf8', { fatal: true }).decode(Buffer.from(source).subarray(0, offset))
                : source.slice(0, offset);
        const lines = prefix.split(/\r\n|\r|\n/);
        return { line: lines.length - 1, character: lines.at(-1)!.length };
    };
    return { start: point(start), end: point(end) };
}

function normalizeNode(node: RawNode, index: number, source: string, language: Language, raw: RawResult): Fact {
    const base = {
        id: node.id,
        type: node.type,
        name: node.name,
        parentId: node.parent,
        role: node.role,
        order: index,
        range: rangeAt(source, node.start, node.end, raw.encoding),
        origin: { backend: language, nativeType: node.nativeType, adapterVersion: VERSION as typeof VERSION },
        extensions: { [raw.framework ?? language]: node.data },
    };
    if (['function', 'method', 'constructor'].includes(node.type))
        return {
            ...base,
            type: node.type as 'function' | 'method' | 'constructor',
            parameters: node.parameters,
            returns: node.returns,
            async: node.async,
            bodyRange: rangeAt(source, node.bodyStart, node.bodyEnd, raw.encoding),
        };
    return { ...base, type: node.type as Exclude<Fact['type'], 'function' | 'method' | 'constructor'> };
}

function references(fact: Fact): string[] {
    return Object.values(fact.extensions).flatMap((data) =>
        data && 'declarationId' in data && typeof data.declarationId === 'string' ? [data.declarationId] : [],
    );
}

export function validateHierarchy(facts: Fact[]): void {
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    if (byId.size !== facts.length) throw new Error('Duplicate fact identifiers');
    for (const fact of facts) {
        if (references(fact).some((id) => !byId.has(id))) throw new Error('Missing declaration reference');
        const visited = new Set([fact.id]);
        let parent = fact.parentId;
        while (parent !== null) {
            if (visited.has(parent)) throw new Error('Cyclic fact hierarchy');
            visited.add(parent);
            const entry = byId.get(parent);
            if (!entry) throw new Error(`Missing parent: ${parent}`);
            parent = entry.parentId;
        }
    }
}

export function selectFacts(facts: Fact[], types?: Fact['type'][]): Fact[] {
    if (!types) return facts;
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    const selected = new Set<string>();
    const pending = facts.filter((fact) => types.includes(fact.type)).map((fact) => fact.id);
    while (pending.length) {
        const id = pending.pop()!;
        if (selected.has(id)) continue;
        const fact = byId.get(id);
        if (!fact) throw new Error(`Missing referenced fact: ${id}`);
        selected.add(id);
        pending.push(...references(fact));
        if (fact.parentId !== null) pending.push(fact.parentId);
    }
    return facts.filter((fact) => selected.has(fact.id));
}

export function normalize(path: string, source: string, language: Language, raw: RawResult): FileResult {
    const facts = raw.nodes.map((node, index) => normalizeNode(node, index, source, language, raw));
    validateHierarchy(facts);
    return fileSchema.parse({
        uri: pathToFileURL(path).href,
        language,
        framework: raw.framework,
        digest: createHash('sha256').update(source).digest('hex'),
        facts,
        coverage: coverageFor(language, raw.framework),
        syntax: raw.syntax ?? syntaxFor(language, raw.version),
        diagnostics: raw.diagnostics
            .map((item) => ({
                ...item,
                source: language,
                severity: 'error',
                range: rangeAt(source, item.start, item.end, raw.encoding),
                start: undefined,
                end: undefined,
            }))
            .map(({ message, code, source: origin, severity, range }) => ({
                message,
                code,
                source: origin,
                severity,
                range,
            })),
        executed: raw.framework ? ['syntax', 'structure', 'framework'] : ['syntax', 'structure'],
        skipped: [
            ...raw.skipped,
            ...(!raw.structureComplete
                ? [{ code: 'STRUCTURE_INCOMPLETE', message: 'Syntax errors limit structural extraction' }]
                : []),
        ].map((item) => ({ ...item, range: null })),
        errors: [],
    });
}
