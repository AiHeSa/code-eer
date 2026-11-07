import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';

const service = new AstService();

after(() => service.close());

test('Python preserves parameter annotations, defaults, kinds, type comments and generic declarations', async () => {
    const source = `@decorate
class Box[T](Base, metaclass=Meta):
    @cache
    def load[U](self, x: T = None, /, y: U = 2, *rest: str, flag: bool = True, required, **kw: object) -> U:
        return y
def typed(x): # type: (int) -> int
    return x
`;
    await withFiles({ 's.py': source }, async (root) => {
        const result = await analyze(service, 'python', ['s.py'], { root });
        assert.equal(result.status, 'complete', JSON.stringify(result));
        const facts = result.files[0]!.facts;
        assert.deepEqual(facts.find((f) => f.name === 'Box')!.extensions.python, {
            typeParameters: ['T'],
            decorators: ['decorate'],
            bases: ['Base'],
            keywords: ['metaclass=Meta'],
        });
        const data = facts.find((f) => f.name === 'load')!.extensions.python!;
        assert.deepEqual(data.typeParameters, ['U']);
        assert.deepEqual(data.decorators, ['cache']);
        assert.deepEqual(data.parameterDetails, [
            { name: 'self', kind: 'positionalOnly', annotation: null, default: null, typeComment: null },
            { name: 'x', kind: 'positionalOnly', annotation: 'T', default: 'None', typeComment: null },
            { name: 'y', kind: 'positional', annotation: 'U', default: '2', typeComment: null },
            { name: 'rest', kind: 'vararg', annotation: 'str', default: null, typeComment: null },
            { name: 'flag', kind: 'keywordOnly', annotation: 'bool', default: 'True', typeComment: null },
            { name: 'required', kind: 'keywordOnly', annotation: null, default: null, typeComment: null },
            { name: 'kw', kind: 'kwarg', annotation: 'object', default: null, typeComment: null },
        ]);
        assert.equal(facts.find((f) => f.name === 'typed')!.extensions.python!.typeComment, '(int) -> int');
    });
});

test('Java preserves annotations, modifiers, heritage, record components and generic parameters', async () => {
    const source =
        '@Deprecated public sealed class Box<T> extends Base implements Runnable permits Child { public void run() {} }\nrecord Entry<T>(T value, int count) implements java.io.Serializable {}';
    await withFiles({ 'S.java': source }, async (root) => {
        const result = await analyze(service, 'java', ['S.java'], { root });
        assert.equal(result.status, 'complete', JSON.stringify(result));
        const facts = result.files[0]!.facts;
        const box = facts.find((f) => f.name === 'Box')!.extensions.java!;
        assert.deepEqual(box.annotations, ['@Deprecated']);
        assert.deepEqual(box.modifiers, ['public ', 'sealed ']);
        assert.deepEqual(box.typeParameters, ['T']);
        assert.deepEqual(box.extends, ['Base']);
        assert.deepEqual(box.implements, ['Runnable']);
        assert.deepEqual(box.permits, ['Child']);
        const entry = facts.find((f) => f.name === 'Entry')!.extensions.java!;
        assert.deepEqual(entry.components, ['T value', 'int count']);
        assert.deepEqual(entry.implements, ['java.io.Serializable']);
    });
});

test('Go distinguishes aliases from named types and preserves generic constraints', async () => {
    await withFiles(
        { 's.go': 'package p\ntype Alias = int\ntype Defined int\ntype Box[T comparable] struct { Value T }' },
        async (root) => {
            const result = await analyze(service, 'go', ['s.go'], { root });
            assert.equal(result.status, 'complete');
            const facts = result.files[0]!.facts;
            assert.equal(facts.find((f) => f.name === 'Alias')!.extensions.go!.typeAlias, true);
            assert.equal(facts.find((f) => f.name === 'Defined')!.extensions.go!.typeAlias, false);
            assert.deepEqual(facts.find((f) => f.name === 'Box')!.extensions.go!.typeParameters, ['T comparable']);
        },
    );
});

test('Rust preserves type and import attributes, visibility and generic constraints', async () => {
    const source =
        '#[derive(Clone)] pub(crate) struct Box<T: Clone> { value: T }\n#[allow(unused)] pub use core::fmt;\npub trait Load<T> { type Output<U>; }';
    await withFiles({ 's.rs': source }, async (root) => {
        const result = await analyze(service, 'rust', ['s.rs'], { root });
        assert.equal(result.status, 'complete');
        const facts = result.files[0]!.facts;
        const box = facts.find((f) => f.name === 'Box')!.extensions.rust!;
        assert.deepEqual(box.attributes, ['#[derive(Clone)]']);
        assert.equal(box.visibility, 'pub(crate)');
        assert.equal(box.generics, '<T: Clone>');
        const imported = facts.find((f) => f.type === 'import')!.extensions.rust!;
        assert.equal(imported.visibility, 'pub');
        assert.deepEqual(imported.attributes, ['#[allow(unused)]']);
        const output = facts.find((f) => f.name === 'Output')!;
        assert.equal(output.parentId, facts.find((f) => f.name === 'Load')!.id);
        assert.equal(output.extensions.rust!.generics, '<U>');
    });
});

test('TypeScript preserves generic parameters, heritage and type declaration text', async () => {
    const source =
        'export class Box<T extends Item = Item> extends Base<T> implements Load<T> { run<U>(value: U): T { throw 0; } }';
    await withFiles({ 's.ts': source }, async (root) => {
        const result = await analyze(service, 'js-ts', ['s.ts'], { root });
        assert.equal(result.status, 'complete');
        const facts = result.files[0]!.facts;
        const box = facts.find((f) => f.name === 'Box' && f.type === 'type')!.extensions['js-ts']!;
        assert.deepEqual(box.typeParameters, ['T extends Item = Item']);
        assert.deepEqual(box.heritage, ['extends Base<T>', 'implements Load<T>']);
        assert.equal(box.declaration, source);
        assert.deepEqual(facts.find((f) => f.name === 'run')!.extensions['js-ts']!.typeParameters, ['U']);
    });
});
