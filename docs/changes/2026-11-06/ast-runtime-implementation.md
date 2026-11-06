# 协议转发与 AST 接入

- 日期：2026-11-06
- 需求：[AST 接入](../../requirements/code-review/ast-integration.md)、[React 与 Vue 3](../../requirements/code-review/framework-support.md)
- 运行说明：[AST 协议与运行说明](../../technical-designs/2026-11-06/ast-runtime.md)
- 格式：[结构转换与结果格式](../../technical-designs/2026-11-06/ast-normalization.md)

## 交付内容

- TypeScript + Node.js 核心、CLI 与本地 stdio 转发入口。
- 协议与结构结果运行时 Schema、请求关联、串行后端队列、超时、取消、故障隔离及进程重启。
- JS/TS、Python、Java、Go、Rust 的真实解析器封装及公共结构转换。
- React JSX / TSX 和 Vue 3 SFC 的语法与结构适配。
- 文件发现、包含排除、源码摘要、UTF-16 位置、能力和转换覆盖记录。
- 依赖锁定、独立后端构建命令、真实集成测试和文件 / 函数行数检查。

## 验证结果

- 132 项测试通过，包含五种语言、React/Vue 精确清单、声明元数据、词法遮蔽、项目配置、原始位置、异常输入与协议验证；10 份手写清单共核对 106 个事实。
- 当前阶段 22 项审计检查通过；语言及框架结构检查纳入集成测试。
- 能力响应及文件结果记录转换范围、元数据字段、限制、目标配置及版本约束方式。
- TypeScript 类型检查、构建和文件 / 函数行数检查通过。
- 编译后的服务已完成五种语言及 React / Vue 的七类样例分析；CLI 的 Rust 后端能力查询通过。
- macOS arm64 环境的实际工具与解析器版本记录在运行说明中。
- 编译产物完成 6 份较大源码的验证，共 10123 行、1516 个事实；覆盖矩阵、通过标准与能力边界见 [AST 验证与覆盖](../../technical-designs/2026-11-06/ast-verification.md)。

## 待扩展能力

类型和符号查询、项目级语义、跨文件框架目标与模板作用域、常驻原生会话、MCP 入口、生产审查规则及前端工作台按后续阶段实施。首批语法与结构基线的交付状态分别记录，完整需求继续按验收标准推进。
