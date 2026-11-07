import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();

after(() => service.close());

test('mixed valid and missing files produce partial results', async () => {
    const result = await analyze(service, 'python', ['python/sample.py', 'missing.py']);
    assert.equal(result.status, 'partial');
    assert.equal(result.files.length, 2);
    assert.ok(result.files[0]!.facts.length);
    assert.ok(result.files[1]!.errors.length);
});

test('project discovery honors exclusions and test selection', async () => {
    await withFiles(
        { 'main.py': 'def main(): pass', 'test_sample.py': 'def test(): pass', 'excluded.py': 'def excluded(): pass' },
        async (root) => {
            const result = await analyze(service, 'python', [], { root, tests: false, exclude: ['excluded.py'] });
            assert.equal(result.status, 'complete');
            assert.equal(result.files.length, 1);
            assert.ok(result.files[0]!.uri.endsWith('/main.py'));
        },
    );
});

test('symlinks outside the root are rejected', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'code-eer-outside-'));
    try {
        await writeFile(join(outside, 'outside.py'), 'def outside(): pass');
        await withFiles({}, async (root) => {
            await symlink(join(outside, 'outside.py'), join(root, 'link.py'));
            const result = await analyze(service, 'python', ['link.py'], { root });
            assert.equal(result.status, 'failed');
            assert.equal(result.files[0]!.errors[0]!.code, 'PATH_OUTSIDE_ROOT');
        });
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test('fact selection retains structural ancestors and reports unsupported categories', async () => {
    const result = await analyze(service, 'python', ['python/sample.py'], { factTypes: ['method'] });
    assert.equal(result.status, 'complete');
    assert.deepEqual(
        result.files[0]!.facts.map((item) => item.type),
        ['type', 'method'],
    );
    const unsupported = await analyze(service, 'python', ['python/sample.py'], { factTypes: ['directive'] });
    assert.equal(unsupported.status, 'partial');
    assert.equal(unsupported.skipped[0]!.code, 'UNSUPPORTED_FACT_TYPE');
});

test('TypeScript config inheritance is parsed and missing config is reported', async () => {
    await withFiles(
        {
            'main.ts': 'export const value = 1;',
            'base.json': '{"compilerOptions":{"strict":true}}',
            'tsconfig.json': '{"extends":"./base.json","include":["*.ts"]}',
        },
        async (root) => {
            const result = await analyze(service, 'js-ts', ['main.ts'], {
                root,
                config: { tsconfig: 'tsconfig.json' },
            });
            assert.equal(result.status, 'complete', JSON.stringify(result));
            const missing = await analyze(service, 'js-ts', ['main.ts'], {
                root,
                config: { tsconfig: 'missing.json' },
            });
            assert.equal(missing.status, 'failed');
        },
    );
});
