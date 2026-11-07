import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { policySchema } from '../../../services/code-review/internal/scoring/policy.js';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { evaluateAssessment } from '../../../services/code-review/internal/scoring/service.js';
import type { Score } from '../../../services/code-review/internal/scoring/model.js';
import type { PositionContext } from '../../../services/code-review/internal/scoring/position-context.js';
import type { EvaluationReport } from '../../../services/code-review/internal/scoring/report-model.js';
import { withFiles } from '../ast/helpers.js';

function weighting(score: Score) {
    return score.details['positionWeighting'] as unknown as { context: PositionContext; aggregationWeight: number };
}

async function evaluate(files: Record<string, string>, check: (report: EvaluationReport) => void) {
    await withFiles(files, async (root) => {
        const ast = new AstService();
        try {
            check(await evaluateAssessment(ast, { root }, { persist: false }));
        } finally {
            ast.close();
        }
    });
}

test('position AST: leaf with an observable parameter write needs no purity or wrapper', async () => {
    await evaluate(
        { 's.ts': 'export {}; function leaf(value) { value.x = 1; } function middle(value) { leaf(value); }' },
        (report) => {
            const leaf = report.files[0]!.units.find((unit) => unit.name === 'leaf')!;
            assert.deepEqual(weighting(leaf.scope).context.roles, ['leaf']);
            assert.equal(leaf.scope.value, 99.25);
            assert.ok(
                report.rules.some(
                    (item) =>
                        item.unitId === leaf.id && item.ruleId === 'S-pure' && item.applicability === 'not-applicable',
                ),
            );
            assert.equal(leaf.complexity.value, null); // Leaf relaxation does not invent a task budget.
            assert.ok(
                !Object.keys(report.statistics['pendingReasons'] as object).some((reason) =>
                    reason.startsWith('Baseline audit only'),
                ),
            );
            const middle = report.files[0]!.units.find((unit) => unit.name === 'middle')!;
            assert.deepEqual(weighting(middle.scope).context.roles, ['intermediate']);
            const parameter = report.files[0]!.units.find(
                (unit) => unit.groupId === leaf.id && unit.kind === 'binding',
            )!;
            assert.deepEqual(weighting(parameter.scope).context.roles, ['leaf']);
        },
    );
});

test('position AST: module initialization is a caller in the depth chain', async () => {
    await evaluate({ 's.ts': 'export {}; function leaf() { return 1; } leaf();' }, (report) => {
        const leaf = report.files[0]!.units.find((unit) => unit.name === 'leaf')!;
        assert.equal(leaf.scope.value, 99.25);
        assert.ok(
            report.rules
                .find((item) => item.unitId === leaf.id && item.ruleId === 'S-CHAIN-DEPTH')!
                .evidenceIds.includes('s.ts#module'),
        );
    });
});

test('position AST: unresolved calls, constructors and callbacks cannot receive leaf relaxation', async () => {
    await evaluate(
        { 's.ts': 'export {}; function dynamic(value) { value.run(); } function allocate(C) { return new C(); }' },
        (report) => {
            for (const name of ['dynamic', 'allocate']) {
                const fn = report.files[0]!.units.find((unit) => unit.name === name)!;
                assert.equal(weighting(fn.scope).context.state, 'unknown');
                assert.equal(fn.scope.value, null);
                assert.ok(
                    report.rules.some(
                        (item) => item.unitId === fn.id && item.ruleId === 'S-POSITION' && item.verdict === 'unknown',
                    ),
                );
            }
        },
    );
});

test('position AST: imported direct calls and recursive cycles are intermediate, never leaves', async () => {
    await evaluate(
        {
            'a.ts': "import {leaf} from './b.js'; function middle() { return leaf(); } function recur() { return recur(); }",
            'b.ts': 'export function leaf() { return 1; }',
        },
        (report) => {
            for (const name of ['middle', 'recur']) {
                const fn = report.files.find((file) => file.path === 'a.ts')!.units.find((unit) => unit.name === name)!;
                assert.deepEqual(weighting(fn.scope).context.roles, ['intermediate']);
            }
            const leaf = report.files.find((file) => file.path === 'b.ts')!.units.find((unit) => unit.name === 'leaf')!;
            assert.deepEqual(weighting(leaf.scope).context.roles, ['leaf']);
            assert.equal(leaf.scope.value, null); // Exported consumers are not a closed depth boundary.
        },
    );
});

