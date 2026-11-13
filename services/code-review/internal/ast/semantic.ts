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

type TypeScriptSession = Awaited<ReturnType<typeof createTypescriptSession>>;
let typescript: { session: TypeScriptSession } | { error: unknown } | undefined;

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
    if (language !== 'js-ts' || !params.capabilities.some((item) => item === 'symbols' || item === 'types')) return;
    const scripts = paths.filter((path) => !path.endsWith('.vue'));
    if (!scripts.length) return;
    try {
        typescript = { session: await createTypescriptSession(params, scripts) };
    } catch (error) {
        typescript = { error };
    }
}

export async function closeSemantics(): Promise<void> {
    const current = typescript;
    typescript = undefined;
    if (current && 'session' in current) await current.session.close();
    await closeLanguageServers();
}

async function queryTypeScript(file: FileResult, path: string, source: string, params: AnalyzeParams) {
    if (path.endsWith('.vue')) return vueSemantics(path, source, params);
    if (typescript && 'error' in typescript) throw typescript.error;
    const session = typescript?.session;
    return session && (await session.includes(path))
        ? session.query(path, file.framework)
        : typescriptSemantics(path, params, file.framework);
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
                ? await queryTypeScript(file, path, source, params)
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
