# 三项评分的 AST 事实采集

- 日期：2026-11-07
- 阶段：已实现事实采集与结构指标；数值评分通过独立[评分引擎](scoring-runtime.md)提供，本采集接口保持不出分。
- 需求：[REQ-SCP-001](../../requirements/code-review/scope-complexity-placement.md)
- 算法：[作用域](scope-algorithm.md)、[复杂度](complexity-algorithm.md)、[代码位置](placement-algorithm.md)

## 1. 编程接口

```sh
npm run test:assessment
```

采集通过 `services/code-review/internal/assessment/service.ts` 的 `collectAssessment` 调用，暂不新增 CLI 入口。
接口复用 AST 的文件选择、包含排除、测试开关、tsconfig、源码路径限制及后端隔离。
`options.timeoutMs` 当前限制 AST 后端请求；评分采集的第二次语法遍历没有独立的硬超时。
无需模块配置即可采集；配置缺失时模块职责为 unknown。

```ts
const service = new AstService();
try {
  const params = analyzeParamsSchema.parse({ root: projectRoot, files: ['src/example.ts'] });
  const result = await collectAssessment(service, 'js-ts', params, moduleConfiguration);
} finally {
  service.close();
}
```

## 2. 流程与源码一致性

1. 使用现有 AstService 获取真实解析结果、诊断、框架事实和文件摘要。
2. 按项目根重新安全读取源文件，比对 SHA-256；变化时返回 SOURCE_CHANGED。
3. 通用采集器复用公共 AST；JS/TS 专项使用锁定 TypeScript 版本的 SourceFile 遍历细粒度语法。
4. 先登记词法作用域和声明，再提取引用、调用和控制结构，支持先调用后声明。
5. 构造作用域、复杂度、代码位置三组证据及结构指标。
6. 输出源码摘要、解析器版本、实际 AST 配置、模块配置及配置摘要。

第二次语法遍历复用原有解析器和源码快照，不改变公共 AST 协议。
源码摘要只保证每个已采集文件对应同一内容；当前没有跨文件原子快照或跨文件关系结论。
语法节点不是代码执行证明；作用域引用和本地调用边均按词法关系解释。

## 3. 输出契约

顶层 `phase=evidence`。已采集时整体 `status=partial`，没有可用文件时为 failed。
`astStatus` 单独保留原 AST 状态；顶层 errors、skipped、diagnostics 不因评分采集而丢失。
每个文件保留原始 `astFacts` 和独立 `evidence`，三项指标引用证据 ID。

| 集合 | 核心字段 | 用途 |
| --- | --- | --- |
| scopes | parentId、kind、range | 块、函数、类、静态块、模块及脚本全局的词法边界 |
| functions | bindingId、scopeId、parentFunctionId、async、generator、immediate、hasBody | 函数归属及候选属性 |
| declarations | name、kind、scopeId、functionId、initializer、exported | 变量、参数、导入、函数、类及成员声明 |
| references | targetId、access、property、dynamicScope | 读写、对象属性路径和捕获 |
| calls | callee、arguments、bindingId、targetId、resolution、loopIds | 本地调用边和循环中的调用 |
| loops | kind、initializer、condition、update、iterable、parentLoopId、depth | 循环边界及嵌套结构 |
| branches | kind、condition | if、条件表达式、switch/case、catch、短路表达式 |
| exits | kind、value、enclosingLoopId | return、throw、break、continue、await、yield |
| allocations | kind、expression、loopIds | 数组、对象、new 和闭包创建位置 |
| effects | kind、expression | this/super、赋值、更新、delete、spread、标签模板 |
| imports / exports | source 或 name | 模块关系的原始证据 |

ID 结合节点类别与区间，区分占用相同区间的文件和函数等节点；在文件和内容摘要内有效，不能脱离文件 URI 跨文件合并。
range 使用原始源码的零基行号、UTF-16 列号、左闭右开区间；Vue 内联脚本映射回 SFC 源码。
exits 的 enclosingLoopId 表示词法上的外层循环，不代表 break/continue 的真实控制流目标。
完整循环条件与表达式保留原文，后续转换成成本表达式时再做绑定和边界求解。

`coverage.level=syntax` 表示细粒度语法采集；structure 表示只复用公共 AST。
`coverage.complete` 只表示当前声明范围内输入未出现 AST 诊断或未执行项，不表示语义完整。
limitations 随结果返回。不得将 structure 下的空列表解释为源码没有循环、调用或变量。
所有 score 当前为 null，composite.status 为 pending。没有证据的维度不会自动记成 0 或 100。

## 4. 当前语言范围

| 范围 | 本次提供 | 明确缺项 |
| --- | --- | --- |
| JS/TS、JSX/TSX | 上述细粒度语法、本地词法绑定、结构指标 | 项目级符号、跨文件绑定、别名、动态分派和数据流 |
| React | JS/TS 采集及原 AST 的组件/Hook 候选 | JSX 标签绑定、组件调用关系和 Hook 运行语义 |
| Vue 3 内联脚本 | 独立 block 作用域、原 SFC 位置 | 跨 script/setup 绑定、模板表达式与槽关系 |
| Vue 外部脚本 | AstService 返回的独立源文件按 URI 采集 | 不拼接进 SFC，不建立跨文件关系 |
| Python / Java / Go / Rust | 公共 AST 中的函数、层级、导入导出和框架原始事实 | 专项细粒度采集尚未实现，作用域/复杂度标记 unsupported |

通用采集器与 `collector.js-ts.ts` 通过 defineCapability / specialize 组织并执行继承校验。
其他语言只得到结构事实，不会回退到正则表达式推测循环或引用。

## 5. 保守绑定规则

- 声明与引用使用绑定标识，处理参数、解构、块、catch、循环和 var 提升的遮蔽关系。
- 属性名、标签、导入名和类型语法不作为普通变量引用；JSX 标签目标尚待解析。
- 直接函数声明、const 函数表达式/箭头函数、直接 IIFE 可形成文件内调用边。
- let/var 函数绑定、已发现重赋值的绑定、new、方法调用、导入目标和别名保持 unresolved。
- 存在 eval/with 时保守撤销文件内引用绑定和调用目标，保留位置及动态作用域标记。
- 函数定义的循环深度从自身重新计量；闭包创建点仍归属外层。
- for 初始化及 for-of/in 的迭代表达式只执行一次，不计入该循环自身的重复区。
- 类字段、装饰器和计算属性的执行时机，以及隐式 getter/转换/迭代器，仍需语义分析。

## 6. 验证与后续交付

新增集成验证覆盖遮蔽、捕获、属性及解构写入、IIFE、重赋值、本地互递归、嵌套与连续循环、
闭包执行边界、分配点、模块边界、React、Vue 原始位置、语法错误和缺失输入。

后续按算法文档推进：语言专项采集、跨文件符号与关系、控制流/数据流、成本推导及职责契约、
参数校准、数值评分与综合评分。每步使用独立 coverage，避免提前将候选事实升级为已证明结论。
