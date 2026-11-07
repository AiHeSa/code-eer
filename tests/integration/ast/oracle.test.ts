import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import type { Fact, FileResult } from '../../../services/code-review/internal/ast/schema.js';
import { analyze, withFiles } from './helpers.js';
import { assertInventory } from './expectations.js';

test('exact inventory rejects lost, extra and corrupted declaration fields', async () => {
    const service = new AstService();
    const source = 'function load(value: string): number { return value.length; }';
    try {
        await withFiles({ 's.ts': source }, async (root) => {
            const result = await analyze(service, 'js-ts', ['s.ts'], { root });
            const expected = [
                {
                    key: 'load',
                    type: 'function' as const,
                    name: 'load',
                    text: source,
                    parameters: ['value: string'],
                    returns: ['number'],
                    body: '{ return value.length; }',
                    nativeType: 'FunctionDeclaration',
                },
            ];
            const original = result.files[0]!;
            assertInventory(original, source, expected);
            for (const [name, mutate] of mutations) {
                const copy = structuredClone(original);
                mutate(copy);
                assert.throws(() => assertInventory(copy, source, expected), { name: 'AssertionError' }, name);
            }
        });
    } finally {
        service.close();
    }
});

const callable = (file: FileResult) => file.facts[0] as Extract<Fact, { parameters: string[] }>;
const mutations: [string, (file: FileResult) => void][] = [
    [
        'missing node',
        (file) => {
            file.facts = [];
        },
    ],
    [
        'extra node',
        (file) => {
            file.facts.push({ ...file.facts[0]!, id: 'extra' });
        },
    ],
    [
        'name',
        (file) => {
            file.facts[0]!.name = 'wrong';
        },
    ],
    [
        'parent',
        (file) => {
            file.facts[0]!.parentId = 'missing';
        },
    ],
    [
        'parameters',
        (file) => {
            callable(file).parameters = [];
        },
    ],
    [
        'returns',
        (file) => {
            callable(file).returns = [];
        },
    ],
    [
        'async',
        (file) => {
            callable(file).async = true;
        },
    ],
    [
        'range end',
        (file) => {
            file.facts[0]!.range!.end.character--;
        },
    ],
    [
        'body',
        (file) => {
            callable(file).bodyRange = null;
        },
    ],
    [
        'native kind',
        (file) => {
            file.facts[0]!.origin.nativeType = 'Unknown';
        },
    ],
    [
        'digest',
        (file) => {
            file.digest = '0'.repeat(64);
        },
    ],
];
