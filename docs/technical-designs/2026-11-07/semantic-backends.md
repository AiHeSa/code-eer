# 静态评分语义与原生后端补齐（engine-3 阶段记录）

- 后续完成记录：[编译器语义接入](compiler-semantics.md)。本文保留 engine-3 阶段的实现状态，当前引擎为 engine-4。
- 日期：2026-11-07
- 当前引擎：scoring-engine-3；计分参数继续使用 scoring-policy-v1。
- 关联：[运行契约](scoring-runtime.md)、[位置加权](position-weighting.md)。

## 1. 已实现范围

本轮补齐本地后端运行环境，并扩展评分引擎的静态语义推导。
评分语义与 AST 协议的完整 symbols/types 查询是两层能力；后者仍未实现，不能因声明名称或类型注解存在而宣称类型查询已完成。
后台评分接口和项目根约束保持原契约，没有新增产品 CLI。

## 2. 本地工具链和后端

| 后端 | 实际解析器 | 本地运行环境 |
| --- | --- | --- |
| JS/TS | TypeScript 7.1.0-beta | 既有 Node 24 |
| Python | CPython ast 3.13.18 | `.cache/toolchains/python/bin/python3` |
| Java | JavaParser 3.28.2 | Temurin JDK 17.0.21+9，`.cache/toolchains/java/Contents/Home` |
| Go | Go parser 1.27.3 | 既有 `.cache/toolchains/go` 与 `.cache/bin/go-ast` |
| Rust | syn 2.0.119 | Rust 1.99.1 与本地 Cargo/rustup，release 产物位于既有 target 目录 |

Java、Rust 为原先缺失后端；系统 Python 3.9 不能覆盖现有新语法测试，因此补装本地 Python。
JDK、Python 下载包以及 rustup-init 均经过对应发布方 SHA-256 核验；Rust 安装使用 minimal 配置且未修改 shell 启动文件。
发行元数据和校验文件保存在 `.cache/toolchains/`；构建产物、工具链与下载包不提交仓库。

运行时优先使用 CODE_EER_JAVA / CODE_EER_PYTHON 显式配置，其次选择项目本地工具链，再回退系统命令。
构建脚本支持 CODE_EER_JAVAC / CODE_EER_CARGO / CODE_EER_GO，并尊重显式 CARGO_HOME / RUSTUP_HOME。
`node scripts/setup-backends.mjs java rust` 使用现有本地工具链构建，Cargo 使用 `--locked`。
长度检查与大型语料验证也选择相同的本地环境，避免服务可运行而验证脚本仍使用旧系统版本。
LaunchAgent 已重新加载；五个后端实际探测全部可用，health 状态为 ready。

下载依据：[Adoptium API](https://api.adoptium.net/)、[Rust 官方安装说明](https://rust-lang.org/tools/install/)、
[Python Standalone 20261026 发布](https://github.com/astral-sh/python-build-standalone/releases/tag/20261026)。

## 3. 项目级调用关系

`semantic-links.ts` 从真实语法树收集绑定引用、const 别名、命名空间导入、静态重导出及局部对象方法。
`project-links.ts` 根据项目清单递归解析目标：

- 直接具名/默认导入、命名空间导入，以及多级静态重导出。
- `export *` 的唯一来源、同一最终绑定、显式导出优先级及歧义检测。
- 命名空间重导出和不可重写的 const 函数别名。
- const 普通对象的直接自有方法；对象不能逃逸或出现属性写入、展开、getter、重复方法和计算属性。

词法遮蔽、重赋值、动态调用、构造调用、未知模块、歧义和解析环均不能强行生成目标。
已知 ESM 不导出某名称，与模块语义未知分开处理；不将未知模块当作“没有该导出”。
CommonJS 的运行时导出修改、export= 互操作、实例方法和多态分派仍保留未知。
解析结果接入同一调用图，影响位置角色和链路分析；原始 AST 调用证据保持原内容，派生目标独立保存。

## 4. 纯度与成本分离

`effect-analysis.ts` 检查无可观察副作用的局部语法，支持参数/局部值、typeof、严格比较、条件及有限字面循环等子集。
`semantic-project.ts` 在已解析调用图上迭代纯度证明：局部前提成立且所有被调函数均已证明时，才生成 verified。
循环调用组不会凭相互依赖的候选结论自证通过；未知强制转换、getter、可观察写入和外部调用保持未知。
纯度证明不要求已知性能成本；影响链路的效果约束也使用纯度证明，而非将成本可计算性当作纯度。

成本模型扩展为 primitive-source-operations-v2：

- 支持安全整数正向/反向的字面量 for 循环，单位步进、计数器不在循环体改写，分析次数上限为一百万。
- 支持静态可解析且已有有限成本上界的被调函数；递归与动态目标不生成有限成本。
- 调用参数、被调操作和存储上界进入调用者模型；保留 upper-bound 与实际成本的区别。
- 未知输入规模、别名生命周期和隐式转换不凭循环层数或类型注解补成确定成本。

成本单位仍是源级操作/存储单元，预算必须来自真实任务，不自动生成默认预算。
有成本上界不等于已证明实际超预算；严重问题仍需独立证据。

## 5. Vue 和原生语言事实

Vue 普通 script 与 script setup 分别提取，使用与采集器相同的块偏移和 ID 前缀，保存原文件范围。
内联脚本进入调用、纯度和成本推导；外部 src、未知脚本语言和模板调用者保持受限状态。
Vue 函数的影响边界保持开放，不因为当前脚本没有引用就忽略模板消费者。

原生公共采集器现在为具名函数补充声明绑定及嵌套作用域归属，具名声明的立即调用属性为 false。
这不把结构级结果升级为完整语法/数据流结果；Python/Java/Go/Rust 的变量、调用、循环及资源生命期评分语义仍需对应语言采集器继续扩展。

## 6. 报告和验证

证据产物新增静态绑定链接、解析后的调用目标、局部纯度候选及传递证明。
statistics.semanticCoverage 保存解析调用总量与纯度证明数量。
新报告记录 scoring-engine-3；旧 engine-1/2 报告仍可读取，原报告不覆盖。

验证结果：233 项完整集成测试通过；六组大型源码语料通过；22 项 AST 基线审计全部通过。
类型检查、构建、能力继承校验和全仓文件/函数长度检查通过。
审计中五种语言的完整 symbols/types 查询仍属于 plannedMissing，不计入已完成基线能力。
实际服务复评及剩余未知项见[本轮报告](../../reports/2026-11-07/repository-semantic-backends.md)。
