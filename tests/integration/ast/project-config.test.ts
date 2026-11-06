import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();
after(() => service.close());
test('TypeScript discovery follows inherited file patterns and explicit exclusions', async () => {
  await withFiles({ 'base/config.json': '{"include":["../src/**/*"],"exclude":["../src/excluded.d.ts"]}',
    'tsconfig.json': '{"extends":"./base/config.json"}', 'src/main.ts': 'function main() {}',
    'src/excluded.d.ts': 'declare function excluded(): void;', 'other.ts': 'function other() {}' }, async (root) => {
    const result = await analyze(service, 'js-ts', [], { root, config: { tsconfig: 'tsconfig.json' } });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.files.map((file) => file.uri.split('/').at(-1)), ['main.ts']);
    const excluded = await analyze(service, 'js-ts', ['src/excluded.d.ts'], { root, config: { tsconfig: 'tsconfig.json' } });
    assert.equal(excluded.files.length, 0);
    assert.equal(excluded.skipped[0]!.code, 'TS_CONFIG_EXCLUDED');
  });
});
test('Vue-only projects honor inherited includes, excludes and output directories', async () => {
  await withFiles({ 'base/config.json': '{"include":["../src/**/*"],"exclude":["../src/skip"],"compilerOptions":{"outDir":"../src/output"}}',
    'tsconfig.json': '{"extends":"./base/config.json"}', 'src/View.vue': '<template><div /></template>',
    'src/skip/Skip.vue': '<template><span /></template>', 'src/output/Built.vue': '<template><hr /></template>',
    'other.vue': '<template><br /></template>' }, async (root) => {
    const result = await analyze(service, 'js-ts', [], { root, config: { tsconfig: 'tsconfig.json' } });
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.deepEqual(result.files.map((file) => file.uri.split('/').at(-1)), ['View.vue']);
  });
});
test('nearest package framework and source imports have independent selection precedence', async () => {
  await withFiles({ 'package.json': '{"dependencies":{"react":"19.2.0"}}', 'root.tsx': 'export const App = () => <div/>;',
    'nested/package.json': '{"dependencies":{"vue":"3.5.45"}}', 'nested/View.tsx': 'export const View = () => <div/>;',
    'source.ts': 'import { ref } from "vue"; const value = ref(0);' }, async (root) => {
    const result = await analyze(service, 'js-ts', ['root.tsx', 'nested/View.tsx', 'source.ts'], { root });
    assert.deepEqual(result.files.map((file) => file.framework), ['react', 'vue', 'vue']);
    const explicit = await analyze(service, 'js-ts', ['nested/View.tsx'], { root, framework: 'react' });
    assert.equal(explicit.files[0]!.framework, 'react');
  });
});
