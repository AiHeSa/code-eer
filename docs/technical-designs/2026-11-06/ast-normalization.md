# 结构转换与结果格式

- 方案编号：TD-AST-002
- 日期：2026-11-06
- 状态：协议 1.0 与结构 Schema 已实现，语义映射按能力扩展
- 关联需求：[AST 接入](../../requirements/code-review/ast-integration.md)、[React 与 Vue 3](../../requirements/code-review/framework-support.md)
- 总体方案：[TD-AST-001](ast-integration-plan.md)
- 变更记录：[核心技术栈与框架范围](../../changes/2026-11-06/core-framework-planning.md)

## 1. 转换职责

核心服务采用 TypeScript + Node.js。各语言和框架适配器读取原生解析结果，生成公共结构事实、诊断与覆盖信息。

```text
源码 → 原生 AST / 模板树 → 语言与框架适配器 → 公共结构模型
                                              ↓
                                核心规则 / CLI / MCP / 工作台
```

公共模型首批覆盖声明、模块、导入导出、组件与视图结构。每类事实定义可用字段、子结构和语言映射范围。原生 AST 和类型会话由对应后端管理；需要原生表达式或类型系统的规则在后端执行。

格式按结构需求逐项扩展，并分别记录结构覆盖与语义能力。表达式字符串保留为源码信息；表达式的符号绑定和类型结果通过对应能力交付。

## 2. 格式参考

