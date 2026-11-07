import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './root.js';
import { LspClient, object, type LspCommand } from './lsp-client.js';

const root = repositoryRoot(),
    toolchains = join(root, '.cache/toolchains');
const sessions = new Map<string, Promise<{ client: LspClient; version: string }>>();

function cargoRoot(path: string, boundary: string): string {
    let directory = dirname(path);
    while (directory.startsWith(boundary)) {
        if (existsSync(join(directory, 'Cargo.toml'))) return directory;
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    return boundary;
}

export function semanticServerAvailable(language: 'python' | 'rust'): boolean {
    return existsSync(
        language === 'python'
            ? join(root, 'node_modules/pyright/dist/pyright-langserver.js')
            : join(toolchains, 'cargo/bin/rust-analyzer'),
    );
}

function command(language: 'python' | 'rust'): LspCommand {
    if (language === 'python')
        return {
            command: process.execPath,
            args: [join(root, 'node_modules/pyright/dist/pyright-langserver.js'), '--stdio'],
        };
    return {
        command: join(toolchains, 'cargo/bin/rust-analyzer'),
        args: [],
        env: {
            ...process.env,
            CARGO_HOME: process.env['CARGO_HOME'] ?? join(toolchains, 'cargo'),
            RUSTUP_HOME: process.env['RUSTUP_HOME'] ?? join(toolchains, 'rustup'),
            PATH: [join(toolchains, 'cargo/bin'), process.env['PATH']].filter(Boolean).join(delimiter),
            CARGO_NET_OFFLINE: 'true',
            CARGO_BUILD_TARGET_DIR: join(root, '.cache/semantic-rust-target'),
        },
    };
}

async function start(language: 'python' | 'rust', workspace: string, path: string) {
    const installed = join(toolchains, 'rustup/toolchains');
    const toolchain =
        language === 'rust' && existsSync(installed)
            ? readdirSync(installed)
                  .map((name) => join(installed, name))
                  .find((path) => existsSync(join(path, 'bin/rustc')))
            : undefined;
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
    const client = new LspClient(command(language), settings);
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
