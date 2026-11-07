import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from './root.js';
import { createTypescriptSession, typescriptSemantics } from './semantic-typescript.js';
import { nativeSemantics } from './semantic-native.js';
import { lspSemantics } from './semantic-lsp.js';
import { semanticServerAvailable, closeLanguageServers } from './lsp-server.js';
import type { AnalyzeParams } from './protocol.js';
import type { FileResult, Language } from './schema.js';
import { semanticSchema } from './semantic-schema.js';
import { vueSemantics } from './semantic-vue.js';

let typescript: Awaited<ReturnType<typeof createTypescriptSession>> | undefined;

export function semanticAvailable(language: Language): boolean {
    if (language === 'js-ts') return true;
    if (language === 'python' || language === 'rust') return semanticServerAvailable(language);
    return existsSync(
        join(
            repositoryRoot(),
            language === 'java' ? 'services/code-review/ast/java/build/eer/SemanticMain.class' : '.cache/bin/go-ast',
        ),
    );
}

export async function prepareSemantics(language: Language, params: AnalyzeParams, paths: string[]): Promise<void> {
    if (language === 'js-ts' && params.capabilities.some((item) => item === 'symbols' || item === 'types'))
        if (paths.some((path) => !path.endsWith('.vue')))
            typescript = await createTypescriptSession(
                params,
                paths.filter((path) => !path.endsWith('.vue')),
            );
}

export async function closeSemantics(): Promise<void> {
    const current = typescript;
    typescript = undefined;
    await current?.close();
    await closeLanguageServers();
}

export async function addSemantics(
    file: FileResult,
    path: string,
    source: string,
    params: AnalyzeParams,
): Promise<void> {
    if (!params.capabilities.some((item) => item === 'symbols' || item === 'types')) return;
    try {
        const result =
            file.language === 'js-ts'
                ? path.endsWith('.vue')
                    ? await vueSemantics(path, source, params)
                    : await (typescript && (await typescript.includes(path))
                          ? typescript.query(path)
                          : typescriptSemantics(path, params))
                : file.language === 'java' || file.language === 'go'
                  ? await nativeSemantics(file.language, path, source, params)
                  : await lspSemantics(file.language, path, source, params.root);
        file.semantic = semanticSchema.parse(result);
        if (file.diagnostics.some((item) => item.severity === 'error') && result.status !== 'failed') {
            file.semantic.status = 'partial';
            file.semantic.diagnostics.push(
                ...file.diagnostics.map(({ message, severity, range }) => ({ message, severity, range })),
            );
        }
        if (result.status !== 'failed') file.executed.push('symbols', 'types');
        if (file.semantic.status !== 'complete')
            file.skipped.push({
                code: 'SEMANTIC_INCOMPLETE',
                message: 'Compiler diagnostics or unavailable project dependencies limit semantic results',
                range: null,
            });
    } catch (error) {
        file.semantic = {
            provider: file.language,
            version: 'unavailable',
            status: 'failed',
            symbols: [],
            references: [],
            diagnostics: [{ message: String(error), severity: 'error', range: null }],
            limitations: [],
        };
        file.skipped.push({ code: 'SEMANTIC_ERROR', message: String(error), range: null });
    }
}
