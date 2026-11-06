import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, root, withFiles } from './helpers.js';

const service = new AstService();
after(() => service.close());
test('React JSX/TSX, components, import aliases and nested attributes', async () => {
  const result = await analyze(service, 'js-ts', ['js-ts/React.tsx']);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  const file = result.files[0]!;
  assert.equal(file.framework, 'react');
  assert.deepEqual(file.facts.filter((fact) => fact.type === 'component').map((fact) => fact.name), ['App', 'Panel']);
  assert.ok(file.facts.some((fact) => fact.type === 'templateElement' && fact.name === '#fragment'));
  assert.ok(file.facts.some((fact) => fact.name === 'state' && fact.extensions['react']));
  assert.ok(file.facts.some((fact) => fact.type === 'attribute' && fact.name === 'onClick'));
  const selected = await analyze(service, 'js-ts', ['js-ts/React.tsx'], { factTypes: ['component'] });
  assert.equal(selected.status, 'complete');
  assert.ok(selected.files[0]!.facts.some((fact) => fact.type === 'function' && fact.name === 'App'));
});
test('Vue 3 SFC, two script blocks, compiler macros, directives and original positions', async () => {
  const result = await analyze(service, 'js-ts', ['js-ts/View.vue']);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  const file = result.files[0]!;
  assert.equal(file.framework, 'vue');
  assert.ok(file.facts.some((fact) => fact.type === 'directive' && fact.name === 'for'));
  assert.ok(file.facts.some((fact) => fact.name === 'defineProps'));
  const source = await readFile(`${root}/js-ts/View.vue`, 'utf8');
  const line = source.split('\n').findIndex((line) => line.startsWith('function increment'));
  assert.equal(file.facts.find((fact) => fact.name === 'increment')!.range!.start.line, line);
});
test('Vue block failures retain script results and report partial completion', async () => {
  await withFiles({ 'View.vue': '<script setup>function ok() {}</script><template lang="pug">p hi</template>' }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.vue'], { root });
    assert.equal(result.status, 'partial');
    assert.ok(result.files[0]!.facts.some((fact) => fact.name === 'ok'));
    assert.ok(result.files[0]!.skipped.some((item) => item.code === 'UNSUPPORTED_BLOCK_LANGUAGE'));
  });
});
test('Vue external scripts retain their own source URI and SFC association', async () => {
  await withFiles({ 'View.vue': '<script src="./logic.ts" lang="ts"></script><template><div /></template>',
    'logic.ts': 'export function external() {}' }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.vue'], { root });
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.files.length, 2);
    assert.ok(result.files[1]!.uri.endsWith('/logic.ts'));
    assert.ok(result.files[1]!.facts.some((fact) => fact.name === 'external'));
    const syntax = await analyze(service, 'js-ts', ['View.vue'], { root, capabilities: ['syntax'] });
    assert.equal(syntax.files[1]!.facts.length, 0);
    const excluded = await analyze(service, 'js-ts', ['View.vue'], { root, exclude: ['logic.ts'] });
    assert.equal(excluded.status, 'partial');
    assert.equal(excluded.files.length, 1);
  });
});
test('Vue script imports identify Composition API usage', async () => {
  await withFiles({ 'state.ts': 'import { ref } from "vue"; export const count = ref(0);' }, async (root) => {
    const result = await analyze(service, 'js-ts', ['state.ts'], { root });
    assert.equal(result.files[0]!.framework, 'vue');
    assert.ok(result.files[0]!.facts.some((fact) => fact.name === 'ref' && fact.type === 'binding'));
  });
});
test('JS, JSX, TSX and module extensions parse independently', async () => {
  for (const extension of ['js', 'jsx', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'd.ts', 'd.mts', 'd.cts']) {
    const jsx = ['js', 'jsx', 'tsx'].includes(extension);
    const source = jsx ? 'export const App = () => <div />' : extension.startsWith('d.')
      ? 'export declare function load(): void;' : 'export function load() {}';
    await withFiles({ [`sample.${extension}`]: source }, async (root) => {
      const result = await analyze(service, 'js-ts', [`sample.${extension}`], { root, framework: 'react' });
      assert.equal(result.status, 'complete', JSON.stringify(result));
      assert.equal(result.files[0]!.diagnostics.length, 0);
    });
  }
});
