import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
function run(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
}
function git(root, args) {
  const result = run(root, args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'code-eer-hook-'));
  try {
    for (const path of ['scripts/capabilities', 'services/code-review/internal/capabilities', '.githooks', 'config'])
      await cp(join(repository, path), join(root, path), { recursive: true });
    for (const path of ['scripts/check-inheritance.mjs', 'scripts/install-hooks.mjs'])
      await cp(join(repository, path), join(root, path));
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, '.gitignore'), 'node_modules/\n');
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2023',
      module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'], rootDir: '.' }, include: ['rules/**/*.ts'] }));
    await mkdir(join(root, 'rules'));
    await writeFile(join(root, 'rules/review.ts'), 'import { defineCapability } from "../services/code-review/internal/capabilities/contract.js"; export default defineCapability({ parse: (source: string) => source.length, count: () => 1 });');
    await writeFile(join(root, 'rules/review.java.ts'), 'import common from "./review.js"; export default common.specialize({ parse: (source: string) => source.length + 1 });');
    git(root, ['init', '--quiet']);
    const installed = spawnSync(process.execPath, ['scripts/install-hooks.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    git(root, ['add', '.']);
    await callback(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('real pre-commit reads the index, preserves staging and rejects extra staged entries', async () => {
  await fixture(async (root) => {
    const path = join(root, 'rules/review.java.ts');
    const valid = await readFile(path, 'utf8');
    const invalid = valid.replace('parse:', 'unexpected:');
    await writeFile(path, invalid);
    git(root, ['commit', '--quiet', '-m', 'valid staged specialization']);
    assert.ok(git(root, ['status', '--short']).includes(' M rules/review.java.ts'));
    git(root, ['add', 'rules/review.java.ts']);
    await writeFile(path, valid);
    const index = git(root, ['write-tree']);
    const head = git(root, ['rev-parse', 'HEAD']);
    const result = run(root, ['commit', '--quiet', '-m', 'invalid staged specialization']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /unknown common entries: unexpected/);
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.equal(git(root, ['write-tree']), index);
  });
});

test('pre-commit rejects incompatible signatures even when the working tree contains a correction', async () => {
  await fixture(async (root) => {
    git(root, ['commit', '--quiet', '-m', 'valid common contract']);
    const path = join(root, 'rules/review.java.ts');
    const valid = await readFile(path, 'utf8');
    await writeFile(path, valid.replace('(source: string) => source.length + 1', '(source: number) => source'));
    git(root, ['add', 'rules/review.java.ts']);
    await writeFile(path, valid);
    const result = run(root, ['commit', '--quiet', '-m', 'invalid method signature']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /not assignable/);
  });
});

test('pre-commit validates deleted common files and staged target configuration', async () => {
  await fixture(async (root) => {
    git(root, ['commit', '--quiet', '-m', 'initial contract']);
    git(root, ['rm', 'rules/review.ts']);
    let result = run(root, ['commit', '--quiet', '-m', 'delete common']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /missing common capability/);
    git(root, ['restore', '--source=HEAD', '--staged', '--worktree', 'rules/review.ts']);
    await writeFile(join(root, 'config/capability-targets.json'), '{"languages":["go"],"frameworks":[]}');
    git(root, ['add', 'config/capability-targets.json']);
    result = run(root, ['commit', '--quiet', '-m', 'remove target']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /unregistered capability target java/);
  });
});

test('pre-commit typechecks JavaScript capability families outside project include patterns', async () => {
  await fixture(async (root) => {
    await mkdir(join(root, 'extras'));
    await writeFile(join(root, 'extras/review.js'), 'import { defineCapability } from "../services/code-review/internal/capabilities/contract.js";\nexport default defineCapability({\n/** @param {string} source */\nparse(source) { return source.length; }\n});');
    const path = join(root, 'extras/review.java.js');
    const valid = 'import common from "./review.js";\nexport default common.specialize({\n/** @param {string} source */\nparse(source) { return source.length; }\n});';
    await writeFile(path, valid);
    git(root, ['add', 'extras']);
    git(root, ['commit', '--quiet', '-m', 'JavaScript specialization']);
    await writeFile(path, valid.replace('@param {string}', '@param {number}').replace('source.length', 'source'));
    git(root, ['add', 'extras']);
    const result = run(root, ['commit', '--quiet', '-m', 'incompatible JavaScript signature']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /not assignable/);
  });
});
