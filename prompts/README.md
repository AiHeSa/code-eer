# Prompts

面向被审查项目的质量规范及 Skill / Rule 生成源，采用双入口、两级路由、统一规则继承和静态预筛设计。
当前已提供源文件与路由骨架；生成器、差分预筛器和 Harness 自动触发尚未接入。
完整方案见[双入口与分层分发设计](../docs/technical-designs/2026-11-07/prompt-entry-routing.md)。

## 目录结构与当前状态

- entries/：已提供 [inject.md](entries/inject.md) 与 [check.md](entries/check.md) 编排源，不是已安装的 Skill／Rule。
- contracts/：已提供 [context.md](contracts/context.md)、[resolution.md](contracts/resolution.md)、[results.md](contracts/results.md) 和 [triggers.md](contracts/triggers.md)，约束后续生成器及评估器。
- routing/：已提供 [catalog.json](routing/catalog.json) 和 7 个目标路由骨架；目标路由均为 pending-rules，不代表已完成对应语言审查。
- requirements/：唯一规则正文来源；当前两条初始规则为[最小链路](requirements/scope/minimal-link.md)和[输入边界](requirements/placement/fail-fast-boundary.md)。后续类别及目标规则继续研究。
- generators/：目录校验、目标组合、阶段投影和预算裁剪，待实现。
- adapters/：各 Harness 的 Rule、Skill、Hook 与事件适配，待实现。
- generated/：后续构建产物，目前为空。

## 规则组织

通用与目标路由只决定何时加载；正文统一为 requirements/<category>/xx.md 和同目录 xx.<target>.md。
专项声明 extends: ./xx.md，二级标题取自根文件；仅适用某目标的规则也定义完整根契约并限定目标。
不以目标目录下的独立根规则绕开仓库继承要求；目标标识以 config/capability-targets.json 为准。

## 核心运行边界

1. 分发、继承、投影在构建期／本地工具内完成；注入保留必要前提和例外，预算不足延后完整规则。
2. 连续编码调试期间不主动插入检查；runtime 在一轮编辑结束后处理增量，postrun 核对约定范围。
3. 预筛区分 triggered、clear、unknown；证据不足保留 partial，配置错误为 failed。clear 不等于语义审查通过。
4. 只有全部适用候选 clear 且无延后项或覆盖限制才可静默结束；当前规则和目标覆盖仍不完整。

需求见[双入口与分发](../docs/requirements/prompts/entry-routing.md)，修正及验证见[变更记录](../docs/changes/2026-11-07/prompt-entry-routing.md)。
