import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const inside = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });

if (inside.status === 0) {
    const root = inside.stdout.trim();
    const existing = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
        cwd: root,
        encoding: 'utf8',
    }).stdout.trim();
    if (existing && resolve(root, existing) !== resolve(root, '.githooks'))
        throw new Error(`Existing core.hooksPath requires hook integration: ${existing}`);
    chmodSync(resolve(root, '.githooks/pre-commit'), 0o755);
    const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
        cwd: root,
        encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    console.log('Installed repository pre-commit inheritance check.');
}
