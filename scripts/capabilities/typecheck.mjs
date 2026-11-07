import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSnapshot } from './repository.mjs';

export async function typecheckSnapshot(root, files, roots) {
    const directory = await mkdtemp(join(tmpdir(), 'code-eer-inheritance-'));
    try {
        await writeSnapshot(directory, files);
        await symlink(
            join(root, 'node_modules'),
            join(directory, 'node_modules'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        await writeFile(
            join(directory, '.capability-check.json'),
            JSON.stringify({
                extends: './tsconfig.json',
                files: roots,
                compilerOptions: { allowJs: true, checkJs: true, noEmit: true },
            }),
        );
        const result = spawnSync(
            process.execPath,
            [join(root, 'node_modules/typescript/bin/tsc'), '--project', join(directory, '.capability-check.json')],
            { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        );
        if (result.status !== 0) throw new Error(result.stdout + result.stderr || String(result.error));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
