import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineCapability } from '../../../services/code-review/internal/capabilities/contract.js';
import { resolveCapability } from '../../../services/code-review/internal/capabilities/router.js';

test('omitted specialization methods retain the common implementation and signature', () => {
  const common = defineCapability({ parse: (source: string) => `common:${source}`, count: (source: string) => source.length });
  const java = common.specialize({ parse: (source: string) => `java:${source}` });
  assert.equal(java.methods.parse('input'), 'java:input');
  assert.equal(java.methods.count('abc'), 3);
  assert.equal(java.methods.count, common.methods.count);
  assert.equal(common.methods.parse('input'), 'common:input');
  assert.equal(common.specialize({}).methods.parse, common.methods.parse);
});

test('language and framework overrides fall back independently through the shared contract', () => {
  const common = defineCapability({ parse: () => 'common', count: () => 1, describe: () => 'shared' });
  const language = common.specialize({ parse: () => 'language', count: () => 2 });
  const framework = common.specialize({ parse: () => 'framework' });
  const result = resolveCapability(common, language, framework);
  assert.equal(result.parse(), 'framework');
  assert.equal(result.count(), 2);
  assert.equal(result.describe(), 'shared');
  assert.equal(resolveCapability(common).parse(), 'common');
  assert.equal(resolveCapability(common, undefined, framework).count(), 1);
});

test('extra entries, non-methods, accessors and chained specialization are rejected', () => {
  const common = defineCapability({ parse: (source: string) => source.length });
  const extra = { other: () => 1 };
  // @ts-expect-error Specializations expose common methods only.
  assert.throws(() => common.specialize(extra), /Unknown capability method: other/);
  assert.throws(() => defineCapability({ get parse() { return () => 1; } }), /named methods/);
  assert.throws(() => Reflect.apply(common.specialize, common, [{ parse: 1 }]), /named methods/);
  assert.throws(() => common.specialize({}).specialize({}), /inherit directly/);
  assert.throws(() => resolveCapability(common, defineCapability({ parse: (source: string) => source.length }).specialize({})), /selected common/);
});

test('method signatures remain constrained by the common capability', () => {
  const common = defineCapability({ parse: (source: string): number => source.length });
  const validateTypes = () => {
    // @ts-expect-error Parameter types must satisfy the common contract.
    common.specialize({ parse: (source: number) => source });
    // @ts-expect-error Return types must satisfy the common contract.
    common.specialize({ parse: (source: string) => source });
  };
  assert.equal(typeof validateTypes, 'function');
});
