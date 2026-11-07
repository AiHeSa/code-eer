# DSH 可选强制注入包

本目录是 Host bundle，适配本机核实的 DSH 0.2.2-rc.1 API。只依赖宿主已有的 systemPrompt 服务，不修改 DSH 核心、Ralph 或用户的 profile 文件。

## 用户主动安装与开启

在需要启用的 DSH profile 中，使用插件管理页或 `plugin_manager`：

1. `install_bundle` 的 target 设为本目录绝对路径（构建输出下的 `plugins/eer-quality`）。读取返回的 application 和 warnings；需要重启时先重启。
2. bundle 中的 `code-eer-quality-injection` 行默认 disabled。用户需要再次明确开启该行：使用插件开关，或 `set_plugin`，target 为该行 ID，enabled 为 true。
3. 确认实际启用成功，再在该 profile 的新会话中验证注入。

这是 profile 级的用户选择，跨该 profile 的工作区生效；其他 profile 需要分别选择。安装包或选择 bundle 都不会自动开启默认禁用的行。不要直接改写 `~/.dsh` 下的 composition。

## 注入与分发

插件注册 required systemPrompt context。DSH 在模型请求进入前将它投影为带来源的 user context；它不依赖模型是否选择 Skill。required 属性使它在关闭可选 runtime context 或使用完整 system prompt 时仍保留。它不提升为 system-role 指令，也不覆盖用户或宿主策略。

实际正文包含 inject 通用规则、适用条件和例外，以及 inject/check 两个分发入口。专项资源沿用同源投影，只列有差异的语言／框架规则，按对象渐进读取；没有专项时使用 common。check 仍为建议式自检，不运行服务、评分门禁或 turn-stopping 自动评审。

全局 Host 注册覆盖该运行时中的 agent，包括共享该 Host 的 in-process child；独立进程、未安装该包的 profile 或自行覆盖同名 context 的插件不在此保证范围内。资源变更和契约超预算使插件激活失败；插件 inactive 时不能声称已注入。

## 验证、关闭与更新

查看真实会话首个模型请求的注入上下文：应包含来源 `code-eer:quality`、`[code-eer:harness-injection source=...]` 和两条规则正文；Skill 目录或插件列表不能替代该证据。

关闭该插件行或关闭／移除 bundle 即停止后续注入，检查管理器的 application 是否 applied，或是否要求重启。已写入会话历史的文本不会被追溯删除。原有建议式 Skill 和 AGENTS 指引独立保留。

更新时构建新目录，通过插件管理器替换包并按结果重启，核对来源 digest；不要修改运行中的生成资源。

协议依据：安装的 `@deepseek-ai/dsh-system-prompt` 与 `@deepseek-ai/dsh-plugin-manager` 0.2.2-rc.1 随包 README 和运行时代码。其他版本应先核对相同的 required context 和管理协议。
