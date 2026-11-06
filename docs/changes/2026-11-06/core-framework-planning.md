# 核心技术栈与框架范围

- 日期：2026-11-06
- 需求：[AST 接入](../../requirements/code-review/ast-integration.md)、[React 与 Vue 3](../../requirements/code-review/framework-support.md)
- 方案：[AST 接入方案](../../technical-designs/2026-11-06/ast-integration-plan.md)、[结构转换与结果格式](../../technical-designs/2026-11-06/ast-normalization.md)

## 已确认内容

- 核心服务、CLI、MCP 入口和公共契约采用 TypeScript + Node.js。
- 首批语言支持范围为 JS/TS、Python、Java、Go、Rust。
- 首批框架支持包括 React 与 Vue 3。
- 公共格式通过原生结构对照设计，语言和框架适配器负责结构转换。

## 本次文档内容

- 补充 React 与 Vue 3 的输入、结构事实、能力边界和验收需求。
- 整理 unist、ESTree、LSP 与各语言原生结构的参考关系，形成公共格式草案。
- 在接入方案中记录核心技术栈、框架适配和阶段交付要求。
- 更新 README 的需求和技术方案导航。

解析器版本、转换字段、协议 Schema 和兼容性记录待接入验证；后端及核心代码尚未实现。
