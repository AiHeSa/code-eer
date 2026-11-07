# 三项评分系统设计

- 日期：2026-11-07
- 版本：scoring-system-v0；实验评分引擎已落地，实际范围见[运行契约](scoring-runtime.md)，其余语义能力按本设计继续推进。
- 需求：[REQ-SCORING-001](../../requirements/code-review/scoring-system.md)
- 配套：[候选策略](scoring-policy-v0.md)、[标定与实施](scoring-validation.md)
- 底座：[采集契约](assessment-collection.md)、[作用域](scope-algorithm.md)、[复杂度](complexity-algorithm.md)、[位置](placement-algorithm.md)

## 1. 对外边界

评分核心是代码审核服务内部能力，通过编程接口供后台 HTTP/MCP 等入口复用。
现有 `collectAssessment` 继续只返回证据；设计中的 `evaluateAssessment` 才负责执行规则及评分。
本轮不新增 CLI、不增加前端，也不将候选参数装载到现有采集返回值中。

当前 HTTP `/v1/assessment/collect` 是采集接口，返回 null 分数。
实验评分接口已接入 `/v1/assessments`；未标定参数和未解析事实的限制随结果返回。

## 2. 处理流程

```text
源码/配置快照 → 范围及评分单元清单 → AST事实
                                    ↓
                         符号/调用/数据流/成本/职责事实
                                    ↓
                     规则前提检查 → 规则判定及证据账本
                                    ↓
                   S / C / P 映射 → 单项有效性及分数区间
                                    ↓
                         分层聚合 → 综合分与严重约束
                                    ↓
                  可选模型合成 → 可选仓库分级 → 下游限制
```

源码采集与语义分析不接受分数参数，数值映射不重新读取文件。
一旦源码摘要、规则、预算或职责契约变化，就创建新评分上下文，避免混用旧证据。
当前采集只提供逐文件内容一致性；实现评分前补充仓库文件清单及快照固定机制。

## 3. 模块职责

| 模块 | 输入与职责 | 输出 |
| --- | --- | --- |
| snapshot | 固定源码、范围、模块配置、解析器及规则版本 | manifest、digest |
| units | 识别声明、函数、模块顶层执行单元、文件与模块 | unit registry、parent/owner |
| facts | AST 与后续语义分析，标注能力边界 | evidence、derived facts、coverage |
| rules | 按规则依赖图检查前提，确定适用性和结论 | rule results |
| ledger | 证据关联、重复问题归属、跨维度去重 | contribution ledger |
| mapping | 使用固定策略计算加成、扣分、区间和上限 | dimension scores |
| aggregate | 按已声明对象集合分层合成 | file/module/repository scores |
| model | 固定样本与提示词，校验模型输出 | 独立来源的 rule results |
| grading | 来源融合、覆盖检查和 A–E 映射 | 可选等级 |

这些是计划模块，不表示对应目录或执行器已存在。
语言专项只覆盖事实解释和语言语义；评分公式、规则标识和返回契约由通用能力维护。
专项缺项按通用能力回退；通用能力缺少必需前提时仍返回 unknown/unsupported。

## 4. 快照与评估单元

manifest 至少保存：repository/root、提交标识（可选）、脏文件内容摘要、实际文件清单、
分析参数、模块配置、解析器版本、规则版本、参数版本、预算版本和职责契约版本。
整体摘要按规范化路径与排序后的文件摘要生成，不只使用 Git HEAD。

unit 标识由快照、文件 URI、声明位置与对象类别组成。源文件内的采集 ID 只在该文件中有效。
函数、变量、文件、模块都可展示结果；是否进入聚合由 dimension ownership 指定：

- S：函数对象和绑定对象各自评估；本地绑定归最近函数组，顶层绑定归文件运行组。
- C：计算事实归函数或模块顶层执行单元；变量初始化的成本分配给其执行单元。
- P：对象职责与文件/模块依赖规则分别评估，文件依赖违例只在文件层计一次。
- 入口链路成本是另一分析视图，不能再与组成它的函数成本相加成仓库资源用量。

嵌套函数的函数体归其自身；闭包创建归外层。生成代码、声明文件和测试代码通过清单显式选择。
导入绑定和纯类型声明不参与自产变量的 S 分母；C 无执行体的声明可为 not-applicable。

## 5. 统一规则契约

规则定义包含：

```text
id / version / dimension / applicableUnitKinds
requires: capabilities、factKinds、contracts、relatedRules
evaluate(context): applicability、execution、verdict、evidence、assumptions
scoreMapping: 参数引用、贡献归属、排重组、严重等级及上限策略
```

判定结果保持三条独立状态轴：

| 轴 | 值 | 意义 |
| --- | --- | --- |
| applicability | applicable / not-applicable / unknown | 此规则是否适用于对象 |
| execution | complete / unsupported / failed / timeout / cancelled | 分析是否执行成功 |
| verdict | satisfied / violated / unknown | 条件是否满足 |

