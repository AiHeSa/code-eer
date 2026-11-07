import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = join(repository, 'scripts/prompts.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('CLI previews, applies and uninstalls from another cwd without changing repository AGENTS', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eer-cli-')); t.after(() => rm(root, { recursive: true, force: true }));
  const args = ['install', '--harness', 'dsh', '--targets', 'ts,react', '--project', root];
  const preview = run(...args); assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).applied, false); assert.deepEqual(await readdir(root), []);
  const installed = run(...args, '--apply'); assert.equal(installed.status, 0, installed.stderr);
  await access(join(root, '.agents/skills/eer-check/SKILL.md'));
  const repeated = run(...args, '--apply'); assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).changes, []);
  const uninstalled = run('uninstall', '--project', root, '--apply'); assert.equal(uninstalled.status, 0, uninstalled.stderr);
  await assert.rejects(access(join(root, 'AGENTS.md')), { code: 'ENOENT' });
});

test('build output is self-contained and refuses an existing directory; invalid CLI options do not write', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eer-build-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'bundle');
  const build = run('build', '--harness', 'codex', '--targets', 'ts,react', '--output', output);
  assert.equal(build.status, 0, build.stderr);
  await access(join(output, '.agents/skills/eer-inject/references/common.md'));
  assert.deepEqual(await readdir(join(output, '.agents/skills/eer-inject/references')), ['common.md']);
  await access(join(output, 'AGENTS.fragment.md'));
  const repeated = run('build', '--harness', 'codex', '--output', output);
  assert.notEqual(repeated.status, 0); assert.match(repeated.stderr, /EEXIST/);
  assert.notEqual(run('install', '--harness', 'codex').status, 0);
  assert.notEqual(run('install', '--harness', 'deepseek-api', '--project', root).status, 0);
});
