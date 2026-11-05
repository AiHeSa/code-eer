# 代码审查用开源 AST 项目调研

调研日期：2026-11-05。状态：历史调研；首批语言范围已在后续需求中确定。

2026-11-06 计划更新：首批已确定按单语言支持 JS/TS、Python、Java、Go、Rust，JS/TS 采用新版接口路线。当前范围以[首批需求](../../requirements/code-review/ast-integration.md)与[接入方案](../2026-11-06/ast-integration-plan.md)为准。本页关于优先引入多语言引擎的建议属于初始调研，未被采纳为首批计划。

## 范围与结论

面向 code-eer 的代码健康度评估与质量审查，整理常见编程语言的开源语法解析、语法树转换和语义分析项目。候选清单不代表已经集成，也不代表已实测性能或支持所有最新语言特性。

建议采用“多语言语法能力 + 按需增加语言语义能力”的组合。多语言规则验证优先评估 ast-grep；需要自定义语法树提取、增量解析时再评估直接使用 Tree-sitter。按目标仓库语言选择编译器或语义分析接口，不必首期全部接入。

下文的接入成本和优先级是针对本项目的工程判断，不是上游项目的性能排名。主要依据是官方文档、仓库说明和许可证；具体版本与运行环境需在集成验证阶段确定。

## 能力边界

| 层次 | 可以支持的审查 | 不能直接推定具备的能力 |
| --- | --- | --- |
| AST / CST 解析 | 函数、类、导入提取，嵌套结构检查，代码模式检查 | 完整类型推断、跨文件引用、数据流分析 |
| 结构规则引擎 | 声明式模式匹配、批量扫描、部分替换修复 | 自动获得语言编译器的语义信息 |
| 语义分析接口 | 类型、符号绑定、引用关系、项目级分析 | 完整调用图、路径敏感分析、污点分析通常仍需额外实现或工具 |

