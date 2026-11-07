import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { collectAssessment } from '../../../services/code-review/internal/assessment/service.js';
import { rangeAt } from '../../../services/code-review/internal/ast/normalize.js';
import { withFiles } from '../ast/helpers.js';
import { withAssessment } from './helpers.js';

test('collection: Vue block identifiers and Unicode CRLF ranges refer to original source', async () => {
  const source = `<template><span>中文🙂</span></template>\r\n<script lang="ts">\r\nexport function first() { return 1; }\r\n</script>\r\n<script setup lang="ts">\r\nconst second = () => 2;\r\nsecond();\r\n</script>`;
  await withAssessment(source, ({ evidence, astFacts }) => {
    assert.equal(evidence.functions.length, 2);
    const first = evidence.functions.find((item) => item.name === 'first')!;
    const snippet = 'export function first() { return 1; }';
    const start = source.indexOf(snippet);
    assert.deepEqual(first.range, rangeAt(source, start, start + snippet.length));
    assert.equal(new Set(evidence.scopes.map((item) => item.id)).size, evidence.scopes.length);
    const second = evidence.functions.find((item) => item.name === 'second')!;
    assert.equal(evidence.calls.find((item) => item.callee === 'second')?.targetId, second.id);
    assert.ok(astFacts.some((item) => item.type === 'component'));
    assert.ok(evidence.coverage.limitations.some((item) => item.includes('independent lexical scopes')));
  }, 'components/空间 View.vue');
});

test('collection: framework-specific facts remain linked to the React AST', async () => {
  await withAssessment(`import {useState} from 'react';
export function View() { const [value, setValue] = useState(0); return <div>{value}</div>; }`, ({ evidence, astFacts, placement }) => {
    assert.ok(evidence.declarations.some((item) => item.name === 'value'));
    assert.equal(evidence.calls.find((item) => item.callee === 'useState')?.targetId, null);
    assert.ok(astFacts.some((item) => item.type === 'component'));
    assert.ok(placement.frameworkCandidates.length);
  }, 'View.tsx');
});

test('collection: native syntax supplies real loops, nested declarations and calls', async () => {
  await withFiles({ 'sample.py': 'def outer(n):\n    def inner():\n        return n\n    for i in range(n):\n        inner()\n' }, async (root) => {
    const service = new AstService();
    try {
      const report = await collectAssessment(service, 'python', analyzeParamsSchema.parse({ root, files: ['sample.py'] }));
      assert.deepEqual(report.errors, []);
      assert.equal(report.files.length, 1);
      const file = report.files[0]!;
      assert.equal(file.evidence.coverage.level, 'syntax');
      assert.equal(file.complexity.status, 'partial');
      assert.equal(file.evidence.loops.length, 1);
      assert.ok(file.evidence.functions.find((item) => item.name === 'inner')?.parentFunctionId);
      assert.equal(file.evidence.functions[0]!.immediate, false);
      assert.ok(file.evidence.declarations.some((item) => item.name === 'outer' && item.kind === 'function'));
      assert.ok(file.evidence.calls.some((item) => item.callee === 'inner' && item.loopIds.length === 1));
    } finally { service.close(); }
  });
});

test('collection: syntax errors retain diagnostics and make evidence incomplete', async () => {
  await withFiles({ 'broken.ts': 'function broken( {' }, async (root) => {
    const service = new AstService();
    try {
      const report = await collectAssessment(service, 'js-ts', analyzeParamsSchema.parse({ root, files: ['broken.ts'] }));
      assert.ok(report.diagnostics.length);
      assert.equal(report.astStatus, 'partial');
      assert.equal(report.files[0]!.evidence.coverage.complete, false);
      assert.equal(report.files[0]!.composite.score, null);
    } finally { service.close(); }
  });
});

test('collection: missing files return an explicit failure, never an empty successful assessment', async () => {
  await withFiles({}, async (root) => {
    const service = new AstService();
    try {
      const report = await collectAssessment(service, 'js-ts', analyzeParamsSchema.parse({ root, files: ['missing.ts'] }));
      assert.equal(report.status, 'failed');
      assert.ok(report.errors.length);
      assert.equal(report.files.length, 0);
    } finally { service.close(); }
  });
});

test('collection: a source edit between AST and evidence collection rejects mixed snapshots', async () => {
  await withFiles({ 'sample.ts': 'export const value = 1;' }, async (root) => {
    const service = new AstService();
    const analyze = service.analyze.bind(service);
    service.analyze = async (...args) => {
      const response = await analyze(...args);
      await writeFile(join(root, 'sample.ts'), 'export const value = 2;');
      return response;
    };
    try {
      const report = await collectAssessment(service, 'js-ts', analyzeParamsSchema.parse({ root, files: ['sample.ts'] }));
      assert.equal(report.status, 'failed');
      assert.equal(report.errors[0]?.code, 'SOURCE_CHANGED');
      assert.equal(report.files.length, 0);
    } finally { service.close(); }
  });
});
