# AST 协议与运行说明

- 日期：2026-11-06
- 状态：协议 1.0 与语法、结构基线已实现
- 需求：[AST 接入](../../requirements/code-review/ast-integration.md)、[React 与 Vue 3](../../requirements/code-review/framework-support.md)
- 结构格式：[TD-AST-002](ast-normalization.md)
- 验证记录：[协议转发与 AST 接入](../../changes/2026-11-06/ast-runtime-implementation.md)
- 验证矩阵：[AST 验证与覆盖](ast-verification.md)
- 完整性：[功能完整性审计](ast-completeness-audit.md)，当前阶段 22 项检查通过。

## 1. 开发环境与安装

核心使用 Node.js 24+。当前实测环境为 macOS arm64、Node.js 24.14.0、Python 3.14.4、Go 1.24.3、Rust 1.97.1 和 JDK 24.0.1。各语言运行环境独立检查。

```sh
npm ci
npm run setup:backends
npm run typecheck
npm test
npm run build
npm run check:limits
```

`setup:backends` 构建 Go、Rust 和 Java 后端；支持传入后端名称分别构建，例如 `npm run setup:backends -- java`。Go 使用 Go 工具链，Rust 使用 Cargo 锁文件，Java 使用 JDK 17+ 的 `javac` 并下载带 SHA-256 校验的依赖 JAR。

Python 后端直接调用解释器；`CODE_EER_PYTHON` 与 `CODE_EER_JAVA` 可分别配置解释器和 JVM 的可执行文件路径。Rust 语义分析使用 `CODE_EER_RUST_ANALYZER`、项目工具链、PATH 的顺序查找分析器；`setup:backends` 安装 `rust-analyzer` 和 `rust-src`。依赖和构建产物放在 `.cache/`、Rust `target/` 与 Java `build/`。

## 2. CLI 与调用入口

```sh
npm run dev -- capabilities --backend python
npm run dev -- analyze --backend js-ts --root . tests/fixtures/ast/js-ts/React.tsx
npm run dev -- analyze --backend js-ts --root . tests/fixtures/ast/js-ts/View.vue
npm run dev -- analyze --backend js-ts --semantic --root . tests/fixtures/ast/js-ts/View.vue
npm run dev -- analyze --backend python --root tests/fixtures/ast/python
node dist/services/cli/index.js analyze --backend rust --root tests/fixtures/ast/rust
node dist/services/cli/index.js serve
```

`--backend` 支持 `js-ts`、`python`、`java`、`go`、`rust`。文件列表为空时扫描项目根目录；支持 `--include`、`--exclude`、`--no-tests`、`--framework react|vue`、`--tsconfig` 与 `--timeout`。`--semantic` 在语法和结构之外请求符号与类型。

代码调用入口为 [AstService](../../../services/code-review/internal/ast/service.ts)，提供 `dispatch`、`analyze`、`capabilities` 与 `close`。每个后端的请求串行处理，各后端独立运行。调用方完成任务后关闭服务。

本轮入口包括 CLI 与本地 stdio 服务；MCP 和工作台接入列入后续阶段。

## 3. JSON Lines 协议

传输为 UTF-8，通过 stdin / stdout 发送一行一条 JSON，日志输出到 stderr。协议版本和结构数据版本均为 `1.0`。请求和响应均在边界执行运行时 Schema 校验。

Schema 源文件：[请求与响应](../../../services/code-review/internal/ast/protocol.ts)、[结构数据](../../../services/code-review/internal/ast/schema.ts)、[扩展字段](../../../services/code-review/internal/ast/extensions.ts)。TypeScript 类型从 Schema 推导。

能力请求：

```json
{"protocolVersion":"1.0","requestId":"caps-1","backend":"python","method":"capabilities","params":{}}
```

分析请求中的 `root` 必须是绝对路径，`files` 相对此路径解析；文件为空时执行发现。以下 `/project` 为调用方指定的项目路径。

```json
{"protocolVersion":"1.0","requestId":"scan-1","backend":"python","method":"analyze","params":{"root":"/project","files":["main.py"],"capabilities":["syntax","structure"],"factTypes":["function","type"]}}
```

成功响应包含 `protocolVersion`、对应 `requestId`、`ok: true` 与 `result`。能力结果包括后端版本、运行时、环境可用性、能力、事实类别、框架列表，以及 `coverage`、`frameworkCoverage` 和 `syntax`。分析结果包括：

- `schemaVersion`、后端版本、`configuration` 和完成状态。
- 文件 URI、SHA-256 源码摘要、框架标记、结构事实与编译器诊断。
- 文件级 `coverage` 转换范围及限制、`syntax` 解析器版本及有效目标配置。
- 文件级和整体运行错误、未执行项，以及实际执行能力。
- 语义查询结果 `semantic`，包含定义、类型、诊断与限制；React 和 Vue 的专属结果位于可选的 `semantic.framework`。
- `findings` 为审查规则结果，本轮保持为空。

协议或工具调用失败返回 `ok: false`，并通过 `error.code` 与 `error.message` 表达原因。错误码包括 `INVALID_REQUEST`、`UNSUPPORTED_PROTOCOL`、`BACKEND_UNAVAILABLE`、`BACKEND_EXIT`、`INVALID_RESPONSE`、`RESPONSE_MISMATCH`、`MESSAGE_TOO_LARGE` 和 `TIMEOUT`。

取消请求：

