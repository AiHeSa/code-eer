import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();
after(() => service.close());
const source = `package fixture
import alias "fmt"
type Reader interface { Read(p []byte) (n int, err error) }
type Box[T any] struct { Value T }
var factory = func(value int) int { return value }
func (box *Box[T]) Load(a, b int, rest ...string) (T, error) {
  type Local struct{}
  inner := func() int { return 1 }
  _ = inner
  return box.Value, nil
}
func Map[T any](value T) T { return value }
`;
const expected: ExpectedFact[] = [
  { key: 'package', type: 'module', name: 'fixture', text: 'fixture', nativeType: '*ast.Ident' },
  { key: 'import', type: 'import', name: '"fmt"', text: 'alias "fmt"', data: { alias: 'alias' } },
  { key: 'reader', type: 'type', name: 'Reader', text: 'Reader interface { Read(p []byte) (n int, err error) }' },
  { key: 'read', type: 'method', name: 'Read', parent: 'reader', text: 'Read(p []byte) (n int, err error)',
    parameters: ['p []byte'], returns: ['n int', 'err error'], body: null, nativeType: '*ast.Field' },
  { key: 'box', type: 'type', name: 'Box', text: 'Box[T any] struct { Value T }' },
  { key: 'factory', type: 'function', name: null, text: 'func(value int) int { return value }', parameters: ['value int'], returns: ['int'], body: '{ return value }' },
  { key: 'load', type: 'method', name: 'Load', text: source.slice(source.indexOf('func (box'), source.indexOf('\nfunc Map')),
    parameters: ['a, b int', 'rest ...string'], returns: ['T', 'error'], body: source.slice(source.indexOf('{\n  type Local'), source.indexOf('\nfunc Map')),
    data: { receiver: ['box *Box[T]'] } },
  { key: 'local', type: 'type', name: 'Local', parent: 'load', text: 'Local struct{}' },
  { key: 'inner', type: 'function', name: null, parent: 'load', text: 'func() int { return 1 }', returns: ['int'], body: '{ return 1 }' },
  { key: 'map', type: 'function', name: 'Map', text: 'func Map[T any](value T) T { return value }',
    parameters: ['value T'], returns: ['T'], body: '{ return value }', data: { typeParameters: ['T any'] } },
];
test('Go complete interface, receiver, generic, local and closure inventory', async () => {
  await withFiles({ 'sample.go': source }, async (root) => {
    const result = await analyze(service, 'go', ['sample.go'], { root });
    assert.equal(result.status, 'complete');
    assertInventory(result.files[0]!, source, expected);
  });
});
