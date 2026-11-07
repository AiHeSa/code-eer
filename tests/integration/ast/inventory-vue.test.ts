import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();

after(() => service.close());

const panel =
    '<Panel v-for="item in items" :[key].camel="item" @click.stop="select(item)"><template #default="{ row }">{{ row }}</template></Panel>';
const source = `<script setup lang="ts">const title = "中😀";</script>\r\n<template>${panel}</template>\r\n<style scoped>.x{}</style>\r\n<docs lang="md">hello</docs>`;
const expected: ExpectedFact[] = [
    { key: 'component', type: 'component', name: 'View.vue', text: source },
    {
        key: 'script',
        type: 'module',
        name: 'script',
        parent: 'component',
        text: 'const title = "中😀";',
        data: { language: 'ts', attributes: { setup: true, lang: 'ts' } },
    },
    { key: 'title', type: 'binding', name: 'title', parent: 'script', text: 'title = "中😀"' },
    { key: 'template', type: 'module', name: 'template', parent: 'component', text: panel },
    { key: 'panel', type: 'templateElement', name: 'Panel', parent: 'template', text: panel, data: { tagType: 1 } },
    {
        key: 'for',
        type: 'directive',
        name: 'for',
        parent: 'panel',
        text: 'v-for="item in items"',
        data: { argument: null, expression: 'item in items', modifiers: [] },
    },
    {
        key: 'loop',
        type: 'binding',
        name: 'item in items',
        parent: 'for',
        text: 'item in items',
        data: { directive: 'for', bindingResolution: 'syntax' },
    },
    {
        key: 'bind',
        type: 'directive',
        name: 'bind',
        parent: 'panel',
        text: ':[key].camel="item"',
        data: { argument: '[key]', expression: 'item', modifiers: ['camel'] },
    },
    { key: 'item', type: 'binding', name: 'item', parent: 'bind', text: 'item', occurrence: 2 },
    {
        key: 'on',
        type: 'directive',
        name: 'on',
        parent: 'panel',
        text: '@click.stop="select(item)"',
        data: { argument: 'click', expression: 'select(item)', modifiers: ['stop'] },
    },
    { key: 'handler', type: 'binding', name: 'select(item)', parent: 'on', text: 'select(item)' },
    {
        key: 'slotTemplate',
        type: 'templateElement',
        name: 'template',
        parent: 'panel',
        text: '<template #default="{ row }">{{ row }}</template>',
    },
    {
        key: 'slot',
        type: 'directive',
        name: 'slot',
        parent: 'slotTemplate',
        text: '#default="{ row }"',
        data: { argument: 'default', expression: '{ row }' },
    },
    { key: 'slotBinding', type: 'binding', name: '{ row }', parent: 'slot', text: '{ row }' },
    {
        key: 'interpolation',
        type: 'binding',
        name: 'row',
        parent: 'slotTemplate',
        text: 'row',
        occurrence: 1,
        data: { usage: 'interpolation' },
    },
    {
        key: 'style',
        type: 'module',
        name: 'style',
        parent: 'component',
        text: '.x{}',
        data: { attributes: { scoped: true } },
    },
    { key: 'docs', type: 'module', name: 'docs', parent: 'component', text: 'hello', data: { language: 'md' } },
];

test('Vue complete SFC, dynamic directive, modifier, slot, interpolation and block inventory', async () => {
    await withFiles({ 'View.vue': source }, async (root) => {
        const result = await analyze(service, 'js-ts', ['View.vue'], { root });
        assert.equal(result.status, 'complete');
        assertInventory(result.files[0]!, source, expected);
    });
});

for (const [block, name, content] of [
    ['script', 'logic.ts', 'function broken( {'],
    ['template', 'view.html', '<div><span></div>'],
]) {
    test(`Vue external ${block} failure reports incomplete structure at the external URI`, async () => {
        await withFiles({ 'View.vue': `<${block} src="./${name}"></${block}>`, [name!]: content! }, async (root) => {
            const result = await analyze(service, 'js-ts', ['View.vue'], { root });
            assert.equal(result.status, 'partial');
            const file = result.files.find((file) => file.uri.endsWith(`/${name}`))!;
            assert.ok(file.diagnostics.length > 0);
            assert.ok(file.skipped.some((item) => item.code === 'STRUCTURE_INCOMPLETE'));
            const syntax = await analyze(service, 'js-ts', ['View.vue'], { root, capabilities: ['syntax'] });
            assert.equal(syntax.status, 'complete');
            assert.ok(syntax.files.every((file) => file.facts.length === 0 && file.skipped.length === 0));
        });
    });
}

test('Vue missing external blocks preserve valid inline script declarations', async () => {
    await withFiles(
        { 'View.vue': '<script setup>function valid() {}</script><template src="./missing.html"></template>' },
        async (root) => {
            const result = await analyze(service, 'js-ts', ['View.vue'], { root });
            assert.equal(result.status, 'partial');
            assert.equal(result.files.length, 1);
            assert.ok(result.files[0]!.facts.some((fact) => fact.type === 'function' && fact.name === 'valid'));
            assert.equal(result.files[0]!.skipped[0]!.code, 'BLOCK_ANALYSIS_FAILED');
        },
    );
});
