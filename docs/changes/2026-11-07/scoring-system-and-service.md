# 后台部署与评分系统设计

- 日期：2026-11-07
- 需求：[评分系统](../../requirements/code-review/scoring-system.md)
- 设计：[系统契约](../../technical-designs/2026-11-07/scoring-system.md)、[候选策略](../../technical-designs/2026-11-07/scoring-policy-v0.md)、[标定计划](../../technical-designs/2026-11-07/scoring-validation.md)
- 部署：[本地服务运行记录](../../technical-designs/2026-11-07/local-service.md)

## 已处理

- 撤回未经要求新增的 CLI 采集入口，恢复原有 CLI 文件，底层采集继续保留。
- 安装并校验项目内 Go 工具链，构建此前缺失的 go-ast；构建脚本支持该本地工具链路径。
- 新增本地 HTTP 服务，复用 AST 和采集核心，固定项目根和本地监听地址。
- 使用用户级 LaunchAgent 部署，提供健康检查和实际后端可用性。
- 评分系统设计覆盖规则契约、证据账本、未知区间、所有权聚合、严重约束和可选来源/等级合成。
- 提供候选参数及算术样例，明确 design-only，尚未实现规则引擎或运行时出分。

## 验证范围

构建、类型检查、继承校验及 76 项相关集成测试通过，包括 Go 声明完整性、HTTP 健康检查、真实 Go 分析、采集及错误请求。
42 个改动文件通过文件/函数长度检查，git diff --check 通过。
全仓 check:limits 已通过 Go 文件，随后因 Java Runtime 缺失而中止。
实际后台进程的健康检查、Go 分析和采集冒烟结果保存在 `.cache/verification/local-service-smoke.json`；测试日志保存在 `.cache/verification/scoring-service-tests.log`。
Java/Rust 环境未就绪，健康接口如实报告不可用；本轮未声称完整多语言验证通过。
评分参数仍需人工排序、保留集和敏感性标定，不因设计文档存在就标记为正式评分能力。
