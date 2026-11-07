import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { evaluateAssessment } from '../../../services/code-review/internal/scoring/service.js';
import type { EvaluationReport } from '../../../services/code-review/internal/scoring/report-model.js';
import { withFiles } from '../ast/helpers.js';

async function evaluate(files: Record<string, string>, check: (report: EvaluationReport) => void | Promise<void>) {
    await withFiles(files, async (root) => {
        const ast = new AstService();
        try {
            await check(
                await evaluateAssessment(ast, {
                    root,
                    configuration: {
                        budgets: [{ path: '*.ts', timeOperations: 10000, spaceUnits: 10000 }],
                    },
                }),
            );
        } finally {
            ast.close();
        }
    });
}

const fn = (report: EvaluationReport, path: string, name: string) =>
    report.files.find((file) => file.path === path)!.units.find((unit) => unit.name === name)!;
const purity = (report: EvaluationReport, path: string, name: string) =>
    report.rules.find((rule) => rule.unitId === fn(report, path, name).id && rule.ruleId === 'S-pure')!;

test('semantics: reexports, namespace imports and const aliases resolve through multiple files', async () => {
    await evaluate(
        {
            'leaf.ts': 'export function leaf() { return 1; }',
            'barrel.ts': "export {leaf as run} from './leaf.js';",
            'entry.ts':
                "import * as api from './barrel.js'; const alias = api.run; function wrapped() { return alias(); }",
        },
        async (report) => {
            assert.equal(purity(report, 'entry.ts', 'wrapped').verdict, 'satisfied');
            assert.equal(fn(report, 'entry.ts', 'wrapped').complexity.value, 100);
            const saved = JSON.parse(await readFile(report.artifacts!.evidence, 'utf8'));
            const entry = saved.find((file: { path: string }) => file.path === 'entry.ts');
            assert.ok(
                entry.derived.resolvedCalls.some((call: { target: string }) => call.target.startsWith('leaf.ts#')),
            );
        },
    );
});

test('semantics: stable local object methods support transitive effects and finite cost', async () => {
    await evaluate(
        { 's.ts': 'export {}; const handlers = {run() { return 1; }}; function wrapped() { return handlers.run(); }' },
        (report) => {
            assert.equal(purity(report, 's.ts', 'wrapped').verdict, 'satisfied');
            assert.equal(fn(report, 's.ts', 'wrapped').complexity.value, 100);
        },
    );
});

test('semantics: purity is independent from cost for typeof and its statically resolved callers', async () => {
    await evaluate(
        {
            's.ts': 'export {}; function classify(value) { return typeof value; } function wrapped(value) { return classify(value); }',
        },
        (report) => {
            for (const name of ['classify', 'wrapped']) {
                assert.equal(purity(report, 's.ts', name).verdict, 'satisfied');
                assert.equal(fn(report, 's.ts', name).complexity.value, null);
            }
        },
    );
});

test('semantics: ambiguous star exports and cycles stay unresolved', async () => {
    await evaluate(
        {
            'a.ts': 'export function work() { return 1; }',
            'b.ts': 'export function work() { return 2; }',
            'barrel.ts': "export * from './a.js'; export * from './b.js';",
            'entry.ts': "import {work} from './barrel.js'; function wrapped() { return work(); }",
            'cycle.ts': 'export {}; function recur() { return recur(); }',
        },
        (report) => {
            assert.equal(purity(report, 'entry.ts', 'wrapped').verdict, 'unknown');
            assert.equal(fn(report, 'entry.ts', 'wrapped').complexity.value, null);
            assert.equal(purity(report, 'cycle.ts', 'recur').verdict, 'unknown');
            assert.equal(fn(report, 'cycle.ts', 'recur').complexity.value, null);
        },
    );
});

test('semantics: explicit exports take precedence over stars and support namespace reexports', async () => {
    await evaluate(
        {
            'a.ts': 'export function work() { return 1; }',
            'b.ts': 'export function work() { return 2; }',
            'barrel.ts': "export * from './a.js'; export {work} from './b.js'; export * as nested from './b.js';",
            'entry.ts':
                "import * as api from './barrel.js'; function one() { return api.work(); } function two() { return api.nested.work(); }",
        },
        (report) => {
            assert.equal(purity(report, 'entry.ts', 'one').verdict, 'satisfied');
            assert.equal(purity(report, 'entry.ts', 'two').verdict, 'satisfied');
        },
    );
});

