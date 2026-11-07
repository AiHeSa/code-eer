import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildBundle } from '../../../prompts/generators/build.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eer-prompts-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(repository, 'prompts'), join(root, 'prompts'), { recursive: true });
  await mkdir(join(root, 'config'));
  await cp(join(repository, 'config/capability-targets.json'), join(root, 'config/capability-targets.json'));
  return root;
}

async function editCatalog(root, edit) {
  const path = join(root, 'prompts/routing/catalog.json');
  const catalog = JSON.parse(await readFile(path, 'utf8')); edit(catalog);
  await writeFile(path, JSON.stringify(catalog));
}

test('Codex and DSH share self-contained skills; builds are deterministic and advisory', async () => {
  const a = await buildBundle(repository, { harness: 'codex', targets: ['ts', 'react'] });
  const b = await buildBundle(repository, { harness: 'codex', targets: ['react', 'ts'] });
  const dsh = await buildBundle(repository, { harness: 'dsh', targets: ['ts', 'react'] });
  assert.deepEqual(a.files, b.files);
  assert.equal(a.manifest.automaticReview, false);
  assert.equal(a.manifest.tokenBudget.status, 'unverified');
  assert.equal(a.manifest.coverage.status, 'partial');
  for (const [name, content] of a.files) {
    if (name.endsWith('bundle.json')) continue;
    assert.equal(content, dsh.files.get(name));
    assert.ok(!content.includes(repository));
    for (const match of content.matchAll(/\]\((references\/[^)]+)\)/g))
      assert.ok(a.files.has(`${dirname(name)}/${match[1]}`), `Missing packaged resource ${match[1]}`);
  }
  const injection = a.files.get('.agents/skills/eer-inject/references/ts-react.md');
  assert.ok(injection.includes('文件大小约束') || injection.includes('文件大小'));
  assert.ok(injection.includes('applicability'));
  assert.ok(!injection.includes('### check'));
});

test('language and framework overrides preserve missing entries and stay isolated per object profile', async (t) => {
  const root = await fixture(t), folder = join(root, 'prompts/requirements/scope');
  await writeFile(join(folder, 'minimal-link.ts.md'), '---\nextends: ./minimal-link.md\n---\n## inject\nTS constraint\n## evidence\nTS evidence\n');
  await writeFile(join(folder, 'minimal-link.react.md'), '---\nextends: ./minimal-link.md\n---\n## inject\nReact constraint\n');
  await editCatalog(root, (catalog) => { catalog.commonRules[0].variants = {
    ts: 'requirements/scope/minimal-link.ts.md', react: 'requirements/scope/minimal-link.react.md',
  }; });
  const bundle = await buildBundle(root, { harness: 'codex', targets: ['ts', 'react', 'java'] });
  const profile = (stage, name) => bundle.files.get(`.agents/skills/eer-${stage}/references/${name}.md`);
  assert.match(profile('inject', 'ts'), /TS constraint/);
  assert.match(profile('inject', 'ts-react'), /React constraint/);
  assert.doesNotMatch(profile('inject', 'ts-react'), /TS constraint/);
  assert.match(profile('check', 'ts-react'), /TS evidence/);
  assert.doesNotMatch(profile('inject', 'java'), /TS constraint|React constraint/);
  assert.match(profile('inject', 'ts-react'), /当前职责边界/);
});

test('invalid targets, duplicate IDs, missing sources, cycles and unknown signals fail generation', async (t) => {
  await assert.rejects(buildBundle(repository, { harness: 'unknown' }), /Unsupported harness/);
  await assert.rejects(buildBundle(repository, { harness: 'codex', targets: ['typo'] }), /Unregistered/);
  for (const [edit, message] of [
    [(c) => { c.commonRules[1].id = c.commonRules[0].id; }, /Duplicate/],
    [(c) => { c.commonRules[0].source = 'requirements/missing.md'; }, /ENOENT/],
    [(c) => { c.commonRules[0].requires = [c.commonRules[1].id]; c.commonRules[1].requires = [c.commonRules[0].id]; }, /Cyclic/],
    [(c) => { c.commonRules[0].checkTrigger.any = ['unsupported-signal']; }, /Unknown trigger/],
  ]) {
    const root = await fixture(t); await editCatalog(root, edit);
    await assert.rejects(buildBundle(root, { harness: 'codex', targets: [] }), message);
  }
});

test('extra specialized entries and unrelated extends are rejected by the existing inheritance validator', async (t) => {
  const root = await fixture(t), path = join(root, 'prompts/requirements/scope/minimal-link.ts.md');
  await editCatalog(root, (c) => { c.commonRules[0].variants.ts = 'requirements/scope/minimal-link.ts.md'; });
  await writeFile(path, '---\nextends: ./minimal-link.md\n---\n## unexpected\nExtra\n');
  await assert.rejects(buildBundle(root, { harness: 'codex', targets: ['ts'] }), /unknown common entries/);
  await writeFile(path, '---\nextends: ./wrong.md\n---\n## inject\nWrong\n');
  await assert.rejects(buildBundle(root, { harness: 'codex', targets: ['ts'] }), /declare extends/);
});

test('target routers are loaded only when selected and their rules stay out of unrelated profiles', async (t) => {
  const root = await fixture(t), folder = join(root, 'prompts/requirements/framework');
  await mkdir(folder);
  await writeFile(join(folder, 'hook-boundary.md'), '# Hook\n\n## applicability\nReact only\n\n## inject\nReactOnlyConstraint\n\n## check\nReview hooks\n\n## evidence\nHook facts\n');
  const router = join(root, 'prompts/routing/targets/react.json');
  const data = JSON.parse(await readFile(router, 'utf8')); data.status = 'initial-rules';
  data.rules = [{ id: 'react-hook-boundary', category: 'framework', summary: 'Hook boundary',
    source: 'requirements/framework/hook-boundary.md', phases: ['inject', 'check'], requires: [],
    checkTrigger: { any: ['delta:empty-catch'] }, variants: {} }];
  await writeFile(router, JSON.stringify(data));
  const ts = await buildBundle(root, { harness: 'codex', targets: ['ts'] });
  assert.ok(!Object.keys(ts.manifest.sources).includes('prompts/requirements/framework/hook-boundary.md'));
  const react = await buildBundle(root, { harness: 'codex', targets: ['ts', 'react'] });
  assert.doesNotMatch(react.files.get('.agents/skills/eer-inject/references/ts.md'), /ReactOnlyConstraint/);
  assert.match(react.files.get('.agents/skills/eer-inject/references/ts-react.md'), /ReactOnlyConstraint/);
  await editCatalog(root, (catalog) => { catalog.commonRules[0].requires = ['react-hook-boundary']; });
  await assert.rejects(buildBundle(root, { harness: 'codex', targets: ['ts', 'react'] }), /Dependency outside profile/);
});
