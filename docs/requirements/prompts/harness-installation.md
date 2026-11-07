# Codex 与 DeepSeek Harness 的 Skill／指引安装

- 日期：2026-11-07
- 状态：首版构建、项目级预览／安装／更新／卸载已实现，默认 advisory。
- 基础：[双入口与规则分发](entry-routing.md)
- 设计：[安装适配方案](../../technical-designs/2026-11-07/prompt-installation.md)
- 记录：[实现与验证](../../changes/2026-11-07/prompt-installation.md)

## 1. 安装目标

- Codex：项目级 .agents/skills/ 安装 eer-inject 与 eer-check；通过受管 AGENTS.md 块提供调用指引。
- DeepSeek Harness（DSH）：复用默认 project-agents 根 .agents/skills/ 与项目 AGENTS.md，不重复安装 .dsh/skills/。
- 共用正文来源与目标专项继承规则；构建后的每个 Skill 自包含，只读取当前对象对应的目标资源。
- 安装前显式指定目标项目；Git 仓库须指定根目录，无 Git 标记时按给定工作目录安装。

## 2. 行为与保护

- 默认只读预览，--apply 执行写入；重复安装同一内容不产生变更。
- 已有 AGENTS.md 的受管块之外原样保留，卸载只移除受管内容。
- 已有同名非受管文件不覆盖；受管文件被用户修改、丢失或替换成符号链接时中止更新及卸载。
- 管理文件路径限制在本项目的 EER Skill 与元数据范围内；失败时尝试回滚已完成写入，进程被强制中止不提供事务保证。
- 不修改全局用户配置、应用安装包、已有 Git hooks 或 Codex 命令执行权限规则。
- 根 AGENTS.override.md 会遮蔽共享指引，需先处理；DSH 原生同名 Skill 需先消除冲突。

## 3. 首版范围

- 分阶段生成 Skill 和完整条件投影，支持通用 → 语言 → 框架按条目覆盖及缺项回退。
- 路由与合并在构建期完成；选择语言／框架资源仍由调用 Skill 的代理按代码对象完成。
- 构建清单包含目标、来源哈希、产物哈希、覆盖限制与未验证的 Token 预算状态。
- 两个现有规则仅用于建议式预防与人工／模型审阅；不依赖尚未实现的静态信号检测器。
- 不把文件安装成功当作已验证宿主激活；宿主插件禁用、指引预算及会话缓存仍可能影响加载。
- DSH 的 agent/created、turn-stopping、Ralph evaluator、评分摘要及 blocking 门禁留作后续接入。

## 4. 验收

- 生成的 Skill 通过 Skill Creator 基础校验；所有相对资源可在安装包内定位。
- 两端安装资源一致，同一输入可重复构建，语言／框架覆盖互不污染。
- 预览零写入；安装、更新、卸载及用户内容保护有集成验证。
- 原有继承校验、能力回归与文件／函数规模检查继续通过。
