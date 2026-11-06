import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInheritance } from '../../../scripts/capabilities/check.mjs';

const config = JSON.stringify({ languages: ['java', 'go'], frameworks: ['react', 'vue'] });
const common = 'import { defineCapability } from "../services/code-review/internal/capabilities/contract.js"; export default defineCapability({ parse(source: string) { return source; }, count: () => 1 });';
const special = 'import common from "./review.js"; export default common.specialize({ parse(source: string) { return source; } });';
const code = (base = common, variant = special) => new Map([
  ['config/capability-targets.json', config], ['rules/review.ts', base], ['rules/review.java.ts', variant],
]);

test('partial and empty specialization contracts pass; private helper functions remain private', async () => {
  for (const variant of [special, 'import common from "./review.js"; function helper() {} export default common.specialize({});']) {
    const result = await checkInheritance(code(common, variant));
    assert.equal(result.families, 1);
    assert.equal(result.specializations, 1);
  }
});

const invalid = [
  ['extra method', special.replace('parse(source: string)', 'unexpected(source: string)'), /unknown common entries/],
  ['extra public export', special + ' export function unexpected() {}', /one default definition/],
  ['unrelated base', special.replace('./review.js', './other.js'), /common default import/],
  ['direct definition', 'export default { parse() {} };', /requires one method object/],
  ['spread', 'import common from "./review.js"; export default common.specialize({ ...helpers });', /static names/],
  ['computed name', 'import common from "./review.js"; export default common.specialize({ [name]() {} });', /static names/],
  ['duplicate', 'import common from "./review.js"; export default common.specialize({ parse() {}, parse() {} });', /duplicate/],
];
for (const [name, variant, error] of invalid) test(`inheritance rejects ${name}`, async () => {
  await assert.rejects(checkInheritance(code(common, variant)), error);
});

test('removing a common method invalidates all associated specializations', async () => {
  await assert.rejects(checkInheritance(code(common.replace('parse(source: string) { return source; }, ', ''))), /unknown common entries: parse/);
});

test('missing bases, unknown targets and unavailable implementation validators fail explicitly', async () => {
  const missing = code(); missing.delete('rules/review.ts');
  await assert.rejects(checkInheritance(missing), /missing common capability/);
  const unknown = code(); unknown.set('rules/review.jvaa.ts', special);
  await assert.rejects(checkInheritance(unknown), /unregistered capability target/);
  for (const extension of ['java', 'py', 'go', 'rs', 'vue', 'json'])
    await assert.rejects(checkInheritance(new Map([['config/capability-targets.json', config],
      [`rules/review.${extension}`, 'base'], [`rules/review.go.${extension}`, 'special']])), /validator required/);
});

test('Markdown entries inherit the common document, with omissions allowed and extra entries rejected', async () => {
  const files = new Map([['config/capability-targets.json', config],
    ['rules/review.md', '# Review\n\n## parse\nRead source.\n\n## count\nCount facts.'],
    ['rules/review.go.md', '---\nextends: ./review.md\n---\n# Go\n\n## parse\nRead Go.']]);
  assert.equal((await checkInheritance(files)).specializations, 1);
  files.set('rules/review.go.md', '---\nextends: ./review.md\n---\n# Go');
  assert.equal((await checkInheritance(files)).specializations, 1);
  files.set('rules/review.go.md', '---\nextends: ./review.md\n---\n## unexpected\nExtra.');
  await assert.rejects(checkInheritance(files), /unknown common entries: unexpected/);
  files.set('rules/review.go.md', '---\nextends: ./wrong.md\n---\n## parse');
  await assert.rejects(checkInheritance(files), /declare extends/);
});

test('Markdown fenced examples do not expose methods; duplicate entries fail', async () => {
  const files = new Map([['config/capability-targets.json', config], ['rules/review.md', '## parse\nSource'],
    ['rules/review.vue.md', '---\nextends: ./review.md\n---\n## parse\n```md\n## unexpected\n```']]);
  assert.equal((await checkInheritance(files)).specializations, 1);
  files.set('rules/review.vue.md', '---\nextends: ./review.md\n---\n## parse\nOne\n## parse\nTwo');
  await assert.rejects(checkInheritance(files), /duplicate document entry/);
});

test('invalid and duplicate target declarations fail before loading implementations', async () => {
  const files = code();
  files.set('config/capability-targets.json', '{"languages":["java"],"frameworks":["java"]}');
  await assert.rejects(checkInheritance(files), /duplicate capability targets/);
});
