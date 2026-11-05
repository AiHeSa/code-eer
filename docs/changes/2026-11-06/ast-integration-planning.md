# 首批单语言 AST 支持范围与接入规划

- 日期：2026-11-06
- 关联需求：[REQ-AST-001](../../requirements/code-review/ast-integration.md)
- 对应方案：[TD-AST-001](../../technical-designs/2026-11-06/ast-integration-plan.md)
- 背景资料：[2026-11-05 AST 项目调研](../../technical-designs/2026-11-05/ast-project-survey.md)

## 已确认的需求

用户确定首批按单语言接入，支持 JS/TS、Python、Java、Go、Rust；JS/TS 按新版本路线规划。

该范围替代前一轮调研中“先接入多语言规则引擎，再选择一至两个语言后端”的建议。ast-grep 与 Tree-sitter 继续作为调研资料保留，首批不将其设为必需依赖。

## 本次文档变更

- 新增按功能类别组织的首批语言需求，明确共同验收能力及语义扩展边界。
- 新增按日期归档的接入方案，建议使用语言原生后端、本地子进程通信与统一结果契约。
- 标注 TypeScript 新 API 的预发布资料状态、Rust 语法与语义接入差异，以及分阶段实施顺序。
- 更新 README 导航与原调研文档的当前计划说明。

当前完成的是需求记录与技术方案草案。具体库选型和协议尚待实现验证，未安装依赖或增加后端代码。
