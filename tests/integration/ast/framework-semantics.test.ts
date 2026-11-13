import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { analysisSchema, type Analysis, type Range } from '../../../services/code-review/internal/ast/schema.js';
import { withFiles } from './helpers.js';

async function analyzeFiles(files: Record<string, string>, entry: string, framework?: 'react') {
    let report: Analysis | undefined;
    await withFiles(files, async (root) => {
        const service = new AstService();
        try {
            const params = analyzeParamsSchema.parse({
                root,
                files: [entry],
                capabilities: ['structure', 'symbols', 'types'],
                framework,
            });
            const response = await service.analyze('js-ts', params);
            assert.ok(response.ok, JSON.stringify(response));
            report = analysisSchema.parse(response.result);
        } finally {
            service.close();
        }
    });
    assert.ok(report);
    return report;
}

function textAt(source: string, range: Range): string {
    assert.equal(range.start.line, range.end.line);
    return source.split(/\r?\n/)[range.start.line]!.slice(range.start.character, range.end.character);
}

test('React semantic JSX resolves re-exported and namespaced components and their actual props', async () => {
    const report = await analyzeFiles(
        {
            'Card.ts':
                'export interface CardProps { title: string; count?: number }\n' +
                'export function Card(props: CardProps) { return props.title; }\n' +
                'export function Box<T>(props: { item: T; useItem: (value: T) => string }) { return props.useItem(props.item); }',
            'index.ts': "export { Card as Panel, Box } from './Card.js';",
            'Page.tsx':
                "import * as UI from './index.js';\n" +
                'declare global { namespace JSX { interface IntrinsicElements { div: { id?: string } } } }\n' +
                'export const content = <div id="a"><UI.Panel title="ok" count={2}></UI.Panel>' +
                '<UI.Box item={1} useItem={(value) => value.toFixed()} /><Missing /></div>;',
        },
        'Page.tsx',
        'react',
    );
    const semantic = report.files[0]!.semantic!;
    assert.equal(semantic.status, 'partial');
    const react = semantic.framework;
    assert.equal(react?.kind, 'react');
    const [div, panel, box, missing] = react.elements;
    assert.equal(div?.kind, 'intrinsic');
    assert.equal(div.attributes[0]!.name, 'id');
    assert.match(div.attributes[0]!.type!, /string/);
    assert.equal(panel?.kind, 'component');
    assert.equal(panel.name, 'UI.Panel');
    assert.match(panel.definition!.uri, /\/Card\.ts$/);
    assert.match(panel.propsType!, /CardProps/);
    assert.equal(panel.attributes[0]!.type, 'string');
    assert.match(panel.attributes[0]!.definition!.uri, /\/Card\.ts$/);
    assert.match(panel.attributes[1]!.type!, /number/);
    assert.match(box!.attributes.find((attribute) => attribute.name === 'useItem')!.type!, /number/);
    assert.equal(missing!.definition, null);
    assert.equal(missing!.propsType, null);
});

