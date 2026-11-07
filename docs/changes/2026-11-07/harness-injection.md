# 可选 Harness 注入流程

## 改动

新增 `prompts build-harness --harness codex|dsh`，仅预览清单或导出到显式指定的新目录。原有 Skill build／install／uninstall 继续提供建议式指引，不注册 Hook。

Codex 导出 AVAILABLE 本地市场与原生插件，在用户安装、开启并信任 Hook 后，于会话启动／恢复／压缩、用户输入和子代理启动时提供额外上下文。当前 Hook 命令适配 macOS／Linux，依赖宿主 PATH 中的 Node。

DSH 导出默认禁用的 Host 插件行，用户安装 bundle 后还需主动开启。插件使用 required context，避免可选上下文开关或完整 system prompt 丢弃质量正文；不改用户 profile composition。

两端共用既有阶段投影结果。直接投递通用要求及适用条件，专项继续渐进读取，check 保持建议式。未新增语言占位副本、评分服务调用、提交门禁或自动评审器。

## 验证

- 全量测试 285 项通过；其中 prompts 测试 22 项，新增 6 项覆盖默认关闭、正文、条件、路径、专项差异、清理与失败情况。
- 类型检查、构建、继承校验和 format:check 通过。新增／修改的注入实现没有新增 40 行函数或 300 行文件违规；check:limits 仍报告仓库之前记录的存量超限，未修改阈值。
- 使用本机 DSH 0.2.2-rc.1 的真实 Cordis／systemPrompt 模块隔离验证：插件未激活时没有质量 context；激活后在完整 prompt、关闭可选 context 的组合中仍渲染规则；dispose 后移除注册。没有连接模型或修改实际 profile。
- DSH 包通过 npm pack --dry-run，必需运行时、规则、patch、locale 和图标均包含在包中。Codex 测试执行生成 Hook 的真实 shell 命令，验证含空格及引号的插件路径和额外上下文 JSON。
- 用户级原有安装的 7 个受管文件与安装记录哈希一致，mode 仍为 advisory。没有安装、开启或信任本次新增的原生包。

尚未执行用户开启后的真实 Codex／DSH 会话请求验收。生成包、Hook 执行或 prompt assembly 验证不等同于用户客户端已启用；具体操作和限制见[使用说明](../../technical-designs/2026-11-07/harness-injection.md)。
