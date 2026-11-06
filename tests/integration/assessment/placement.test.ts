import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAssessment } from './helpers.js';
import { assessmentConfigSchema } from '../../../services/code-review/internal/assessment/config.js';

test('placement: explicit module boundaries use the longest path and keep unknown callees from becoming leaves', async () => {
  const source = `export function run() { return leaf(); }
function leaf() { return 1; }
function external() { return sdk.run(); }`;
  await withAssessment(source, ({ evidence, placement }) => {
    assert.equal(placement.module.id, 'feature');
    assert.equal(placement.module.kind, 'business');
    assert.equal(placement.configuredFileEntry, true);
    const role = (name: string) => placement.functions.find((item) =>
      item.functionId === evidence.functions.find((fn) => fn.name === name)!.id)!.role;
    assert.equal(role('run'), 'entry-candidate');
    assert.equal(role('leaf'), 'leaf-candidate');
    assert.equal(role('external'), 'unknown');
    assert.equal(placement.score, null);
  }, 'src/feature/index.ts', { modules: [
    { id: 'src', root: 'src', kind: 'public' },
    { id: 'feature', root: 'src/feature', kind: 'business', entries: ['src/feature/index.ts'] },
  ] });
});

test('placement: folder names do not infer public responsibilities; invalid configurations are rejected', async () => {
  await withAssessment('export const helper = () => 1;', ({ placement }) => {
    assert.equal(placement.module.kind, 'unknown');
    assert.equal(placement.module.source, 'unconfigured');
  }, 'public/helpers.ts');
  assert.equal(assessmentConfigSchema.safeParse({ modules: [{ id: 'x', root: '../other', kind: 'public' }] }).success, false);
  assert.equal(assessmentConfigSchema.safeParse({ modules: [
    { id: 'x', root: 'src', kind: 'public', entries: ['outside/main.ts'] },
  ] }).success, false);
  assert.equal(assessmentConfigSchema.safeParse({ modules: [
    { id: 'x', root: 'src', kind: 'public' }, { id: 'y', root: './src/', kind: 'business' },
  ] }).success, false);
});