执行 complete 且 verdict=unknown 是合法结果，例如成功分析后仍无法确定动态目标。
not-applicable 必须提供依据，不用来掩盖语言后端缺项；unsupported 不从分母中悄悄移除。
只有覆盖与证明条件满足时才返回 satisfied/violated；语法候选保留 candidate 证据等级。

## 6. 分数契约

每项结果包含：

```text
dimension、unitId、source(internal/model)、methodVersion、policyVersion
status: complete / partial / pending / not-applicable / failed / cancelled
value: number | null
interval: { lower, upper } | null
components: base、bonuses、deductions、caps、weights、contributions
coverage: required、resolved、unknown、unsupported、failed、notApplicable
ruleResultIds、evidenceIds、assumptions、pendingReasons
```

value 仅在所有必需条件有效时出现。interval 是规则允许范围传播所得的保守区间，不是统计置信区间。
score 的计算完成状态与证据覆盖分别保存；区间偶然收敛不代表语义完整。
模型另保留模型版本、参数、prompt 摘要和原始响应，不把模型自报置信度当作证明。
当前采集使用的 score:null 保持不变，正式契约在评分核心实现时作为新的版本边界接入。

## 7. 规则调度与去重

按 requires 构建 DAG，先检查事实/契约，再运行可执行规则。规则循环依赖在装载时拒绝。
一次运行固定策略，不在评分过程中因仓库等级变化修改阈值。
同一输入和版本的 internal 运算使用排序和确定性数值处理。

去重账本键建议为 `(snapshot, issueKind, evidenceIdentity, ownership)`：

- 影响范围、复用方法/文件/模块数和链路长度归 S。
- 执行次数、操作成本、时间/空间预算、死循环和泄漏归 C。
- 模块契约、依赖方向及职责冲突归 P。
- 同一关系可提供不同事实，但同一质量问题不得跨维度重复计分。
- 同一严重问题的普通预算扣分由严重规则接管；封顶作为约束记录，不再伪装成第二条违例。

每条贡献保留原始证据、采用的规则、被抑制的重复条目及最终归属。

## 8. 缺失证据与区间传播

未知属性的加成范围为 `[0, 最大允许加成]`，不是直接取 0；未知扣分也保留允许区间。
适用范围或基础档位未知时按候选档位求保守边界，无法形成有意义边界时返回 `[0,100]`。
只有已证实严重问题才能启用严重扣分及上限；候选死循环或泄漏不会直接扣分。

合成使用固定非负权重：已知项取点区间，未知项取规则区间，各端点按公式传播。
not-applicable 的处理按策略声明；移除该项时同时标记 reduced-scope，不能展示成完整三项综合分。
语言缺项、规则失败和语义未知均使必需项保持未完成，不自动重新归一化已知项。

## 9. 聚合与分级

先在每个维度的所有权树上聚合，再做 S/C/P 合成，避免把变量的 N/A 复杂度变成零分。
初版建议同组对象等权、文件内组等权、模块内文件等权、仓库内模块等权，所有分母随结果保存。
这是质量评分聚合，不是资源成本求和；执行成本和质量分数使用不同字段。
未评估的清单成员保留 unknown 区间。抽样结果只能标记 sample-scope，不能冒充仓库全量分数。

综合分建议 `0.45S+0.40C+0.15P`，内部计算不提前舍入，展示统一保留两位小数。
新增 [REQ-SCP-002](../../requirements/code-review/position-conditioned-weighting.md)：S/C 的生效评分需结合代码位置上下文加权，当前固定全局合成比例仍是 v0 基线。
[v1 位置加权](position-weighting.md)已接入运行时：保留基础分，叶子 S 仅看链路深度，严格位置放大普通扣分并提高汇总重要性；多角色取严，未知角色保留包络。P 数值不参与乘法加权。
严重约束同时保留 rawValue、policyCap 和最终 value；作用域和位置高分不能抹掉已证明严重风险。
完整规则及数字样例见候选策略文档，当前参数还未标定。

仓库分级是可选下游：先按相同维度和可比较范围融合 internal/model 来源，再映射等级。
两路重叠对象不累加扣分；单路缺失默认不产生正式 A–E 等级，保留该路已有结果。
不同快照或规则版本的来源禁止直接合成；等级只影响后续限制，不回写原始分。

## 10. 存储、失效与运行

计划使用 `.cache/assessments/<runId>/` 保存 manifest、evidence、rule-results、scores 和模型原始记录。
每次运行写入独立目录，完成时原子写结果索引；部分失败仍保留已完成证据与原因。
源码或分析器变化使事实缓存失效；规则/参数变化只使判定/评分缓存失效；预算和职责变化按依赖失效。
缓存键包括实际依赖摘要，不只使用文件修改时间。

请求取消时中止未完成工作，不发布新的正式评分；超时、规则失败和语言不可用分别记录。
采集层现有取消/超时边界见采集契约；评分执行器的队列、时间预算和资源隔离随其实现验收。

下一步先落规则与结果 Schema、纯映射函数和排重账本，再补语义规则；不先增加外层交互入口。
