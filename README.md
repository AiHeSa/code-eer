# code-eer

面向代码项目健康度评估与代码质量审查的工程项目。

项目将统一维护分类的代码质量审查要求，通过工具生成适用于不同 Harness（AI 编码工具或代理运行环境）的 Skills / Rules，并结合代码审核服务，通过 MCP、CLI 和前端工作台提供审查能力。

当前已实现 AST 协议转发、公共结构转换，以及 JS/TS、Python、Java、Go、Rust、React 和 Vue 3 的语法与结构基线。

AST 基线的验证记录为 22 项审计检查与 132 项回归测试通过。转换范围、验证结果及后续能力见[功能完整性审计](docs/technical-designs/2026-11-06/ast-completeness-audit.md)。

三项评分已实现实验引擎：基于 AST 证据执行规则、计算数值或保守区间，按组/文件/模块聚合并保留去重账本、源码快照与完整报告。事实采集见[采集契约与三项算法](docs/technical-designs/2026-11-07/assessment-collection.md)，运行与能力范围见[评分引擎](docs/technical-designs/2026-11-07/scoring-runtime.md)。

评分系统采用[系统设计](docs/technical-designs/2026-11-07/scoring-system.md)和[候选计分策略](docs/technical-designs/2026-11-07/scoring-policy-v0.md)，实验运行参数单独保存在 config/scoring.v0.json。人工质量标定尚未完成；预算、职责或语义证明不足时不产生完整总分。
本地后台 HTTP 入口与部署状态见[运行记录](docs/technical-designs/2026-11-07/local-service.md)，评分采集通过编程接口及后台接口提供。

## 目录结构

```text
code-eer/
├── README.md                    # 项目说明与目录导航
├── .ai/                         # 本项目开发过程中使用的 AI 辅助资源
│   ├── context/                 # 项目背景、术语与供 AI 参考的上下文
│   ├── skills/                  # 辅助开发本项目的 Skills
│   └── rules/                   # 辅助开发本项目的 AI 规则
├── prompts/                     # 面向代码质量审查的提示词工程
│   ├── requirements/            # 审查要求源文件，按类别组织
│   ├── generators/              # Skills / Rules 生成工具
│   ├── adapters/                # 不同 Harness 的格式与目录适配
│   └── generated/               # 生成产物，后续按 Harness 分目录
├── services/                    # 服务实现
│   ├── mcp/                     # MCP 服务入口
│   ├── cli/                     # CLI 服务入口
│   ├── server/                  # 本地后台 HTTP 服务入口
│   └── code-review/             # 代码质量审核服务
│       ├── internal/            # 当前仓库自身的审核功能实现
│       └── ast/                 # 语言与框架解析器封装
├── frontend/                    # 独立的前端工作台
├── config/                      # 项目级配置
├── tests/                       # 独立测试目录
│   └── fixtures/                # 审查与测试使用的样例代码、数据
└── docs/                        # 项目需求、变更与技术方案
    ├── requirements/            # 按功能类别组织的需求与功能说明
    ├── changes/                 # 按日期组织的变更记录
    └── technical-designs/       # 按日期组织的技术方案
```

## 提示词工程与 AI 辅助资源

`prompts/` 是项目自身的产品能力：维护代码质量审查要求，并生成供不同 Harness 使用的 Skills / Rules。要求源文件、生成工具、Harness 适配和生成产物分别存放。

`.ai/` 用于存放开发本项目时使用的共享上下文、Skills 和 Rules。当前只预留目录；这是仓库内部的存放约定，各 Harness 的自动加载入口与配置后续按需接入。

## 文档组织

- `docs/requirements/` 按功能类别维护本项目的需求与功能说明。它与 `prompts/requirements/` 中面向被审查代码的审查要求用途不同。
- `docs/changes/` 与 `docs/technical-designs/` 按 `YYYY-MM-DD` 建立日期目录，同一天的不同事项分别建文档。
- 需求、变更记录与对应技术方案应相互关联，便于追踪。

当前文档：

- [首批单语言 AST 接入需求](docs/requirements/code-review/ast-integration.md)：JS/TS、Python、Java、Go、Rust。
- [首批单语言 AST 接入方案（2026-11-06）](docs/technical-designs/2026-11-06/ast-integration-plan.md)：选型、接入方式、接口边界与实施顺序。
- [React 与 Vue 3 支持需求](docs/requirements/code-review/framework-support.md)：框架输入、结构事实、能力边界与验收要求。
- [结构转换与结果格式（2026-11-06）](docs/technical-designs/2026-11-06/ast-normalization.md)：原生 AST 对照、公共模型与位置转换。
- [AST 协议与运行说明（2026-11-06）](docs/technical-designs/2026-11-06/ast-runtime.md)：环境、安装、CLI、协议与能力范围。
- [AST 验证与覆盖矩阵（2026-11-06）](docs/technical-designs/2026-11-06/ast-verification.md)：精确预期、异常输入、较大源码与验收边界。
- [AST 功能完整性审计（2026-11-06）](docs/technical-designs/2026-11-06/ast-completeness-audit.md)：结构检查、输入和实际结果、转换范围及后续能力。
- [协议转发与 AST 接入记录（2026-11-06）](docs/changes/2026-11-06/ast-runtime-implementation.md)。
- [能力分类、回退与提交校验（2026-11-06）](docs/technical-designs/2026-11-06/capability-routing.md)：通用与专项入口、缺项回退、Markdown 继承及 Git pre-commit 校验。
- [仓库健康度分级评估需求](docs/requirements/code-review/repository-grading.md)：模型与 internal 两路评分、A–E 等级及可选依赖。
- [仓库分级评估设计草案（2026-11-06）](docs/technical-designs/2026-11-06/repository-grading.md)：抽样、评分合成、结果追溯及等级策略。
- [作用域、复杂度与代码位置评分需求](docs/requirements/code-review/scope-complexity-placement.md)：三项独立评分、影响链路及综合评分。
- [三项评分设计草案（2026-11-06）](docs/technical-designs/2026-11-06/scope-complexity-placement.md)：属性、成本分析、模块角色及建议权重。
- [核心技术栈与框架范围记录（2026-11-06）](docs/changes/2026-11-06/core-framework-planning.md)。
- [首批语言范围确认与变更记录（2026-11-06）](docs/changes/2026-11-06/ast-integration-planning.md)。
- [代码审查用开源 AST 项目调研（2026-11-05）](docs/technical-designs/2026-11-05/ast-project-survey.md)。

## 当前状态

- 核心服务、CLI、本地 stdio 服务和公共契约采用 TypeScript + Node.js。
- 五个语言后端及 React / Vue 3 已接入真实解析器，提供结构事实、语法诊断和能力状态。
- 协议具备运行时校验、请求关联、超时、取消与后端故障隔离。
- 类型与符号能力、框架语义、MCP 入口、审查规则和前端工作台按后续阶段推进。

## 开发命令

```sh
npm ci
npm run setup:backends
npm run dev -- capabilities --backend python
npm run dev -- analyze --backend js-ts --root . tests/fixtures/ast/js-ts/View.vue
npm test
npm run test:assessment
npm run test:scoring
npm run check:inheritance
npm run typecheck
npm run build
npm run check:limits
npm run verify:ast
```

各后端的运行环境、独立构建与详细参数见运行说明。前端、MCP、项目配置、提示词工程和 AI 资源目录保留扩展位置。

`npm ci` 自动安装 Git 提交前继承校验；手动安装使用 `npm run setup:hooks`。专项缺项使用通用实现，额外入口或不兼容签名会阻止提交；校验读取暂存区内容。
