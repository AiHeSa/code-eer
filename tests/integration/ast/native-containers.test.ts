import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { expectedRange } from './expectations.js';

const service = new AstService();

after(() => service.close());

test('Java Unicode escapes retain decoded names and original method and body ranges', async () => {
    const source = 'cl\\u0061ss B\\u006fx {\\u000a void load() {}\\u000a}';
    await withFiles({ 'Box.java': source }, async (root) => {
        const result = await analyze(service, 'java', ['Box.java'], { root });
        assert.equal(result.status, 'complete', JSON.stringify(result));
        const facts = result.files[0]!.facts;
        assert.deepEqual(
            facts.map((fact) => fact.name),
            ['Box', 'load'],
        );
        assert.deepEqual(facts[0]!.range, expectedRange(source, source));
        const method = facts[1]!;
        assert.deepEqual(method.range, expectedRange(source, 'void load() {}'));
        assert.ok('bodyRange' in method);
        assert.deepEqual(method.bodyRange, expectedRange(source, '{}'));
    });
});

test('Java module directives retain names, native categories and module parents', async () => {
    const source =
        'open module sample { requires java.base; exports sample.api; opens sample.internal; uses sample.Service; provides sample.Service with sample.Impl; }';
    await withFiles({ 'module-info.java': source }, async (root) => {
        const result = await analyze(service, 'java', ['module-info.java'], { root });
        assert.equal(result.status, 'complete');
        const facts = result.files[0]!.facts;
        assert.deepEqual(
            facts.map((fact) => fact.type),
            ['module', 'import', 'export', 'export', 'import', 'export'],
        );
        assert.deepEqual(
            facts.map((fact) => fact.name),
            ['sample', 'java.base', 'sample.api', 'sample.internal', 'sample.Service', 'sample.Service'],
        );
        for (const fact of facts.slice(1)) {
            assert.equal(fact.parentId, facts[0]!.id);
            assert.equal(fact.extensions.java!.directive, fact.origin.nativeType);
        }
    });
});

test('Rust extern crate aliases and nested enum functions retain imports and parents', async () => {
    const source =
        'extern crate core as base; enum E { V = { const fn inner() -> isize { 1 } inner() } } fn after() {}';
    await withFiles({ 'sample.rs': source }, async (root) => {
        const result = await analyze(service, 'rust', ['sample.rs'], { root });
        assert.equal(result.status, 'complete');
        const facts = result.files[0]!.facts;
        assert.equal(facts.length, 4);
        assert.equal(facts[0]!.extensions.rust!.alias, 'base');
        assert.equal(facts[2]!.parentId, facts[1]!.id);
        assert.equal(facts[3]!.parentId, null);
    });
});

for (const [backend, name, source] of [
    ['python', 's.py', 'text = "a\u2028b"\rdef named():\r    pass'],
    ['java', 'Box.java', 'class Box {\rvoid named() {}\r}'],
] as const)
    test(`${backend}: physical CR line endings retain UTF-16 source positions`, async () => {
        await withFiles({ [name]: source }, async (root) => {
            const result = await analyze(service, backend, [name], { root });
            assert.equal(result.status, 'complete');
            const fact = result.files[0]!.facts.find((fact) => fact.name === 'named')!;
            assert.deepEqual(fact.range!.start, { line: 1, character: 0 });
            assert.deepEqual(
                fact.range!.end,
                backend === 'python' ? { line: 2, character: 8 } : { line: 1, character: 15 },
            );
        });
    });
