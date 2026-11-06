# AST 验证与覆盖矩阵

- 日期：2026-11-06
- 需求：[AST 接入](../../requirements/code-review/ast-integration.md)、[React 与 Vue 3](../../requirements/code-review/framework-support.md)
- 契约：[结构转换与结果格式](ast-normalization.md)
- 环境与能力：[运行说明](ast-runtime.md)
- 完整性结论：[AST 功能完整性审计](ast-completeness-audit.md)，当前阶段 22 项检查通过。

## 1. 验证对象

源码解析由 TypeScript、CPython ast、JavaParser、Go 标准库、syn 和 Vue 编译器完成。适配器负责选定结构的提取、公共模型转换、源码定位和能力状态。

本轮验证对象是公共结构投影及协议。公共模型覆盖声明、导入导出、组件和视图结构；表达式和语句按所属事实的源码范围保留。需要表达式树、符号或类型信息的审查规则仍需对应后端能力。

回归结果：132 项测试通过，失败、取消、跳过均为 0；6 份较大源码共 10123 行、1516 个事实，编译产物验证通过。类型检查、构建及文件和函数行数检查通过。完整性审计的 22 项当前阶段检查全部通过，五个后端的后续类型及符号能力记录为未实现。

## 2. 精确预期与通过标准

[预期校验器](../../../tests/integration/ast/expectations.ts)接收手写清单。清单以语言语法和样例源码确定，每份样例核对：

- 事实总数、唯一 ID、节点类别与名称，额外节点和遗漏节点均触发失败。
- 每个节点的确切父节点；同名函数和重载分别匹配。
- 声明的完整起止位置，使用独立的源码片段定位计算预期值。
- 每个可调用节点的参数、返回信息、async 标记和函数体完整范围。
- 测试指定的原生类别及语言、框架扩展字段。
- 输入内容的 SHA-256；有效输入的诊断和运行错误必须为空。

10 份精确清单共验证 106 个事实。各清单覆盖该份样例的完整输出。

| 方向 | 精确清单中的主要形式 | 事实数 | 测试 |
| --- | --- | ---: | --- |
| JS/TS | 导入别名、导出变量、箭头函数、接口方法、构造器、访问器、async、namespace、类型别名、enum、调用及构造签名 | 27 | [declarations-js](../../../tests/integration/ast/declarations-js.test.ts) |
| Python | 相对导入、类型别名、装饰器、方法、async、嵌套函数、lambda、参数分类、`.pyi` 重载 | 10 | [declarations-python](../../../tests/integration/ast/declarations-python.test.ts) |
| Java | 包、静态通配导入、注解成员、record compact 构造器、接口、varargs、泛型、throws、普通构造器、lambda | 13 | [declarations-java](../../../tests/integration/ast/declarations-java.test.ts) |
| Go | 包、导入别名、接口方法、泛型类型及函数、接收者、多返回值、全局及局部函数表达式、局部类型 | 10 | [declarations-go](../../../tests/integration/ast/declarations-go.test.ts) |
| Rust | use、mod、struct、union、trait、impl、属性、async、闭包、extern、enum、类型别名、关联类型 | 18 | [declarations-rust](../../../tests/integration/ast/declarations-rust.test.ts) |
| React | JSX、片段、组件候选及声明引用、展开属性、中文属性、嵌入表达式、Hook 导入别名 | 11 | [inventory-react](../../../tests/integration/ast/inventory-react.test.ts) |
| Vue 3 | SFC 区块、脚本变量、组件元素、v-for、动态指令参数、修饰符、事件、插槽、插值、style、自定义区块 | 17 | [inventory-vue](../../../tests/integration/ast/inventory-vue.test.ts) |

[校验器敏感性验证](../../../tests/integration/ast/oracle.test.ts)对正确结果分别施加 11 种损坏：遗漏、额外节点、名称、父节点、参数、返回、async、结束位置、函数体、原生类别和摘要。每种损坏都必须被校验器拒绝。

## 3. 异常、配置与协议

