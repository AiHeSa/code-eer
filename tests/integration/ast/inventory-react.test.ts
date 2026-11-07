import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory, type ExpectedFact } from './expectations.js';

const service = new AstService();

after(() => service.close());

const source = `import React, { useState as state } from 'react';
export const App = () => <><Panel {...props} title="中😀">{state(0)[0]}</Panel></>;
`;
const arrow = '() => <><Panel {...props} title="中😀">{state(0)[0]}</Panel></>';
const expected: ExpectedFact[] = [
    { key: 'import', type: 'import', name: "'react'", text: "import React, { useState as state } from 'react';" },
    { key: 'app', type: 'binding', name: 'App', text: `App = ${arrow}` },
    { key: 'export', type: 'export', name: 'App', text: `App = ${arrow}` },
    { key: 'function', type: 'function', name: 'App', parent: 'app', text: arrow, body: arrow.slice(6) },
    { key: 'fragment', type: 'templateElement', name: '#fragment', parent: 'function', text: arrow.slice(6) },
    {
        key: 'panel',
        type: 'templateElement',
        name: 'Panel',
        parent: 'fragment',
        text: '<Panel {...props} title="中😀">{state(0)[0]}</Panel>',
    },
    { key: 'spread', type: 'attribute', name: null, parent: 'panel', text: '{...props}', data: { spread: 'props' } },
    {
        key: 'title',
        type: 'attribute',
        name: 'title',
        parent: 'panel',
        text: 'title="中😀"',
        data: { value: '"中😀"' },
    },
    { key: 'expression', type: 'binding', name: 'state(0)[0]', parent: 'panel', text: '{state(0)[0]}' },
    {
        key: 'hook',
        type: 'binding',
        name: 'state',
        parent: 'expression',
        text: 'state(0)',
        data: {
            usage: 'hookCandidate',
            source: 'react',
            imported: 'useState',
            arguments: ['0'],
            bindingResolution: 'syntax',
        },
    },
    { key: 'component', type: 'component', name: 'App', parent: 'app', text: arrow, data: { certainty: 'candidate' } },
];

test('React complete JSX, fragment, spread, expression, alias and component inventory', async () => {
    await withFiles({ 'View.tsx': source }, async (root) => {
        const result = await analyze(service, 'js-ts', ['View.tsx'], { root });
        assert.equal(result.status, 'complete');
        assertInventory(result.files[0]!, source, expected);
        const facts = result.files[0]!.facts;
        const component = facts.find((fact) => fact.type === 'component')!;
        assert.equal(component.extensions.react!.declarationId, facts.find((fact) => fact.type === 'function')!.id);
    });
});

test('React namespace hooks and memo-wrapped arrow components retain their declaration', async () => {
    const source =
        'import * as React from "react"; export const App = React.memo(() => <div>{React.useState(0)[0]}</div>);';
    await withFiles({ 'View.tsx': source }, async (root) => {
        const result = await analyze(service, 'js-ts', ['View.tsx'], { root });
        const file = result.files[0]!;
        assert.deepEqual(
            file.facts.filter((fact) => fact.type === 'component').map((fact) => fact.name),
            ['App'],
        );
        const hook = file.facts.find((fact) => fact.extensions.react?.usage === 'hookCandidate');
        assert.equal(hook?.name, 'React.useState');
        assert.equal(hook?.extensions.react?.source, 'react');
        assert.equal(hook?.extensions.react?.imported, 'useState');
    });
});

test('React imported aliases shadowed by parameters retain syntax-only evidence', async () => {
    const source =
        'import { useState as state } from "react"; function ordinary(state: any) { return state(0); } function useLocal() {} useLocal();';
    await withFiles({ 'state.ts': source }, async (root) => {
        const result = await analyze(service, 'js-ts', ['state.ts'], { root });
        const candidates = result.files[0]!.facts.filter((fact) => fact.extensions.react?.usage === 'hookCandidate');
        assert.deepEqual(
            candidates.map((fact) => fact.name),
            ['useLocal'],
        );
        assert.equal(candidates[0]!.extensions.react!.source, null);
        assert.equal(candidates[0]!.extensions.react!.imported, null);
    });
});
