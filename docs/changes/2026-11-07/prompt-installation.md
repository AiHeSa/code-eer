# Codex 与 DSH 的项目级 Skill／指引安装

- 日期：2026-11-07
- 需求：[安装要求](../../requirements/prompts/harness-installation.md)
- 设计：[命令与适配边界](../../technical-designs/2026-11-07/prompt-installation.md)

## 变更

- 添加 Codex／DSH 适配元数据，采用两端支持的 .agents/skills/ 与 AGENTS.md。
- 添加路由校验、多层 Markdown 继承、目标 profile 预组合和阶段投影，生成两个自包含 Skill。
- 构建清单保留来源／产物哈希、目标、partial 覆盖及未计量 Token 预算状态。
- 添加构建、只读预览、安装、更新、卸载命令；只维护 EER 文件与受管指引块。
- 拒绝非受管覆盖、用户改动、路径越界、符号链接、DSH 同名原生 Skill、Git 子目录及遮蔽指引的 override。
- 写入采用同目录临时文件后替换，普通失败尝试撤回已完成操作；不承诺并发或进程中断事务。
- 不改评分服务、全局配置、应用包、Git Hook 或 Codex 命令权限，不新增 DSH host 插件。

## 验证

- 14 项安装／构建／CLI 集成测试通过，覆盖目标隔离、继承与缺项回退、重复安装、更新、卸载、现有指引及文件保护。
- 原有能力回归 25 项通过；正式继承校验及类型检查通过。
- Codex／DSH 两端共 4 个生成 Skill 通过 Skill Creator quick_validate.py。
- 文件／函数规模与 diff 空白检查通过，相关文档相对链接有效。
- 测试仅在临时项目执行安装与卸载，没有向用户全局配置、应用包或实际开发项目安装。
- 已核对本机 DSH 第一方加载契约，尚未进行宿主 UI／会话激活或自动 loop 评审验收。