| 项目 | 验证内容 | 测试 |
| --- | --- | --- |
| 五个语言的失败输入 | 诊断 code、source、severity、完整 range；语法诊断与运行错误分离；结构受限状态 | [diagnostics](../../../tests/integration/ast/diagnostics.test.ts)、[languages](../../../tests/integration/ast/languages.test.ts) |
| 源码位置 | 中文、emoji、制表符、CRLF，声明与函数体的起止位置 | [positions](../../../tests/integration/ast/positions.test.ts) |
| 文件与能力 | 五个语言的文件缺失、worker 不可用、symbols/types 未执行 | [diagnostics](../../../tests/integration/ast/diagnostics.test.ts) |
| 项目输入 | 五个语言的多文件发现、包含排除、测试开关、默认依赖和产物排除 | [projects](../../../tests/integration/ast/projects.test.ts) |
| 配置 | TypeScript 配置继承及缺失；Python/Java 版本约束；Rust edition 未执行标记 | [files](../../../tests/integration/ast/files.test.ts)、[projects](../../../tests/integration/ast/projects.test.ts) |
| 输入边界 | 根目录外符号链接、无效 UTF-8、文件大小上限、目录输入 | [files](../../../tests/integration/ast/files.test.ts)、[projects](../../../tests/integration/ast/projects.test.ts) |
| 框架补充 | React 包装函数、命名空间 Hook、参数遮蔽；Vue 双脚本、编译器宏、预处理语言、外部区块独立失败与缺失 | [frameworks](../../../tests/integration/ast/frameworks.test.ts)、[inventory-react](../../../tests/integration/ast/inventory-react.test.ts)、[inventory-vue](../../../tests/integration/ast/inventory-vue.test.ts) |
| 导出与词法绑定 | 嵌套解构、默认值、rest、声明引用、CommonJS 导入导出、var / catch / 循环 / 块作用域及类静态块 | [bindings](../../../tests/integration/ast/bindings.test.ts) |
| 框架绑定与上下文 | 局部遮蔽、默认参数作用域、默认导出、React 基类、Vue Options API 与顶层宏调用 | [framework-bindings](../../../tests/integration/ast/framework-bindings.test.ts) |
| 项目范围 | TS 配置继承及显式排除、Vue-only 项目、输出目录、嵌套依赖与框架识别优先级 | [project-config](../../../tests/integration/ast/project-config.test.ts) |
| 原生容器与位置 | Java 模块指令、Unicode 转义、Rust enum 容器、extern crate、Python / Java CR 换行 | [native-containers](../../../tests/integration/ast/native-containers.test.ts) |
| 声明元数据 | Python 参数注解、默认值、类型注释、泛型；Java 注解、继承与 record；Go 别名；Rust 属性和可见性；TS 泛型和继承 | [metadata](../../../tests/integration/ast/metadata.test.ts) |
| 能力声明 | 转换范围的 Schema、声明节点及字段、框架范围、有效目标配置及约束方式 | [coverage](../../../tests/integration/ast/coverage.test.ts) |
| 审计回归 | 审计中的语言与框架检查直接纳入集成测试 | [completeness](../../../tests/integration/ast/completeness.test.ts) |
| 协议 | 运行时 Schema、分片帧、并发请求关联、损坏响应、后端退出、消息上限、超时、取消、隔离与重启 | [protocol](../../../tests/integration/ast/protocol.test.ts)、[stdio](../../../tests/integration/ast/stdio.test.ts) |

Vue 外部脚本及模板具有各自的 URI、诊断和结构受限标记。请求结构时，任一外部区块结构受限使整体返回 `partial`。仅请求语法时，完成诊断收集可以返回 `complete`，诊断继续保留。

## 4. 较大源码验证

[语料准备](../../../scripts/ast-corpus-sources.mjs)读取已安装工具的源码及锁定依赖。JavaParser Node.java 使用固定 tag 和 SHA-256 校验，首次运行通过 curl 获取并缓存。

