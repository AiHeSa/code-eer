import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import type { Language } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();

after(() => service.close());

const cases: [Language, string, string][] = [
    ['js-ts', 'ts', 'function named() {}'],
    ['python', 'py', 'def named(): pass'],
    ['java', 'java', 'class Sample { void named() {} }'],
    ['go', 'go', 'package sample\nfunc named() {}'],
    ['rust', 'rs', 'fn named() {}'],
];

for (const [backend, extension, source] of cases) {
    test(`${backend}: project discovery, multiple files, include/exclude and ignored dependencies`, async () => {
        await withFiles(
            {
                [`src/one.${extension}`]: source,
                [`src/two.${extension}`]: source,
                [`tests/test.${extension}`]: source,
                [`vendor/dependency.${extension}`]: 'invalid source',
                [`dist/generated.${extension}`]: 'invalid source',
                'unrelated.txt': 'text',
            },
            async (root) => {
                const all = await analyze(service, backend, [], { root, tests: false });
                assert.equal(all.status, 'complete');
                assert.deepEqual(
                    all.files.map((file) => file.uri.split('/').at(-1)),
                    [`one.${extension}`, `two.${extension}`],
                );
                const selected = await analyze(service, backend, [], {
                    root,
                    include: ['src/*'],
                    exclude: [`**/two.${extension}`],
                });
                assert.equal(selected.status, 'complete');
                assert.equal(selected.files.length, 1);
                assert.ok(selected.files[0]!.uri.endsWith(`/src/one.${extension}`));
            },
        );
    });
}

test('Python and Java configured language versions reject newer syntax', async () => {
    await withFiles({ 's.py': 'match value:\n    case 1: pass', 'S.java': 'record S(int n) {}' }, async (root) => {
        for (const [backend, file, config] of [
            ['python', 's.py', { pythonVersion: 9 }],
            ['java', 'S.java', { javaLanguageLevel: 'JAVA_8' }],
        ] as const) {
            const result = await analyze(service, backend, [file], { root, config });
            assert.equal(result.status, 'partial');
            assert.ok(result.files[0]!.diagnostics.some((item) => /supported/.test(item.message)));
            assert.equal(result.files[0]!.skipped[0]!.code, 'STRUCTURE_INCOMPLETE');
        }
    });
});

test('Rust edition constraints are reported as unexecuted', async () => {
    await withFiles({ 's.rs': 'fn named() {}' }, async (root) => {
        const result = await analyze(service, 'rust', ['s.rs'], { root, config: { rustEdition: '2015' } });
        assert.equal(result.status, 'partial');
        assert.equal(result.files[0]!.skipped[0]!.code, 'EDITION_NOT_ENFORCED');
    });
});

test('invalid UTF-8, oversized files and directory inputs fail explicitly', async () => {
    await withFiles({ 's.py': '' }, async (root) => {
        await writeFile(join(root, 's.py'), Buffer.from([0xff, 0xfe]));
        const invalid = await analyze(service, 'python', ['s.py'], { root });
        assert.equal(invalid.status, 'failed');
        assert.equal(invalid.files[0]!.errors[0]!.code, 'FILE_ERROR');
        await writeFile(join(root, 's.py'), ' '.repeat(4 * 1024 * 1024 + 1));
        const large = await analyze(service, 'python', ['s.py'], { root });
        assert.equal(large.files[0]!.errors[0]!.code, 'FILE_TOO_LARGE');
        await mkdir(join(root, 'directory.py'));
        const directory = await analyze(service, 'python', ['directory.py'], { root });
        assert.equal(directory.files[0]!.errors[0]!.code, 'NOT_A_FILE');
    });
});
