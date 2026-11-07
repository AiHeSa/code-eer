import { parse, version, type SFCBlock } from '@vue/compiler-sfc';
import { dirname, extname, relative, resolve } from 'node:path';
import { readSource, included } from '../../internal/ast/paths.js';
import { normalize } from '../../internal/ast/normalize.js';
import type { FileResult } from '../../internal/ast/schema.js';
import { ProtocolError, type AnalyzeParams } from '../../internal/ast/protocol.js';
import type { ParsedResult, RawResult } from '../../internal/ast/raw.js';
import { parseScript, tsVersion } from './parser.js';
import { syntaxFor } from '../../internal/ast/coverage.js';
import { mergeScript, vueNode } from './vue-merge.js';
import { parseTemplate } from './vue-template.js';

function emptyResult(): RawResult {
    return {
        version,
        runtime: process.version,
        encoding: 'utf16',
        framework: 'vue',
        syntax: syntaxFor('js-ts', tsVersion),
        nodes: [],
        diagnostics: [],
        skipped: [],
        structureComplete: true,
    };
}

async function externalBlock(block: SFCBlock, path: string, params: AnalyzeParams): Promise<FileResult> {
    const input = await readSource(params.root, resolve(dirname(path), block.src!));
    if (!included(relative(params.root, input.path), params)) throw new ProtocolError('FILE_EXCLUDED', input.path);
    const result = emptyResult();
    result.nodes.push(
        vueNode('block', 'module', 'ExternalSFCBlock', block.type, 0, input.source.length, null, {
            owner: path,
            language: block.lang ?? null,
        }),
    );
    if (block.type === 'template') result.diagnostics.push(...parseTemplate(input.source, result.nodes, 'block', 0));
    else mergeScript(result, await parseScript(input.path, input.source, { ...params, framework: 'vue' }), 'block', 0);
    result.structureComplete &&= result.diagnostics.length === 0;
    return normalize(input.path, input.source, 'js-ts', result);
}

async function processBlock(
    block: SFCBlock,
    path: string,
    result: RawResult,
    relatedFiles: FileResult[],
    params: AnalyzeParams,
): Promise<void> {
    const id = `block:${result.nodes.length}`;
    const start = block.loc.start.offset;
    result.nodes.push(
        vueNode(id, 'module', 'SFCBlock', block.type, start, block.loc.end.offset, 'component', {
            language: block.lang ?? null,
            src: block.src ?? null,
            attributes: block.attrs,
        }),
    );
    if (!['script', 'template'].includes(block.type)) return;
    const supported = block.type === 'script' ? ['js', 'ts', 'jsx', 'tsx'] : ['html'];
    if (block.lang && !supported.includes(block.lang)) {
        result.skipped.push({ code: 'UNSUPPORTED_BLOCK_LANGUAGE', message: `${block.type}: ${block.lang}` });
        return;
    }
    try {
        if (block.src) {
            relatedFiles.push(await externalBlock(block, path, params));
            return;
        }
        if (block.type === 'template')
            result.diagnostics.push(...parseTemplate(block.content, result.nodes, id, start));
        else {
            const extension = block.lang ?? 'js';
            const script = await parseScript(
                `${path}.${extension}`,
                block.content,
                { ...params, framework: 'vue' },
                Boolean(block.attrs['setup']),
            );
            mergeScript(result, script, id, start);
        }
    } catch (error) {
        result.skipped.push({
            code: error instanceof ProtocolError ? error.code : 'BLOCK_ANALYSIS_FAILED',
            message: String(error),
        });
    }
}

export async function parseVue(path: string, source: string, params: AnalyzeParams): Promise<ParsedResult> {
    const result = emptyResult();
    const relatedFiles: FileResult[] = [];
    const { descriptor, errors } = parse(source, { filename: path });
    result.nodes.push(
        vueNode('component', 'component', 'SFCDescriptor', path.split('/').at(-1) ?? path, 0, source.length, null, {
            framework: 'vue',
            evidence: ['sfc'],
        }),
    );
    for (const error of errors)
        result.diagnostics.push(
            typeof error === 'string'
                ? { code: 'VUE_SFC', message: error, start: null, end: null }
                : {
                      code: 'code' in error ? `VUE${error.code}` : 'VUE_SFC',
                      message: error.message,
                      start: 'loc' in error ? (error.loc?.start.offset ?? null) : null,
                      end: 'loc' in error ? (error.loc?.end.offset ?? null) : null,
                  },
        );
    const blocks = [
        descriptor.script,
        descriptor.scriptSetup,
        descriptor.template,
        ...descriptor.styles,
        ...descriptor.customBlocks,
    ];
    for (const block of blocks) if (block) await processBlock(block, path, result, relatedFiles, params);
    result.structureComplete = result.diagnostics.length === 0;
    return { ...result, relatedFiles };
}

export async function parseJavaScript(path: string, source: string, params: AnalyzeParams): Promise<ParsedResult> {
    return extname(path) === '.vue' ? parseVue(path, source, params) : parseScript(path, source, params);
}
