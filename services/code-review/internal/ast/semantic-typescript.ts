import { API, SymbolFlags, type Project, type Symbol as TSymbol } from 'typescript/async';
import * as ts from 'typescript/ast';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safePath } from './paths.js';
import type { AnalyzeParams } from './protocol.js';
import { semanticId, type SemanticResult, type SemanticLocation } from './semantic-schema.js';
import { sourceLocator } from './tree.js';
import { serverFS, createFileSystemLayer } from 'typescript/fs';
import { existsSync } from 'node:fs';

async function definition(symbol: TSymbol, project: Project): Promise<SemanticLocation | null> {
    if (symbol.flags & SymbolFlags.Alias) symbol = await project.checker.getAliasedSymbol(symbol);
    const declaration = await (symbol.valueDeclaration ?? symbol.declarations[0])?.resolve(project);
    if (!declaration) return null;
    const file = declaration.getSourceFile(),
        name = 'name' in declaration ? (declaration.name as ts.Node | undefined) : undefined;
    const node = name && typeof name.getStart === 'function' ? name : declaration;
    return { uri: pathToFileURL(file.fileName).href, range: sourceLocator(file.text)(node.getStart(file), node.end) };
}

async function query(project: Project, path: string): Promise<SemanticResult> {
    const file = await project.program.getSourceFile(path);
    if (!file) throw new Error(`Semantic compiler did not load ${path}`);
    const nodes: ts.Identifier[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) nodes.push(node);
        node.forEachChild(walk);
    };
    walk(file);
    const [symbols, types, diagnostics] = await Promise.all([
        project.checker.getSymbolAtLocation(nodes),
        project.checker.getTypeAtLocation(nodes),
        project.program.getSemanticDiagnostics(path),
    ]);
    const result: SemanticResult = {
        provider: 'typescript/Checker',
        version: '7.1.0-beta',
        status: diagnostics.some((item) => item.category === 1) ? 'partial' : 'complete',
        symbols: [],
        references: [],
        diagnostics: diagnostics.map((item) => ({
            message: item.text,
            severity: item.category === 1 ? 'error' : 'warning',
            range: item.pos >= 0 ? sourceLocator(file.text)(item.pos, item.end) : null,
        })),
        limitations: [],
    };
    const definitions = new Map<number, Promise<SemanticLocation | null>>(),
        typeNames = new Map<number, Promise<string>>(),
        locate = sourceLocator(file.text);
    for (const [index, node] of nodes.entries()) {
        const symbol = symbols[index],
            type = types[index]!;
        if (symbol && !definitions.has(symbol.id)) definitions.set(symbol.id, definition(symbol, project));
        if (!typeNames.has(type.id)) typeNames.set(type.id, project.checker.typeToString(type));
        const target = symbol ? await definitions.get(symbol.id)! : null,
            range = locate(node.getStart(file), node.end);
        const own = Boolean(
            target?.uri === pathToFileURL(path).href &&
            target.range.start.line === range.start.line &&
            target.range.start.character === range.start.character,
        );
        const text = type.isErrorType() ? null : await typeNames.get(type.id)!;
        result.references.push({
            name: node.text,
            range,
            declaration: own,
            definition: target,
            targetId: target ? semanticId(target) : null,
            type: text,
        });
        if (own && target)
            result.symbols.push({
                id: semanticId(target),
                name: node.text,
                kind: 'compiler-symbol',
                range,
                definition: target,
                type: text,
            });
    }
    return result;
}

export async function typescriptSemantics(path: string, params: AnalyzeParams): Promise<SemanticResult> {
    const session = await createTypescriptSession(params, [path]);
    try {
        return await session.query(path);
    } finally {
        await session.close();
    }
}

export async function createTypescriptSession(
    params: AnalyzeParams,
    paths: string[],
    virtual: [string, string][] = [],
) {
    const api = new API({
        cwd: params.root,
        fs: {
            readFile: serverFS.useOS,
            fileExists: serverFS.useOS,
            directoryExists: serverFS.useOS,
            getAccessibleEntries: serverFS.useOS,
            realpath: serverFS.useOS,
            stat: serverFS.useOS,
            writeFile: serverFS.noop,
            removeFile: serverFS.noop,
        },
    });
    const configPath =
        params.config.tsconfig ?? (existsSync(resolve(params.root, 'tsconfig.json')) ? 'tsconfig.json' : undefined);
    const config = configPath
        ? await api.parseConfigFile(await safePath(params.root, resolve(params.root, configPath)))
        : null;
    const snapshot = await api.createSnapshot({
        ...(virtual.length ? { fileSystem: createFileSystemLayer(virtual) } : {}),
        createPrograms: [
            {
                rootFiles: config ? [...new Set([...config.fileNames, ...paths])] : paths,
                compilerOptions: { ...config?.options, allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true },
            },
        ],
    });
    const project = snapshot.getProject(snapshot.operation.createdPrograms[0].id)!;
    return {
        query: (path: string) => query(project, path),
        includes: async (path: string) => Boolean(await project.program.getSourceFile(path)),
        close: async () => {
            await snapshot.dispose();
            await api.close();
        },
    };
}
