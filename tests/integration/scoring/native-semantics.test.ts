import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { evaluateAssessment } from '../../../services/code-review/internal/scoring/service.js';
import type { Language } from '../../../services/code-review/internal/ast/schema.js';
import { withFiles } from '../ast/helpers.js';

const cases: [Language, string, string][] = [
    ['python', 's.py', 'def leaf(value: int) -> int:\n    return value\n'],
    ['java', 'S.java', 'class S { static int leaf(int value){return value+1;} }'],
    ['go', 's.go', 'package s\nfunc leaf(value int)int{return value+1}\n'],
    ['rust', 'lib.rs', 'fn leaf(value:i32)->i32{value+1}\n'],
];

for (const [language, path, source] of cases)
    test(`native scoring: ${language} consumes semantic evidence and produces a finite cost score`, async () => {
        await withFiles({ [path]: source }, async (root) => {
            const service = new AstService();
            try {
                const report = await evaluateAssessment(
                    service,
                    { root, configuration: { budgets: [{ path, timeOperations: 100, spaceUnits: 100 }] } },
                    { persist: false, timeoutMs: 120000 },
                );
                const file = report.files[0]!,
                    unit = file.units.find((item) => item.name === 'leaf')!;
                assert.equal(file.syntaxCoverage, 'syntax');
                assert.deepEqual(file.errors, []);
                assert.ok(unit, JSON.stringify(file));
                assert.equal(unit.complexity.value, 100, JSON.stringify(unit.complexity));
                assert.ok(
                    report.rules.some(
                        (rule) => rule.unitId === unit.id && rule.ruleId === 'S-pure' && rule.verdict === 'satisfied',
                    ),
                );
            } finally {
                service.close();
            }
        });
    });

const projects: [Language, Record<string, string>, string][] = [
    [
        'python',
        {
            'leaf.py': 'def leaf(value: int) -> int:\n    return value\n',
            'entry.py': 'from leaf import leaf\ndef wrapped(value: int) -> int:\n    return leaf(value)\n',
        },
        'entry.py',
    ],
    [
        'java',
        {
            'Leaf.java': 'class Leaf { static int leaf(int value){return value+1;} }',
            'Entry.java': 'class Entry { static int wrapped(int value){return Leaf.leaf(value);} }',
        },
        'Entry.java',
    ],
    [
        'go',
        {
            'leaf.go': 'package s\nfunc leaf(value int)int{return value+1}\n',
            'entry.go': 'package s\nfunc wrapped(value int)int{return leaf(value)}\n',
        },
        'entry.go',
    ],
    [
        'rust',
        {
            'leaf.rs': 'pub fn leaf(value:i32)->i32{value+1}\n',
            'lib.rs': 'mod leaf;\nfn wrapped(value:i32)->i32{leaf::leaf(value)}\n',
        },
        'lib.rs',
    ],
];

for (const [language, files, path] of projects)
    test(`native scoring: ${language} follows actual cross-file calls for effects and cost`, async () => {
        await withFiles(files, async (root) => {
            const service = new AstService();
            try {
                const report = await evaluateAssessment(
                    service,
                    { root, configuration: { budgets: [{ path: '*', timeOperations: 100, spaceUnits: 100 }] } },
                    { persist: false, timeoutMs: 120000 },
                );
                const unit = report.files
                    .find((file) => file.path === path)!
                    .units.find((item) => item.name === 'wrapped')!;
                assert.equal(unit.complexity.value, 100, JSON.stringify(unit.complexity));
                assert.ok(
                    report.rules.some(
                        (rule) => rule.unitId === unit.id && rule.ruleId === 'S-pure' && rule.verdict === 'satisfied',
                    ),
                );
            } finally {
                service.close();
            }
        });
    });

test('native scoring: Python cross-file monkeypatch prevents a false static call proof', async () => {
    await withFiles(
        {
            'leaf.py': 'def leaf(): return 1\n',
            'entry.py': 'import leaf\nleaf.leaf = lambda: 2\ndef wrapped(): return leaf.leaf()\n',
        },
        async (root) => {
            const service = new AstService();
            try {
                const report = await evaluateAssessment(
                    service,
                    { root, configuration: { budgets: [{ path: '*', timeOperations: 100, spaceUnits: 100 }] } },
                    { persist: false, timeoutMs: 120000 },
                );
                const unit = report.files
                    .find((file) => file.path === 'entry.py')!
                    .units.find((item) => item.name === 'wrapped')!;
                assert.equal(unit.complexity.value, null);
                assert.ok(
                    report.rules.some(
                        (rule) => rule.unitId === unit.id && rule.ruleId === 'S-pure' && rule.verdict === 'unknown',
                    ),
                );
            } finally {
                service.close();
            }
        },
    );
});

const imports: [Language, string, string][] = [
    ['python', 's.py', 'import math\n'],
    ['java', 'S.java', 'import java.util.List; class S {}'],
    ['go', 's.go', 'package s\nimport "fmt"\nvar _=fmt.Println\n'],
    ['rust', 'lib.rs', 'use std::fmt;\n'],
];

for (const [language, path, source] of imports)
    test(`native placement: ${language} enforces contracts on compiler-resolved external imports`, async () => {
        await withFiles({ [path]: source }, async (root) => {
            const service = new AstService();
            try {
                const report = await evaluateAssessment(
                    service,
                    {
                        root,
                        configuration: {
                            modules: [{ id: 'app', root: '.', kind: 'business' }],
                            contracts: [{ moduleId: 'app', allowedDependencies: [], allowExternal: false }],
                        },
                    },
                    { persist: false, timeoutMs: 120000 },
                );
                const rule = report.rules.find((item) => item.ruleId === 'P-DEPENDENCY-BOUNDARY')!;
                assert.equal(rule.verdict, 'violated', JSON.stringify(rule));
            } finally {
                service.close();
            }
        });
    });
