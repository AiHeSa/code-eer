import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { capabilitiesSchema, type Language } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();
after(() => service.close());
const cases: [Language, string][] = [['js-ts', 'js-ts/sample.ts'], ['python', 'python/sample.py'],
  ['java', 'java/Sample.java'], ['go', 'go/sample.go'], ['rust', 'rust/sample.rs']];
for (const [language, file] of cases) {
  test(`${language}: capabilities and file expose validated conversion and syntax profiles`, async () => {
    const response = await service.capabilities(language);
    assert.ok(response.ok);
    const caps = capabilitiesSchema.parse(response.result);
    assert.equal(caps.coverage.projection, 'selected-facts');
    assert.equal(caps.syntax.parserVersion, caps.version);
    assert.ok(caps.coverage.limitations.length);
    assert.equal(capabilitiesSchema.safeParse({ ...caps, coverage: undefined }).success, false);
    const result = await analyze(service, language, [file]);
    const parsed = result.files[0]!;
    assert.deepEqual(parsed.coverage, caps.coverage);
    assert.deepEqual(parsed.syntax, caps.syntax);
    for (const fact of parsed.facts) {
      assert.ok(caps.coverage.nativeNodes.some((name) => name === fact.origin.nativeType || name.startsWith(`${fact.origin.nativeType}(`)), fact.origin.nativeType);
      for (const field of Object.keys(fact.extensions[language]!)) assert.ok(caps.coverage.metadata.includes(field), field);
    }
  });
}

test('framework profiles expose SFC mapping and candidate limitations', async () => {
  const response = await service.capabilities('js-ts');
  assert.ok(response.ok);
  const caps = capabilitiesSchema.parse(response.result);
  assert.ok(caps.frameworkCoverage.react!.limitations.some((value) => value.includes('syntax candidates')));
  const vue = await analyze(service, 'js-ts', ['js-ts/View.vue']);
  assert.deepEqual(vue.files[0]!.coverage, caps.frameworkCoverage.vue);
  assert.equal(vue.files[0]!.syntax.parserVersion, caps.version);
});

test('effective grammar constraints retain requested versions and TypeScript project target', async () => {
  await withFiles({ 's.py': 'def run(): pass', 'S.java': 'class S {}', 's.rs': 'fn run() {}',
    's.ts': 'class S {}', 'tsconfig.json': '{"compilerOptions":{"target":"ES2022"},"files":["s.ts"]}' }, async (root) => {
    const cases = [
      ['python', 's.py', { pythonVersion: 11 }, '3.11', 'best-effort'],
      ['java', 'S.java', { javaLanguageLevel: 'JAVA_17' }, 'JAVA_17', 'parser'],
      ['rust', 's.rs', { rustEdition: '2024' }, '2024', 'not-enforced'],
      ['js-ts', 's.ts', { tsconfig: 'tsconfig.json' }, 'es2022', 'not-enforced'],
    ] as const;
    for (const [language, path, config, version, constraint] of cases) {
      const result = await analyze(service, language, [path], { root, config });
      assert.equal(result.files[0]!.errors.length, 0, JSON.stringify(result));
      assert.equal(result.files[0]!.syntax.targetVersion?.toLowerCase(), version.toLowerCase(), JSON.stringify(result));
      assert.equal(result.files[0]!.syntax.versionConstraint, constraint);
    }
  });
});
