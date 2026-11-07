import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { collectAssessment } from '../../../services/code-review/internal/assessment/service.js';
import type { Language } from '../../../services/code-review/internal/ast/schema.js';
import { withFiles } from '../ast/helpers.js';

const fixtures: [Language, string, string][] = [
    ['python', 's.py', 'def child(n):\n    return n\ndef outer(n):\n    for i in range(n):\n        child(i)\n'],
    [
        'java',
        'S.java',
        'class S { static int child(int n){return n;} static void outer(int n){for(int i=0;i<n;i++){child(i);}} }',
    ],
    ['go', 's.go', 'package s\nfunc child(n int)int{return n}\nfunc outer(n int){for i:=0;i<n;i++{child(i)}}\n'],
    ['rust', 'lib.rs', 'fn child(n:i32)->i32{n}\nfn outer(n:i32){for i in 0..n{child(i);}}\n'],
];

for (const [language, path, source] of fixtures)
    test(`native syntax: ${language} projects variables, references, calls, loops and exits`, async () => {
        await withFiles({ [path]: source }, async (root) => {
            const service = new AstService();
            try {
                const report = await collectAssessment(
                    service,
                    language,
                    analyzeParamsSchema.parse({ root, files: [path] }),
                );
                assert.deepEqual(report.errors, []);
                const file = report.files[0]!,
                    evidence = file.evidence;
                assert.equal(evidence.coverage.level, 'syntax');
                assert.equal(evidence.coverage.complete, true);
                const outer = evidence.functions.find((fn) => fn.name === 'outer')!,
                    child = evidence.functions.find((fn) => fn.name === 'child')!;
                assert.ok(outer && child);
                assert.ok(
                    evidence.declarations.some(
                        (item) => item.kind === 'parameter' && item.name === 'n' && item.functionId === outer.id,
                    ),
                );
                assert.ok(evidence.references.some((ref) => ref.name === 'n' && ref.targetId));
                assert.equal(evidence.loops.filter((loop) => loop.functionId === outer.id).length, 1);
                const call = evidence.calls.find((call) => call.functionId === outer.id && call.callee === 'child')!;
                assert.ok(call && call.loopIds.length === 1);
                assert.equal(call.targetId, child.id);
                if (language !== 'rust')
                    assert.ok(evidence.exits.some((exit) => exit.kind === 'return' && exit.functionId === child.id));
            } finally {
                service.close();
            }
        });
    });

test('native scope: Python global and nonlocal writes retain the actual owning bindings', async () => {
    await withFiles(
        {
            's.py': 'value=0\ndef outer():\n    captured=0\n    def inner():\n        nonlocal captured\n        global value\n        captured=1\n        value=2\n    return inner\n',
        },
        async (root) => {
            const service = new AstService();
            try {
                const report = await collectAssessment(
                    service,
                    'python',
                    analyzeParamsSchema.parse({ root, files: ['s.py'] }),
                );
                const evidence = report.files[0]!.evidence,
                    outer = evidence.functions.find((fn) => fn.name === 'outer')!,
                    inner = evidence.functions.find((fn) => fn.name === 'inner')!;
                const captured = evidence.declarations.find((item) => item.name === 'captured')!,
                    global = evidence.declarations.find((item) => item.name === 'value')!;
                assert.equal(captured.functionId, outer.id);
                assert.equal(global.functionId, null);
                assert.ok(
                    evidence.references.some(
                        (ref) => ref.targetId === captured.id && ref.functionId === inner.id && ref.access === 'write',
                    ),
                );
                assert.ok(
                    evidence.references.some(
                        (ref) => ref.targetId === global.id && ref.functionId === inner.id && ref.access === 'write',
                    ),
                );
            } finally {
                service.close();
            }
        },
    );
});

