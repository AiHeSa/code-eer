# 全仓格式化后的代码质量评估

- 日期：2026-11-07（Asia/Shanghai）
- 当前运行：f52cafe5-306d-4cda-9da6-61ac5f4b9265；基线运行：838c2cb2-6a62-4929-8a56-4a42581d4e30
- 引擎：scoring-engine-4；配置：config/scoring.repository.json；策略：默认 scoring-policy-v1。
- 状态：partial；来源仅 internal，参数未经人工标定，没有正式 A–E 等级。
- 摘要：[可机器读取的评估摘要](repository-format-quality.json)；格式方案：[四空格与注释约定](../../technical-designs/2026-11-07/code-formatting.md)。

## 结论

当前 213 个源码文件全部解析，五语言语法与语义后端均就绪，未发生解析或语义后端失败。
已完成 279 项集成回归、类型检查与构建。格式统一改善了阅读和后续维护的一致性，不能据此声称执行成本或架构质量提高。

**目前不能给出可信的综合点分。** 缺少真实预算、职责声明、跨文件影响闭包及部分行为证明时，结果只能保留区间；区间不是统计置信区间。

## S／C／P 结果

| 维度 | 完整数值 | 保守范围 |
| --- | --- | --- |
| 作用域 S | 待定 | 0.00–57.10 |
| 复杂度 C | 待定 | 0.00–100.00 |
| 代码位置 P | 待定 | 37.13–100.00 |
| 综合 | 待定 | 5.57–80.70 |

已判定的 326 条静态位置／依赖规则条件分为 100/100，没有确认的 P 维度依赖违例。
该分数只覆盖已解析且契约明确的规则，不是完整 P 分。现有 38229 条规则记录中，16773 条具备有效确定结论，其余存在未知、不适用或未完成证明。

### 与格式化前比较

对两次评估共有的 212 个文件逐维度比较 status、value、interval、coverage，变化项为 0。
新增源码仅 scripts/format-native.mjs，因此仓库聚合区间的轻微变化来自评估集合增加，不表示排版提高了业务代码评分。
JS／TS 的 193 个修改文件经规范化 AST 比较，忽略注释和冗余括号后结构、字面量及绑定类型相同；两份 Python 源码在忽略文档字符串后 AST 相同。
15 份配置 JSON 的数据值未改动，源码位置测试样例保持原样。

## 值得优先改进的地方

### 1. 优先拆分承担多个阶段的长函数

展开紧凑写法后，规模检查发现 1 个文件超过 300 行、62 个函数超过 40 行。
当前超长文件为 services/code-review/internal/assessment/native-context.ts（310 行）。完整位置清单见 JSON 摘要 sizeWarnings。
这些是物理行数信号，部分函数只是展开了数据对象，不能全部当成高复杂度缺陷，也不应重新压缩成多语句一行规避。

| 优先位置 | 当前长度 | 改进方向 |
| --- | --- | --- |
| [placementRules](../../../services/code-review/internal/scoring/placement-rules.ts) | 93 行 | 将依赖分类与证据／规则结果组装分开，优先当前模块内的纯函数 |
| [lspSemantics](../../../services/code-review/internal/ast/semantic-lsp.ts) | 90 行 | 分清初始化、查询、完整度判断及资源释放阶段 |
| [collectProject](../../../services/code-review/internal/scoring/service.ts) | 86 行 | 拆出批次采集和成员关联／错误归集，保持快照与取消语义 |
| [evaluateAssessment](../../../services/code-review/internal/scoring/service.ts) | 74 行 | 将评估流程与报告对象组装分开，不改变发布前快照复核 |

### 2. 区分奖励资格与真正的违例

原始记录含 1946 条 S-isolatedIife 和 279 条 S-temporary 的 violated。
检查 [scoreScope](../../../services/code-review/internal/scoring/scope.ts) 可知，它们对应 IIFE／临时绑定加分资格未满足，而不是同等数量的代码缺陷。
例如普通具名函数不是 IIFE，属于正常实现；不得据此要求将所有函数改成 IIFE，或在 loop 中自动强制重构。
建议报告模型区分 bonus-eligibility 与 violation，保持计算结果不变，并让发现列表只展示真正可操作的问题。

### 3. 补齐 prompts 的真实模块契约与评估输入

当前 [仓库配置](../../../config/scoring.repository.json) 尚未登记 prompts 模块，8 个 adapters／generators 源文件被归入 unconfigured，相关依赖结论不完整。
应依据实际导入关系登记 prompts 及 scripts → prompts 的允许依赖，再逐步补充真实函数职责、工作负载与成本预算。
预算完整的函数复杂度分目前为 0；不能为了得到完整评分虚构预算或把所有函数默认标成 leaf。

### 4. 为自动化接入增加有界摘要

本次完整报告为 107.06 MiB，证据为 50.74 MiB。
建议在保留本地完整产物的前提下，为 CLI／HTTP 提供区间、覆盖率、top findings、缺失证据和报告路径的有界摘要；避免将全量结果放进模型上下文。

## 已验证与限制

| 检查 | 结果 |
| --- | --- |
| Prettier + Python／Rust／Go 格式 | 通过，四空格配置与重复执行稳定 |
| TypeScript 类型、构建、正式继承 | 通过 |
| Go／Java／Rust 原生重编译 | 通过 |
| 全量集成测试 | 279 通过，0 失败，0 跳过 |
| 行数原则检查 | 未通过：1 个文件、62 个函数超限，未放宽阈值 |
| 当前评分 | partial，没有模型来源和完整预算／职责证明 |

本轮保留样式整理的边界，未实施上述架构重构、修改评分规则或调整预算来美化分数。
完整缓存：[report.json](../../../.cache/assessments/f52cafe5-306d-4cda-9da6-61ac5f4b9265/report.json)、[evidence.json](../../../.cache/assessments/f52cafe5-306d-4cda-9da6-61ac5f4b9265/evidence.json)，仅当前机器存在。
JSON 摘要保留实际源码、策略及配置摘要；Git HEAD 不是未提交格式变更的内容标识。
