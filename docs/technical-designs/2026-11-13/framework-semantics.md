# React JSX 与 Vue 模板语义

- 需求：[React 与 Vue 3 支持](../../requirements/code-review/framework-support.md)
- 入口：[AST 协议](../2026-11-06/ast-runtime.md)
- 契约：[语义 Schema](../../../services/code-review/internal/ast/semantic-schema.ts)

CLI `analyze --semantic` 或包含 `symbols` / `types` 的协议请求返回框架证据 `semantic.framework`。证据使用原始源码 URI 和零起始 UTF-16 范围；无法解析的定义或类型使用 `null`。

## React JSX

`kind: react` 的 `elements` 对应 JSX 开始标签与自闭合标签。每项记录标签原名、范围、类别、符号定义、组件类型和使用处的上下文 Props 类型。具名属性记录自己的范围、属性声明定义和预期类型。TypeScript Checker 使用项目配置及可解析依赖，支持导入别名、模块重导出和泛型推导。展开属性与 Fragment 保留在结构事实中。

## Vue 模板

`kind: vue` 的 `bindings` 记录插值和指令中的自由标识符。顶层 `script setup` 绑定、循环变量及插槽参数保留声明位置；Vue 模板全局和内联事件的 `$event` 标注各自类别。循环输入和同节点的 `v-if` 使用外层作用域；插槽参数作用于其子节点。普通 JavaScript 表达式内部的局部变量不属于模板绑定列表。

`components` 记录组件标签。可解析的脚本导入引用到符号定义；项目内相对路径的 Vue 默认导入引用到目标 SFC 范围。动态组件和未解析的注册组件保留空定义。

`setup` 绑定类型描述脚本声明。模板中的 ref 解包、循环及插槽变量类型、Options API 实例绑定、跨 SFC Props、编译器宏和外部模板语义属于待扩展范围。未解析绑定、动态组件、缺依赖或无法精确映射位置的表达式返回 `partial`。

## 验证

[框架语义集成测试](../../../tests/integration/ast/framework-semantics.test.ts)覆盖跨文件定义、Props 泛型、模板作用域、动态目标、缺失依赖、中文、Emoji 和 CRLF 位置映射。运行 `npm run verify:ast` 检查五语言语义和语法基线。
