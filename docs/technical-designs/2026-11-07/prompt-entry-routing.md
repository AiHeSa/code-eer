# Prompts 双入口、低干扰边界与语言／框架分层分发设计

- 日期：2026-11-07
- 状态：源文件、索引、构建、项目 Skill 安装及默认关闭的原生注入包已实现；自动预筛与评估器待实现，见[安装说明](prompt-installation.md)和[Harness 注入流程](harness-injection.md)。
- 需求：[双入口与分层分发](../../requirements/prompts/entry-routing.md)
- 记录：[修正与验证](../../changes/2026-11-07/prompt-entry-routing.md)
- 基础：[能力继承](../2026-11-06/capability-routing.md)、[抗急性劣化信号](anti-degradation-signals.md)

## 1. 设计边界

保留双工作流入口、通用与目标两级分发、路由外置和低 Token 注入。
语言／框架路由只控制规则选择；正文统一采用仓库通用根文件与同目录专项机制。
入口负责编排，requirements 是质量要求的唯一正文来源，公共输出及分发约定放在 contracts。

构建期处理静态来源和可预生成的阶段资源；本地运行时依据任务、目标及当前快照选择有效资源。
Skill／项目指引包装与安装已实现；原生注入由用户单独安装开启。实际 Token 计量、差分计算及自动评估器后续实现。
源 Markdown 中的流程描述和链接不等于已安装的自动触发器。

## 2. 当前目录

```text
prompts/
├── README.md
├── entries/
│   ├── inject.md                     # 运行前编排源
│   └── check.md                      # runtime／postrun 检查编排源
├── contracts/
│   ├── context.md                    # 任务、目标、前后快照与能力
│   ├── resolution.md                 # 分发、继承、投影、预算、预筛
│   ├── results.md                    # 结果、覆盖、反馈与失效
│   └── triggers.md                   # 信号 ID 与必要证据规格
├── routing/
│   ├── catalog.json                  # 两条初始通用规则与目标映射
│   └── targets/                      # 目前均为 pending-rules 空索引
│       ├── js-ts.json
│       ├── python.json
│       ├── java.json
│       ├── go.json
│       ├── rust.json
│       ├── react.json
│       └── vue.json
├── requirements/
│   ├── scope/minimal-link.md
│   └── placement/fail-fast-boundary.md
├── generators/                       # 校验、继承、投影、构建与安装
├── adapters/                         # Codex／DSH 格式元数据
└── generated/                        # 预留；产物由 build --output 写入新目录
```

目标规则继续按职责放入 requirements/<category>/。
例如后续可用 render-purity.md 定义完整根契约、render-purity.react.md 覆盖 React 细节，并由 react.json 选择。
该示例尚未创建文件；规则仅适用 React 时，根文件也要明确目标及有效条件，不虚构全语言适用性。
不再使用 requirements/targets/<target>/<rule>.md 来回避继承检查，也不修改 AGENTS.md 的既有要求。

## 3. 两级索引

catalog.json 的 targetRouters 指向目标索引，commonRules 包含通用规则记录。
目标索引包含 target、kind、status、rules；rules 与 commonRules 使用相同记录结构。
所有规则 ID 全局唯一，source 指向根文件，variants 只登记同目录且继承该根的专项文件。
同一规则被多个目标共用时只保留一个完整定义；后续需要跨索引引用时先定义显式引用契约，不复制不同版本。

规则记录示意（与当前目录结构一致）：

```json
{
  "id": "scope-minimal-link",
  "category": "scope",
  "summary": "结合当前职责和先例评估跨文件链路的必要性",
  "source": "requirements/scope/minimal-link.md",
  "phases": ["inject", "check"],
  "requires": [],
  "checkTrigger": {
    "any": ["delta:single-consumer-export", "delta:scope-chain-growth"]
  },
  "variants": {}
}
```

路径相对 prompts/，不可越出根目录；依赖须存在、无环且支持当前阶段。
目标名称统一来自 config/capability-targets.json。
js、ts、js-ts 共用 js-ts.json 时按文件路径去重，但仍保留具体对象的语言。
当前 7 个目标路由没有规则，标为 pending-rules；只提供两条初始通用规则，不宣称完整质量覆盖。

## 4. 规则正文与继承

所有根规则定义以下完整公开条目；阶段行为不同，但共享同一个规则身份：

```md
# 规则名称

## applicability
必要生效条件与例外；目标限定规则声明其适用语言／框架。

## inject
满足上述条件时的精简约束，不能把条件建议改成无条件禁令。

## check
具体审阅步骤、如何确认问题及保留合理例外。

## evidence
所需事实、快照与关系覆盖；缺证据时如何返回未知。
```

