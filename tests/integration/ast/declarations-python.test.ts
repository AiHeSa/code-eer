import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();
after(() => service.close());
const source = `from .utils import name as alias
type Pair[T] = tuple[T, T]
class Box:
    @staticmethod
    def build(value: str = "中文😀") -> "Box":
        return value
    async def load(self, first: int, /, value: str = "x", *rest: int, flag: bool = True, **options: str) -> list[str]:
        def nested(item: str) -> str:
            return item
        callback = lambda item: item + 1
        return [value]
`;
const expected: ExpectedFact[] = [
  { key: 'import', type: 'import', name: 'utils', text: 'from .utils import name as alias',
    data: { level: 1, names: [{ name: 'name', alias: 'alias' }] } },
  { key: 'alias', type: 'type', name: 'Pair', text: 'type Pair[T] = tuple[T, T]', nativeType: 'TypeAlias' },
  { key: 'box', type: 'type', name: 'Box', text: source.slice(source.indexOf('class Box')).trimEnd() },
  { key: 'build', type: 'method', name: 'build', parent: 'box', text: 'def build(value: str = "中文😀") -> "Box":\n        return value',
    parameters: ['value'], returns: ["'Box'"], body: 'return value', data: { decorators: ['staticmethod'] } },
  { key: 'load', type: 'method', name: 'load', parent: 'box', text: source.slice(source.indexOf('async def')).trimEnd(),
    parameters: ['self', 'first', 'value', '*rest', 'flag', '**options'], returns: ['list[str]'], async: true,
    body: source.slice(source.indexOf('def nested')).trimEnd(), data: { positionalOnly: ['self', 'first'], keywordOnly: ['flag'] } },
  { key: 'nested', type: 'function', name: 'nested', parent: 'load', text: 'def nested(item: str) -> str:\n            return item',
    parameters: ['item'], returns: ['str'], body: 'return item' },
  { key: 'lambda', type: 'function', name: null, parent: 'load', text: 'lambda item: item + 1',
    parameters: ['item'], body: 'item + 1' },
];
test('Python complete nested declaration, parameter-kind, decorator and alias inventory', async () => {
  await withFiles({ 'sample.py': source }, async (root) => {
    const result = await analyze(service, 'python', ['sample.py'], { root });
    assert.equal(result.status, 'complete');
    assertInventory(result.files[0]!, source, expected);
  });
});
test('Python stub overloads retain separate signatures and complete ranges', async () => {
  const source = 'from typing import overload\n@overload\ndef load(value: int) -> int: ...\n@overload\ndef load(value: str) -> str: ...\n';
  await withFiles({ 'sample.pyi': source }, async (root) => {
    const result = await analyze(service, 'python', ['sample.pyi'], { root });
    assertInventory(result.files[0]!, source, [
      { key: 'import', type: 'import', name: 'typing', text: 'from typing import overload' },
      { key: 'int', type: 'function', name: 'load', text: 'def load(value: int) -> int: ...', parameters: ['value'], returns: ['int'], body: '...' },
      { key: 'str', type: 'function', name: 'load', text: 'def load(value: str) -> str: ...', parameters: ['value'], returns: ['str'], body: '...' },
    ]);
  });
});
