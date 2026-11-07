import type { AuditCase } from './model.js';

export const frameworkCases: AuditCase[] = [
    {
        id: 'REACT-DEFAULT-ARROW',
        title: '匿名默认导出函数组件',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架需求 §2 / 函数组件与导出',
        files: { 'View.tsx': 'import React from "react"; export default () => <div />;' },
        entry: ['View.tsx'],
        expects: [{ kind: 'facts', file: 'View.tsx', selector: { type: 'component' }, min: 1 }],
        implementation: ['services/code-review/ast/js-ts/react.ts'],
    },
    {
        id: 'REACT-NULL-CLASS',
        title: 'render 返回 null 的 React 类组件',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架需求 §2 / 类组件',
        files: {
            'View.tsx':
                'import React from "react"; export class App extends React.Component { render() { return null; } }',
        },
        entry: ['View.tsx'],
        expects: [{ kind: 'facts', file: 'View.tsx', selector: { type: 'component', name: 'App' }, min: 1 }],
        implementation: ['services/code-review/ast/js-ts/react.ts'],
    },
    {
        id: 'REACT-PROJECT-DETECTION',
        title: '项目依赖中的 React 识别',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架需求 §1 / 项目依赖识别',
        files: {
            'View.tsx': 'export function App() { return <div />; }',
            'package.json': '{"dependencies":{"react":"19.2.0"}}',
        },
        entry: ['View.tsx'],
        expects: [{ kind: 'framework', file: 'View.tsx', value: 'react' }],
        implementation: ['services/code-review/ast/js-ts/react.ts'],
    },
    {
        id: 'REACT-LOCAL-SHADOW',
        title: '局部同名函数的 Hook 导入来源',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架验收 §5 / Hook 别名与同名普通函数',
        files: {
            'View.ts':
                'import { useState as state } from "react"; function ordinary() { const state = () => 0; return state(); }',
        },
        entry: ['View.ts'],
        expects: [
            {
                kind: 'facts',
                file: 'View.ts',
                selector: { type: 'binding', name: 'state', data: { source: 'react' } },
                min: 0,
                max: 0,
            },
        ],
        implementation: ['services/code-review/ast/js-ts/react-imports.ts'],
    },
    {
        id: 'VUE-INTERPOLATION-SYNTAX',
        title: '模板插值表达式语法错误',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架验收 §5 / 语法错误',
        files: { 'View.vue': '<template><div>{{ value( }}</div></template>' },
        entry: ['View.vue'],
        templateOracle: '<div>{{ value( }}</div>',
        expects: [{ kind: 'diagnostics', file: 'View.vue', min: 1 }],
        implementation: ['services/code-review/ast/js-ts/vue-template.ts'],
    },
    {
        id: 'VUE-DIRECTIVE-SYNTAX',
        title: '模板指令表达式语法错误',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架验收 §5 / 指令与语法错误',
        files: { 'View.vue': '<template><div v-if="value +">text</div></template>' },
        entry: ['View.vue'],
        templateOracle: '<div v-if="value +">text</div>',
        expects: [{ kind: 'diagnostics', file: 'View.vue', min: 1 }],
        implementation: ['services/code-review/ast/js-ts/vue-template.ts'],
    },
    {
        id: 'VUE-OPTIONS-SHORTHAND',
        title: 'Options API 的 props 简写属性',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架需求 §3 / Options API 与 props 结构',
        files: { 'View.vue': '<script>const props = ["value"]; export default { props };</script>' },
        entry: ['View.vue'],
        expects: [
            {
                kind: 'facts',
                file: 'View.vue',
                selector: { name: 'props', data: { usage: 'optionCandidate' } },
                min: 1,
            },
        ],
        implementation: ['services/code-review/ast/js-ts/vue-script.ts'],
    },
    {
        id: 'VUE-MACRO-CONTEXT',
        title: '普通 script 内同名函数的宏分类',
        backend: 'js-ts',
        scope: 'baseline',
        requirement: '框架需求 §3 / 编译器宏语法证据',
        files: {
            'View.vue':
                '<script>function defineProps() { return []; } const value = defineProps(); export default {};</script>',
        },
        entry: ['View.vue'],
        expects: [
            {
                kind: 'facts',
                file: 'View.vue',
                selector: { name: 'defineProps', data: { usage: 'compilerMacro' } },
                min: 0,
                max: 0,
            },
        ],
        implementation: ['services/code-review/ast/js-ts/vue-script.ts', 'services/code-review/ast/js-ts/vue.ts'],
    },
];