```json
{"protocolVersion":"1.0","requestId":"cancel-1","method":"cancel","targetRequestId":"scan-1"}
```

取消响应中的 `result.cancelled` 表示是否找到活动请求。被取消的分析返回 `status: cancelled`；对应后端进程被终止，后续请求启动新进程。POSIX 环境清理该后端独立进程组；Windows 当前清理直接子进程。

stdin 正常结束后等待活动请求完成。`SIGINT` / `SIGTERM` 触发服务清理。每个 stdio 连接最多接受 128 个活动请求。

## 4. 限制与访问约定

- 单条请求或响应上限为 16 MiB，单文件上限为 4 MiB，单请求文件数量上限为 10000。
- 后端请求超时默认 30 秒，从该请求开始执行时计时；CLI 可配置。原生单文件解析也设 30 秒上限。
- 显式源码和 Vue 外部区块均校验真实路径，源码限制在项目根目录内。项目发现跳过符号链接。
- 默认排除依赖、构建产物及缓存目录；包含排除规则相对于项目根目录匹配。
- TypeScript 官方配置加载器解析配置继承；`files`、`include`、`exclude` 与输出目录参与文件选择，Vue 文件遵循继承后的路径规则。
- 语法解析读取源码快照；各原生解析器按文件启动。常驻 Node.js 后端承担协议、文件管理与结果转换。
- 函数体范围和节点位置使用零起始行列、UTF-16 列号及结束位置不包含的区间。无效范围返回缺失位置及原因。
- 按事实类别筛选时保留所需的容器和声明引用。引用校验涵盖唯一标识、存在性与包含关系无环。

## 5. 已验证的解析器与能力

| 后端 | 实际版本 | 当前能力 |
| --- | --- | --- |
| JS/TS | TypeScript 7.1.0-beta | 新版异步 API、AST、诊断、项目配置选文件、声明、独立解构导出、CommonJS、泛型和继承文本 |
| Python | CPython 3.14.4 标准库 ast | 函数、方法、lambda、类、类型别名、导入、参数注解与默认值、泛型、装饰器及诊断 |
| Java | JavaParser 3.28.2；Gson 2.13.2 | 声明、构造器、lambda、匿名类、模块指令、泛型、注解、继承、record 组件及原始 Unicode 转义位置 |
| Go | Go 1.24.3 标准库 | 函数、函数表达式、接收者及接口方法、全局与局部类型、类型别名标记、泛型、导入、包与诊断 |
| Rust | syn 2.0.119、proc-macro2 1.0.107 | 函数、闭包、trait / impl 方法与关联类型、union、extern、模块、use、属性、可见性、泛型与容器 |
| Vue 3 | compiler-sfc / compiler-dom 3.5.45 | SFC 区块、JS/TS 脚本、HTML 模板、指令、插槽、插值与原始位置 |

React 的 JSX / TSX 由 TypeScript 解析。组件记录声明引用及候选依据，覆盖匿名默认导出、变量和调用包装内的箭头函数、继承 React 基类的组件。Hook 来源判断检查参数、局部声明、catch、循环和块作用域；默认参数使用参数作用域。框架识别优先级为显式配置、源码导入、最近 package.json 的 dependencies / devDependencies / peerDependencies；同时依赖 React 和 Vue 时保留未确定状态。SFC 文件标记为 Vue。

Vue 支持普通脚本与 `script setup` 共存，保留 props / emits、编译器宏和调用的语法证据。宏候选要求 setup 上下文、顶层调用和可辨识的词法绑定；Options API 支持简写、引号属性和方法形式。外部脚本与模板保留原始文件 URI。样式和自定义区块记录属性与位置；预处理语言根据支持状态返回未执行项。

`coverage.projection` 为 `selected-facts`，`nativeNodes` 列出映射节点及条件，`metadata` 列出扩展字段，`limitations` 声明当前范围。`syntax.versionConstraint` 标明解析器约束、尽力约束或未约束；TypeScript 的编译目标、Python feature_version、Java LanguageLevel 和 Rust edition 记录到文件结果。

`symbols` 和 `types` 使用 [五语言语义提供者](../2026-11-07/compiler-semantics.md)。React JSX 组件引用和 Props 类型，以及 Vue 模板绑定与静态组件引用，见[框架语义契约](../2026-11-13/framework-semantics.md)。未解析的目标保留空定义；部分结果保留诊断与范围说明。

## 6. 验证

`npm test` 运行真实解析器集成测试和协议故障测试，覆盖正常输入、语法错误、文件缺失、能力受限、React/Vue 结构、区块失败、外部脚本、路径边界、Unicode、CRLF、流式帧、错误响应、超时、取消与重启。

`check:limits` 检查源文件和文档的 300 行限制，并使用语法解析器检查函数的 40 行限制。生成的依赖锁文件按其工具格式保存。

`npm run verify:ast` 顺序执行类型检查、构建、回归测试、编译产物的大源码验证、行数检查和完整性审计，任一步失败即返回失败。准备原生后端后运行该命令；单独运行大源码验证使用 `npm run verify:ast:corpus`。覆盖清单、预期定义和结果解释见[验证矩阵](ast-verification.md)。

`npm run audit:ast` 检查语法、结构与五语言类型和符号能力。执行前运行 `npm run build`；报告保存为 `.cache/verification/ast-completeness.json`。首轮结构基线见[完整性审计](ast-completeness-audit.md)。
