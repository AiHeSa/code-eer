import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import type { Analysis, Fact } from '../../../services/code-review/internal/ast/schema.js';
import type { Expectation, Selector } from './model.js';

export function matches(fact: Fact, selector: Selector): boolean {
  const data = Object.assign({}, ...Object.values(fact.extensions));
  return (selector.type === undefined || fact.type === selector.type)
    && (selector.name === undefined || fact.name === selector.name)
    && (selector.nativeType === undefined || fact.origin.nativeType === selector.nativeType)
    && Object.entries(selector.data ?? {}).every(([key, value]) => isDeepStrictEqual(data[key], value));
}

export function check(result: Analysis, expected: Expectation, root: string): string[] {
  if (expected.kind === 'executed') return result.files.length > 0
    && result.files.every((file) => file.executed.includes(expected.capability)) ? [] : [`Capability not executed: ${expected.capability}`];
  const file = result.files.find((file) => relative(root, fileURLToPath(file.uri)) === expected.file);
  if (expected.kind === 'absentFile') return file ? [`Excluded file was analyzed: ${expected.file}`] : [];
  if (!file) return [`Missing result file: ${expected.file}`];
  if (expected.kind === 'semantic') return file.semantic?.symbols.length && file.semantic.references.some((ref) =>
    ref.name === expected.name && ref.type?.includes(expected.typeIncludes) && ref.definition && ref.targetId)
    ? [] : [`No real resolved symbol/type evidence for ${expected.name}`];
  if (expected.kind === 'diagnostics') return file.diagnostics.length >= expected.min ? [] : ['Expected syntax diagnostic is absent'];
  if (expected.kind === 'framework') return file.framework === expected.value ? [] : [`Framework is ${file.framework}`];
  const facts = file.facts.filter((fact) => matches(fact, expected.selector));
  if (expected.kind === 'facts') return facts.length >= expected.min && facts.length <= (expected.max ?? Infinity)
    ? [] : [`Expected ${expected.min}..${expected.max ?? '∞'} facts, received ${facts.length}`];
  if (!facts.length) return [`Missing fact: ${JSON.stringify(expected.selector)}`];
  if (expected.kind === 'range') return facts.every((fact) => isDeepStrictEqual(fact.range, expected.range))
    ? [] : [`Incorrect range: ${JSON.stringify(facts.map((fact) => fact.range))}`];
  return facts.every((fact) => file.facts.some((parent) => parent.id === fact.parentId && matches(parent, expected.parent)))
    ? [] : ['Required structural parent is absent'];
}
