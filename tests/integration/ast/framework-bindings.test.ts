import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();
after(() => service.close());

test('default parameter calls resolve outside function body var declarations', async () => {
  const source = 'import { useState as state } from "react"; function View(value = state(0)) { var state = local; state(1); } state(2);';
  await withFiles({ 's.tsx': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['s.tsx'], { root });
    assert.equal(result.status, 'complete');
    const hooks = result.files[0]!.facts.filter((fact) => fact.extensions.react?.usage === 'hookCandidate');
    assert.deepEqual(hooks.map((fact) => fact.extensions.react!.arguments), [['0'], ['2']]);
    assert.ok(hooks.every((fact) => fact.extensions.react?.source === 'react'));
  });
});
const shadows = [
  'function f() { const state = () => 0; state(); }',
  'function f() { state(); var state; }',
  'function f() { function state() {} state(); }',
  'function f({ key: state }) { state(); }',
  'try {} catch (state) { state(); }',
  'for (const state of functions) { state(); }',
];
for (const body of shadows) test(`React import evidence respects lexical bindings: ${body}`, async () => {
  const source = `import { useState as state } from "react"; ${body} state(0);`;
  await withFiles({ 'sample.ts': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.ts'], { root });
    const hooks = result.files[0]!.facts.filter((fact) => fact.extensions.react?.usage === 'hookCandidate');
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]!.extensions.react!.source, 'react');
    assert.deepEqual(hooks[0]!.extensions.react!.arguments, ['0']);
  });
});
test('React named and default null-rendering classes retain their declaration references', async () => {
  const source = 'import { PureComponent as Base } from "react"; export class App extends Base { render() {return null;} } export default class extends Base {}';
  await withFiles({ 'View.tsx': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.tsx'], { root });
    const facts = result.files[0]!.facts;
    const components = facts.filter((fact) => fact.type === 'component');
    assert.deepEqual(components.map((fact) => fact.name), ['App', 'default']);
    for (const component of components) {
      assert.ok(component.extensions.react!.evidence!.includes('reactBaseClass'));
      assert.equal(facts.find((fact) => fact.id === component.extensions.react!.declarationId)!.type, 'type');
    }
  });
});
test('ordinary nested JSX callbacks do not identify their enclosing function as a component', async () => {
  await withFiles({ 'View.tsx': 'import React from "react"; function Utility() { const Child = () => <div/>; return 1; }' }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.tsx'], { root });
    assert.deepEqual(result.files[0]!.facts.filter((fact) => fact.type === 'component').map((fact) => fact.name), ['Child']);
  });
});
test('Vue macro evidence requires setup context and an unshadowed top-level callee', async () => {
  const source = '<script setup>const actual = defineProps(); function f() { defineProps(); } { const defineEmits = () => 0; defineEmits(); }</script>';
  await withFiles({ 'View.vue': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.vue'], { root });
    const macros = result.files[0]!.facts.filter((fact) => fact.extensions.vue?.usage === 'compilerMacro');
    assert.deepEqual(macros.map((fact) => fact.name), ['defineProps']);
  });
});
test('Vue options retain shorthand, quoted keys, method syntax and imported defineComponent aliases', async () => {
  const source = '<script>import { defineComponent as component } from "vue"; const unrelated = { props: [] }; const options = { props, "emits": ["change"], setup() {} }; export default component(options);</script>';
  await withFiles({ 'View.vue': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.vue'], { root });
    const options = result.files[0]!.facts.filter((fact) => fact.extensions.vue?.usage === 'optionCandidate');
    assert.deepEqual(options.map((fact) => fact.name), ['props', 'emits', 'setup']);
  });
});

test('Vue macros identify top-level withDefaults and exclude nested expression, block and class calls', async () => {
  const source = '<script setup lang="ts">const props = withDefaults(defineProps<{ value?: number }>(), { value: 0 }); if (ok) { defineEmits(); } class Local { value = defineModel(); } const value = consume(defineSlots());</script>';
  await withFiles({ 'View.vue': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['View.vue'], { root });
    assert.equal(result.status, 'complete', JSON.stringify(result));
    const macros = result.files[0]!.facts.filter((fact) => fact.extensions.vue?.usage === 'compilerMacro');
    assert.deepEqual(macros.map((fact) => fact.name), ['withDefaults', 'defineProps']);
  });
});