test('position AST: cyclic callers leave depth unresolved even for a call-free target', async () => {
    await evaluate(
        { 's.ts': 'export {}; function leaf() { return 1; } function recur() { leaf(); recur(); }' },
        (report) => {
            const leaf = report.files[0]!.units.find((unit) => unit.name === 'leaf')!;
            assert.deepEqual(weighting(leaf.scope).context.roles, ['leaf']);
            assert.equal(leaf.scope.value, null);
            assert.equal(
                report.rules.find((item) => item.unitId === leaf.id && item.ruleId === 'S-CHAIN-DEPTH')!.verdict,
                'unknown',
            );
        },
    );
});

test('position contracts: same facts score differently and stricter file roles override leaf contracts', async () => {
    await withFiles({ 's.ts': 'export {}; function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const baseline = await evaluateAssessment(ast, { root }, { persist: false });
            for (const role of ['intermediate', 'global', 'entry', 'public'] as const) {
                const strict = await evaluateAssessment(
                    ast,
                    {
                        root,
                        configuration: {
                            positions: [{ path: '*.ts', role }],
                            responsibilities: [{ path: 's.ts', name: 'leaf', role: 'leaf' }],
                        },
                    },
                    { persist: false },
                );
                const a = baseline.files[0]!.units[0]!,
                    b = strict.files[0]!.units[0]!;
                assert.equal(baseline.manifest.sourceDigest, strict.manifest.sourceDigest);
                assert.deepEqual(a.scope.details['baseline'], b.scope.details['baseline']);
                assert.ok(b.scope.interval!.upper < a.scope.value!);
                assert.deepEqual(weighting(b.scope).context.roles, [role]);
                assert.ok(weighting(b.scope).aggregationWeight > weighting(a.scope).aggregationWeight);
            }
        } finally {
            ast.close();
        }
    });
});

test('position contracts: module entries and shared module state automatically impose strict roles', async () => {
    await withFiles(
        {
            'entry.ts': 'export {}; function main() { return 1; }',
            'state.ts': 'export let count = 0; function bump() { count++; }',
        },
        async (root) => {
            const ast = new AstService();
            try {
                const report = await evaluateAssessment(
                    ast,
                    {
                        root,
                        configuration: { modules: [{ id: 'app', root: '.', kind: 'business', entries: ['entry.ts'] }] },
                    },
                    { persist: false },
                );
                const main = report.files
                    .find((file) => file.path === 'entry.ts')!
                    .units.find((unit) => unit.name === 'main')!;
                assert.deepEqual(weighting(main.scope).context.roles, ['entry']);
                const bump = report.files
                    .find((file) => file.path === 'state.ts')!
                    .units.find((unit) => unit.name === 'bump')!;
                assert.deepEqual(weighting(bump.scope).context.roles, ['global']);
                assert.equal(report.engineVersion, 'scoring-engine-4');
            } finally {
                ast.close();
            }
        },
    );
});

test('position contracts: an impure contracted leaf can satisfy topology without finite primitive cost proof', async () => {
    await withFiles({ 's.ts': 'export {}; function leaf(value) { value.x = 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(
                ast,
                {
                    root,
                    configuration: {
                        responsibilities: [{ path: 's.ts', name: 'leaf', role: 'leaf' }],
                    },
                },
                { persist: false },
            );
            assert.equal(report.rules.find((item) => item.ruleId === 'P-LEAF-RESPONSIBILITY')!.verdict, 'satisfied');
            assert.equal(report.files[0]!.units.find((unit) => unit.name === 'leaf')!.scope.value, 100);
        } finally {
            ast.close();
        }
    });
});

test('position versions: v0 retains its base mapping under the current semantic engine', async () => {
    const policy = policySchema.parse(
        JSON.parse(await readFile(new URL('../../../config/scoring.v0.json', import.meta.url), 'utf8')),
    );
    await withFiles({ 's.ts': 'export {}; function leaf() { return 1; }' }, async (root) => {
        const ast = new AstService();
        try {
            const report = await evaluateAssessment(ast, { root }, { persist: false, policy });
            assert.equal(report.engineVersion, 'scoring-engine-4');
            assert.equal(report.files[0]!.units[0]!.scope.value, 54);
            assert.equal(report.files[0]!.units[0]!.scope.details['positionWeighting'], undefined);
        } finally {
            ast.close();
        }
    });
});
