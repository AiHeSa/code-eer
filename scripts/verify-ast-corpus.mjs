import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AstService } from '../dist/services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../dist/services/code-review/internal/ast/protocol.js';
import { corpusSources } from './ast-corpus-sources.mjs';

function offset(source, point) {
  const lines = source.split('\n');
  assert.ok(point.line < lines.length && point.character <= lines[point.line].length);
  return lines.slice(0, point.line).reduce((total, line) => total + line.length + 1, 0) + point.character;
}
function verifyFile(file, source) {
  assert.deepEqual(file.errors, []);
  assert.deepEqual(file.skipped, []);
  assert.deepEqual(file.diagnostics, []);
  assert.equal(file.digest, createHash('sha256').update(source).digest('hex'));
  assert.ok(file.facts.length >= 20, 'Large corpus must contain at least 20 structural facts');
  const ids = new Set(file.facts.map((fact) => fact.id));
  assert.equal(ids.size, file.facts.length);
  for (const fact of file.facts) {
    assert.ok(file.coverage.nativeNodes.some((name) => name === fact.origin.nativeType
      || name.startsWith(`${fact.origin.nativeType}(`)), `Undeclared native node: ${fact.origin.nativeType}`);
    for (const data of Object.values(fact.extensions)) for (const field of Object.keys(data))
      assert.ok(file.coverage.metadata.includes(field), `Undeclared metadata: ${field}`);
    assert.ok(fact.parentId === null || ids.has(fact.parentId));
    assert.ok(fact.range, `${fact.name}: missing range`);
    const start = offset(source, fact.range.start), end = offset(source, fact.range.end);
    assert.ok(start < end, `${fact.name}: empty or reversed range`);
    if ('bodyRange' in fact && fact.bodyRange) {
      assert.ok(offset(source, fact.bodyRange.start) >= start);
      assert.ok(offset(source, fact.bodyRange.end) <= end);
    }
  }
}
async function verifyCase(service, root, entry) {
  const source = await readFile(entry.path, 'utf8');
  await writeFile(join(root, entry.name), source);
  const params = analyzeParamsSchema.parse({ root, files: [entry.name] });
  const response = await service.analyze(entry.backend, params);
  assert.ok(response.ok, JSON.stringify(response));
  const result = response.result;
  assert.equal(result.status, 'complete', JSON.stringify(result.errors));
  assert.equal(result.files.length, 1);
  const file = result.files[0];
  verifyFile(file, source);
  return { backend: entry.backend, input: entry.name, source: entry.source, version: result.version,
    digest: file.digest, lines: source.split('\n').length, facts: file.facts.length,
    byType: Object.fromEntries([...new Set(file.facts.map((fact) => fact.type))].map((type) =>
      [type, file.facts.filter((fact) => fact.type === type).length])) };
}
const service = new AstService();
const root = await mkdtemp(join(tmpdir(), 'code-eer-corpus-'));
const cases = [];
try {
  await rm(resolve('.cache/verification/ast-corpus.json'), { force: true });
  for (const entry of await corpusSources()) {
    const result = await verifyCase(service, root, entry);
    cases.push(result);
    console.log(`${result.backend} ${result.input}: ${result.lines} lines, ${result.facts} facts`);
  }
  await mkdir(resolve('.cache/verification'), { recursive: true });
  await writeFile(resolve('.cache/verification/ast-corpus.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), node: process.version, mode: 'compiled', status: 'passed', cases,
  }, null, 2) + '\n');
} finally { service.close(); await rm(root, { recursive: true, force: true }); }
