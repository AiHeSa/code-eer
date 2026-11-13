import { parse, type SFCBlock } from '@vue/compiler-sfc';
import { pathToFileURL } from 'node:url';
import { createTypescriptSession } from './semantic-typescript.js';
import { sourceLocator } from './tree.js';
import { semanticId, type SemanticResult, type SemanticLocation } from './semantic-schema.js';
import type { AnalyzeParams } from './protocol.js';
import type { Range } from './schema.js';
import { setupBindings, type SetupBindings } from './semantic-vue-setup.js';
import { analyzeVueTemplate } from './semantic-vue-template.js';
import { resolveSetupComponents } from './semantic-vue-components.js';
import { tsVersion } from '../../ast/js-ts/parser.js';

function projectBlock(path: string, source: string, virtual: string, block: SFCBlock) {
    const lines = [0];
    for (const match of block.content.matchAll(/\r\n|\r|\n/g)) lines.push(match.index + match[0].length);
    const locate = sourceLocator(source);
    const uri = pathToFileURL(path).href;
    const virtualUri = pathToFileURL(virtual).href;
    const offset = (point: Range['start']) => block.loc.start.offset + lines[point.line]! + point.character;
    const range = (value: Range) => locate(offset(value.start), offset(value.end));
    const location = (value: SemanticLocation | null) =>
        value?.uri === virtualUri ? { uri, range: range(value.range) } : value;
    return { uri, range, location };
}

function appendScript(result: SemanticResult, part: SemanticResult, projection: ReturnType<typeof projectBlock>) {
    const { location, range } = projection;
    for (const item of part.references) {
        const definition = location(item.definition);
        result.references.push({
            ...item,
            range: range(item.range),
            definition,
            targetId: definition ? semanticId(definition) : null,
        });
    }
    for (const item of part.symbols) {
        const definition = location(item.definition)!;
        result.symbols.push({ ...item, id: semanticId(definition), range: range(item.range), definition });
    }
    for (const item of part.diagnostics)
        result.diagnostics.push({ ...item, range: item.range ? range(item.range) : null });
    if (part.status !== 'complete') result.status = 'partial';
}

async function queryScript(
    path: string,
    source: string,
    params: AnalyzeParams,
    block: SFCBlock,
    isSetup: boolean,
    result: SemanticResult,
) {
    const virtual = `${path}.script-${block.loc.start.offset}.${block.lang ?? 'js'}`;
    const projection = projectBlock(path, source, virtual, block);
    let setup: SetupBindings = new Map();
    const session = await createTypescriptSession(params, [virtual], [[virtual, block.content]]);
    try {
        const part = await session.query(virtual, undefined, (file, evidence) => {
            if (isSetup) setup = setupBindings(file, evidence.references, pathToFileURL(virtual).href);
        });
        appendScript(result, part, projection);
        for (const binding of setup.values()) {
            binding.definition = projection.location(binding.definition);
            binding.componentDefinition = projection.location(binding.componentDefinition);
        }
        return setup;
    } finally {
        await session.close();
    }
}

export async function vueSemantics(path: string, source: string, params: AnalyzeParams): Promise<SemanticResult> {
    const { descriptor, errors } = parse(source, { filename: path });
    const result: SemanticResult = {
        provider: 'typescript/Checker+vue-sfc',
        version: tsVersion,
        status: errors.length ? 'partial' : 'complete',
        symbols: [],
        references: [],
        diagnostics: [],
        limitations: [
            'Template types on setup bindings describe the script declaration; Vue ref unwrapping and local template types are not inferred',
            'Options API instance bindings, compiler macros, registered component types and cross-SFC Props are outside template coverage',
        ],
    };
    let setup: SetupBindings = new Map();
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (!block) continue;
        if (block.src || (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang))) {
            result.status = 'partial';
            result.limitations.push('External or unsupported script block was not queried');
            continue;
        }
        const bindings = await queryScript(path, source, params, block, block === descriptor.scriptSetup, result);
        if (block === descriptor.scriptSetup) setup = bindings;
    }
    const template = descriptor.template;
    if (template && !template.src && (!template.lang || template.lang === 'html')) {
        await resolveSetupComponents(path, params, setup);
        const analysis = analyzeVueTemplate(
            template.content,
            template.loc.start.offset,
            source,
            pathToFileURL(path).href,
            setup,
        );
        result.framework = analysis.result;
        if (analysis.incomplete) {
            result.status = 'partial';
            result.limitations.push(
                'Template contains unresolved bindings, components or expressions without exact ranges',
            );
        }
    } else if (template) {
        result.status = 'partial';
        result.limitations.push('External or unsupported template block was not queried');
    }
    return result;
}
