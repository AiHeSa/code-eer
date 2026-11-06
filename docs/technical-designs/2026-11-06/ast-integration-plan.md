# 首批单语言 AST 接入方案

- 方案编号：TD-AST-001
- 日期：2026-11-06
- 状态：协议与语法、结构基线已实现，语义能力待扩展
- 对应需求：[REQ-AST-001](../../requirements/code-review/ast-integration.md)
- 变更记录：[首批语言范围确认](../../changes/2026-11-06/ast-integration-planning.md)
- 结构格式：[结构转换与结果格式草案](ast-normalization.md)
- 框架需求：[React 与 Vue 3 支持](../../requirements/code-review/framework-support.md)
- 实现说明：[AST 协议与运行说明](ast-runtime.md)
- 上游依据：沿用 2026-11-05 至本轮续接前核对的官方资料；实际包版本在接入验证时锁定

## 1. 接入决策建议

首批采用语言原生工具分别封装后端。优先通过本地子进程通信，避免把 JVM、Python、Go、Rust 和 TypeScript 的运行时全部嵌入核心进程。

核心服务采用 TypeScript + Node.js，负责后端调度、协议校验、规则执行与结果汇总；CLI 和 MCP 入口复用核心模块。

| 语言后端 | 建议选型 | 封装方式 | 首批能力 | 后续可扩展能力 |
| --- | --- | --- | --- | --- |
| JS/TS | TypeScript 7.1 新 API 路线 | Node.js 封装新版官方客户端 | AST 访问、结构与模块信息、诊断 | 项目级类型、符号查询 |
| Python | 标准库 ast | Python 进程 | 语法与结构分析 | 按需增加 LibCST 的元数据和修改能力 |
| Java | JavaParser + JavaSymbolSolver | JVM 可执行包 | 语法与声明分析 | 结合 classpath 的符号、类型与方法解析 |
| Go | go/parser、go/ast、go/types、go/packages、go/analysis | Go 可执行文件 | 语法与声明分析 | 包和类型分析、自定义 Analyzer |
| Rust | syn | Rust 可执行文件 | 语法与声明分析 | rust-analyzer 经 LSP 提供定义、引用等查询 |

各后端已接入语法与结构基线，实际版本、可用能力与待扩展项记录在运行说明中。JavaSymbolSolver、Go 包类型与 rust-analyzer 按语义需求接入。

## 2. 总体调用方式

```text
CLI / MCP / 前端工作台
          ↓
代码审核核心（internal）：任务、能力检查、审查规则、结果汇总
          ↓
语言后端注册与进程管理
          ↓
JS/TS | Python | Java | Go | Rust 后端
          ↓
各语言原生解析器、编译器接口或语言服务
```

每个后端封装自己的原生库，输出可序列化的结构事实与诊断。核心模块不跨进程持有原生 AST 节点，也不依赖各工具的内部节点编号。

后端中的适配器负责原生结构到公共结构模型的转换，覆盖节点类别、包含关系、源码位置与语言专属信息。公共格式综合参考 unist、ESTree 与 LSP，字段与映射规则见结构格式草案。

只依赖公共结构事实的检查可在核心模块执行；必须访问原生 AST 或类型系统的检查，由对应语言的执行器完成并映射回统一规则编号。核心负责规则选择与结果汇总，避免为了执行语言专属规则而序列化整棵原生树。具体生产规则及分析器扩展接口随规则需求补充。

每个启用的语言后端使用一个常驻 Node.js 协议进程，并串行处理请求。原生解析器按文件启动，JS/TS 按文件创建并释放 API 快照。项目级原生会话、并行度和缓存按后续验证扩展。

首批无需为每个语言后端各建一套 HTTP / MCP 服务。MCP 作为项目统一入口复用核心调用。

## 3. 各语言的接入要点

### 3.1 JS/TS：采用新 API，先验证实际可用接口

