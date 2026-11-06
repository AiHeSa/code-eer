# 当前工作区代码评估

- 日期：2026-11-07（Asia/Shanghai）
- 运行：`4d5aa001-269c-4dd0-b297-7040e677d1f5`
- 引擎：`scoring-engine-1`；策略：`scoring-policy-v0`；状态：**partial**
- 参数状态：experimental-unvalidated，未经人工质量标定。

## 结论

本次清单包含 149 个源码文件，成功解析 142 个，其中 136 个具有细粒度语法证据、6 个只有结构证据；7 个因 Java/Rust 后端未就绪而未解析。
共生成 3996 个评分对象、16646 条规则/资格判定，其中 5413 条具备确定结论。
已判定的 210 条静态模块依赖规则的条件分为 **100/100**，已确认依赖违例 **0** 项。
该条件分只覆盖已解析且契约明确的静态导入规则；完整 P 分还需要入口、叶子和混合职责证据。

**当前无法给出完整 S/C/P 综合分或 A–E 等级。** 主要缺口是任务预算、职责契约、跨文件状态/别名和成本证明，以及部分语言环境。未知项按策略保留区间，不填为 0 或 100。

## 三项结果

| 项目 | 完整数值 | 保守范围 |
| --- | --- | --- |
| 作用域 S | 待定 | 3.59–64.52 |
| 复杂度 C | 待定 | 0.00–100.00 |
| 代码位置 P | 待定 | 39.95–100.00 |
| 综合 | 待定 | 7.61–84.03 |

这些是规则允许范围的传播结果，不是统计置信区间，也不是当前质量的点估计。区间较宽，暂不适合用来可靠排序仓库。
仓库综合采用 45% S、40% C、15% P；组、文件、模块按配置声明的所有权层级等权聚合，未解析文件仍在分母中。

## 范围与可复现性

- 包含生产实现、开发脚本和测试；默认排除 tests/fixtures、依赖、构建和缓存目录。
- 包含未提交和未跟踪源码，以实际内容摘要固定输入。
- Git HEAD：`4e1ccc071a32d8a02517f9397538c7c492e93899`
- 源码清单摘要：`50ea64f23ab26b310dd10a56bcfefa88d03947fbad1158d6ce4d0c57c51c4383`
- 策略摘要：`f1c3f0dd66965c60a0e9ec326612da1a95e5308899fac61d85a91702a40b4402`
- 配置摘要：`28e67ba9c8928f1de3e2b1459e65b785793826b41fa53ca7b8ccd134e1bf7c48`
- 评估前后清单及内容一致；后台实际接口 POST /v1/assessments 执行本次评估。
- 配置：[scoring.repository.json](../../../config/scoring.repository.json)；未填入虚构预算或职责断言。
- 完整报告：[report.json](../../../.cache/assessments/4d5aa001-269c-4dd0-b297-7040e677d1f5/report.json)
- 事实与派生证明：[evidence.json](../../../.cache/assessments/4d5aa001-269c-4dd0-b297-7040e677d1f5/evidence.json)
- 所有规则引用的证据 ID 已核对存在。完整 JSON/证据文件位于本地缓存，不进入 Git。

## 模块视图

| 模块 | 文件数 | S 范围 | P 范围 |
| --- | ---: | --- | --- |
| assessment | 13 | 3.95–56.54 | 50.00–100.00 |
| ast | 15 | 2.96–56.07 | 50.00–100.00 |
| ast-native | 31 | 2.33–70.85 | 29.03–100.00 |
| capabilities | 3 | 4.08–56.02 | 50.00–100.00 |
| cli | 2 | 4.17–75.41 | 33.33–100.00 |
| scoring | 26 | 4.20–59.49 | 50.00–100.00 |
| scripts | 12 | 3.97–66.68 | 30.56–100.00 |
| server | 4 | 3.36–67.04 | 33.33–100.00 |
| tests | 43 | 3.24–72.57 | 33.33–100.00 |

## 缺失项

- 成本证明器识别了 12 个有限、无调用等限制下的函数模型；全仓未配置任务预算，因此预算完整的函数复杂度分为 0 个。
- 自动成本证明器尚未覆盖一般循环、递归、外部调用和复杂对象存活；对应 AST 结构仍保留在证据中。
- 仓库未声明函数职责契约，入口/叶子/职责混用规则保持未知。
- 公共导出消费者、回调逃逸、别名和共享状态传播仍影响作用域评分完整性。
- 默认只运行 internal；未调用模型来源，因此不生成双来源正式等级。

未解析文件：

- `services/code-review/ast/java/src/Extraction.java`
- `services/code-review/ast/java/src/Main.java`
- `services/code-review/ast/java/src/Source.java`
- `services/code-review/ast/rust/src/expressions.rs`
- `services/code-review/ast/rust/src/main.rs`
- `services/code-review/ast/rust/src/model.rs`
- `services/code-review/ast/rust/src/visitor.rs`

## 优先补证的结构位置

以下位置按语法循环深度和未解析调用数排序，属于分析优先级提示，不是已证实性能问题。

| 文件 | 最大循环深度 | 文件内词法未解析调用数 |
| --- | ---: | ---: |
| scripts/verify-ast-corpus.mjs | 3 | 62 |
| services/code-review/internal/assessment/declarations.ts | 2 | 81 |
| services/code-review/internal/scoring/impact.ts | 2 | 70 |
| services/code-review/internal/scoring/service.ts | 2 | 70 |
| services/code-review/internal/ast/normalize.ts | 2 | 50 |
| tests/integration/ast/coverage.test.ts | 2 | 41 |

## 实现验证

- 101 项相关集成测试通过，涵盖评分公式、去重、区间、来源融合、真实 AST、HTTP、快照变化和不可用后端。
- 正向端到端样例在预算/职责完整时得到 S=54、C=100、P=100、综合 79.30，证明引擎可以产生完整 internal 分数；该样例分数不用于代替本仓库评估。
- TypeScript 构建、类型检查、继承校验及改动长度检查通过。
- 全仓长度检查仍受 Java Runtime 缺失限制；本次未宣称完整多语言验证通过。

下一步先明确真实任务预算与函数职责，再扩展语义证明和补齐 Java/Rust 环境后重评。
