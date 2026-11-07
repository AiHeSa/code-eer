# 编译器语义与原生细粒度采集

- 日期：2026-11-07；引擎：scoring-engine-4；策略：scoring-policy-v1。
- 接续 [engine-3 阶段记录](semantic-backends.md)，评分入口仍为后台 POST `/v1/assessments`。

## 1. 五种语言的实际语义提供者

| 语言 | 符号、类型、定义来源 | 项目上下文 |
| --- | --- | --- |
| JS/TS | TypeScript 7.1 Checker | tsconfig、真实只读文件系统、导入依赖 |
| Python | Pyright 1.1.414 LSP | 项目根、依赖模块、实际解释器路径 |
| Java | JDK javac Trees / Elements / TypeMirror | sourcepath、本地源码、可用 classpath；关闭注解处理 |
| Go | go/packages + go/types | go.mod、同包文件、依赖、活动构建约束及测试包 |
| Rust | rust-analyzer 1.99.1 LSP | Cargo 项目或显式独立 crate、rust-src 标准库 |

`internal/ast/semantic.ts` 选择提供者，`semantic-schema.ts` 统一返回 symbols、references、definition、type、diagnostics 和 limitations。
字段来自实际查询，不从类型注解或名称拼出“推断结果”。查询失败仍保存 AST，并返回 failed；缺依赖、编译错误、未解析发生点返回 partial。
同一请求共用项目会话，请求结束关闭会话，避免依赖文件修改后读到旧类型。
Vue 内联普通脚本和 setup 脚本分别建立虚拟 TS 文件，再映射回 SFC 的真实范围。

## 2. 原生细粒度采集

`collector.python.ts`、`collector.java.ts`、`collector.go.ts`、`collector.rust.ts` 继承同一公共采集入口。
原有 CPython / JavaParser / Go parser / syn 结构解析保留；补充语法使用锁定版本的 `@vscode/tree-sitter-wasm` 及配套文法。
采集结果包含词法作用域、声明、读写引用、函数、调用、循环、分支、退出、分配与效果发生点。

特殊边界包括 Python global/nonlocal、推导式局部绑定、生成器延迟执行、Rust 同行遮蔽初始化，以及 Java 静态/实例字段归属。
字段持有的实例状态不伪装成模块全局变量；未知堆所有权不生成封闭影响链路。
现代 Python 泛型语法及 Unicode 源码范围有独立回归测试。

## 3. 接入加权评分

`compiler-links.ts` 使用真实 definition URI 和范围关联目标函数，跨文件解析结果进入统一调用图。
虚分派、被改写绑定、Python 模块函数被 monkeypatch 等情况不生成稳定目标。
`native-model.ts` 将可证明的同步 primitive 操作转换为成本模型；传递纯度和静态调用成本由 `semantic-project.ts` 迭代。
异步函数、生成器、递归、未知目标及隐式用户代码不冒充普通有限操作。
Python 类型注解不能排除运算符重载，因此不会仅凭 int 注解证明任意加法成本。

原生依赖结合编译器定义与已解析 import 进入同一模块契约校验；外部包可确认后仍服从 allowExternal。
既有叶子链路减负，以及中间、全局、入口、公共位置的严格权重继续生效。
语义证据和派生模型写入 evidence.json；统计包含 queriedFiles、failedFiles、typedReferences、resolvedDefinitions、staticCallsResolved。
旧 engine-1/2/3 报告继续可读取。

## 4. 运行与确定性边界

`npm ci` 安装锁定的 Pyright 与文法。`node scripts/setup-backends.mjs go java rust` 构建原生后端，并安装 Rust 的 rust-analyzer / rust-src 组件。
工具链沿用项目本地目录；构建及服务不依赖 shell 启动文件。Go 包加载关闭网络代理和 cgo，Rust 查询使用离线依赖。
Rust 默认关闭 build scripts 与过程宏执行；缺少其展开结果会显式保留为未解析证据。
独立 Rust 项目使用 rust-project 配置和标准库源码，参见 [rust-analyzer 官方格式](https://rust-analyzer.github.io/book/non_cargo_based_projects.html)。

评分按每批四个文件采集，避免单个协议帧承载全仓语义。完整评估总时限默认十分钟，取消与源码快照复核仍生效。
真实类型/符号服务与四种原生细采集均已接入；完整数学终止性、任意堆别名和动态代码行为不可能由这些静态证据普遍判定。
未配置真实性能预算、职责契约或存在动态事实时，报告保留 partial 和区间；不会据此虚构全仓总分。
