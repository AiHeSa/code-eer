import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { capabilitiesSchema, type Language } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();

after(() => service.close());

const cases: [Language, string, string, string][] = [
    ['python', 'python/sample.py', 'load', 'method'],
    ['java', 'java/Sample.java', 'load', 'method'],
    ['go', 'go/sample.go', 'Load', 'method'],
    ['rust', 'rust/sample.rs', 'load', 'method'],
    ['js-ts', 'js-ts/sample.ts', 'load', 'function'],
];

for (const [language, path, name, type] of cases) {
    test(`${language}: real parser, capabilities and declaration hierarchy`, async () => {
        const response = await service.capabilities(language);
        assert.ok(response.ok);
        const caps = capabilitiesSchema.parse(response.result);
        assert.equal(caps.available, true, JSON.stringify(caps.errors));
        assert.ok(caps.capabilities.includes('types') && caps.capabilities.includes('symbols'));
        const result = await analyze(service, language, [path]);
        assert.equal(result.status, 'complete', JSON.stringify(result));
        const file = result.files[0]!;
        assert.equal(file.diagnostics.length, 0);
        const fact = file.facts.find((item) => item.name === name && item.type === type);
        assert.ok(fact, JSON.stringify(file.facts));
        assert.equal(file.digest.length, 64);
        assert.ok(fact.range);
        assert.ok(file.facts.some((item) => item.type === 'import'));
    });
}

const invalid: [Language, string, string][] = [
    ['python', 'broken.py', 'def broken(:'],
    ['java', 'Broken.java', 'class Broken { void f( {'],
    ['go', 'broken.go', 'package broken\nfunc f( {'],
    ['rust', 'broken.rs', 'fn broken( {'],
    ['js-ts', 'broken.ts', 'function broken( {'],
];

for (const [language, file, source] of invalid) {
    test(`${language}: syntax diagnostics and incomplete structure`, async () => {
        await withFiles({ [file]: source }, async (root) => {
            const result = await analyze(service, language, [file], { root });
            assert.equal(result.status, 'partial', JSON.stringify(result));
            assert.ok(result.files[0]!.diagnostics.length);
            const syntax = await analyze(service, language, [file], { root, capabilities: ['syntax'] });
            assert.equal(syntax.status, 'complete');
        });
    });
}

test('missing inputs remain errors and semantic capabilities return real evidence', async () => {
    const missing = await analyze(service, 'python', ['missing.py']);
    assert.equal(missing.status, 'failed');
    assert.ok(missing.files[0]!.errors.length);
    const limited = await analyze(service, 'python', ['python/sample.py'], { capabilities: ['syntax', 'types'] });
    assert.equal(limited.status, 'complete', JSON.stringify(limited));
    assert.ok(limited.files[0]!.executed.includes('types'));
    assert.ok(limited.files[0]!.semantic!.references.some((item) => item.type !== null));
});
