import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './root.js';
import { LspClient, object, type LspCommand } from './lsp-client.js';
import { rustAnalyzerAvailable, rustAnalyzerCommand, rustSysroot } from './rust-toolchain.js';

const root = repositoryRoot(),
    toolchains = join(root, '.cache/toolchains');
const sessions = new Map<string, Promise<{ client: LspClient; version: string }>>();

function cargoRoot(path: string, boundary: string): string {
    let directory = dirname(path);
    while (true) {
        const rel = relative(boundary, directory);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) break;
        if (existsSync(join(directory, 'Cargo.toml'))) return directory;
        if (!rel) break;
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    return boundary;
}

export function semanticServerAvailable(language: 'python' | 'rust'): boolean {
    return language === 'python'
        ? existsSync(join(root, 'node_modules/pyright/dist/pyright-langserver.js'))
        : rustAnalyzerAvailable();
}

function command(language: 'python' | 'rust'): LspCommand {
    if (language === 'python')
        return {
            command: process.execPath,
            args: [join(root, 'node_modules/pyright/dist/pyright-langserver.js'), '--stdio'],
        };
    return rustAnalyzerCommand();
}

async function start(language: 'python' | 'rust', workspace: string, path: string) {
    const server = command(language);
    const toolchain = language === 'rust' ? rustSysroot(server) : undefined;
    const detachedRoot = existsSync(join(workspace, 'lib.rs')) ? join(workspace, 'lib.rs') : path;
    const linkedProjects = existsSync(join(workspace, 'Cargo.toml'))
        ? [join(workspace, 'Cargo.toml')]
        : [
              {
                  sysroot: toolchain,
                  sysroot_src: toolchain ? join(toolchain, 'lib/rustlib/src/rust/library') : undefined,
                  crates: [
                      {
                          root_module: detachedRoot,
                          edition: '2024',
                          deps: [],
                          cfg: [],
                          env: {},
                          is_workspace_member: true,
                      },
                  ],
              },
          ];
    const rust = {
        cargo: { buildScripts: { enable: false }, offline: true },
        procMacro: { enable: false },
        checkOnSave: false,
        check: { enable: false },
        cachePriming: { enable: false },
        linkedProjects,
    };
    const python = {
        pythonPath: process.env['CODE_EER_PYTHON'] ?? join(toolchains, 'python/bin/python3'),
        analysis: {
            diagnosticMode: 'openFilesOnly',
            autoSearchPaths: true,
            typeCheckingMode: 'basic',
            extraPaths: [workspace],
        },
    };
    const settings = language === 'rust' ? { 'rust-analyzer': rust } : { python };
    const client = new LspClient(server, settings);
    try {
        const response = object(
            await client.request('initialize', {
                processId: process.pid,
                rootUri: pathToFileURL(workspace).href,
                workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: 'code-eer-semantic' }],
                initializationOptions: language === 'rust' ? rust : {},
                capabilities: {
                    experimental: { serverStatusNotification: true },
                    general: { positionEncodings: ['utf-16'] },
                    workspace: { configuration: true, workspaceFolders: true },
                    textDocument: {
                        hover: { contentFormat: ['markdown', 'plaintext'] },
                        publishDiagnostics: { versionSupport: true },
                    },
                },
            }),
        );
        client.notify('initialized', {});
        client.notify('workspace/didChangeConfiguration', { settings });
        return { client, version: String(object(response['serverInfo'])['version'] ?? language) };
    } catch (error) {
        client.close();
        throw error;
    }
}

export function languageServer(language: 'python' | 'rust', root: string, path: string) {
    const workspace = language === 'rust' ? cargoRoot(path, root) : root,
        key = `${language}:${workspace}`;
    if (!sessions.has(key))
        sessions.set(
            key,
            start(language, workspace, path).catch((error) => {
                sessions.delete(key);
                throw error;
            }),
        );
    return sessions.get(key)!;
}

export async function closeLanguageServers(): Promise<void> {
    const current = [...sessions.values()];
    sessions.clear();
    for (const session of current)
        try {
            (await session).client.close();
        } catch {
            /* Initialization already failed. */
        }
}
