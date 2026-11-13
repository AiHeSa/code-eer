import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { repositoryRoot } from './root.js';
import type { LspCommand } from './lsp-client.js';

export function rustAnalyzerCommand(): LspCommand {
    const root = repositoryRoot();
    const cargo = join(root, '.cache/toolchains/cargo');
    const rustup = join(root, '.cache/toolchains/rustup');
    const local = join(cargo, 'bin/rust-analyzer');

    return {
        command: process.env['CODE_EER_RUST_ANALYZER'] ?? (existsSync(local) ? local : 'rust-analyzer'),
        args: [],
        env: {
            ...process.env,
            ...(existsSync(cargo) ? { CARGO_HOME: process.env['CARGO_HOME'] ?? cargo } : {}),
            ...(existsSync(rustup) ? { RUSTUP_HOME: process.env['RUSTUP_HOME'] ?? rustup } : {}),
            PATH: [join(cargo, 'bin'), process.env['PATH']].filter(Boolean).join(delimiter),
            CARGO_NET_OFFLINE: 'true',
            CARGO_BUILD_TARGET_DIR: join(root, '.cache/semantic-rust-target'),
        },
    };
}

export function rustAnalyzerAvailable(): boolean {
    const { command, env } = rustAnalyzerCommand();
    return spawnSync(command, ['--version'], { env, timeout: 5000, stdio: 'ignore' }).status === 0;
}

export function rustSysroot(command: LspCommand): string | undefined {
    const result = spawnSync('rustc', ['--print', 'sysroot'], { env: command.env, timeout: 5000, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}
