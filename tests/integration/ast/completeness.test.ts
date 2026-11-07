import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { languageCases } from '../../audit/ast/languages.js';
import { frameworkCases } from '../../audit/ast/frameworks.js';
import { check } from '../../audit/ast/checks.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();

after(() => service.close());

for (const probe of [...languageCases, ...frameworkCases]) {
    test(`completeness regression: ${probe.id}`, async () => {
        await withFiles(probe.files, async (root) => {
            const result = await analyze(service, probe.backend, probe.entry, { root, ...probe.params });
            const diagnostics = probe.expects.some((expected) => expected.kind === 'diagnostics');
            assert.equal(result.status, diagnostics ? 'partial' : 'complete', JSON.stringify(result));
            assert.deepEqual(result.errors, []);
            assert.ok(result.files.every((file) => file.errors.length === 0));
            if (!diagnostics) assert.ok(result.files.every((file) => file.diagnostics.length === 0));
            for (const expected of probe.expects)
                assert.deepEqual(check(result, expected, await realpath(root)), [], probe.id);
        });
    });
}
