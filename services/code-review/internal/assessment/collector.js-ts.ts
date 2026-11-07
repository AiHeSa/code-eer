import { API } from 'typescript/async';
import { parse } from '@vue/compiler-sfc';
import { fileURLToPath } from 'node:url';
import collector from './collector.js';
import { emptyEvidence, syntaxEvidenceSchema, type SyntaxEvidence, type CollectionInput } from './model.js';
import { scriptContext } from './context.js';
import { collectDeclarations } from './declarations.js';
import { collectReferences } from './references.js';
import { collectControlFlow } from './control-flow.js';

const limitations = [
    'Lexical file-local bindings only; cross-file targets, aliases, methods and dynamic calls are unresolved',
    'Purity, escape, object aliasing, liveness, termination and memory leaks require semantic/dataflow analysis',
    'Loop structure and allocation sites do not prove asymptotic time or peak space',
    'Type-only syntax is excluded; decorators, implicit operations and runtime execution order need semantic analysis',
];

async function script(
    api: API,
    input: CollectionInput,
    path: string,
    source: string,
    offset: number,
    prefix: string,
): Promise<SyntaxEvidence> {
    await using lease = await api.createSourceFile(path, source);
    const context = scriptContext(lease.sourceFile, input.source, offset, prefix);
    collectDeclarations(context);
    collectReferences(context);
    collectControlFlow(context);
    context.output.coverage = {
        level: 'syntax',
        complete:
            input.file.diagnostics.length === 0 &&
            !input.file.errors.length &&
            !input.file.skipped.some((item) => !item.code.startsWith('SEMANTIC_')),
        limitations: [...limitations, ...context.output.coverage.limitations],
    };
    return context.output;
}

function merge(target: SyntaxEvidence, part: SyntaxEvidence): void {
    const keys = [
        'scopes',
        'functions',
        'declarations',
        'references',
        'calls',
        'loops',
        'branches',
        'exits',
        'allocations',
        'effects',
        'imports',
        'exports',
    ] as const;
    for (const key of keys) (target[key] as unknown[]).push(...part[key]);
    target.coverage.complete &&= part.coverage.complete;
    target.coverage.limitations = [...new Set([...target.coverage.limitations, ...part.coverage.limitations])];
}

async function collect(input: CollectionInput): Promise<SyntaxEvidence> {
    await using api = new API();
    const path = fileURLToPath(input.file.uri);
    if (!path.endsWith('.vue')) return syntaxEvidenceSchema.parse(await script(api, input, path, input.source, 0, ''));
    const result = emptyEvidence();
    result.coverage = {
        level: 'syntax',
        complete:
            !input.file.diagnostics.length &&
            !input.file.errors.length &&
            !input.file.skipped.some((item) => !item.code.startsWith('SEMANTIC_')),
        limitations: [...limitations, 'Vue blocks have independent lexical scopes; template bindings are unresolved'],
    };
    const { descriptor, errors } = parse(input.source, { filename: path });
    result.coverage.complete &&= errors.length === 0;
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (!block) continue;
        if (block.src || (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang))) {
            result.coverage.complete = false;
            result.coverage.limitations.push('External/unsupported Vue scripts are not collected in the owning SFC');
            continue;
        }
        merge(
            result,
            await script(
                api,
                input,
                `${path}.${block.lang ?? 'js'}`,
                block.content,
                block.loc.start.offset,
                `script:${block.loc.start.offset}:`,
            ),
        );
    }
    return syntaxEvidenceSchema.parse(result);
}

export default collector.specialize({ collect });