专项文件与根文件同目录，例如：

```md
---
extends: ./render-purity.md
---
# React 渲染纯度

## evidence
在根契约限定的目标范围内，使用 React 组件和渲染副作用证据。
```

此处为格式示意，不表示已实现对应规则。
专项新增二级标题必须先在根文件定义；三级标题可承载细节。
按通用 → 语言 → 框架组合，整段替换同名条目，缺项沿用上一层。
语言层优先精确专项，缺失时才回退 js-ts 专项；共享路由不自动叠加两个语言专项。
多框架冲突须显式优先序；不以加载顺序作为规则间隐式优先级。
现有 resolveDocument 仅接收一个专项；构建器现已逐专项对根校验并按条目实现多层组合。

## 5. 入口及投影

两个入口均使用 purpose、inputs、budget、dispatch、execute、output 稳定二级条目。
实际入口源为 [inject](../../../prompts/entries/inject.md) 与 [check](../../../prompts/entries/check.md)，不在此复制其规则正文。

inject：识别任务及目标 → 选择两级路由与依赖 → 合并专项 → 判断适用性 → 条件与指令一起投影。
check：绑定范围和前后快照 → 选择候选及依赖 → 三态预筛 → 定向复核 → 结果与覆盖记录。

通用注入预算为 200 Tokens，目标附加预算由适配器显式配置，用对应模型计量。
必要条件、例外及约束是不可拆分单元；只能裁剪背景，不能删掉条件来满足预算。
超预算按依赖顺序选择完整单元，其余 deferred、整体 partial；前提未知时保留条件式要求。
入口不写死“必须单文件”或“内部禁止校验”等具体规则，这些要求在规则库中按证据和例外判断。

check 默认 postrun，可独立运行；缺少注入记录时重新建立上下文。
runtime 在一轮编辑收尾处理受影响对象；连续编码调试时不主动打断。
postrun 核对约定范围内全部候选与未决项，不要求逐条打印满足清单。
审阅只输出结论与建议；实际修改以当前任务授权为准，修复后重新检查。

## 6. 三态预筛与静默条件

信号规格见 [triggers.md](../../../prompts/contracts/triggers.md)，包括 signal ID、触发结构及 clear 所需证据。
checkTrigger.any 采用三态 OR：任一 triggered 则 triggered；全部 clear 才 clear；其余 unknown。

| 预筛结果 | 后续行为 | 结论边界 |
| --- | --- | --- |
| triggered | 加载该规则并定向复核 | 是候选，不能直接记 violated |
| clear | 保存预筛记录，通常不调用模型 | 不等于语义审阅 satisfied |
| unknown | 补证、定向复核或保留 partial | 不得作为 clear 静默放行 |

缺基线、解析失败、不支持、未解析依赖、超时及不完整证据均不是 clear。
未实现的检测器也须 unknown，不能用“接口中已有信号 ID”假装检测能力可用。
缺失源文件、非法目标／依赖和未知信号 ID 属于配置错误，结果 failed。
只有全部适用候选 clear 且无未知、延后、覆盖限制或配置错误时可不反馈文本。
即便静默结束，也只表示约定预筛范围未命中风险，不证明所有代码质量要求满足。

## 7. 结果、失效与打包

上下文绑定任务范围、前后内容摘要、对象对应、目标及规则／分析器版本。
before 默认任务开始时快照；独立检查显式选择基线，不用 HEAD 静默覆盖已有未提交改动。
新文件、删除及重命名单独记录；未知差分不得变成 0。

结果契约见 [results.md](../../../prompts/contracts/results.md)。
预筛、适用性和审阅结论分开保存，覆盖账本区分 screened、checked、deferred、blocked。
unknown 和未覆盖目标导致 partial；complete 表示约定流程执行完成，不等于全体规则满足。
主上下文只展示问题及必要限制；partial／failed 不伪装成全部通过或用静默掩盖。

源码、依赖证据、目标、规则或分析器版本变化使关联结果失效，不能复用旧快照结论。
适配器现已分别包装 eer-inject 与 eer-check，按自包含 Skill 打包投影和来源映射。
实际 Hook、读写缓存与自动调用仍待实现；不支持的能力须声明，不增加宿主不存在的工具要求。

## 8. 当前验证与后续工作

当前检查源文件链接、JSON 索引、目标映射、规则引用、阶段／依赖／信号及 Markdown 条目格式。
既有继承校验只覆盖识别出的文件族，不证明路由和独立根文档已经受控。
目录校验、多层组合及 Skill 安装已有集成验证；后续补 Token 计量、三态预筛器和自动事件，再验证自动闭环。
尚未实现差分检测与自动触发，不能以本次结构校验代替运行验收。
