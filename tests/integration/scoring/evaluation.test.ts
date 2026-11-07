import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { evaluateAssessment } from '../../../services/code-review/internal/scoring/service.js';
import { scoringConfigurationSchema } from '../../../services/code-review/internal/scoring/config.js';
import { evaluationReportSchema } from '../../../services/code-review/internal/scoring/report-model.js';
import { withFiles } from '../ast/helpers.js';

test('evaluation: real AST evidence produces calculable scope and budget-compliant cost scores', async () => {
    await withFiles({ 'sample.ts': 'export {}; function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(ast, {
                root,
                configuration: {
                    modules: [{ id: 'app', root: '.', kind: 'business' }],
                    contracts: [{ moduleId: 'app', allowedDependencies: [], allowExternal: true }],
                    budgets: [{ path: 'sample.ts', name: 'leaf', timeOperations: 10, spaceUnits: 10 }],
                },
            });
            const fn = report.files[0]!.units.find((unit) => unit.name === 'leaf')!;
            assert.equal(fn.scope.value, 100);
            assert.equal((fn.scope.details['baseline'] as { value: number }).value, 54);
            assert.equal(fn.complexity.value, 100);
            assert.equal(report.repository.composite.value, null);
            assert.equal(report.grade.value, null);
            assert.equal(report.manifest.stable, true);
            const saved = evaluationReportSchema.parse(JSON.parse(await readFile(report.artifacts!.report, 'utf8')));
            assert.equal(saved.manifest.sourceDigest, report.manifest.sourceDigest);
            const evidence = JSON.parse(await readFile(report.artifacts!.evidence, 'utf8'));
            assert.ok(evidence[0].derived.costs.some((item: { id: string }) => item.id === fn.id));
        } finally {
            ast.close();
        }
    });
});

test('evaluation: all three dimensions produce a full internal number when their contracts are proven', async () => {
    await withFiles({ 's.ts': 'export {}; function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(
                ast,
                {
                    root,
                    configuration: {
                        modules: [{ id: 'app', root: '.', kind: 'business' }],
                        contracts: [{ moduleId: 'app', allowedDependencies: [], allowExternal: true }],
                        budgets: [
                            { path: 's.ts', name: 'leaf', timeOperations: 10, spaceUnits: 10 },
                            { path: 's.ts', name: '<module>', timeOperations: 10, spaceUnits: 10 },
                        ],
                        responsibilities: [{ path: 's.ts', name: 'leaf', role: 'leaf' }],
                    },
                },
                { persist: false },
            );
            assert.equal(report.repository.scope.value, 100);
            assert.equal(report.repository.complexity.value, 100);
            assert.equal(report.repository.placement.value, 100);
            assert.equal(report.repository.composite.value, 100);
            assert.equal(report.status, 'complete');
            assert.equal(report.grade.value, null); // Two-source grade is separate from complete internal scoring.
        } finally {
            ast.close();
        }
    });
});

test('evaluation: fixed inputs reproduce results and missing budgets remain pending', async () => {
    await withFiles({ 's.ts': 'export {}; function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const a = await evaluateAssessment(ast, { root }, { persist: false });
            const b = await evaluateAssessment(ast, { root }, { persist: false });
            assert.equal(a.manifest.sourceDigest, b.manifest.sourceDigest);
            assert.deepEqual(a.repository, b.repository);
            assert.equal(a.files[0]!.units[0]!.complexity.value, null);
            assert.ok(a.rules.some((rule) => rule.reason === 'No explicit task budget'));
        } finally {
            ast.close();
        }
    });
});

test('evaluation: one forbidden dependency has one ledger owner; role uncertainty stays visible', async () => {
    await withFiles(
        {
            'public/index.ts': "import {run} from '../business/run.js'; export function publicRun() { return run(); }",
            'business/run.ts': 'export function run() { return 1; }',
        },
        async (root) => {
            const ast = new AstService();
            try {
                const report = await evaluateAssessment(
                    ast,
                    {
                        root,
                        configuration: {
                            modules: [
                                { id: 'public', root: 'public', kind: 'public' },
                                { id: 'business', root: 'business', kind: 'business' },
                            ],
                            contracts: [
                                { moduleId: 'public', allowedDependencies: [], allowExternal: true },
                                { moduleId: 'business', allowedDependencies: [], allowExternal: true },
                            ],
                        },
                    },
                    { persist: false },
                );
                assert.equal(report.findings.length, 1);
                assert.equal(report.findings[0]!.ruleId, 'P-PUBLIC-BUSINESS-COUPLING');
                assert.ok(report.rules.some((rule) => rule.suppressedBy));
                assert.equal(report.files.find((file) => file.path === 'public/index.ts')!.placement.value, null);
            } finally {
                ast.close();
            }
        },
    );
});

