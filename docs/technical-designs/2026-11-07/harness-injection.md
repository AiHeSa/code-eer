# 可选 Harness 强制注入

## 行为与边界

常规 Skill 模式由模型选择加载，AGENTS 指引也只是调用约定。新增的原生注入包在用户开启后由 Harness 入口提供实际规则正文，减少遗漏；普通 build、install、npm ci 和代码评估不会安装或开启它。

“强制”指上下文投递方式，不代表模型必然遵守、已完成检查或可阻断提交。check 仍是建议式审阅，没有新增独立评审器、评分服务请求、Git 门禁或逐工具自动检查。注入失败按宿主协议报告，不能把包已安装当成成功证据。

| 宿主 | 用户选择 | 注入入口 | 模型收到的内容 |
| --- | --- | --- | --- |
| 本地 Codex | 用户安装／启用插件，并审阅信任 Hook | SessionStart、UserPromptSubmit、SubagentStart | additionalContext 提供额外 developer context |
| DSH 0.2.2-rc.1 | 用户安装 bundle，再开启默认禁用的插件行 | systemPrompt required context，模型请求进入前 | 带来源的 user context |

Codex 的 AVAILABLE 市场策略不会默认安装；DSH 的 disabled 行不会随 bundle 安装启动。构建过程仅写用户显式指定的新目录，不碰 `~/.agents`、`~/.codex` 或 `~/.dsh` 的现有配置。

## 同源生成与渐进加载

```text
requirements + routing + xx.<target>.md 继承
    → 既有阶段投影器
    → guidance/eer-inject/{SKILL.md,references/*}
    → guidance/eer-check/{SKILL.md,references/*}
    → 原生适配器读取入口与 inject/common.md
    → 实际通用要求 + 两个入口的分发表
```

规则正文仍只有 requirements 一个来源。直接注入 inject 的完整通用要求，保留 applicability 和例外；check 仅注入流程和资源链接，完整核查方法、证据及专项在需要时读取。

每个代码对象依精确组合、框架、语言、common 的顺序选取至多一个专项，再覆盖显式条目、继承缺项。不预读所有专项，不把语言或框架固定成全仓属性。现有两条规则没有目标差异，因而每个阶段仍只有 common.md，没有语言占位副本。

入口中的资源链接在运行时转换成插件内的绝对路径，工作区没有 AGENTS.md 也能使用。guidance 放在包内的独立资源目录，不再注册一份同名 Skill，避免与既有用户级安装重复。

quality.json 保存来源 digest、投影路由、资源哈希和覆盖限制。入口与直接注入正文的哈希不匹配时报告失败。规则覆盖和 Token 计量仍为 partial／unverified；24 KB UTF-8 是传输保护，不是已满足 200 Tokens 的声明。超限报错，不能裁掉例外来凑预算。

## 构建与开启

使用 Node 24 或更高版本，从本仓库执行。省略 output 只打印清单；指定 output 时目录必须不存在。可用 --targets 限定构建目标，未选目标使用 common。

```sh
mkdir -p ~/.code-eer/harness
npm run prompts -- build-harness --harness codex --output ~/.code-eer/harness/codex-v1
npm run prompts -- build-harness --harness dsh --output ~/.code-eer/harness/dsh-v1
```

### Codex 用户级

```sh
codex plugin marketplace add ~/.code-eer/harness/codex-v1
codex plugin add eer-quality@code-eer-local
```

用户在 `/hooks` 或设置的 Hooks 页面审阅信任 EER Hook；确认插件已开启且 Hook 未被配置或管理员策略禁用。Hook 环境的 PATH 必须能找到 node。启用后新建会话，检查 Hook 输出包含 source 标记及实际中文规则，不能只检查 Skill 列表。完整说明随包导出，源见[Codex 操作说明](../../../prompts/adapters/codex/harness.md)。

本地安装不覆盖远端云编排；不支持这些 Hook 的客户端、未信任的 Hook 或被禁用的插件都无法保证投递。宿主通常对 Hook 执行错误继续运行，因此应检查执行结果。本实现不绕过信任、不自写 trusted_hash。

### DSH 用户 profile

通过目标 profile 的插件管理页或 plugin_manager 安装 `~/.code-eer/harness/dsh-v1/plugins/eer-quality`，再主动开启 `code-eer-quality-injection` 行。应以 application=applied 为实际生效证据；如果返回 restart-required，先重启。没有自动修改 home 或 profile composition 的安装脚本。

required context 避免完整 system prompt 或关闭可选 runtime context 导致正文丢失。注册属于运行时 Host，覆盖共享它的工作区和 in-process child；其他 profile 或独立进程需要单独安装开启。不得由其他插件覆盖保留名称 `code-eer:quality`。详细步骤见[DSH 操作说明](../../../prompts/adapters/dsh/harness.md)。

## 关闭、升级与验证

Codex 可在插件设置关闭，或 `codex plugin remove eer-quality@code-eer-local`；DSH 关闭对应行／bundle，按管理器结果重启。关闭影响后续投递，已存在的会话历史不会被删除；若需完全移除旧上下文，使用关闭后的新会话。建议式 Skill 安装独立保留。

升级用新目录构建，通过宿主更新包并重新审阅变化的 Hook，不直接覆盖运行中的资源。source digest 用于核对规则源版本，不是本地宿主执行成功的证明。

验收分三层：生成包检查默认关闭和资源路由；适配器执行检查真实规则、例外及可用路径；最后在用户开启的宿主会话中检查模型请求。仓库测试覆盖前两层。用户未开启时不替用户安装、信任或发送测试会话，不宣称完成最后一层。

## 协议依据

- [OpenAI Hooks](https://learn.chatgpt.com/docs/hooks)：用户信任、生命周期及上下文传递协议。
- [OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)和[插件命令](https://learn.chatgpt.com/docs/developer-commands)：本地市场、AVAILABLE 策略和用户安装入口。
- 本机 DSH 0.2.2-rc.1 随包的 dsh-system-prompt、dsh-plugin-manager README 与运行时代码：required context、bundle 安装和插件行开关。未将其他版本未经验证的行为写成兼容保证。
