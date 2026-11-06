import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import type { Language, Range } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();
after(() => service.close());
const cases: [Language, string, string, string, Range][] = [
  ['python', 's.py', 'title = "中😀"\r\n$\n', 'SyntaxError', { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }],
  ['go', 's.go', 'package sample\n@\n', 'SYNTAX_ERROR', { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }],
  ['java', 'S.java', 'class S { @ }', 'SYNTAX_ERROR', { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } }],
  ['rust', 's.rs', 'fn broken() { @ }', 'SYNTAX_ERROR', { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } }],
  ['js-ts', 's.ts', 'const value = ;', 'TS1109', { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } }],
];
for (const [language, name, source, code, range] of cases) {
  test(`${language}: diagnostic code, source, severity and complete range`, async () => {
    await withFiles({ [name]: source }, async (root) => {
      const result = await analyze(service, language, [name], { root });
      assert.equal(result.status, 'partial');
      const file = result.files[0]!;
      assert.equal(file.diagnostics.length, 1);
      assert.deepEqual(file.diagnostics[0], { code, range, source: language, severity: 'error', message: file.diagnostics[0]!.message });
      assert.ok(file.diagnostics[0]!.message.length > 0);
      assert.deepEqual(file.errors, []);
      assert.equal(file.skipped[0]!.code, 'STRUCTURE_INCOMPLETE');
    });
  });
  test(`${language}: missing files, unsupported semantics and unavailable worker`, async () => {
    await withFiles({ [name]: source }, async (root) => {
      const missing = await analyze(service, language, [`missing-${name}`], { root });
      assert.equal(missing.status, 'failed');
      assert.equal(missing.files[0]!.errors.length, 1);
      const limited = await analyze(service, language, [name], { root, capabilities: ['symbols', 'types'] });
      assert.equal(limited.status, 'failed');
      assert.deepEqual(limited.files[0]!.executed, []);
      assert.deepEqual(limited.files[0]!.skipped.map((item) => item.message), ['symbols', 'types']);
      const broken = new AstService({ [language]: { command: '/missing/code-eer-parser', args: [] } });
      try {
        const response = await broken.capabilities(language);
        assert.ok(!response.ok);
        assert.equal(response.error.code, 'BACKEND_UNAVAILABLE');
      } finally { broken.close(); }
    });
  });
}