test('evaluation: unavailable native files remain in the manifest and aggregation denominator', async () => {
    await withFiles({ 's.ts': 'export const value = 1;', 'Sample.java': 'class Sample {}' }, async (root) => {
        const ast = new AstService(),
            original = ast.analyze.bind(ast);
        ast.analyze = async (...args) =>
            args[0] === 'java'
                ? {
                      protocolVersion: '1.0',
                      requestId: null,
                      ok: false,
                      error: { code: 'BACKEND_UNAVAILABLE', message: 'Test fixture backend unavailable' },
                  }
                : original(...args);
        try {
            const report = await evaluateAssessment(ast, { root }, { persist: false });
            assert.equal(report.manifest.files.length, 2);
            assert.equal(report.files.length, 2);
            assert.equal(report.files.find((file) => file.path === 'Sample.java')!.scope.status, 'failed');
            assert.equal(report.repository.scope.value, null);
            assert.ok(report.errors.length);
        } finally {
            ast.close();
        }
    });
});

test('evaluation: changed source snapshots and cancellation cannot publish a completed run', async () => {
    await withFiles({ 's.ts': 'export const value = 1;' }, async (root) => {
        const ast = new AstService(),
            original = ast.analyze.bind(ast);
        ast.analyze = async (...args) => {
            const response = await original(...args);
            await writeFile(join(root, 's.ts'), 'export const value = 2;');
            return response;
        };
        try {
            await assert.rejects(
                evaluateAssessment(ast, { root }, { persist: false }),
                /SOURCE_CHANGED|manifest changed/,
            );
            const controller = new AbortController();
            controller.abort();
            await assert.rejects(
                evaluateAssessment(ast, { root }, { signal: controller.signal, persist: false }),
                /cancelled/,
            );
        } finally {
            ast.close();
        }
    });
});

test('configuration: undeclared contracts and missing AST inputs are explicit', async () => {
    assert.equal(
        scoringConfigurationSchema.safeParse({ contracts: [{ moduleId: 'missing', allowedDependencies: [] }] }).success,
        false,
    );
    await withFiles({}, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(ast, { root }, { persist: false });
            assert.equal(report.status, 'failed');
            assert.equal(report.repository.composite.value, null);
        } finally {
            ast.close();
        }
    });
});

test('configuration: overlapping unit budgets are rejected rather than chosen implicitly', async () => {
    await withFiles({ 's.ts': 'export function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            await assert.rejects(
                evaluateAssessment(
                    ast,
                    {
                        root,
                        configuration: {
                            budgets: [
                                { path: '*.ts', timeOperations: 10, spaceUnits: 10 },
                                { path: 's.ts', name: 'leaf', timeOperations: 20, spaceUnits: 20 },
                            ],
                        },
                    },
                    { persist: false },
                ),
                /Ambiguous cost budget/,
            );
        } finally {
            ast.close();
        }
    });
});

test('semantics: coercions, IIFE returned aliases and rebound branch variables stay unproved', async () => {
    await withFiles(
        {
            's.ts': `export {}; const identity = ((value) => value)({});
function coercion(value) { return value + 1; }
function rebound(flag) { var value = 1; if (flag) { var value = 'text'; } return value + 1; }`,
        },
        async (root) => {
            const ast = new AstService();
            try {
                const report = await evaluateAssessment(ast, { root }, { persist: false });
                assert.ok(report.rules.some((rule) => rule.ruleId === 'S-isolatedIife' && rule.verdict === 'unknown'));
                for (const name of ['coercion', 'rebound']) {
                    const fn = report.files[0]!.units.find((unit) => unit.name === name)!;
                    assert.ok(
                        report.rules.some(
                            (rule) => rule.unitId === fn.id && rule.ruleId === 'S-pure' && rule.verdict === 'unknown',
                        ),
                    );
                }
            } finally {
                ast.close();
            }
        },
    );
});

test('dependencies: local require is not an import, aliases remain unknown and namespaces do not flatten exports', async () => {
    const { deriveSemantics } = await import('../../../services/code-review/internal/scoring/semantics.js');
    const local = await deriveSemantics(
        's.ts',
        `function require(value) { return value; } require('../business/run.js');`,
    );
    assert.equal(local.dependencies.length, 0);
    const namespace = await deriveSemantics('s.ts', 'export namespace N { export function nested() { return 1; } }');
    assert.equal(namespace.exports.has('nested'), false);
    await withFiles({ 's.ts': "import {value} from '@local/alias'; export const x = value;" }, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(
                ast,
                {
                    root,
                    configuration: {
                        modules: [{ id: 'app', root: '.', kind: 'business' }],
                        contracts: [{ moduleId: 'app', allowedDependencies: [], allowExternal: true }],
                    },
                },
                { persist: false },
            );
            assert.equal(report.rules.find((rule) => rule.ruleId === 'P-DEPENDENCY-BOUNDARY')?.verdict, 'unknown');
        } finally {
            ast.close();
        }
    });
});
