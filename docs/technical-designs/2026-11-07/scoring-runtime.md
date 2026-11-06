# 评分引擎与运行契约

- 日期：2026-11-07
- 引擎：scoring-engine-1；参数：scoring-policy-v0。
- 状态：可运行的实验版本，未经过人工质量标定。
- 设计：[系统设计](scoring-system.md)、[计分策略](scoring-policy-v0.md)。

## 1. 已实现

评分入口为 `services/code-review/internal/scoring/service.ts` 的 evaluateAssessment。
底层 collectAssessment 仍只采集事实，不改变其 null 分数字段；评分使用独立结果契约。
后台提供 POST `/v1/assessments`，固定在服务配置的项目根；本轮没有新增 CLI。

实现包含：

- 参数及规则/分数/报告 Schema 校验，有限数值、非负预算及权重校验。
- 规则依赖排序工具、三轴状态、证据标识、重复问题所有权及严重问题去重。
- S 基础分、百分比加成、对数链路扣分；C 预算比与严重规则；P 规则加权判定。
- 未知项区间传播、N/A 显式保留、按所有权组/文件/模块等权聚合、三项固定权重合成。
- internal/model 来源合成函数、版本/快照一致性、分歧门槛与等级有效性检查。
- 源码清单、工作区内容摘要、策略/配置摘要、前后清单与内容复核。
- 唯一 runId、完整报告及证据保存；报告文件通过临时文件原子重命名发布。

默认执行 internal。当前没有连接模型提供者，不会伪造模型评分或发布双来源正式等级。
同一代码运行可产生完整 internal 分数，也可因事实不足返回 partial；这两个路径都由集成测试覆盖。

## 2. 自动分析边界

JS/TS 支持：词法绑定、已解析本地调用、直接具名/默认导入函数目标、导出别名、
调用图 SCC、最长压缩链路、已知受影响对象计数及静态模块依赖规则。
方法、跨文件重导出链、命名空间对象调用、动态分派及外部消费者仍可能未知。
已发现重赋值的函数/导入目标不作为稳定调用目标；eval/with 限制静态结论。

自动成本/纯度证明只覆盖一个保守子集：直接返回、已知局部值、基本数值运算、严格相等、
简单条件分支及无副作用的局部声明。未知强制转换、调用、循环、递归、对象分配等不在此证明器范围内。
返回参数可以是无副作用的恒等操作，但不会因此证明 IIFE 的无逃逸属性。
局部 primitive const 的临时性还要求无写入/捕获；共享状态传播未证明时链路扣分保持区间。

成本模型单位为源级基本操作和局部存储单元，不是毫秒或字节。
模型输出是保守上界：上界满足显式预算时可证明预算符合度；上界超预算时不能直接证明实际违例。
模块模型只计本文件自己的定义/初始化；导入目标的执行在对应模块单元中评估，不重复相加成资源用量。
模块定义的正常持有按模块生命周期解释；其他资源/对象生命周期未知时不证明无泄漏。

其他语言暂复用公共结构事实，不将 JS/TS 的证明能力推广到其他语言。
没有预算不生成 C 数值；没有责任配置或行为证明不生成完整 P 数值。
只有已确认严重事实才启用严重扣分；当前自动采集不会把 while(true) 或 new 当作已证实风险。

## 3. 评估配置

配置分为：

| 字段 | 用途 |
| --- | --- |
| modules | 项目相对模块根、公共/业务职责及文件入口 |
| externalPackages | 明确声明的外部包名称；未知裸导入可能是路径别名，不按外部包默认放行 |
| contracts | 每个模块允许依赖的模块，以及是否允许外部导入 |
| budgets | 文件 glob、可选函数名、timeOperations、spaceUnits；模块初始化名为 `<module>` |
| responsibilities | 文件 glob、函数名、leaf/entry/intermediate 角色及输入校验责任 |

多个预算或职责同时匹配同一单元时拒绝，不按配置顺序隐式选择。
当前 entry 输入契约只有“显式不要求输入校验且无参数”可自动确认；其他校验逻辑保留 unknown。
leaf/mixing 规则需明确角色及支持子集的行为证明；单靠目录或零已知出边不确认职责。

可运行的完整分数样例配置：

```json
{
  "modules": [{"id":"app","root":".","kind":"business"}],
  "contracts": [{"moduleId":"app","allowedDependencies":[],"allowExternal":true}],
  "budgets": [
    {"path":"s.ts","name":"leaf","timeOperations":10,"spaceUnits":10},
    {"path":"s.ts","name":"<module>","timeOperations":10,"spaceUnits":10}
  ],
  "responsibilities": [{"path":"s.ts","name":"leaf","role":"leaf"}]
}
```

源码 `export {}; function leaf() { return 1; }` 的 internal 分数为 S=54、C=100、P=100、综合 79.30。
这是固定合成样例，不代表仓库实际评估分，也不是参数质量标定。

## 4. 接口与报告

```json
{"files":["s.ts"],"configuration":{"modules":[],"contracts":[],"budgets":[]}}
```

请求发送到 POST `/v1/assessments`；省略 files 时扫描支持的源码类型。
默认包含测试，排除 tests/fixtures；依赖、构建、缓存及 .git 目录由发现器排除。
显式 include/exclude 与实际清单保存在 manifest 中。文件级解析失败保留在分母，不静默删除。
源码/清单在评估期间变化、取消或总时限到达时，不发布已完成报告。
总时限默认 120 秒，逐文件异步阶段检查取消/时限；同步单次 AST/图运算当前没有独立硬抢占。

运行产物：`.cache/assessments/<runId>/report.json` 和 evidence.json。
清单保存代码内容 SHA-256、Git HEAD、解析器、策略与配置；Git HEAD 不替代未提交源码内容摘要。
结果内 value=null 表示不能给出完整数值，interval 是规则约束的保守范围，不是统计置信区间。
完整 internal 分数和双来源等级分开：没有模型来源时等级仍为 pending。

本仓库评估配置为 [scoring.repository.json](../../../config/scoring.repository.json)，参数为 [scoring.v0.json](../../../config/scoring.v0.json)。
前者没有虚构性能预算或职责断言，因此实际仓库评估可能保持 partial。
