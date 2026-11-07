# 任务上下文与快照契约

## scope
定义 `inject` 与 `check` 共享的最小任务上下文，避免在各规则正文中重复声明输入结构。
至少记录任务 ID、项目根、约定范围、阶段／模式、规则与分析器能力版本；不将全部工作区改动默认归为本任务。

## target-identification
按待修改或已变更文件的路径、扩展名与 AST 框架事实识别目标集合：
1. 语言目标复用 `config/capability-targets.json` 中的 `languages`（`js-ts`, `js`, `ts`, `python`, `java`, `go`, `rust`）。
2. 框架目标复用 `config/capability-targets.json` 中的 `frameworks`（`react`, `vue`）。
3. 同一任务涉及多语言或多框架时，按文件或代码对象分别绑定目标集合，不将单一框架规则扩散至整仓。

## precedent-context
在 `inject` 与 `check` 阶段记录同模块或同仓库内既有类似功能的实现粒度（如单文件函数闭合 vs 跨文件模块拆分），作为先例对齐与最小作用链路审计的参照基线。

## snapshot-delta
在 `check` 阶段绑定修改前（`before`）与修改后（`after`）源码快照及本地引擎产出的增量差分摘要：
1. 作用域差分（$\Delta S$）：绑定档位变化、受影响方法 $\Delta M$、文件 $\Delta F$、模块 $\Delta U$、链路长度 $\Delta L$、状态传播 $\Delta W$，以及入度为 1 的新增跨文件导出。
2. 复杂度差分（$\Delta C$）：存量函数循环嵌套深度变化 $\Delta d$、行数变化 $\Delta \text{LOC}$、成本上界比变化及严重风险证据。
3. 位置与职责差分（$\Delta P$）：节点角色变化（如 `leaf` 退化为 `intermediate`）、跨模块依赖边界及内部防御分支增量。
4. 默认 before 为任务开始时的范围快照；独立检查显式选择基线，不静默用 HEAD 替代已有未提交改动的任务基线。
5. 快照记录内容摘要、对象对应关系和新增／删除／重命名；新文件只有在确认原不存在时允许无 before 内容。
6. 各证据分别记录 verified／unknown／unsupported／failed 与覆盖范围；未知指标不得记作数值 0。
7. 缺快照或对象无法对应时，依赖差分的触发器为 unknown，不能对空输入静默放行。
