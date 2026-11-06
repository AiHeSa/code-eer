# AST 功能完整性审计

- 日期：2026-11-06
- 结果：22 项当前阶段检查通过，5 项后续类型及符号能力尚待实现，运行错误为 0。
- 依据：[语言需求](../../requirements/code-review/ast-integration.md)、[框架需求](../../requirements/code-review/framework-support.md)、锁定版本解析器及真实运行结果。
- 测试定义：[审计用例](../../../tests/audit/ast/)、[执行器](../../../tests/audit/ast/run.ts)。

## 1. 验证范围

当前阶段检查五种语言的语法、选定声明与模块结构、导入导出、源码定位，以及 React / Vue 3 的框架结构。类型、符号和宏展开按后续能力记录。

| 范围 | 数量 | 结果 |
| --- | ---: | --- |
| 五个真实后端的声明对照 | 5 | 通过 |
| Vue 插值及指令中的非法表达式 | 2 | 通过，返回原生编译器语法诊断 |
| 结构、配置及框架检查 | 15 | 通过 |
| 五个后端的类型及符号能力 | 5 | 待实现，返回 `UNSUPPORTED_CAPABILITY` |

审计状态为 `baseline-probes-passed`，退出码为 0。整体 `verify:ast` 为 `passed`，132 项回归测试全部通过；6 份较大源码共 10123 行、1516 个事实的编译产物验证通过。

`complete` 表示请求能力在声明的转换范围内已执行。节点范围通过 `coverage` 公布，语法版本通过 `syntax` 记录；事实的语义正确性仍由具体用例验收。

## 2. 结构与框架检查

每项机器记录保存输入、参数、预期、实际事实、诊断和失败原因。

| ID | 已验证行为 |
| --- | --- |
| JS-DESTRUCTURED-EXPORT | 解构叶子绑定分别产生导出及声明引用，保留嵌套容器 |
| JS-COMMONJS | 直接全局 `require`、`exports`、`module.exports` 提取导入导出，记录静态来源及动态参数 |
| TS-CONFIG-DECLARATIONS | 项目文件选择遵循 TypeScript 配置，显式排除的声明文件返回 `TS_CONFIG_EXCLUDED` |
| PY-UNICODE-SEPARATOR | 字符串内 U+2028 后的声明定位到原始源码 |
| JAVA-MODULE | 模块及 requires、uses、exports、opens、provides 指令保留名称、类别和所属模块 |
| JAVA-ANONYMOUS-TYPE | 匿名对象和 enum 常量类体具有类型容器，方法引用所属类型 |
| JAVA-UNICODE-KEYWORD | Unicode 转义关键字与标识符可解析，区间对应原始源码 |
| RUST-EXTERN-CRATE | `extern crate` 保留 crate 名和别名 |
| RUST-ENUM-CONTAINER | enum 内嵌套声明引用 enum 容器，后续声明恢复正确父节点 |
| REACT-DEFAULT-ARROW | 匿名默认导出函数组件保留候选依据及声明引用 |
| REACT-NULL-CLASS | 继承导入的 Component / PureComponent 的类保留组件候选 |
| REACT-PROJECT-DETECTION | 结合显式配置、源码导入、最近 package.json 的框架依赖识别 React / Vue |
| REACT-LOCAL-SHADOW | 参数、局部声明、catch、循环和块作用域参与 Hook 导入来源判断 |
| VUE-OPTIONS-SHORTHAND | Options API 保留简写、引号属性及方法形式，识别 defineComponent 导入别名 |
| VUE-MACRO-CONTEXT | 编译器宏候选受 script setup、调用位置及词法绑定约束 |

相邻用例覆盖嵌套解构、默认值和 rest、CommonJS 局部遮蔽、类静态块、配置继承、Vue-only 项目、输出目录排除、嵌套 package.json、CR / CRLF、Unicode 转义换行及原始函数体区间。

## 3. 元数据与可查询范围

能力响应提供 `coverage`、`frameworkCoverage` 和 `syntax`。文件结果记录所用框架的覆盖声明和有效语法配置；Schema 校验这些字段。

| 方向 | 保留的专属信息 | 明确的后续范围 |
| --- | --- | --- |
| JS/TS | 修饰符、泛型参数、继承文本、类型声明、导入子句、独立解构导出引用、CommonJS 来源 | 符号、类型、跨文件绑定、项目引用语义 |
| Python | 参数分类、注解、默认值、type comment、泛型、装饰器、基类、类关键字参数、导入别名 | 作用域、限定名、符号和类型 |
| Java | 修饰符、注解、泛型、throws、继承、实现、permits、record 组件、模块指令 | classpath、符号和类型 |
| Go | 接收者、泛型约束、多返回值、类型声明、类型别名标记、导入别名 | 包加载、构建标签、平台约束和类型 |
| Rust | 属性、可见性、泛型、impl 声明、extern crate 别名、类型容器 | edition 约束、宏展开、cfg、Cargo 语义、符号和类型 |
| React | JSX、组件及 Hook 候选、声明引用、词法导入来源 | 跨文件组件目标、属性类型及审查规则 |
| Vue 3 | SFC、脚本、Options API、宏候选、模板、指令和区块来源 | 模板与插槽绑定解析、组件类型及表达式语义 |

公共模型使用 `selected-facts` 投影。字段、常量、static、初始化块、表达式和语句的独立事实范围按各后端 `coverage.limitations` 查询。CommonJS 名称识别限于直接全局对象和静态属性键。动态 eval / with 的作用域目标尚待解析。

TypeScript `target` 记录项目编译目标；Python `feature_version` 记录尽力约束；Java LanguageLevel 由解析器校验；Go 使用后端版本的语法；Rust edition 请求记录为 `not-enforced` 并返回未执行项。

## 4. 需求验收记录

| 需求 | 当前验证 | 后续范围 |
| --- | --- | --- |
| AST-F01 环境与版本 | 可查询运行时、解析器、目标版本、约束方式、能力和转换范围 | 多运行时及目标版本矩阵 |
| AST-F02 文件与项目 | 文件列表、扫描、包含排除、测试开关、TS 配置继承及项目依赖识别 | 项目引用、classpath、Go 包和 Cargo 语义 |
| AST-F03 结构与诊断 | 上表检查、精确清单、声明元数据、异常输入与位置验证通过 | 公共模型的其他投影和语义能力 |
| AST-F04 完整性 | 完成、部分完成、失败、取消、未执行项及覆盖信息可辨识 | 后续能力的失败路径 |
| AST-F05 统一输出 | 核心服务、CLI、stdio、运行时 Schema 与来源记录 | MCP、工作台和语义关系契约 |
| AST-F06 执行与隔离 | 当前环境的超时、取消、后端隔离与恢复验证通过 | 其他平台及后代进程清理矩阵 |
| AST-F07 版本验证 | 锁定版本、可复现命令和 macOS arm64 结果 | 更多平台和大项目兼容性 |

## 5. 复现与产物

```sh
npm run setup:backends
npm run verify:ast
```

单独运行审计时，先执行 `npm run build`，再执行 `npm run audit:ast`。退出码 0 表示列出的当前阶段检查通过；1 表示存在缺失；2 表示运行或对照异常。

`.cache/verification/ast-completeness.json` 保存能力响应、有效输入、预期、实际结果、用例摘要及实现源码摘要。`.cache/verification/ast-verification.json` 保存完整验证状态和分步日志。

通过结论限定于上述用例、转换范围、配置和运行环境。完整验证方法及精确清单见[验证矩阵](ast-verification.md)。
