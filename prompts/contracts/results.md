# 注入、预筛与检查结果契约

## identity
结果绑定 taskId、项目根、检查范围、phase、mode、before／after 快照摘要、规则及分析器版本。
路由 id 在结果中记为 ruleId；对象位置与证据绑定对应快照，不能用旧位置代表新代码。

## injection
记录有效约束、ruleId、对象范围、适用条件／例外、根文件和专项覆盖链、验证事项。
记录未知、预算延后及未覆盖目标；已注入不代表已通过代码验证。
原型跳过项另记 exempted、授权来源、对象／规则范围与当前状态，不记作已注入或已验证。

## prefilter
逐规则、逐对象记录信号、证据引用、覆盖范围、缺失项、原因与 triggered／clear／unknown。
clear 只表示完整证据下没有命中预筛信号，不转换为 satisfied。
triggered 是待复核候选，不转换为 violated；unknown 定向补证或保留未决。

## findings
适用性为 applicable／not-applicable／unknown，与审核服务的结论字段分开。
适用规则审阅结论为 satisfied／violated／unknown；不适用项记录原因，不伪造满足结论。
发现包含 ruleId、对象、源码位置、证据引用、原因、精简建议与可选问题标识。
语义推演说明依据及不确定性；静态候选不能当成已证明的缺陷。

## coverage
外置账本记录 selected、loaded、screened、checked、deferred、blocked，预筛与语义审阅分别统计。
执行状态为 complete／partial／failed；complete 表示约定流程完成，不等于所有质量要求满足。
未知、延后、未覆盖目标或未决必要依赖导致 partial；非法目录或缺失规则源导致 failed。
明确豁免项单列 exempted 并使整体覆盖保持 partial；补审未完成保留 pending-review。用户确认大改不改变覆盖或审查结论。
目标规则尚未编写须声明覆盖限制，不能以空表证明该目标已检查通过。

## feedback
无候选风险且无覆盖限制时可不输出文本，但须在本地结果保留范围和预筛结论。
只展示确认问题和必要限制；partial／failed 时不输出“全部通过”，也不用静默掩盖受阻。
完整证据和账本由后续评估器外置保存；本契约不执行写盘或安装触发器。

## invalidation
缓存键含任务范围、源码与依赖证据摘要、目标、规则和分析器版本。
任一项变化使相关旧结果失效；修复后重新绑定快照并检查，不能复用失效结论。
豁免范围、授权来源、毕业状态及接入依赖变化同样使相关旧结论失效；reviewed 不等于 satisfied，也不构成后续改动豁免。
