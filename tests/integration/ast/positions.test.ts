import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import type { Language } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';
import { expectedRange } from './expectations.js';

const service = new AstService();
after(() => service.close());
const cases: [Language, string, string, string][] = [
  ['python', 'sample.py', 'title = "中文😀"; ', 'def named():\r\n    pass\r\n'],
  ['go', 'sample.go', 'package fixture\r\nvar title = "中文😀"; ', 'func Named() {}\r\n'],
  ['java', 'Sample.java', 'class Sample { String title = "中文😀";\t', 'void named() {} }\r\n'],
  ['rust', 'sample.rs', 'const TITLE: &str = "中文😀"; ', 'fn named() {}\r\n'],
  ['js-ts', 'sample.ts', 'const title = "中文😀"; ', 'function named() {}\r\n'],
];
for (const [language, file, prefix, declaration] of cases) {
  test(`${language}: non-BMP characters, tabs and CRLF produce UTF-16 positions`, async () => {
    const actualPrefix = language === 'python' ? prefix + '\r\n' : prefix;
    await withFiles({ [file]: actualPrefix + declaration }, async (root) => {
      const result = await analyze(service, language, [file], { root });
      assert.equal(result.status, 'complete', JSON.stringify(result));
      const fact = result.files[0]!.facts.find((fact) => ['named', 'Named'].includes(fact.name ?? ''));
      assert.ok(fact?.range);
      const lines = actualPrefix.split('\n');
      assert.deepEqual(fact.range.start, { line: lines.length - 1, character: lines.at(-1)!.length });
      const text = language === 'java' ? 'void named() {}' : declaration.trimEnd();
      assert.deepEqual(fact.range, expectedRange(actualPrefix + declaration, text));
      assert.ok('bodyRange' in fact);
      assert.deepEqual(fact.bodyRange, expectedRange(actualPrefix + declaration, language === 'python' ? 'pass' : '{}'));
    });
  });
}