CST 更关注源码细节；例如 LibCST 可保留注释和空白，适合生成修改。Tree-sitter 输出具体语法树，不能简单视为每种语言官方 AST 的等价替代。[Tree-sitter](https://tree-sitter.github.io/tree-sitter/)、[LibCST](https://github.com/Instagram/LibCST)

## 多语言基础候选

| 项目 | 定位与能力 | 接入方式 | 上游主许可证 | 本项目建议 |
| --- | --- | --- | --- | --- |
| [Tree-sitter](https://github.com/tree-sitter/tree-sitter) | 多语言增量语法解析，适合树遍历、结构提取和不完整代码解析 | 语言绑定、原生库、WASM；需要匹配各语言 grammar | MIT；各 grammar 独立核对 | 基础候选；需要直接操纵语法树时接入 |
| [ast-grep](https://github.com/ast-grep/ast-grep) | 基于 Tree-sitter 的结构搜索、规则扫描与代码重写 | CLI、Node.js / Python API 等 | MIT | 优先验证；可以减少自建规则匹配器的工作 |
| [ANTLR](https://www.antlr.org/) | 根据 grammar 生成解析器和 parse tree | 生成目标运行时的解析器 | [BSD-3-Clause](https://github.com/antlr/antlr4/blob/master/LICENSE.txt) | 备选；自定义 DSL 或特殊语法出现时再评估 |

ast-grep 已覆盖 JS/TS、Python、Java、Go、C/C++、C#、Rust、Kotlin、Swift 等多种语言，但 CLI、各语言绑定和自定义语言包的可用范围应分别核对。官方 FAQ 明确列出其缺少作用域、类型、控制流、数据流和污点分析。多语言支持也不表示一条规则可以原样应用于所有语言。[语言概览](https://ast-grep.github.io/guide/introduction)、[能力限制](https://ast-grep.github.io/advanced/faq.html)

ast-grep 已使用 Tree-sitter；首期可以先用 ast-grep，不需要为同一批结构规则再维护一套直接基于 Tree-sitter 的实现。

## 按语言整理的候选

| 语言 | 优先评估项目 | 适合的能力 | 接入成本判断 | 上游主许可证 |
| --- | --- | --- | --- | --- |
| JavaScript / TypeScript | [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) | AST、类型和符号查询、项目级检查 | 中；必须先明确 API 代际与版本 | Apache-2.0 |
| JavaScript / TypeScript | [Oxc](https://github.com/oxc-project/oxc) | JS/TS/JSX/TSX 解析与工具构建；具体语义能力按所用组件核对 | 低至中；Rust crate 或 Node.js 绑定 | MIT |
| Python | [标准库 ast](https://docs.python.org/3/library/ast.html) | AST 遍历、自定义检查、结构统计 | 低；随 Python 解释器提供 | 随 Python 发行版 |
| Python | [LibCST](https://github.com/Instagram/LibCST) | 保留格式的语法树、访问器、作用域元数据、自动修改 | 低至中；Python 包 | MIT |
| Java | [JavaParser + JavaSymbolSolver](https://github.com/javaparser/javaparser) | AST、声明与引用关联、类型和方法解析 | 中；JVM 与项目依赖解析 | Apache-2.0 或 LGPL，按上游选项选择 |
| Go | [go/ast](https://pkg.go.dev/go/ast)、[go/packages](https://pkg.go.dev/golang.org/x/tools/go/packages)、[go/analysis](https://pkg.go.dev/golang.org/x/tools/go/analysis) | 语法树、包加载、类型信息、自定义分析器及诊断 | 低至中；Go 工具链与模块环境 | BSD-3-Clause |
| C / C++ / Objective-C | [Clang：libclang / LibTooling](https://clang.llvm.org/docs/Tooling.html) | 编译器级语法与语义信息，AST 匹配与重构 | 高；涉及编译参数、头文件、宏和平台环境 | Apache-2.0 WITH LLVM-exception |
| C# / Visual Basic | [Roslyn](https://github.com/dotnet/roslyn) | 语法树、语义模型、符号、解决方案模型、自定义分析器 | 中；.NET、项目引用与构建环境 | MIT |
| Rust | [syn](https://github.com/dtolnay/syn) | Rust 源码和 TokenStream 解析、访问和转换 | 低至中；适合语法级规则 | MIT 或 Apache-2.0 |
| Rust | [rust-analyzer](https://github.com/rust-lang/rust-analyzer) | 项目语义、定义与引用、IDE 分析能力 | 高；需选择 LSP 或内部库的接入边界 | MIT / Apache-2.0 |
| Kotlin | [Kotlin Analysis API](https://kotlin.github.io/analysis-api/) | 基于 PSI 的符号、类型及语义关系查询 | 高；需验证项目模型与所选版本的独立运行方式 | Kotlin 主仓库为 Apache-2.0 |
| Swift | [SwiftSyntax / SwiftParser](https://github.com/swiftlang/swift-syntax) | 保留源码细节的语法树、遍历、生成与转换 | 中；版本需与 Swift 工具链匹配 | Apache-2.0，包含 Runtime Library Exception |
| PHP | [nikic/PHP-Parser](https://github.com/nikic/PHP-Parser) | AST、名称解析、遍历、转换和部分格式保留 | 低至中；PHP / Composer 环境 | BSD-3-Clause |
| Ruby | [Prism](https://github.com/ruby/prism) | Ruby 解析与语法树访问 | 中；按所选绑定和 Ruby 版本验证 | MIT |
| Dart / Flutter | [analyzer](https://pub.dev/packages/analyzer) | Dart 语法与静态分析能力，可嵌入工具 | 中；Dart SDK 与项目解析环境 | BSD-3-Clause |

这些候选多数是库、工具链或进程，并非现成的 HTTP / MCP 服务。集成时需要由本项目封装调用与结果输出。

## 重点候选的取舍

### JavaScript / TypeScript

TypeScript 官方 Compiler API 能查询节点的类型和符号。但当前官方教程注明只描述 TypeScript 6.0 及以前，且 7.1 API 将完全不同。因此集成前应验证目标版本的公开接口与兼容范围，不能直接假设旧版 `createProgram` / `TypeChecker` 示例适用于全部新版。[官方 Compiler API 说明](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

Oxc 的解析器支持 Node.js 绑定和 Rust crate，适合高吞吐语法处理；解析器组件自身的能力应与类型检查、lint 等组件区分。[Oxc Parser](https://oxc.rs/docs/guide/usage/parser)

另外两个成熟候选是 [Babel parser / traverse](https://babeljs.io/docs/babel-parser)（MIT）和 [SWC](https://swc.rs/docs/usage/core)（Apache-2.0）。前者适合复用 Babel 的语法和转换生态，后者提供 Rust / Node.js 的解析与转换接口。首期可按规则实现方式选择一个语法后端，避免同时维护多套 AST 结构。

### Python

标准库 `ast` 足以支撑很多语法检查，但语法版本与运行的 Python 版本有关。它不会自动提供完整的项目类型推断。[ast 文档](https://docs.python.org/3/library/ast.html)

LibCST 更适合需要保留注释、空白的修复。其作用域与限定名称元数据有助于分析，但不能据此推定具备完整的 Python 类型检查；需要区分元数据提供器本身与外部类型推断依赖。[LibCST 元数据文档](https://libcst.readthedocs.io/en/latest/metadata.html)

### Java

JavaParser 适合 AST 遍历和操作；JavaSymbolSolver 已合并到同一项目，可以关联表达式与声明。做语义检查时需要准备源码路径、JDK 与依赖信息。[JavaParser 官方说明](https://github.com/javaparser/javaparser)

备选包括 [Spoon](https://spoon.gforge.inria.fr/) 和 [Eclipse JDT Core](https://github.com/eclipse-jdt/eclipse.jdt.core)。Spoon 提供更丰富的源码分析与转换模型，官网目前列出 CeCILL-C / MIT 双许可证；JDT Core 适合需要 Eclipse 编译器和项目模型的情况，仓库主许可证为 EPL-2.0。首期建议先验证 JavaParser 是否满足需求，再决定是否增加其他实现。

### Go 与 C#

Go 优先复用官方工具栈：`go/ast` 用于树结构，`go/packages` 处理包与类型加载，`go/analysis` 提供分析器、诊断和修复建议接口。不要把单独使用 `go/ast` 等同于完整项目语义分析。[Go analysis](https://pkg.go.dev/golang.org/x/tools/go/analysis)

Roslyn 同时公开语法、符号、语义和 Workspace 模型，适合为 .NET 项目实现自定义检查。[Roslyn 架构概览](https://github.com/dotnet/roslyn/blob/main/docs/wiki/Roslyn-Overview.md)

### C / C++

libclang 提供相对稳定的高层 C 接口，方便跨语言调用，但不会暴露全部 Clang AST。LibTooling 面向独立 C++ 工具和服务，能更深入访问 AST，但接口升级维护成本较高。[官方接口比较](https://clang.llvm.org/docs/Tooling.html)

评估时应使用真实项目的编译参数、头文件路径和宏定义；不能只测试孤立代码片段就判定已支持该项目。

### Rust、Kotlin、Swift

syn 适合语法级分析，不负责 Rust 项目的完整类型检查或自动宏展开。rust-analyzer 提供定义、引用和诊断等能力，但复用内部库与使用 LSP 是不同集成方案；标准 LSP 本身不等于通用 AST 导出协议。[syn](https://github.com/dtolnay/syn)、[rust-analyzer](https://github.com/rust-lang/rust-analyzer)

Kotlin Analysis API 明确面向语义查询，构建于 PSI 之上；独立运行和项目配置方式需要按实际版本验证。[官方说明](https://kotlin.github.io/analysis-api/)

SwiftSyntax 主要提供源码准确的语法树，版本与 Swift 工具链对应；类型与跨文件语义需求应另行评估，不能单凭 SwiftSyntax 推定具备。[SwiftSyntax 官方说明](https://github.com/swiftlang/swift-syntax)

## 建议的选择顺序

1. **首先验证多语言结构规则：ast-grep。** 用少量实际规则验证定位、误报、规则测试和修复能力；必要时再增加直接的 Tree-sitter 解析能力。
2. **根据首期目标仓库选择语言后端。** Python 可选 `ast` / LibCST，Java 可选 JavaParser + JavaSymbolSolver，Go 可选官方工具栈，C# 可选 Roslyn。JS/TS 需先确认语法检查还是类型检查，再选择 Oxc / Babel / SWC 或对应版本的 TypeScript 接口。
3. **针对真实需求增加较重的环境。** C/C++ 的 Clang、Rust 的 rust-analyzer、Kotlin Analysis API 等，在需要对应语言的深入语义检查时再接入。
4. **按代码资产扩充语言。** Swift、PHP、Ruby、Dart 的专用库进入候选池，是否提前接入取决于首期被审查仓库。

当前建议优先选择“一个多语言结构规则引擎 + 一至两个实际需要的语言后端”，不把此建议视为已经确定的集成清单。

## 集成验证时需要补齐的证据

- 目标语言版本、真实仓库和需要支持的规则；包括容易误报的反例。
- 是否只需要单文件语法，还是需要类型、跨文件引用、数据流或修复。
- 依赖安装、项目模型与编译参数缺失时，哪些分析仍然有效。
- 真实仓库上的扫描时间、峰值内存、增量处理效果和错误恢复情况。
- 使用的具体版本、公开接口、许可证及随附第三方代码说明。

本轮只记录选型依据，尚未安装依赖、复制上游源码、封装服务或运行性能基准。
