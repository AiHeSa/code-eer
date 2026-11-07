import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { analysisSchema, type Language } from '../../../services/code-review/internal/ast/schema.js';
import { withFiles } from './helpers.js';

const fixtures: { language: Language; entry: string; files: Record<string, string>; name: string; type: string; target: string }[] = [
  { language: 'js-ts', entry: 'sample.ts', files: { 'helper.ts': 'export function inc(n:number):number{return n+1;}',
    'sample.ts': "import {inc} from './helper.js'; export const result=inc(1);" }, name: 'inc', type: 'number', target: 'helper.ts' },
  { language: 'python', entry: 'sample.py', files: { 'helper.py': 'def inc(n: int) -> int:\n    return n+1\n',
    'sample.py': 'from helper import inc\nresult=inc(1)\n' }, name: 'inc', type: 'int', target: 'helper.py' },
  { language: 'java', entry: 'Sample.java', files: { 'Helper.java': 'class Helper { static int inc(int n){return n+1;} }',
    'Sample.java': 'class Sample { int result=Helper.inc(1); }' }, name: 'inc', type: 'int', target: 'Helper.java' },
  { language: 'go', entry: 'sample.go', files: { 'go.mod': 'module example/sample\n\ngo 1.26.0\n',
    'helper/helper.go': 'package helper\nfunc Inc(n int) int {return n+1}\n',
    'sample.go': 'package sample\nimport "example/sample/helper"\nvar result=helper.Inc(1)\n' }, name: 'Inc', type: 'int', target: 'helper/helper.go' },
  { language: 'rust', entry: 'lib.rs', files: { 'helper.rs': 'pub fn inc(n:i32)->i32{n+1}\n',
    'lib.rs': 'mod helper;\nfn caller()->i32{helper::inc(1)}\n' }, name: 'inc', type: 'i32', target: 'helper.rs' },
];

for (const fixture of fixtures) test(`semantic compiler: ${fixture.language} resolves inferred type and real cross-file definition`, async () => {
  await withFiles(fixture.files, async (root) => {
    const service = new AstService();
    try {
      const response = await service.analyze(fixture.language, analyzeParamsSchema.parse({ root, files: [fixture.entry], capabilities: ['syntax', 'structure', 'symbols', 'types'] }), { timeoutMs: 120000 });
      assert.ok(response.ok, JSON.stringify(response));
      const report = analysisSchema.parse(response.result), file = report.files[0]!;
      assert.deepEqual(file.errors, []);
      assert.ok(file.executed.includes('symbols') && file.executed.includes('types'), JSON.stringify(file.skipped));
      assert.ok(file.semantic, 'Must return actual semantic evidence');
      const ref = file.semantic.references.find((item) => item.name === fixture.name && item.definition?.uri.endsWith(fixture.target) && item.type?.includes(fixture.type));
      assert.ok(ref, JSON.stringify(file.semantic));
      assert.ok(ref.targetId && ref.definition);
      assert.equal(file.semantic.status, 'complete', JSON.stringify(file.semantic.diagnostics));
    } finally { service.close(); }
  });
});

test('semantic compiler: unknown names preserve compiler diagnostics instead of a fabricated type', async () => {
  await withFiles({ 's.ts': 'const value = missingSymbol();' }, async (root) => {
    const service = new AstService();
    try {
      const response = await service.analyze('js-ts', analyzeParamsSchema.parse({ root, files: ['s.ts'], capabilities: ['symbols', 'types'] }));
      assert.ok(response.ok);
      const file = analysisSchema.parse(response.result).files[0]!;
      assert.equal(file.semantic!.status, 'partial');
      assert.ok(file.semantic!.diagnostics.some((item) => item.severity === 'error'));
      assert.equal(file.semantic!.references.find((ref) => ref.name === 'missingSymbol')!.definition, null);
    } finally { service.close(); }
  });
});

test('semantic compiler: changing a dependency invalidates the previous project result', async () => {
  await withFiles({ 'helper.py': 'def value() -> int:\n    return 1\n', 's.py': 'from helper import value\nresult=value()\n' }, async (root) => {
    const service = new AstService();
    try {
      const params = analyzeParamsSchema.parse({ root, files: ['s.py'], capabilities: ['symbols', 'types'] });
      const first = await service.analyze('python', params); assert.ok(first.ok);
      await writeFile(join(root, 'helper.py'), 'def value() -> str:\n    return "updated"\n');
      const second = await service.analyze('python', params); assert.ok(second.ok);
      const a = analysisSchema.parse(first.result).files[0]!.semantic!, b = analysisSchema.parse(second.result).files[0]!.semantic!;
      assert.ok(a.references.some((ref) => ref.name === 'value' && ref.type?.includes('int')));
      assert.ok(b.references.some((ref) => ref.name === 'value' && ref.type?.includes('str')));
    } finally { service.close(); }
  });
});