官方已于 2026-10-20 发布 TypeScript 7.1 Beta 的新 API 说明，包含 `typescript/sync`、`typescript/async` 和 `typescript/ast` 等入口。该路线适合本次“按新版本”要求，当前文档依据明确为 Beta 说明，不把它写作已验证的稳定版本。[官方发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)

接入建议：

1. 使用新 API 的 Node.js 客户端，优先验证异步调用；同步接口可用于简单命令或调试。
2. 先验证实际可安装的版本、包导出、AST 遍历、类型查询与会话释放，再固定依赖和实现目录。
3. 分别验证 JS、TS、JSX、TSX 及 ESM / CommonJS；不能只验证 `.ts` 即声称全部支持。
4. 实现并验证 `tsconfig.json` / `jsconfig.json` 的项目加载，包括配置继承和项目引用。以当前公开接口为准，不能假设示例中的显式文件编译会自动加载项目配置。
5. 通过适配层隐藏新版 API 的对象生命周期，输出结果后不将会话内对象泄漏给核心模块。

首个验证项目失败时，记录缺口并调整新版接入方案，不静默改回 TypeScript 6 的旧 API。Node.js 与原生编译器平台包的版本要求也在此阶段确认。

React 在 JS/TS 后端内增加框架适配，提取 JSX、组件与 Hook 使用证据。Vue 3 在同一后端内增加 SFC 适配，使用 `@vue/compiler-sfc` 识别区块，使用 Vue 模板编译器的解析接口读取模板结构；脚本内容交给 JS/TS 适配器。框架解析器的版本和实际接口需在 P0 验证并锁定。

Vue 的脚本与模板事实统一定位到原始 `.vue` 文件。生成代码参与分析时，必须保留并验证映射；模板语法、脚本语法、组件绑定与类型解析分别声明能力。详细边界见框架需求与结构格式草案。

### 3.2 Python：ast 为基线，LibCST 按能力扩展

