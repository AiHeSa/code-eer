# Codex 可选强制注入包

本目录是独立本地插件。普通 Skill 安装不会安装它。当前命令适配 macOS／Linux，需要支持生命周期 Hook 的本地 Codex、可执行 `node` 的 Hook 环境，以及用户亲自开启并信任 Hook。Windows 的命令环境尚未适配验证。

## 用户级开启

将构建输出保存在稳定目录。以下 `OUTPUT_ROOT` 指包含 `.agents/plugins/marketplace.json` 的输出根目录，不是本插件目录。

```sh
codex plugin marketplace add /absolute/OUTPUT_ROOT
codex plugin add eer-quality@code-eer-local
```

在 Codex 中通过 `/hooks` 或设置中的 Hooks 页面审阅并信任 EER Hook；不要绕过信任。确认插件已开启、Hook 功能未被配置或管理员策略关闭，再开启新会话验证。注册市场只让包可发现，市场策略为 AVAILABLE，不自动安装。

启用是用户级选择，适用于使用相同 Codex home 的本地会话。项目配置仍可能禁用插件。远端／云端编排不能凭本地安装保证注入。

## 注入与分发

- SessionStart：启动、恢复、fork 和根会话 compact 后注入。
- UserPromptSubmit：每轮用户输入前重新注入，以覆盖长期会话中的任务变化。
- SubagentStart：为宿主支持的子代理启动补充上下文。

Hook 通过 additionalContext 返回实际通用规则正文和两个阶段的分发入口，作为额外 developer context。共同条件完整保留；语言／框架专项只列出有实际差异的资源，按对象按需读取。check 入口提供自检指引，不启动评分服务或独立评审器。

包使用自己的 guidance，不依赖当前 cwd 或项目 AGENTS.md，也不重复安装用户级 Skill。Hook 的 Node 必须在宿主 PATH 中；缺少 Node、资源被改动或契约超预算会报错。Codex 的 Hook 错误通常不会阻断模型请求，因此应查看 Hook 执行结果，不能把“插件已安装”当成“注入成功”。

## 关闭与更新

在插件设置中关闭 `eer-quality@code-eer-local`，或移除插件：

```sh
codex plugin remove eer-quality@code-eer-local
```

关闭后新请求不再产生 EER Hook 上下文；历史消息中的内容不会被删除。原有建议式 AGENTS / Skill 安装独立保留。

更新时重新构建到新目录，按宿主的市场／插件更新流程切换版本并重新审阅变化的 Hook；不要覆盖运行中的包。以新会话 Hook 输出中 `[code-eer:harness-injection source=...]` 及实际规则正文为验证依据。只看到 Skill 目录不算验证成功。

参考：[Hook 协议](https://learn.chatgpt.com/docs/hooks)、[插件打包和本地市场](https://developers.openai.com/plugins/build/plugins)、[插件命令](https://learn.chatgpt.com/docs/developer-commands)。
