import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { expectedRange } from './expectations.js';

const service = new AstService();
after(() => service.close());
test('nested destructuring exports retain leaves, aliases, defaults, rest and declaration references', async () => {
  const source = 'export const { alpha: { inner = 1 }, rest: [first, , ...tail], ...remaining } = value;';
  await withFiles({ 'sample.ts': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.ts'], { root });
    assert.equal(result.status, 'complete');
    const facts = result.files[0]!.facts;
    assert.equal(facts.length, 11);
    assert.deepEqual(facts.filter((fact) => fact.type === 'export').map((fact) => fact.name), ['inner', 'first', 'tail', 'remaining']);
    for (const [name, text] of [['inner', 'inner = 1'], ['first', 'first'], ['tail', '...tail'], ['remaining', '...remaining']]) {
      const binding = facts.find((fact) => fact.type === 'binding' && fact.name === name)!;
      const exported = facts.find((fact) => fact.type === 'export' && fact.name === name)!;
      assert.deepEqual(binding.range, expectedRange(source, text!));
      assert.equal(exported.extensions['js-ts']!.declarationId, binding.id);
      assert.equal(exported.parentId, binding.parentId);
    }
  });
});
test('CommonJS imports and exports preserve source, names, values and containment', async () => {
  const source = 'const dep = require("./dep.cjs"); exports.one = dep; module["exports"].two = dep; module.exports = function load() {};';
  await withFiles({ 'sample.cjs': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.cjs'], { root });
    assert.equal(result.status, 'complete');
    const facts = result.files[0]!.facts;
    assert.equal(facts.length, 6);
    const imports = facts.filter((fact) => fact.type === 'import');
    assert.equal(imports.length, 1);
    assert.equal(imports[0]!.extensions['js-ts']!.source, './dep.cjs');
    assert.deepEqual(imports[0]!.range, expectedRange(source, 'require("./dep.cjs")'));
    assert.deepEqual(facts.filter((fact) => fact.type === 'export').map((fact) => fact.name), ['one', 'two', 'default']);
    assert.equal(facts.find((fact) => fact.name === 'load')!.parentId, facts.find((fact) => fact.name === 'default')!.id);
  });
});
const shadowed = [
  'function run(require, exports, module) { require("x"); exports.x = 1; module.exports = 2; }',
  'function run() { require("x"); var require; exports.x = 1; var exports; module.exports = 2; var module; }',
  '{ let require = fn; require("x"); }',
  'try {} catch (require) { require("x"); }',
  'for (const require of calls) { require("x"); }',
  'function require() {} require("x");',
];
for (const source of shadowed) test(`CommonJS respects lexical bindings: ${source}`, async () => {
  await withFiles({ 'sample.cjs': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.cjs'], { root });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.files[0]!.facts.filter((fact) => ['import', 'export'].includes(fact.type)), []);
  });
});
test('block bindings and class static var declarations do not shadow outer CommonJS globals', async () => {
  const source = '{ const require = fn; } class Box { static { var require; } } require("actual");';
  await withFiles({ 'sample.cjs': source }, async (root) => {
    const result = await analyze(service, 'js-ts', ['sample.cjs'], { root });
    assert.deepEqual(result.files[0]!.facts.filter((fact) => fact.type === 'import').map((fact) => fact.name), ['"actual"']);
  });
});