| 输入 | 来源版本 | 行数 | 事实数 |
| --- | --- | ---: | ---: |
| ast.generated.d.ts | TypeScript 7.1.0-beta | 1167 | 799 |
| compiler-sfc.d.ts | Vue compiler-sfc 3.5.45 | 488 | 110 |
| ast.py | CPython 3.14.4 标准库 | 681 | 48 |
| parser.go | Go 1.24.3 标准库 | 2944 | 109 |
| item.rs | syn 2.0.119 | 3540 | 260 |
| Node.java | JavaParser 3.28.2 | 1303 | 190 |

[执行器](../../../scripts/verify-ast-corpus.mjs)调用编译后的 AstService 和 worker，通过真实协议核对：完整状态、无诊断和运行错误、摘要、唯一 ID、父引用、位置有效性、函数体包含于声明范围，以及原生节点和元数据均已列入覆盖声明。每份源码至少产生 20 个事实。

该层验证较大输入的集成行为和结构不变量。表中事实数量是本次运行记录；逐节点语义预期由第 2 节的精确清单承担。Vue 的大源码条目属于编译器声明文件，SFC 功能由框架清单验证。

## 5. 需求状态与边界

| 需求 | 已验证范围 | 继续验收的范围 |
| --- | --- | --- |
| AST-F01 环境与版本 | 独立后端、实际工具版本、不可用状态、目标配置、版本约束方式、转换范围 | 完整目标版本矩阵、Go 平台及构建配置、Rust edition 约束 |
| AST-F02 文件与项目 | 文件列表、项目扫描、包含排除、测试开关、路径范围、TS 配置选文件与依赖识别 | TypeScript 项目引用、Java classpath、Go 包加载与构建标签、Cargo workspace 语义 |
| AST-F03 结构与诊断 | 表中声明、模块与框架结构、参数元数据、继承与泛型、语法诊断和原始位置 | 字段与属性的独立事实、表达式与语句投影的后续范围 |
| AST-F04 完整性状态 | complete/partial/failed/cancelled、能力受限、语法失败、区块失败与运行失败 | 后续语义能力的状态与失败路径 |
| AST-F05 调用与输出 | 核心服务、CLI、stdio、Schema、来源与配置记录 | MCP 与工作台消费、语义关系契约 |
| AST-F06 执行与隔离 | 超时、取消、独立进程、故障隔离与恢复 | Windows 后代进程清理、其他平台运行矩阵 |
| AST-F07 兼容性 | 锁定依赖、macOS arm64 的当前运行时、复现命令 | 其他运行时版本、操作系统及大项目兼容性 |
| React | 语法证据、组件候选、默认导出、React 基类、Hook、词法遮蔽和依赖识别 | 动态 eval / with 作用域、跨文件组件目标和属性类型 |
| Vue 3 | 区块、脚本与模板结构、动态参数、修饰符、插槽语法、外部文件位置及失败 | 模板和插槽作用域解析、指令表达式语义、组件属性类型 |
| Rust 宏与 cfg | 源码中可见的语法结构 | 宏展开产生的声明、过程宏与 cfg 求值 |

`complete` 表示当前声明的能力已执行。当前 `symbols`、`types` 和生产审查规则仍需实现；`findings: []` 仅表示本次没有生成审查规则结果。语法与结构验证通过的结论限定于上述样例、字段、配置和环境。

## 6. 复现与产物

```sh
npm ci
npm run setup:backends
npm run verify:ast
```

`verify:ast` 顺序执行类型检查、构建、132 项回归测试、大源码验证、行数检查和完整性审计，任一步失败即返回非零状态。当前整体状态为 `passed`，审计为 `baseline-probes-passed`。后续语义能力单独记录。

- `.cache/verification/ast-verification.json`：本轮状态、各步骤退出码、测试数量及日志路径。
- `.cache/verification/ast-corpus.json`：编译产物验证状态、源码来源、版本、摘要、行数、事实数量与分类。
- `.cache/verification/ast-completeness.json`：需求检查、完整输入、预期、实际结果及未满足项。
- `.cache/verification/*.log`：各验证步骤的完整输出。

原生后端源码修改后，先执行对应的 `setup:backends`。单独执行语料验证前运行 `npm run build`。验证产物保存在忽略的缓存目录；上表记录当前已通过的结果。
