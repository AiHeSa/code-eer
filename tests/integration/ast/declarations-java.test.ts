import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();

after(() => service.close());

const source = `package fixture;
import static java.util.Collections.*;
@interface Marker { String value() default "x"; }
record Pair(int value) { Pair { if (value < 0) throw new IllegalArgumentException(); } }
interface Reader<T> { T read(String... names) throws Exception; }
class Box {
  Box() {}
  <T> T load(T value) { return value; }
  void run() { Runnable task = () -> {}; }
}
`;
const expected: ExpectedFact[] = [
    { key: 'package', type: 'module', name: 'fixture', text: 'package fixture;' },
    {
        key: 'import',
        type: 'import',
        name: 'java.util.Collections',
        text: 'import static java.util.Collections.*;',
        data: { static: true, wildcard: true },
    },
    { key: 'annotation', type: 'type', name: 'Marker', text: '@interface Marker { String value() default "x"; }' },
    {
        key: 'value',
        type: 'method',
        name: 'value',
        parent: 'annotation',
        text: 'String value() default "x";',
        returns: ['String'],
        body: null,
    },
    {
        key: 'record',
        type: 'type',
        name: 'Pair',
        text: 'record Pair(int value) { Pair { if (value < 0) throw new IllegalArgumentException(); } }',
    },
    {
        key: 'compact',
        type: 'constructor',
        name: 'Pair',
        parent: 'record',
        text: 'Pair { if (value < 0) throw new IllegalArgumentException(); }',
        body: '{ if (value < 0) throw new IllegalArgumentException(); }',
    },
    {
        key: 'reader',
        type: 'type',
        name: 'Reader',
        text: 'interface Reader<T> { T read(String... names) throws Exception; }',
    },
    {
        key: 'read',
        type: 'method',
        name: 'read',
        parent: 'reader',
        text: 'T read(String... names) throws Exception;',
        parameters: ['String... names'],
        returns: ['T'],
        body: null,
        data: { throws: ['Exception'] },
    },
    { key: 'box', type: 'type', name: 'Box', text: source.slice(source.indexOf('class Box')).trimEnd() },
    { key: 'constructor', type: 'constructor', name: 'Box', parent: 'box', text: 'Box() {}', body: '{}' },
    {
        key: 'load',
        type: 'method',
        name: 'load',
        parent: 'box',
        text: '<T> T load(T value) { return value; }',
        parameters: ['T value'],
        returns: ['T'],
        body: '{ return value; }',
        data: { typeParameters: ['T'] },
    },
    {
        key: 'run',
        type: 'method',
        name: 'run',
        parent: 'box',
        text: 'void run() { Runnable task = () -> {}; }',
        returns: ['void'],
        body: '{ Runnable task = () -> {}; }',
    },
    { key: 'lambda', type: 'function', name: null, parent: 'run', text: '() -> {}', body: '{}' },
];

test('Java complete record, annotation, interface, constructor, generic and lambda inventory', async () => {
    await withFiles({ 'Sample.java': source }, async (root) => {
        const result = await analyze(service, 'java', ['Sample.java'], { root });
        assert.equal(result.status, 'complete');
        assertInventory(result.files[0]!, source, expected);
    });
});
