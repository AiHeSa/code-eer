# 两级路由、继承合并与阶段投影契约

## architecture
顶层通用路由与语言／框架路由由本地工具解析，正文均来自统一的通用／专项文件族。
构建器已实现目录校验、目标组合和阶段投影；运行时评估、自动预筛与模型 Token 预算裁剪仍待实现。

## common-track
顶层 routing/catalog.json 的 commonRules 索引通用规则，source 指向无目标后缀的根文件。
记录统一使用 id、category、summary、source、phases、requires、checkTrigger、variants。
ID 全局唯一；阶段为 inject／check，runtime／postrun 是 check 模式，不是额外规则身份。
requires 为规则 ID 列表，须存在、无环且支持当前阶段；空列表表示无依赖。
依赖按拓扑顺序加载，同层按目录顺序；索引路径相对 prompts/，禁止越出根目录。

## target-track
targetRouters 的目标标识复用仓库配置，值指向 routing/targets/<target>.json。
目标索引声明 target、kind、rules；记录与通用索引同构，仍引用根文件及同目录专项。
目标路由只控制何时加载；不以 requirements/targets/<target>/<rule>.md 绕开继承规范。
仅读取当前对象命中的路由；js、ts、js-ts 映射共享路由时，按规范化路径去重。
共享路由不改变对象的精确语言；目标未知时使用已知目标和通用规则并保留覆盖限制。
目标索引的空 rules 表示规则尚未编写，不代表已完成该目标的审查覆盖。

## inheritance
正文为 requirements/<category>/xx.md，专项为同目录 xx.<target>.md，必须 extends: ./xx.md。
专项二级标题只取自根文件；新增公开条目先定义在根文件，每个专项直接对根文件校验。
按通用、语言、框架组合；整段覆盖同名条目，缺项沿用上一层，专项前言不参与合并。
语言层优先使用精确目标专项（如 ts），缺失时可回退 js-ts 专项，二者不隐式叠加。
多框架覆盖同一条目时须显式优先序，否则为配置错误，不按目录顺序静默覆盖。
仅适用某目标的规则也定义完整根契约，在 applicability 中限定目标，不扩散至无关语言。
现有 Markdown 解析器只组合一个专项；构建器逐个对根校验专项后按条目执行多层组合。

## phase-projection
按目标和阶段选候选、展开依赖，再判断适用性；适用性未知不能当作不适用。
inject 将 applicability 的必要条件、例外和 inject 作为完整单元投影；已证实无关的前提可省略。
前提未知时必须保留条件式表述；裁剪只能删除背景，不能删除条件、例外或改变强制程度。
通用预算为 200 Tokens，目标附加预算由适配器指定；用目标模型计量方式，不把字数当 Token 数。
超预算按依赖顺序选择完整单元，其余记 deferred 和 partial；预算未配置时不得宣称验证通过。
check 读取 applicability、check、evidence；入口不复制具体质量规则。

## prefilter
checkTrigger 使用结构化 any，包含一个或多个信号 ID；定义见[触发器契约](triggers.md)。
信号与规则预筛结果均为 triggered／clear／unknown：任一 triggered 则规则 triggered；全部 clear 才 clear；其余 unknown。
clear 须有适用于当前快照的完整必要证据；“没有检测到”不是证据完整性证明。
缺基线、解析失败、未解析依赖、不支持、超时或缺所需证据均为 unknown，记录原因与缺失项。
缺失规则源、未登记目标、非法依赖或未定义信号 ID 是配置错误，结果 failed，不静默跳过。
triggered 只唤醒复核，不直接意味违反；unknown 定向补证或保留 partial；clear 不转换为 satisfied。
只有全部适用候选 clear 且无未知、延后、覆盖限制或配置错误才可静默结束；沉默不替代内部结果。

## deduplication
同任务范围、源码快照、规则版本和对象下同规则只加载一次；同规则跨阶段沿用 ID。
同一问题按问题标识关联，不能仅因证据位置相同而合并不同缺陷。
源码、依赖证据、目标、规则或分析器版本改变时，相关结论与依赖结果失效，重新选择和预筛。
