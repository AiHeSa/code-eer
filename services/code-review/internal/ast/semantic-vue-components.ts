import { parse } from '@vue/compiler-sfc';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { included, readSource } from './paths.js';
import type { AnalyzeParams } from './protocol.js';
import type { SemanticLocation } from './semantic-schema.js';
import type { SetupBindings } from './semantic-vue-setup.js';
import { sourceLocator } from './tree.js';

async function sfcDefinition(path: string, specifier: string, params: AnalyzeParams): Promise<SemanticLocation | null> {
    try {
        const input = await readSource(params.root, resolve(dirname(path), specifier));
        if (!input.path.endsWith('.vue') || !included(relative(params.root, input.path), params)) return null;
        if (parse(input.source, { filename: input.path }).errors.length) return null;
        return { uri: pathToFileURL(input.path).href, range: sourceLocator(input.source)(0, input.source.length) };
    } catch {
        return null;
    }
}

export async function resolveSetupComponents(path: string, params: AnalyzeParams, setup: SetupBindings): Promise<void> {
    const definitions = new Map<string, Promise<SemanticLocation | null>>();
    for (const binding of setup.values()) {
        const source = binding.defaultSource;
        if (!source || !/^(?:\.\.?\/).+\.vue$/.test(source)) continue;
        if (!definitions.has(source)) definitions.set(source, sfcDefinition(path, source, params));
        binding.componentDefinition = await definitions.get(source)!;
    }
}
