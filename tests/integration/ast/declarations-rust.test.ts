import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();

after(() => service.close());

const source = `use std::fmt::{self, Debug as Display};
pub mod inner {
  pub struct Box<T>(T);
  pub union Value { number: u32, byte: u8 }
  pub trait Reader { fn read(&self) -> u32; }
  impl<T> Box<T> {
    #[inline]
    pub async fn load(&self, value: T) -> T { value }
  }
  pub fn outer() { let closure = |value: i32| -> i32 { value + 1 }; }
}
unsafe extern "C" { fn external(value: i32) -> i32; }
`;
const expected: ExpectedFact[] = [
    {
        key: 'import',
        type: 'import',
        name: 'std::fmt::{self, Debug as Display}',
        text: 'use std::fmt::{self, Debug as Display};',
    },
    {
        key: 'module',
        type: 'module',
        name: 'inner',
        text: source.slice(source.indexOf('pub mod'), source.indexOf('\nunsafe extern')),
    },
    { key: 'struct', type: 'type', name: 'Box', parent: 'module', text: 'pub struct Box<T>(T);' },
    { key: 'union', type: 'type', name: 'Value', parent: 'module', text: 'pub union Value { number: u32, byte: u8 }' },
    {
        key: 'trait',
        type: 'type',
        name: 'Reader',
        parent: 'module',
        text: 'pub trait Reader { fn read(&self) -> u32; }',
    },
    {
        key: 'read',
        type: 'method',
        name: 'read',
        parent: 'trait',
        text: 'fn read(&self) -> u32;',
        parameters: ['&self'],
        returns: ['u32'],
        body: null,
    },
    {
        key: 'impl',
        type: 'type',
        name: 'Box<T>',
        parent: 'module',
        text: source.slice(source.indexOf('impl<T>'), source.indexOf('\n  pub fn outer')),
    },
    {
        key: 'load',
        type: 'method',
        name: 'load',
        parent: 'impl',
        text: '#[inline]\n    pub async fn load(&self, value: T) -> T { value }',
        parameters: ['&self', 'value: T'],
        returns: ['T'],
        async: true,
        body: '{ value }',
        data: { attributes: ['#[inline]'] },
    },
    {
        key: 'outer',
        type: 'function',
        name: 'outer',
        parent: 'module',
        text: 'pub fn outer() { let closure = |value: i32| -> i32 { value + 1 }; }',
        body: '{ let closure = |value: i32| -> i32 { value + 1 }; }',
    },
    {
        key: 'closure',
        type: 'function',
        name: null,
        parent: 'outer',
        text: '|value: i32| -> i32 { value + 1 }',
        parameters: ['value: i32'],
        returns: ['i32'],
        body: '{ value + 1 }',
    },
    { key: 'extern', type: 'module', name: 'C', text: 'unsafe extern "C" { fn external(value: i32) -> i32; }' },
    {
        key: 'foreign',
        type: 'function',
        name: 'external',
        parent: 'extern',
        text: 'fn external(value: i32) -> i32;',
        parameters: ['value: i32'],
        returns: ['i32'],
        body: null,
    },
];

test('Rust complete module, trait, impl, union, closure and foreign function inventory', async () => {
    await withFiles({ 'sample.rs': source }, async (root) => {
        const result = await analyze(service, 'rust', ['sample.rs'], { root });
        assert.equal(result.status, 'complete');
        assertInventory(result.files[0]!, source, expected);
    });
});

test('Rust enum, type alias and associated types preserve their containers', async () => {
    const source =
        'pub enum Mode { Ready }\ntype Alias = Mode;\ntrait Reader { type Output; }\nimpl Reader for Mode { type Output = u32; }';
    await withFiles({ 'types.rs': source }, async (root) => {
        const result = await analyze(service, 'rust', ['types.rs'], { root });
        assertInventory(result.files[0]!, source, [
            { key: 'enum', type: 'type', name: 'Mode', text: 'pub enum Mode { Ready }' },
            { key: 'alias', type: 'type', name: 'Alias', text: 'type Alias = Mode;' },
            { key: 'trait', type: 'type', name: 'Reader', text: 'trait Reader { type Output; }' },
            { key: 'associated', type: 'type', name: 'Output', parent: 'trait', text: 'type Output;' },
            { key: 'impl', type: 'type', name: 'Mode', text: 'impl Reader for Mode { type Output = u32; }' },
            { key: 'output', type: 'type', name: 'Output', parent: 'impl', text: 'type Output = u32;' },
        ]);
    });
});
