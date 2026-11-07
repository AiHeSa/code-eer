# Codex／DSH 安装适配与使用说明

- 日期：2026-11-07
- 需求：[安装要求](../../requirements/prompts/harness-installation.md)
- 记录：[实现与验证](../../changes/2026-11-07/prompt-installation.md)
- 源入口：[命令脚本](../../../scripts/prompts.mjs)

## 1. 已确认的宿主约定

| 宿主 | Skill 发现 | 常驻指引 | 本轮接入 |
| --- | --- | --- | --- |
| Codex | 项目 .agents/skills/ 下的包 | AGENTS.md | 两个 Skill 与受管指引块 |
| DSH | 默认 project-agents 根 .agents/skills/；也支持 .dsh/skills/ | dsh-agent-instructions 读取 AGENTS.md | 共用包与指引，不新增 host 插件 |

Codex 依据 [OpenAI Skills 文档](https://learn.chatgpt.com/docs/build-skills)及 [AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。
Codex 的 [.rules](https://learn.chatgpt.com/docs/agent-configuration/rules) 是命令执行权限规则；本项目的代码质量 Rules 以自然语言指引安装，不生成权限 allow／deny 规则。

DSH 核查来自本机 DeepSeek Harness.app 内 app.asar 中的第一方包 README、实现及 package.json：
@deepseek-ai/dsh-skill-filesystem 0.2.2-rc.1、dsh-agent-instructions、dsh-tool-skill。
安装器使用默认 project-agents 根；DSH 若关闭默认根或禁用相关插件，需要先恢复对应发现能力。
不改应用包、DSH 的系统提示词、preset、插件配置或 Ralph 工具。

## 2. 安装布局

```text
<target-project>/
├── AGENTS.md                       # 只增改 code-eer:quality 受管块
├── .agents/skills/
│   ├── eer-inject/
│   │   ├── SKILL.md
│   │   └── references/             # workflow.md、common.md + 确有差异的目标条目
│   └── eer-check/
│       ├── SKILL.md
│       └── references/             # workflow.md、common.md + 当前阶段检查差异
└── .code-eer/prompts/
    ├── bundle.json                 # 来源／产物摘要、目标及覆盖限制
    ├── install.json                # 受管文件哈希与可撤回的 AGENTS 块
    └── exemptions.json             # 有豁免时由执行代理维护，非安装器产物
```

两端使用同名同布局资源，在一个项目中从 codex 切换为 dsh 安装时更新已有受管产物，不安装第二份。
两个 Skill 均先读取共享流程再读取具体规则，独立调用 check 同样核对豁免毕业状态。[豁免账本](prototype-review-workflow.md)属于项目运行记录，安装、更新和卸载均保留它。
DSH 原生 .dsh/skills/ 下若已有 EER 同名包或平铺 Markdown，安装前拒绝冲突。
Git 仓库只接受根目录，避免 DSH 与 Codex 的项目发现差异导致子目录安装不可见。
AGENTS.override.md 存在时拒绝写入会被遮蔽的 AGENTS.md；不擅自修改 override。

## 3. 命令

运行环境为 Node.js 24+；从 code-eer 仓库执行。target-project 为待接入项目，不默认修改 code-eer 自己。

```sh
# 只查看构建清单，不写入任何项目
npm run prompts -- build --harness codex --targets ts,react

# 输出自包含安装镜像；目录必须尚不存在
npm run prompts -- build --harness dsh --targets ts,react --output /tmp/eer-dsh-bundle

# 查看计划；不会创建文件
npm run prompts -- install --harness codex --project /path/to/target-project --targets ts,react

# 执行项目级安装；相同参数再次执行即为检查／更新
npm run prompts -- install --harness codex --project /path/to/target-project --targets ts,react --apply

# DSH 采用同一份安装布局
npm run prompts -- install --harness dsh --project /path/to/target-project --targets ts,react --apply

# 卸载预览与执行
npm run prompts -- uninstall --project /path/to/target-project
npm run prompts -- uninstall --project /path/to/target-project --apply
```

省略 --targets 时包含配置中的全部目标；--targets "" 仅包含通用资源。
build 的 --output 目录必须是新目录，避免覆盖任何既有构建或用户文件；install 每次从当前源重新构建。
用户自改受管文件后，更新／卸载会明确报错并保留现场，需要先自行保留或还原修改；没有强制覆盖选项。
卸载只删受管文件，用户新增资源及非受管指引保留；可能留下空目录。
安装器对普通 I/O 失败尝试回滚，无法保证跨进程并发或进程强制终止时的原子性；不要同时操作同一项目。

## 4. 分发、投影与调用

构建器读取所选目标的两级路由，校验 ID、阶段、信号、依赖与专项关系。
构建期组合候选目标，只在当前阶段正文与默认不同的情况下输出专项资源；不为每种目标或组合创建占位副本。
common.md 保存完整默认要求，专项只保存发生变化的条目；标题、来源链及其他阶段的变更不触发复制。
相同差异共用一个文件。入口只列出必要路由，优先精确组合、再框架、再语言，其余回退 common。
调用时先读 common，再按对象读取至多一个命中专项，覆盖同名条目并继承缺项，避免把单一框架套用到全仓。
语言目标优先精确专项，缺失时回退 js-ts；框架整段覆盖其显式条目，缺项沿用已选语言／通用内容。
没有目标信息时读 common，并声明覆盖限制；多框架同时作用同一对象时不静默组合。

inject 的有效内容为 applicability 与 inject；check 为 applicability、check、evidence，均由默认加专项差异合成。
语言／框架没有专项规则时，两个 Skill 的 references/ 均仅有 common.md 和共享流程 workflow.md；证据条目只变化时，仅影响 check 资源。
来源链保存在构建清单的 projections 中，不因来源路径不同而复制相同规则正文。
没有静态预筛器时，eer-check 执行建议式审阅；缺基线或语义证据时保留 unknown／partial，不伪造静态通过结论。
当前没有实际模型 Token 计量和预算裁剪，bundle.json 明确 tokenBudget.status=unverified，不宣称满足 200 Tokens。

Codex 可通过 $eer-inject／$eer-check 显式调用，或由宿主按描述选择；DSH 使用其 Skill 选择／加载机制。
安装的 AGENTS 块是调用约定，不能保证模型一定执行，不等价于 agent/created 或 turn-stopping Hook。
新 Skill 发现后可在下一轮尝试；若未出现则在目标项目重新开启会话，并检查默认发现根与插件启用状态。

## 5. 后续 DSH agent／Ralph 接入

现已提供独立、默认关闭的原生注入包，详见[Harness 注入流程](harness-injection.md)。普通 install 不安装 Hook，用户需要另外安装并开启。
后续评估器仍需独立接入：tools/result 只记录脏文件，turn-stopping 触发有界评审。
先补评分 summary／跨工作区调用／快照绑定，再考虑自动反馈与有限次数 steer；不把本轮文件安装称为自动闭环。
Ralph child 不依赖 workspaceChanges 的 subagent 记录，应采用明确的快照／diff；blocking 与 Git Hook 另行设计。
原始研究中的旧状态需以当前仓库为准：requirements 现已有两条规则和构建器，不再为空。