test('Vue semantic bindings respect setup, v-for, v-if, slot scope and source coordinates', async () => {
    const source = [
        '<script setup lang="ts">',
        "import { Card as UiCard } from './Card.js';",
        'const rows = [{ id: 1 }], id = "outer", fallback = 2;',
        'const label = "outside", key = "title", handle = (_: unknown) => {};',
        '</script>',
        '<template>',
        '  <ui-card v-for="({ id = fallback }, index) in rows" v-if="id" :[key]="id" @click="handle($event); handle(index)">',
        '    <template #default="{ text: label = id }">中文🙂 {{ label }} {{ id }} {{ index }} {{ Math.max(index, 1) }}',
        '      {{ ((label) => label)(1) }}',
        '    </template>',
        '  </ui-card>',
        '  <div>{{ label }} {{ unknown }} {{ id &amp;&amp; unknown }}</div>',
        '  <component :is="UiCard" />',
        '</template>',
    ].join('\r\n');
    const report = await analyzeFiles({ 'Page.vue': source, 'Card.ts': 'export function Card() {}' }, 'Page.vue');
    const semantic = report.files[0]!.semantic!;
    const vue = semantic.framework;
    assert.equal(vue?.kind, 'vue');
    assert.equal(semantic.status, 'partial');
    assert.equal(report.status, 'partial');
    for (const item of [...vue.bindings, ...vue.components]) assert.equal(textAt(source, item.range), item.name);
    assert.deepEqual(
        vue.components.map((item) => item.name),
        ['ui-card', 'component'],
    );
    assert.match(vue.components[0]!.definition!.uri, /\/Card\.ts$/);
    assert.equal(vue.components[1]!.definition, null);
    const uses = (name: string, line: number) =>
        vue.bindings.filter((item) => item.name === name && !item.declaration && item.range.start.line === line);
    assert.deepEqual(
        uses('id', 6).map((item) => item.kind),
        ['setup', 'for'],
    );
    assert.equal(uses('id', 6)[0]!.definition!.range.start.line, 2);
    assert.equal(uses('id', 6)[0]!.type, '"outer"');
    assert.equal(uses('id', 6)[1]!.definition!.range.start.line, 6);
    assert.equal(uses('fallback', 6)[0]!.kind, 'setup');
    assert.equal(uses('key', 6)[0]!.kind, 'setup');
    assert.equal(uses('$event', 6)[0]!.kind, 'event');
    assert.equal(uses('label', 7)[0]!.kind, 'slot');
    assert.deepEqual(uses('label', 8), []);
    assert.equal(uses('label', 11)[0]!.kind, 'setup');
    assert.equal(uses('Math', 7)[0]!.kind, 'global');
    assert.deepEqual(
        uses('unknown', 11).map((item) => item.definition),
        [null],
    );
});

test('Vue syntax facts survive incomplete template semantics; resolved templates report complete', async () => {
    const complete = '<script setup>const message = "hello"</script><template><div>{{ message }}</div></template>';
    const incomplete =
        '<script>export default { data: () => ({ message: "hello" }) }</script>' +
        '<template><div>{{ message }}</div></template>';
    const a = await analyzeFiles({ 'Page.vue': complete }, 'Page.vue');
    const b = await analyzeFiles({ 'Page.vue': incomplete }, 'Page.vue');
    assert.equal(a.files[0]!.semantic?.status, 'complete');
    const file = b.files[0]!;
    assert.equal(file.semantic?.status, 'partial');
    assert.ok(file.facts.some((fact) => fact.type === 'binding' && fact.name === 'message'));
    const vue = file.semantic.framework;
    assert.equal(vue?.kind, 'vue');
    assert.equal(vue.bindings[0]!.kind, 'unresolved');
});

test('Vue static SFC tags resolve only to readable project components', async () => {
    const child = '<template><div>Child</div></template>';
    const report = await analyzeFiles(
        {
            'Page.vue':
                '<script setup lang="ts">import UiCard from "./Card.vue"; import Missing from "./Missing.vue";</script>' +
                '<template><Transition><ui-card/><Missing/></Transition></template>',
            'Card.vue': child,
        },
        'Page.vue',
    );
    const semantic = report.files[0]!.semantic!;
    const vue = semantic.framework;
    assert.equal(vue?.kind, 'vue');
    assert.equal(semantic.status, 'partial');
    assert.deepEqual(
        vue.components.map((item) => item.name),
        ['ui-card', 'Missing'],
    );
    assert.match(vue.components[0]!.definition!.uri, /\/Card\.vue$/);
    assert.equal(textAt(child, vue.components[0]!.definition!.range), child);
    assert.equal(vue.components[0]!.type, null);
    assert.equal(vue.components[1]!.definition, null);
});

test('An invalid default tsconfig preserves structure and reports the semantic setup failure', async () => {
    const report = await analyzeFiles(
        {
            'tsconfig.json': '{"compilerOptions":{"target":"invalid-target"}}',
            'entry.ts': 'export function entry() {}',
        },
        'entry.ts',
    );
    const file = report.files[0]!;
    assert.equal(report.status, 'partial');
    assert.ok(file.facts.some((fact) => fact.name === 'entry'));
    assert.equal(file.semantic?.status, 'failed');
    assert.match(file.semantic.diagnostics[0]!.message, /--target/);
});