test('native scope: Python comprehensions count repeated bodies and do not leak loop bindings', async () => {
    await withFiles(
        {
            's.py': 'def use(x): return x\ndef outer(n):\n    values=[{"v":use(i+j)} for i in range(n) for j in range(2)]\n    return values,i\n',
        },
        async (root) => {
            const service = new AstService();
            try {
                const report = await collectAssessment(
                    service,
                    'python',
                    analyzeParamsSchema.parse({ root, files: ['s.py'] }),
                );
                const evidence = report.files[0]!.evidence,
                    call = evidence.calls.find((item) => item.callee === 'use')!;
                assert.equal(call.loopIds.length, 2);
                assert.ok(evidence.allocations.some((item) => item.kind === 'object' && item.loopIds.length === 2));
                assert.ok(evidence.allocations.some((item) => item.kind === 'array' && item.loopIds.length === 0));
                assert.equal(
                    evidence.references.find((ref) => ref.name === 'i' && ref.range.start.line === 3)!.targetId,
                    null,
                );
            } finally {
                service.close();
            }
        },
    );
});

test('native scope: generator bodies are deferred while the first iterable belongs to the outer function', async () => {
    await withFiles(
        { 's.py': 'def tick(x): return x\ndef outer(n):\n    return (tick(i) for i in range(n))\n' },
        async (root) => {
            const service = new AstService();
            try {
                const report = await collectAssessment(
                    service,
                    'python',
                    analyzeParamsSchema.parse({ root, files: ['s.py'] }),
                );
                const evidence = report.files[0]!.evidence,
                    generator = evidence.functions.find((fn) => fn.generator)!,
                    outer = evidence.functions.find((fn) => fn.name === 'outer')!;
                assert.ok(generator && generator.hasBody);
                assert.equal(evidence.calls.find((call) => call.callee === 'tick')!.functionId, generator.id);
                assert.equal(evidence.calls.find((call) => call.callee === 'range')!.functionId, outer.id);
                assert.ok(evidence.allocations.some((item) => item.kind === 'closure' && item.functionId === outer.id));
            } finally {
                service.close();
            }
        },
    );
});

test('native scope: Rust same-line shadow initializers refer to the preceding binding', async () => {
    await withFiles({ 'lib.rs': 'fn f(x:i32)->i32{let x=x+1;let x=x+2;x}' }, async (root) => {
        const service = new AstService();
        try {
            const report = await collectAssessment(
                service,
                'rust',
                analyzeParamsSchema.parse({ root, files: ['lib.rs'] }),
            );
            const evidence = report.files[0]!.evidence,
                bindings = evidence.declarations.filter((item) => item.name === 'x');
            const refs = evidence.references.filter((item) => item.name === 'x');
            assert.equal(bindings.length, 3);
            assert.equal(refs.length, 3);
            assert.deepEqual(
                refs.map((ref) => ref.targetId),
                bindings.map((item) => item.id),
            );
        } finally {
            service.close();
        }
    });
});

test('native syntax: modern Python generics and Unicode source ranges stay intact', async () => {
    const source = '# 😀\ndef identity[T](值: T) -> T:\n    return 值\n';
    await withFiles({ 's.py': source }, async (root) => {
        const service = new AstService();
        try {
            const report = await collectAssessment(
                service,
                'python',
                analyzeParamsSchema.parse({ root, files: ['s.py'] }),
            );
            const evidence = report.files[0]!.evidence;
            assert.equal(evidence.coverage.complete, true);
            assert.ok(
                evidence.declarations.some(
                    (item) => item.name === '值' && item.range.start.line === 1 && item.range.start.character === 16,
                ),
            );
            assert.ok(
                evidence.references.some((item) => item.name === '值' && item.range.start.line === 2 && item.targetId),
            );
        } finally {
            service.close();
        }
    });
});

test('native storage: Java static and instance fields retain distinct ownership', async () => {
    await withFiles(
        { 'S.java': 'class S { static int shared; int owned; private static int hidden; }' },
        async (root) => {
            const service = new AstService();
            try {
                const report = await collectAssessment(
                    service,
                    'java',
                    analyzeParamsSchema.parse({ root, files: ['S.java'] }),
                );
                const bindings = report.files[0]!.evidence.declarations;
                assert.equal(bindings.find((item) => item.name === 'shared')!.storage, 'global');
                assert.equal(bindings.find((item) => item.name === 'owned')!.storage, 'instance');
                assert.equal(bindings.find((item) => item.name === 'hidden')!.exported, false);
            } finally {
                service.close();
            }
        },
    );
});