| 参考 | 采用的设计内容 | 本项目约定 |
| --- | --- | --- |
| [unist](https://github.com/syntax-tree/unist) | 公共节点、位置与扩展数据的组织方式 | 定义公共事实基类和可校验的扩展字段；包含关系使用事实引用 |
| [ESTree](https://github.com/estree/estree/blob/master/es5.md) | 判别式节点类别、命名字段及函数等结构的组织方式 | 按审查需求定义跨语言事实类别及字段；逐项明确语言含义 |
| [LSP Position](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#position)、[Range](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#range) | 文件内行列和范围表达 | 零起始行列、固定 UTF-16 编码、结束位置不包含 |

本项目维护独立版本的 Schema。unist 与 ESTree 的位置约定各自定义；所有输入位置均由适配器转换到上述公共约定。上游格式名称作为设计参考记录。

## 3. 原生结构对照

下表列出原生结构和映射约定，实际版本及公开接口验证见[运行说明](ast-runtime.md)。

| 来源 | 原生结构特征 | 转换要求 |
| --- | --- | --- |
| JS/TS | TypeScript 7 新版异步 API 提供快照、声明、参数和 JSX 结构 | 映射函数、方法、类型、模块、绑定和 JSX，保留泛型、继承及独立解构导出 |
| [Python ast](https://docs.python.org/3/library/ast.html) | `FunctionDef` / `AsyncFunctionDef`、`ClassDef`、`arguments`；列位置采用 UTF-8 字节偏移 | 统一函数事实并记录 async；保留参数类别、装饰器和类包含关系；转换字节列 |
| [JavaParser](https://github.com/javaparser/javaparser/blob/master/javaparser-core/src/main/java/com/github/javaparser/ast/Node.java) | 节点对象、子节点、可选源码范围及声明专属字段 | 提取声明与修饰符，保留构造器类别；核对位置单位和端点语义 |
| [Go ast](https://pkg.go.dev/go/ast) | `FuncDecl` 包含 `Recv`、`Type`、`Body`；通过 `Pos` / `End` 提供位置 | 区分函数和方法，保留接收者、多返回值及类型参数；通过 FileSet 转换位置 |
| [Rust syn](https://docs.rs/syn/latest/syn/) | 独立函数、impl、trait 及其成员具有各自节点和签名结构 | 保留 impl / trait 容器、签名、属性及 cfg 语法；验证 span 能力 |
| React | JSX 结构结合导入、函数或类声明提供框架识别证据 | 保留元素树、属性、表达式与组件声明引用；记录 Hook 调用来源 |
| [Vue 3 compiler-sfc](https://github.com/vuejs/core/tree/main/packages/compiler-sfc)、[模板 AST](https://github.com/vuejs/core/blob/main/packages/compiler-core/src/ast.ts) | SFC 区块描述与模板节点结构；脚本区块可独立处理 | 分区解析并关联脚本与模板；保留指令和作用域；映射到原始源码 |

## 4. 公共结构模型

结果保留总体方案中的 `facts`、`diagnostics`、`findings`、`errors` 和 `skipped` 分类。公共结构事实按文件组织，每个文件记录 URI、语言、框架识别结果和源码摘要。

事实基类字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 当前文件结果内唯一的事实标识；跨文件引用同时携带文件标识 |
| `type` | 公共事实类别；每一类别拥有独立字段 Schema |
| `parentId` | 当前文件内的结构容器；顶层事实归属文件 |
| `role` | 在容器内的角色，例如成员、参数或模板子节点 |
| `order` | 同一容器和角色中的源码顺序 |
| `range` | 原始源码范围；无法可靠确定时为 `null`，同时记录原因 |
| `origin` | 后端、原生节点类别与适配器版本 |
| `extensions` | 按语言或框架命名的扩展空间，每个空间维护字段 Schema |

Schema 类别包括 `function`、`method`、`constructor`、`type`、`module`、`import`、`export`、`component`、`templateElement`、`attribute`、`directive` 和 `binding`。各后端通过能力查询声明已支持的类别；字段按五种语言和两种框架的样例映射验证。

包含关系以 `parentId` 表达并验证引用有效、无环；符号、调用和绑定关系单独定义。Go 接收者的类型名称属于语法信息，解析后的类型目标由语义关系提供。Rust 的 impl 与 trait 容器保留自身类别与来源。

函数事实的公共字段优先覆盖名称、参数、返回信息、async 标记和函数体范围。Python 参数类别、Go 多返回值、Java 修饰符、Rust 属性等按字段语义或扩展 Schema 保留；未知值和不适用值分别定义。

Python `parameterDetails` 保留参数名、种类、注解、默认值和 type comment；字符串记录语法文本，空值表示未声明。Java 保留注解、继承、实现、permits 和 record 组件。Go `typeAlias` 标记别名声明；Rust 类型及导入保留属性、可见性和适用的泛型。JS/TS 保留类型参数、继承文本及类型声明。

React 的组件事实引用其函数或类声明，避免重复统计声明。Vue 的组件事实关联脚本区块与模板区块；局部作用域、模板变量和绑定目标分别记录。

## 5. 能力与转换覆盖

后端分别声明解析能力、公共模型支持的事实类别及语言扩展版本。请求可以选择所需事实类别；默认类别集合需在 Schema 中固定。

能力响应包括语言 `coverage` 和按框架分组的 `frameworkCoverage`。文件结果的 `coverage` 使用实际框架对应的声明，包含 `projection: selected-facts`、`nativeNodes`、`metadata` 和 `limitations`。`syntax` 记录语法、解析器版本、目标配置、版本约束方式及配置键；TypeScript 编译目标、Python 尽力约束和 Rust edition 的状态随结果保留。

每个文件记录已执行类别、未执行类别及原因。请求范围内的映射缺失或区块分析失败影响完成状态；当前请求未涉及的类别不影响完成状态。语法错误和解析结果有效范围同时保留。

原生节点类别与规范化类别分别保留。组件候选、源码名称、已解析符号和已推断类型具有不同的数据状态；识别依据随结果交付。

## 6. 位置与来源

位置统一采用 `{line, character}` 与 `{start, end}`，行列零起始、列按 UTF-16 代码单元计数、区间结束位置不包含。文件内容摘要标识转换使用的源码快照。

Python 字节列、Go 的 token 位置、JavaParser 范围、Rust span 与模板位置各自实现转换器。ESTree 的行号约定和公共约定分别处理。转换器通过非 ASCII、非 BMP、CRLF 和文件末尾用例验证。

Vue 的原始脚本切片可通过区块偏移映射回 `.vue`；转换生成的脚本或模板代码使用来源映射。经过插入、删除或重排的内容需逐段验证映射；无法定位的事实按缺失位置处理。外部区块定位到实际输入文件。

## 7. 请求响应与格式分层

通信层负责 `protocolVersion`、`requestId`、操作、取消、超时和错误；数据层负责 `schemaVersion`、源码快照、事实、诊断与覆盖范围。版本兼容性按两层分别校验。

`capabilities` 声明协议版本、数据版本、后端及框架能力、事实类别和扩展版本。`analyze` 接收目标文件、项目配置、请求能力、框架配置及事实类别，并返回实际执行范围。路径基准与访问范围显式配置。

传输采用 UTF-8 JSON Lines、本地 stdin / stdout 和 stderr 日志。协议操作字段、错误码、消息大小限制、取消响应与请求示例见[运行说明](ast-runtime.md)。请求、响应、事实类别与扩展字段均具有可执行 Schema。

## 8. 验证与交付

1. 用真实解析器样例确认五种语言、React 和 Vue 3 的原生节点与位置信息。
2. 建立公共事实字段、语言专属字段及覆盖矩阵，明确每个字段的来源和空值语义。
3. 定义 TypeScript 判别联合类型和运行时 Schema，验证跨进程输入输出。
4. 验证转换前后的声明、参数、层次、组件、模板和源码范围。
5. 用核心模块的消费样例验证规则所需信息，并验证能力缺失、部分完成与错误分类。

当前已完成真实解析器样例、结构转换、位置映射和运行时 Schema 验证。项目级语义、框架绑定和完整兼容性验证继续按能力推进；当前覆盖见[运行说明](ast-runtime.md)。
