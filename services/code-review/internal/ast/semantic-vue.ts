import { parse } from '@vue/compiler-sfc';
import { pathToFileURL } from 'node:url';
import { createTypescriptSession } from './semantic-typescript.js';
import { sourceLocator } from './tree.js';
import { semanticId, type SemanticResult, type SemanticLocation } from './semantic-schema.js';
import type { AnalyzeParams } from './protocol.js';
import type { Range } from './schema.js';

export async function vueSemantics(path: string, source: string, params: AnalyzeParams): Promise<SemanticResult> {
    const { descriptor, errors } = parse(source, { filename: path });
    const result: SemanticResult = {
        provider: 'typescript/Checker+vue-sfc',
        version: '7.1.0-beta',
        status: errors.length ? 'partial' : 'complete',
        symbols: [],
        references: [],
        diagnostics: [],
        limitations: [
            'Compiler queries cover inline script blocks; template/compiler-generated operations retain separate syntax evidence',
        ],
    };
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (!block) continue;
        if (block.src || (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang))) {
            result.status = 'partial';
            result.limitations.push('External/unsupported script is queried through its own source file');
            continue;
        }
        const virtual = `${path}.script-${block.loc.start.offset}.${block.lang ?? 'js'}`,
            uri = pathToFileURL(virtual).href;
        const session = await createTypescriptSession(params, [virtual], [[virtual, block.content]]);
        try {
            const part = await session.query(virtual),
                lines = [0],
                locate = sourceLocator(source);
            for (const match of block.content.matchAll(/\r\n|\r|\n/g)) lines.push(match.index + match[0].length);
            const range = (value: Range) =>
                locate(
                    block.loc.start.offset + lines[value.start.line]! + value.start.character,
                    block.loc.start.offset + lines[value.end.line]! + value.end.character,
                );
            const location = (value: SemanticLocation | null) =>
                value?.uri === uri ? { uri: pathToFileURL(path).href, range: range(value.range) } : value;
            result.references.push(
                ...part.references.map((item) => {
                    const definition = location(item.definition);
                    return {
                        ...item,
                        range: range(item.range),
                        definition,
                        targetId: definition ? semanticId(definition) : null,
                    };
                }),
            );
            result.symbols.push(
                ...part.symbols.map((item) => {
                    const definition = location(item.definition)!;
                    return { ...item, id: semanticId(definition), range: range(item.range), definition };
                }),
            );
            result.diagnostics.push(
                ...part.diagnostics.map((item) => ({ ...item, range: item.range ? range(item.range) : null })),
            );
            if (part.status !== 'complete') result.status = 'partial';
        } finally {
            await session.close();
        }
    }
    return result;
}