test('semantics: a unique star export resolves when other ESM modules do not export that name', async () => {
    await evaluate(
        {
            'a.ts': 'export function work() { return 1; }',
            'b.ts': 'export function other() { return 2; }',
            'barrel.ts': "export * from './a.js'; export * from './b.js';",
            'entry.ts': "import {work} from './barrel.js'; function wrapped() { return work(); }",
        },
        (report) => {
            assert.equal(purity(report, 'entry.ts', 'wrapped').verdict, 'satisfied');
            assert.equal(fn(report, 'entry.ts', 'wrapped').complexity.value, 100);
        },
    );
});

test('semantics: reassignment, escaping objects and shadowed namespaces prevent unsound resolution', async () => {
    await evaluate(
        {
            'leaf.ts': 'export function work() { return 1; }',
            's.ts': `import * as api from './leaf.js';
function shadow(api) { return api.work(); }
function stable() { return 1; }
let mutable = stable; function rewritten() { return mutable(); }
const handlers = {run() { return 1; }}; consume(handlers); function escaped() { return handlers.run(); }`,
        },
        (report) => {
            for (const name of ['shadow', 'rewritten', 'escaped']) {
                assert.equal(purity(report, 's.ts', name).verdict, 'unknown');
                assert.equal(fn(report, 's.ts', name).complexity.value, null);
            }
        },
    );
});

test('semantics: literal finite loops are budgetable; data-dependent or modified bounds are not', async () => {
    await evaluate(
        {
            's.ts': `export {};
function finite() { for (let i = 0; i < 3; i++) { 1 + 2; } return 1; }
function dynamic(n) { for (let i = 0; i < n; i++) {} return 1; }
function rewritten() { for (let i = 0; i < 3; i++) { i--; } return 1; }`,
        },
        (report) => {
            assert.equal(fn(report, 's.ts', 'finite').complexity.value, 100);
            for (const name of ['dynamic', 'rewritten']) assert.equal(fn(report, 's.ts', name).complexity.value, null);
        },
    );
});

test('semantics: getters, coercions, observable writes and unresolved side effects are not proven pure', async () => {
    await evaluate(
        {
            's.ts': `export {};
function getter(value) { return value.x; }
function coercion(value) { return value + 1; }
function write(value) { value.x = 1; }
function unknown() { external(); }`,
        },
        (report) => {
            for (const name of ['getter', 'coercion', 'write', 'unknown'])
                assert.equal(purity(report, 's.ts', name).verdict, 'unknown');
        },
    );
});

test('semantics: lexical blocks cannot turn reads of unknown outer state into local purity', async () => {
    await evaluate({ 's.ts': 'export {}; function blocked() { { const hidden = 1; } return hidden; }' }, (report) => {
        assert.equal(purity(report, 's.ts', 'blocked').verdict, 'unknown');
    });
});

test('semantics: Vue inline scripts retain source IDs and template consumers keep depth open', async () => {
    await evaluate(
        {
            's.vue':
                '<script setup lang="ts">\nfunction classify(value) { return typeof value; }\nfunction wrapped(value) { return classify(value); }\n</script>\n<template>{{ wrapped(1) }}</template>',
        },
        async (report) => {
            assert.equal(purity(report, 's.vue', 'wrapped').verdict, 'satisfied');
            assert.equal(fn(report, 's.vue', 'classify').scope.value, null);
            const saved = JSON.parse(await readFile(report.artifacts!.evidence, 'utf8'));
            assert.ok(saved[0].derived.resolvedCalls[0].target.includes('#script:'));
        },
    );
});

test('semantics: external Vue scripts remain incomplete rather than silently proving absence of imports', async () => {
    const { deriveSemantics } = await import('../../../services/code-review/internal/scoring/semantics.js');
    const result = await deriveSemantics('s.vue', '<script src="./external.ts"></script>');
    assert.equal(result.completeImports, false);
    assert.equal(result.moduleCost, null);
});
