import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAssessment } from './helpers.js';

test('scope: lexical shadowing, captures, property writes and destructured writes retain separate evidence', async () => {
  const source = `export let shared = 0;
function outer(input: {value: number}) {
  const local = input.value;
  function inner(shared: number) { shared++; input.value++; return local + shared; }
  ({value: shared} = input);
  return inner(local);
}`;
  await withAssessment(source, ({ evidence, scope }) => {
    const outer = evidence.functions.find((item) => item.name === 'outer')!;
    const inner = evidence.functions.find((item) => item.name === 'inner')!;
    const shared = evidence.declarations.filter((item) => item.name === 'shared');
    assert.equal(shared.length, 2);
    const global = shared.find((item) => item.functionId === null)!;
    const parameter = shared.find((item) => item.functionId === inner.id)!;
    assert.equal(evidence.references.find((ref) => ref.targetId === parameter.id && ref.access === 'read-write')?.functionId, inner.id);
    assert.ok(evidence.references.some((ref) => ref.targetId === global.id && ref.access === 'write'));
    const input = evidence.declarations.find((item) => item.name === 'input')!;
    assert.ok(evidence.references.some((ref) => ref.targetId === input.id && ref.property === 'input.value' && ref.access === 'read-write'));
    assert.deepEqual(scope.bindings.find((item) => item.declarationId === input.id)?.capturedBy, [inner.id]);
    assert.ok(scope.functions.find((item) => item.functionId === inner.id)?.captures.length);
    assert.equal(evidence.calls.find((call) => call.callee === 'inner')?.targetId, inner.id);
    assert.deepEqual(scope.functions.find((item) => item.functionId === inner.id)?.impact.directCallers, [outer.id]);
    assert.equal(scope.score, null);
  });
});

test('scope: IIFE, const arrow binding, reassignment and member calls are distinguished', async () => {
  const source = `export const stable = (() => 1);
let changed = () => 2;
function run() { stable(); changed(); changed = () => 3; obj.method(); return (() => stable())(); }`;
  await withAssessment(source, ({ evidence }) => {
    assert.ok(evidence.calls.find((item) => item.callee === 'stable')?.targetId);
    assert.equal(evidence.calls.find((item) => item.callee === 'changed')?.targetId, null);
    assert.equal(evidence.calls.find((item) => item.callee === 'obj.method')?.targetId, null);
    const immediate = evidence.functions.filter((item) => item.immediate);
    assert.equal(immediate.length, 1);
    assert.ok(evidence.calls.some((item) => item.targetId === immediate[0]!.id));
  });
});

test('scope: type syntax is excluded and this, mutation, tagged calls and eval keep purity unknown', async () => {
  const source = `import type { Hidden } from './missing';
function clean(x: number) { const y = x + 1; return y; }
function risky(value: Hidden) { this.value = value; tag\`x\`; return this.value; }
function dynamic() { eval('x = 1'); return clean(1); }`;
  await withAssessment(source, ({ evidence, scope }) => {
    assert.ok(!evidence.references.some((ref) => ['Hidden', 'number'].includes(ref.name)));
    assert.ok(evidence.effects.some((item) => item.kind === 'this'));
    assert.ok(evidence.effects.some((item) => item.kind === 'tagged-call'));
    assert.ok(evidence.calls.every((item) => item.targetId === null));
    assert.ok(evidence.references.every((item) => item.dynamicScope));
    const risky = evidence.functions.find((item) => item.name === 'risky')!;
    assert.equal(scope.functions.find((item) => item.functionId === risky.id)?.purity.status, 'unknown');
  });
});

test('scope: block var is function-scoped while let and catch bindings stay lexical', async () => {
  const source = `function run(x: number) { if (x) { var lifted = 1; let local = 2; }
try { throw 1; } catch (error) { const f = () => error; }
return lifted + local; }`;
  await withAssessment(source, ({ evidence }) => {
    const scopes = new Map(evidence.scopes.map((item) => [item.id, item.kind]));
    assert.equal(scopes.get(evidence.declarations.find((item) => item.name === 'lifted')!.scopeId), 'function');
    assert.equal(scopes.get(evidence.declarations.find((item) => item.name === 'local')!.scopeId), 'block');
    assert.ok(evidence.references.find((item) => item.name === 'lifted')!.targetId);
    assert.equal(evidence.references.find((item) => item.name === 'local')!.targetId, null);
    assert.ok(evidence.references.find((item) => item.name === 'error')!.targetId);
  });
});

test('scope: a source file and its sole function have distinct scope identities', async () => {
  await withAssessment('function only(x: number) { var local = x; return local; }', ({ evidence, scope }) => {
    assert.equal(evidence.scopes.length, 3);
    const local = evidence.declarations.find((item) => item.name === 'local')!;
    assert.equal(scope.bindings.find((item) => item.declarationId === local.id)?.scope, 'function');
  });
});

test('scope: named function expressions retain self bindings and exported aliases retain exposure', async () => {
  await withAssessment(`const f = function self(n: number): number { return n ? self(n - 1) : 0; };
export { f as renamed };
f(1);`, ({ evidence, complexity }) => {
    const fn = evidence.functions[0]!;
    assert.equal(evidence.calls.find((item) => item.callee === 'self')?.targetId, fn.id);
    assert.equal(evidence.calls.find((item) => item.callee === 'f')?.targetId, fn.id);
    assert.equal(evidence.declarations.find((item) => item.name === 'f')?.exported, true);
    assert.equal(complexity.functions[0]!.recursive, 'detected-local-cycle');
  });
});

test('scope: var in a class static block does not hoist into an enclosing function', async () => {
  await withAssessment(`function outer() { class Local { static { var hidden = 1; const use = () => hidden; } } return hidden; }`, ({ evidence }) => {
    const hidden = evidence.declarations.find((item) => item.name === 'hidden')!;
    assert.equal(evidence.scopes.find((item) => item.id === hidden.scopeId)?.kind, 'static-block');
    const refs = evidence.references.filter((item) => item.name === 'hidden');
    assert.ok(refs.some((item) => item.targetId === hidden.id));
    assert.ok(refs.some((item) => item.targetId === null));
  });
});

test('scope: nested destructuring exports expose each leaf binding', async () => {
  await withAssessment('export const { nested: { value }, items: [first, ...rest] } = source;', ({ evidence }) => {
    assert.deepEqual(evidence.declarations.map((item) => [item.name, item.exported]),
      [['value', true], ['first', true], ['rest', true]]);
  });
});
