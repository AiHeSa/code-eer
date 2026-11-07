# 实施位置关联加权评分

- 日期：2026-11-07
- 需求：[REQ-SCP-002](../../requirements/code-review/position-conditioned-weighting.md)
- 设计：[位置加权 v1](../../technical-designs/2026-11-07/position-weighting.md)

## 行为变化

叶子的有效作用域分只看链路深度，不再因纯度、IIFE 或临时封装证明缺失而保持待定。
中间承接、全局、入口和公共位置提高普通扣分与聚合重要性；多角色取严，未知角色保留包络。
局部绑定继承函数角色，模块初始化纳入调用链；递归调用者的深度不当作有限已知值。
叶子职责的拓扑检查不要求纯函数证明，执行成本和严重风险仍分别评估。
严重扣分及封顶不乘放宽系数，并向文件/模块/仓库传播综合封顶。

报告保留 baseline、有效分、角色、证据、系数、版本和位置上下文摘要。
新增 scoring-policy-v1，默认引擎升为 scoring-engine-2；v0 参数及已有报告保留。
v1 双来源合成要求配置和位置上下文一致；当前服务仍只运行 internal。

## 验证及部署

- 构建、类型检查、能力继承校验通过。
- 117 项相关集成测试通过，包括评分、HTTP、采集、JS/TS/框架、Go 与能力校验。
- 修改文件/函数长度检查通过；本轮未声称完成缺失 Java/Rust 运行环境下的全语言验证。
- 本地 LaunchAgent 已更新，服务继续监听 127.0.0.1:4317。
- 在线评分接口确认返回 scoring-engine-2 / scoring-policy-v1，仓库结果见[复评记录](../../reports/2026-11-07/repository-position-weighting.md)。

数值系数仍属 experimental-unvalidated；本轮验证算法方向与边界，未完成大规模人工质量标定。
