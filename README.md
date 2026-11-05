# code-eer

面向代码项目健康度评估与代码质量审查的工程项目。

项目将统一维护分类的代码质量审查要求，通过工具生成适用于不同 Harness（AI 编码工具或代理运行环境）的 Skills / Rules，并结合代码审核服务，通过 MCP、CLI 和前端工作台提供审查能力。

当前已完成项目结构初始化，并开始整理首批 AST 支持需求与接入方案，尚未实现服务、生成工具或前端功能。

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
│   └── code-review/             # 代码质量审核服务
│       ├── internal/            # 当前仓库自身的审核功能实现
│       └── ast/                 # 开源 AST 服务集合
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
- [首批语言范围确认与变更记录（2026-11-06）](docs/changes/2026-11-06/ast-integration-planning.md)。
- [代码审查用开源 AST 项目调研（2026-11-05）](docs/technical-designs/2026-11-05/ast-project-survey.md)。

## 当前状态

- 已建立项目目录骨架并初始化 Git，初始分支为 `main`。
- 已确定首批单语言支持范围，并形成需求与接入方案草案。
- 尚未安装依赖或配置启动命令，核心服务与前端技术栈待实现阶段确定。
- 审查规范、流程编排和配置内容将在后续逐项补充；AST 后端待按方案验证和实现。

服务、前端、配置、测试、提示词工程和 AI 目录目前仅含 `.gitkeep` 占位文件，用于在 Git 中保留目录结构，尚无实现内容。
