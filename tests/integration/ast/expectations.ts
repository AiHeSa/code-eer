import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Fact, FileResult, Range } from '../../../services/code-review/internal/ast/schema.js';

export interface ExpectedFact {
  key: string; type: Fact['type']; name: string | null; text: string; parent?: string;
  occurrence?: number; nativeType?: string; body?: string | null; parameters?: string[];
  returns?: string[]; async?: boolean; data?: Record<string, unknown>;
}

function textStart(source: string, text: string, occurrence = 0): number {
  let start = -1;
  for (let index = 0; index <= occurrence; index++) start = source.indexOf(text, start + 1);
  assert.ok(start >= 0, `Expected source text is absent: ${text}`);
  return start;
}

function offsetsRange(source: string, start: number, end: number): Range {
  const position = (offset: number) => {
    const lines = source.substring(0, offset).split('\n');
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  };
  return { start: position(start), end: position(end) };
}

export function expectedRange(source: string, text: string, occurrence = 0): Range {
  const start = textStart(source, text, occurrence);
  return offsetsRange(source, start, start + text.length);
}

function assertFields(fact: Fact, expected: ExpectedFact, source: string): void {
  assert.equal(fact.origin.nativeType, expected.nativeType ?? fact.origin.nativeType);
  assert.deepEqual(fact.range, expectedRange(source, expected.text, expected.occurrence), `${expected.key}: range`);
  if ('parameters' in fact) {
    assert.deepEqual(fact.parameters, expected.parameters ?? [], `${expected.key}: parameters`);
    assert.deepEqual(fact.returns, expected.returns ?? [], `${expected.key}: returns`);
    assert.equal(fact.async, expected.async ?? false, `${expected.key}: async`);
    const bodyStart = expected.body == null ? -1 : expected.text.lastIndexOf(expected.body);
    assert.ok(expected.body == null || bodyStart >= 0, `${expected.key}: body must occur within declaration`);
    const offset = textStart(source, expected.text, expected.occurrence) + bodyStart;
    assert.deepEqual(fact.bodyRange, expected.body == null ? null
      : offsetsRange(source, offset, offset + expected.body.length), `${expected.key}: bodyRange`);
  }
  const data = Object.values(fact.extensions)[0];
  for (const [key, value] of Object.entries(expected.data ?? {}))
    assert.deepEqual((data as Record<string, unknown>)[key], value, `${expected.key}: extensions.${key}`);
}

export function assertInventory(file: FileResult, source: string, expected: ExpectedFact[]): void {
  assert.deepEqual(file.errors, []);
  assert.deepEqual(file.diagnostics, []);
  assert.equal(file.digest, createHash('sha256').update(source, 'utf8').digest('hex'));
  assert.equal(file.facts.length, expected.length, 'Complete declaration inventory differs');
  assert.equal(new Set(file.facts.map((fact) => fact.id)).size, file.facts.length, 'Fact identifiers must be unique');
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const item of expected) {
    const parent = item.parent ? ids.get(item.parent) : null;
    assert.ok(!item.parent || parent, `Expected parent must precede child: ${item.key}`);
    const fact = file.facts.find((fact) => !used.has(fact.id) && fact.type === item.type
      && fact.name === item.name && fact.parentId === parent);
    assert.ok(fact, `Missing ${item.key}: ${item.type} ${item.name} under ${item.parent ?? '<file>'}`);
    used.add(fact.id); ids.set(item.key, fact.id);
    assertFields(fact, item, source);
  }
}