以标准库 `ast` 实现读取、解析、遍历及结构提取，不导入或运行被分析的 Python 模块。目标语法版本与执行解析的解释器版本一起记录。[ast 官方文档](https://docs.python.org/3/library/ast.html)

需要作用域元数据或保留格式的修改时，在同一语言后端中增加 LibCST；应声明它独立的版本支持范围。LibCST 的元数据不能直接等同于完整项目类型推断。[LibCST 元数据文档](https://libcst.readthedocs.io/en/latest/metadata.html)

Python 首批不引入完整类型检查器；如后续规则依赖类型，应新增需求与相应工具评估。

### 3.3 Java：先解析，按 classpath 增加语义

使用 JavaParser 完成语法与声明提取，使用同一项目中的 JavaSymbolSolver 解析符号。[JavaParser 官方说明](https://github.com/javaparser/javaparser)

项目上下文包括源码根目录、语言级别、JDK 和依赖 classpath。首期先支持显式提供这些信息；Maven / Gradle 的自动项目导入作为后续增强，不能把“发现 pom.xml”当成已解析完整依赖。

依赖缺失时保留语法结果，并标注相关语义查询受限。打包本项目后端时使用的 JDK 版本，与能够分析的 Java 源码语言级别分别记录。

### 3.4 Go：使用官方包加载与分析框架

`go/parser` / `go/ast` 支撑语法基线；需要语义时使用 `go/packages` 加载包和类型信息，自定义审查可基于 `go/analysis` 实现。[go/packages](https://pkg.go.dev/golang.org/x/tools/go/packages)、[go/analysis](https://pkg.go.dev/golang.org/x/tools/go/analysis)

项目上下文需包含 module / workspace、构建标签、GOOS / GOARCH、测试文件策略。仅处理被当前构建配置选中的文件时，应报告未纳入的文件，不能把当前配置的结果视为所有平台结果。

依赖下载策略单独配置。离线或依赖不齐时可完成独立文件语法分析，包级结果标注部分完成。

### 3.5 Rust：syn 提供 AST，语义接口另行扩展

使用 syn 的完整文件解析与遍历能力建立语法基线。集成验证需确认当前版本所需 feature、源码 span 和 edition 支持；不把宏调用中的 token 或 cfg 分支推定为已完成语义分析。[syn 文档](https://docs.rs/syn/latest/syn/)

类型、定义和引用能力建议通过独立 rust-analyzer 进程的 LSP 接口扩展。其内部 `ide` API 明确没有稳定保证，不作为首批核心依赖；LSP 也不负责为 syn 自动补上通用 AST 或任意自定义语义查询。[rust-analyzer 架构](https://rust-analyzer.github.io/book/contributing/architecture.html)

语义阶段需处理 Cargo workspace、features、target、cfg 和工具链。build.rs、过程宏及相关检查命令会带来执行行为，应按运行配置控制；未启用时明确其分析限制。[rust-analyzer 配置](https://rust-analyzer.github.io/book/configuration.html)

## 4. 通信与结果契约草案

协议 1.0 已提供请求、响应、结构数据与扩展字段的可执行 Schema，具体字段、操作和限制见运行说明。

- 传输：UTF-8 JSON Lines，通过本地 stdin / stdout 通信；一行一条完整 JSON，日志走 stderr。
- 协议：包含 `protocolVersion` 和 `requestId`，校验请求响应关联；后端声明版本与能力。
- 初始操作：`capabilities` 查询版本及能力，`analyze` 分析文件或项目。
- 请求包含：项目根目录、目标文件、语言、请求能力和后端配置；执行语言专属规则时附带已注册的规则或分析器编号。由调用端明确路径解析基准。
- 返回包含：完成状态、后端与版本、实际执行能力、结构事实、编译器诊断、审查发现、运行错误及未执行项。
- 超时或取消时终止相应任务；无法可靠中断的后端可重启进程，不复用状态未知的项目会话。
- 不支持的协议或能力需返回明确错误；对请求和结果大小设定上限，具体默认值在验证后确定。

### 4.1 能力声明

建议使用 `syntax`、`structure`、`symbols`、`types` 等能力名称，并按请求检查可用性。`symbols` 指已解析的语义符号；仅从语法树提取声明名称属于 `structure`。

可用性分为“后端支持”与“当前项目可用”两层：例如工具支持类型查询，但项目依赖缺失时，不能对该项目声称类型能力完整可用。

### 4.2 结果分类与状态

| 字段 | 用途 |
| --- | --- |
| `facts` | 函数、类型、模块、导入导出等结构事实，可带语言专属数据 |
| `diagnostics` | 原生解析器或编译器的语法、类型等诊断，保留来源与原生编号 |
| `findings` | code-eer 审查规则产生的问题，包含规则编号、严重程度、说明与位置 |
| `errors` | 环境缺失、工具故障、超时等运行错误 |
| `skipped` | 未分析的文件、未执行的能力或规则，以及原因 |

后端主要返回 `facts` / `diagnostics` / `errors` / `skipped`；核心模块执行审查规则并汇总 `findings`。后端如承载语言原生自定义分析器，应显式映射规则编号，避免同一诊断被重复计入审查发现。

整体状态使用 `complete`、`partial`、`failed`、`cancelled`。`complete` 表示本次请求的能力已执行完成，不表示没有代码问题。请求仅语法能力且解析完成时，不应因未请求类型分析而标为 `partial`。

### 4.3 源码位置

建议统一为零起始行号、UTF-16 列号和结束位置不包含的区间，便于与编辑器及 LSP 互通。CLI 展示时可转换为一起始行列。

各后端需把原生位置转换到这一约定，并记录源码版本或内容摘要；尤其不能直接混用 Python / Go 等工具的字节偏移与 UTF-16 列号。非 ASCII、非 BMP 字符、CRLF 及文件末尾位置必须纳入验证。暂时无法可靠定位时应明确缺失，不填造位置。

## 5. 建议的代码落位

实现目录与职责如下：

```text
services/code-review/
├── internal/
│   └── ast/                    # 接口契约、后端注册、进程管理及结果校验
└── ast/
    ├── js-ts/                  # TypeScript API、React 与 Vue 3 适配
    ├── python/                 # ast；按需接入 LibCST
    ├── java/                   # JavaParser + JavaSymbolSolver
    ├── go/                     # 官方语法与分析工具栈
    └── rust/                   # syn；按需增加 rust-analyzer 客户端

config/ast/                     # 后端启用、可执行路径、版本和项目分析选项
tests/fixtures/ast/              # 按 js-ts、python、java、go、rust 分类的样例
tests/integration/ast/           # 后端协议、结构提取和项目分析验证
```

`internal/ast/` 存放本项目的通用接入逻辑；`ast/<language>/` 存放各上游工具的接入封装及依赖声明。首期建议通过包管理器锁定依赖；确需保存或修改上游源码时，再在对应语言目录规划独立位置与来源记录。

核心服务、CLI、MCP 入口和公共契约采用 TypeScript + Node.js。语言后端分别声明运行环境与依赖；Node.js 版本在 P0 锁定。

## 6. 实施顺序与交付检查

| 阶段 | 工作 | 交付与完成条件 | 当前状态 |
| --- | --- | --- | --- |
| P0 | 验证 TypeScript 新 API、React / Vue 3 解析链路，确定五种后端及框架工具的版本与能力范围 | 实际可安装版本、公开接口验证、兼容性记录；发现缺口有明确处理方案 | 语法链路与版本已验证，语义接口待扩展 |
| P1 | 定义最小协议、结果 Schema、结构映射、位置约定和样例 | 请求响应可校验；错误与代码问题可区分；约定覆盖五个后端及 React / Vue 3 | 协议 1.0 与结构 Schema 已实现 |
| P2 | 先以 Python 跑通端到端调用，再接 Go | 进程管理、结构输出、语法诊断、取消及环境错误可验证 | 语法、结构与协议集成测试通过 |
| P3 | 接入 Java、JS/TS 与 React / Vue 3 适配 | 相应语言及框架用例通过；项目上下文加载有能力记录 | 语法结构用例通过，项目语义待扩展 |
| P4 | 接入 Rust syn，完成五方向语法基线验收 | 全部语言独立可用，位置转换与异常用例通过 | 五方向语法基线用例通过，完整兼容性验收继续推进 |
| P5 | 分别增加已需要的语义能力，并接到统一 CLI / MCP 入口 | 跨文件用例通过；缺依赖时正确返回受限结果；工作台可复用结果接口 | 未开始 |

各阶段按五个语言方向和 React / Vue 3 的首批范围验收。全部语言的共同能力及框架需求完成后，才能宣称首批 AST 支持完成。完整审查规则、评分策略与工作台页面按后续需求推进。

## 7. 关键验证用例

- 每种语言的声明与导入提取，同时验证对应语言的差异，例如 Rust 的 trait / impl、Go 的 receiver、Python 的 async def。
- React 的 JSX / TSX、函数与类组件、Hook 使用，以及 Vue 3 的模板、普通脚本、`script setup` 和区块间绑定。
- 同一请求中正常文件与语法错误文件并存，验证文件级结果及整体完成状态。
- 不完整 classpath、缺失 Go 依赖、TS 配置继承、Rust cfg / 宏等项目上下文边界。
- 中文、emoji、混合换行与结束位置，确保能准确定位源码。
- 后端启动失败、异常退出、超时、取消和重启后请求，验证故障隔离及结果关联。
- 用测试规则验证结构事实能够被核心模块消费；生产规则的具体判定标准另行定义。

当前交付包含协议 1.0、真实语言解析器、框架结构适配与集成测试。具体能力、环境和验证结果见[运行说明](ast-runtime.md)与[接入记录](../../changes/2026-11-06/ast-runtime-implementation.md)。
