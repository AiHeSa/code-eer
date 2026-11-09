# code-eer 代码库完整评估报告

- 评估对象：`/Users/wangzihan11/Documents/ChatGPT/code-eer`
- 评估方式：静态分析（源码、文档、配置交叉验证）+ 注入产物字节级实测 + `check:limits` 实际运行
- 说明：对 agent 影响的量级为机制推断，无 A/B 实测；其余结论均有文件级证据

---

## 1. 执行摘要

code-eer 是一个「代码质量基础设施」项目，由三条产品线组成：**prompts 提示词工程**（为不同 AI 编码宿主生成审查 Skills/规则注入）、**AST 多语言分析引擎**、**三项评分引擎**（scope / complexity / placement）。

总体判断：

- **AST 解析**：语法/结构基线可靠（22 项审计 + 132 项回归通过），接近生产但差五个闭环（语义主路径、错误恢复一致性、增量与内存、二进制分发、可观测性）。
- **评分与提示词注入**：设计完备而覆盖窄，**主因是实现滞后**（设计画了 5+4 约束矩阵、7 目标路由、双路合成 A–E 定级，落地只有 2 条规则、0 检测器），辅以局部主动自限（测试/漏洞维度明确排除本轮）。
- **上下文开销**：渐进式/分阶段投影已实际降耗约 71%，但名义 200 Token 预算是纸面（`tokenBudget.status=unverified`），实际每轮注入 6.4KB ≈ 2500 Token，超标 12.7 倍。
- **工程设计**：契约驱动、语义保守（三态预筛、clear≠通过）、文档诚实度高；主要矛盾是规则与现实的冲突（62 处行数超限 vs 硬性检查）——本轮已将 300/40 修订为建议限制并把文档对齐现实（见 §7）。

---

## 2. 功能盘点

```svg
<svg viewBox="0 0 680 410" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10" fill="none" stroke="#666" stroke-width="1.5"/>
    </marker>
  </defs>
  <text x="340" y="22" text-anchor="middle" font-size="14" font-weight="500" fill="#1a1a1a">code-eer 能力流向（实线=已实现，虚线=占位/待实现）</text>

  <rect x="40" y="44" width="280" height="76" rx="8" fill="#EEF4FF" stroke="#7A9AE0" stroke-width="1"/>
  <text x="180" y="70" text-anchor="middle" font-size="13" fill="#1a1a1a">prompts/ 提示词工程</text>
  <text x="180" y="90" text-anchor="middle" font-size="11" fill="#444">双入口 inject/check · 规则仅 2 条</text>
  <text x="180" y="106" text-anchor="middle" font-size="11" fill="#444">构建 Skill · Codex/DSH 适配器</text>

  <rect x="360" y="44" width="280" height="76" rx="8" fill="#EAF7EF" stroke="#5FA877" stroke-width="1"/>
  <text x="500" y="70" text-anchor="middle" font-size="13" fill="#1a1a1a">services/ 分析引擎</text>
  <text x="500" y="90" text-anchor="middle" font-size="11" fill="#444">AST：5 语言 + React/Vue（成熟）</text>
  <text x="500" y="106" text-anchor="middle" font-size="11" fill="#444">三项评分 S/C/P：实验性·未标定</text>

  <line x1="180" y1="120" x2="140" y2="172" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>
  <line x1="200" y1="120" x2="330" y2="172" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>
  <line x1="500" y1="120" x2="550" y2="172" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>

  <rect x="40" y="176" width="200" height="60" rx="8" fill="#FFF7E8" stroke="#D9A441" stroke-width="1"/>
  <text x="140" y="200" text-anchor="middle" font-size="13" fill="#1a1a1a">Harness 注入包</text>
  <text x="140" y="220" text-anchor="middle" font-size="11" fill="#444">Codex/DSH，默认关闭</text>

  <rect x="260" y="176" width="180" height="60" rx="8" fill="#FFF7E8" stroke="#D9A441" stroke-width="1"/>
  <text x="350" y="200" text-anchor="middle" font-size="13" fill="#1a1a1a">通用 Skills 安装</text>
  <text x="350" y="220" text-anchor="middle" font-size="11" fill="#444">.agents/skills 只读预览</text>

  <rect x="460" y="176" width="180" height="60" rx="8" fill="#FFF7E8" stroke="#D9A441" stroke-width="1"/>
  <text x="550" y="200" text-anchor="middle" font-size="13" fill="#1a1a1a">CLI / HTTP 证据 API</text>
  <text x="550" y="220" text-anchor="middle" font-size="11" fill="#444">analyze · /v1/assessments</text>

  <line x1="140" y1="236" x2="140" y2="276" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>
  <line x1="350" y1="236" x2="140" y2="276" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>
  <line x1="520" y1="236" x2="450" y2="276" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>
  <line x1="580" y1="236" x2="580" y2="276" stroke="#666" stroke-width="1" marker-end="url(#ar)"/>

  <rect x="40" y="280" width="200" height="56" rx="8" fill="#F4F4F5" stroke="#999" stroke-width="1"/>
  <text x="140" y="304" text-anchor="middle" font-size="13" fill="#1a1a1a">编码 agent</text>
  <text x="140" y="322" text-anchor="middle" font-size="11" fill="#444">编码前约束 + 收尾审阅</text>

  <rect x="260" y="280" width="180" height="56" rx="8" fill="#F4F4F5" stroke="#999" stroke-width="1"/>
  <text x="350" y="304" text-anchor="middle" font-size="13" fill="#1a1a1a">审查 agent</text>
  <text x="350" y="322" text-anchor="middle" font-size="11" fill="#444">结构事实 + 差分证据</text>

  <rect x="460" y="280" width="180" height="56" rx="8" fill="#F4F4F5" stroke="#999" stroke-width="1"/>
  <text x="550" y="304" text-anchor="middle" font-size="13" fill="#1a1a1a">CI / 提交校验</text>
  <text x="550" y="322" text-anchor="middle" font-size="11" fill="#444">继承校验 · verify:ast</text>

  <rect x="40" y="356" width="600" height="40" rx="8" fill="#FAFAFA" stroke="#999" stroke-width="1" stroke-dasharray="5 4"/>
  <text x="340" y="381" text-anchor="middle" font-size="11" fill="#666">占位/待实现：MCP 服务（仅 .gitkeep）· frontend 工作台（空）· 差分预筛器 · 7 个目标路由索引 · Token 预算计量</text>
</svg>
```

三条产品线的实现状态：

| 产品线 | 已实现 | 待实现 |
|---|---|---|
| prompts 提示词工程 | 双入口编排源、5 份契约、2 条规则、两级路由骨架、Skill 构建/安装/卸载、Codex/DSH 注入包（24KB 熔断） | 差分预筛器、自动评估器、Token 计量与裁剪、语言/框架专项规则、7 目标索引填充 |
| AST 分析引擎 | JSON Lines 协议 1.0、五语言 + React/Vue 解析、超时/取消/进程组隔离、TS Checker/Pyright/javac/go/types/rust-analyzer 语义接入、四原生语言 tree-sitter 细粒度采集 | 错误恢复一致性、增量与会话缓存、原生二进制分发与签名校验、跨平台、可观测性 |
| 三项评分引擎 | S/C/P 规则执行、区间传播、位置加权 v1、聚合与 grade、HTTP `/v1/assessments`、源码快照复核 | 人工参数标定、模型评分双路合成、A–E 定级落地、跨文件原子快照 |

入口现状：CLI 与本地 HTTP 可用；**MCP 与 frontend 是空壳**；测试覆盖 ast(19)/assessment(5)/scoring(6)/capabilities/prompts/server 集成用例。

---

## 3. 设计评价

### 亮点

1. **契约驱动、语义保守**。三态预筛（triggered / clear / unknown）、"clear ≠ 语义通过"、预算不足整条 defer 不裁剪例外、结果绑定源码快照失效（`prompts/contracts/`、`docs/requirements/prompts/entry-routing.md`）。这套语义专门防止工具给出虚假保证，对 AI agent 尤其关键。
2. **分层干净**。entries 只编排、requirements 唯一正文源、routing 两级索引、generators 构建期完成继承与投影、adapters 只管宿主差异；通用/专项 `extends` 继承由 pre-commit 校验器强制（`scripts/check-inheritance.mjs`）。
3. **文档体系是仓库最强资产**。requirements（REQ 编号）→ technical-designs → changes → reports 四层交叉链接，且如实记录失败与中止细节，诚实度高于多数同类项目。
4. **反劣化设计有洞察**（`anti-degradation-signals.md`）：针对 LLM 的"教科书式过度分层"与"防御性免责"两个训练偏好，设计编码前反向约束 + 编码后快照差分，比泛泛的"写高质量代码"提示词高明。
5. **工程配置严格**：tsconfig 开 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`；运行时依赖仅 6 项；`dist/`、`node_modules` 均未入库；`verify-ast.mjs` 六步串联失败即停。

### 问题

1. **规则与现实冲突（已在本轮缓解）**：300/40 曾是硬性检查（`check:limits` exit 1）但全仓 62 处超限且未入 pre-commit——规则写了没闭环。本轮已修订为建议限制（见 §7）。
2. **覆盖面是骨架**：审查规则 2 条、7 目标路由全空、预筛器与评估器未接入（详见 §5）。
3. **文档与实现偶发不同步**：`assessment-collection.md` 曾称原生细粒度采集未实现，与 `compiler-semantics.md` 冲突——本轮已按现实修正（见 §7）。
4. **评分不可用作结论**：参数未标定、依赖本机工具链、缺跨文件原子快照、同步运算无硬抢占——目前只能当"证据发生器"，不能当"裁判"。
5. 文档量约为源码的 25%，对骨架期项目偏重但尚可控。

---

## 4. 专题一：AST 解析达到生产可用还差什么

按优先级排序（P0 = 不解决不能宣称生产可用）：

| 级别 | 差距 | 现状证据 | 阻碍维度 | 工作量 |
|---|---|---|---|---|
| P0 | **符号/类型能力未在协议主路径闭环** | 审计仍记五后端 `UNSUPPORTED_CAPABILITY`（`ast-completeness-audit.md`）、`schema.ts` `findings:[]`；`semantic*.ts` 有实现但失败路径未验收 | 可靠性：审查规则无法落地 | 大 |
| P0 | **错误恢复不对称** | Python/Rust 语法错即丢光结构（`parser.py`、`main.rs`），Go/Java 部分保留；单文件失败 → 空事实 + `STRUCTURE_INCOMPLETE` | 可靠性：残缺文件审查漏检 | 中 |
| P1 | **无增量解析与会话缓存** | 原生按文件 spawn（`native.ts`）、JS/TS 每文件建/释快照、语义会话每请求关闭；方案明文"并行度与缓存后续" | 性能：大仓全量重析，延迟/内存不可控 | 大 |
| P1 | **大文件/大仓防护偏弱** | 已有 4MiB/16MiB/1e4 文件/128 并发上限，但无总内存预算与自适应超时；语料最大约 3.5k 行 | 性能：OOM/超时雪崩 | 中 |
| P1 | **原生二进制分发与版本锁** | `setup-backends.mjs` 仅本机源码构建，路径硬编码；无多平台预构建产物与签名校验（JAR 有 SHA-256，产物无） | 可运维性：环境漂移、无法部署 | 大 |
| P1 | **跨平台未验证** | 结论限 macOS arm64；Windows 仅杀直接子进程 | 可靠性：故障隔离不可靠 | 中 |
| P2 | **协议演进硬编码** | `VERSION='1.0'` + `z.literal` + `strictObject`，无法兼容 additive 变更 | 可演进性 | 小 |
| P2 | **可观测性缺失** | 仅 stderr 截断日志与验证 JSON；无延迟/错误码/后端健康指标 | 可运维性：故障定位靠翻日志 | 中 |
| P2 | **语料与平台矩阵不足** | 132 回归 + 6 语料；无 fuzz、无 Windows/Linux CI | 质量保障 | 中 |
| P2 | **入口未生产化** | MCP/前端工作台列后续 | 接入成本 | 中 |

**结论**：语法/结构基线可靠，生产差距集中在**语义闭环、错误恢复一致性、增量/内存、二进制分发与跨平台、可观测性**。最小生产路径建议：P0 两项 → 分发与跨平台 → 增量缓存。

---

## 5. 专题二：覆盖窄——设计窄还是没实现？如何优化

### 归因：主体是实现滞后，辅以局部主动自限

**设计画了的饼（远宽于现状）**：

- 评分侧：`repository-grading.md` 规划了 A–E 五级、LLM+internal 双路合成、分层抽样、等级限制策略（自述"待实现"）；`evolutionary-resilience.md` 提出五维支柱（演化韧性、局部性、架构位置、执行成本、认知直白度）。
- 提示词侧：`anti-degradation-signals.md` 完整设计了 inject 5 道反向约束 + check 4 类静态差分信号 + 4 项 LLM 反事实推演；`prompt-entry-routing.md` 规划了三态预筛、Token 计量、自动触发。

**实际落地**：

- `prompts/requirements/` 仅 2 条规则；7 个 `targets/*.json` 全为 `pending-rules` 空数组；4 个信号 ID 只是接口规格，无检测器。
- `config/scoring.v0/v1/draft.json` 实为同一参数集：P 规则 5 条、严重问题 2 类、A–E 5 界；v1 仅多 `positionWeighting` 5 profile。
- 变更记录自证（`changes/2026-11-07/prompt-entry-routing.md`）："尚未编写语言/框架专项规则，尚未实现生成器、信号检测器、Token 计量及 Harness 触发"。

**结论**：① 7 目标路由、4 信号、5+4 约束矩阵、双路 A–E 定级都是**设计好了没做**（实现滞后）；② S/C/P 三维度正交是**主动设计选择**（非遗漏）；③ 测试/漏洞等维度是 `entry-routing.md` 明确写出的**本轮自限**；④ 参数"待标定"是设计承认的阶段约束。

### 优化路径

**高杠杆先做**（基础设施已就绪，边际成本低）：

1. 把 `anti-degradation-signals.md` 的 5 道注入约束 + 4 项反事实推演转写为 `prompts/requirements/` 规则正文——尤其 complexity 类目目录都还不存在；
2. 实现 `triggers.md` 已定义的 4 个差分信号检测器，预筛从全 `unknown` 变为可用；
3. 填充 `targets/js-ts.json`（最高频目标），验证两级路由与继承闭环；
4. 接入自动评估器（设计已承诺的核心缺口），优先于新增维度。

**设计要不要加宽**：

- **评分维度暂不加宽**：先完成 S/C/P 人工标定（`scoring-validation.md` 已有标定计划）；五支柱中的"认知直白度/演化韧性"留作 v2 维度。
- **规则类别应加宽**：测试/漏洞等健康维度按既定"后续 feature"路径纳入。
- **自动分级（A–E）与模型评分提示词**是设计已画全、实现为零的部分，属最大单点缺口。

---

## 6. 专题三：注入的上下文开销——已降多少，还能怎么降

### 实测数据（`node scripts/prompts -- build` 构建产物，字节级测量）

全部注入相关源文件合计 21972B ≈ 10000 Token（中文按 1.5 tok/字、ASCII 按 4B/tok 估算）。

| 场景 | 每次实际加载 | 估算 Token |
|---|---|---|
| A1：只装 Skills，未调用 | 常驻仅 `AGENTS.fragment.md` 410B | ~100 |
| A2：调用 eer-inject Skill | SKILL 733B + workflow 3393B + common 1110B = 5236B | ~2300 |
| A3：调用 eer-check Skill | SKILL 1010B + workflow 3393B + common 1883B = 6286B | ~2700 |
| B：开启 Harness 注入 | inject SKILL + workflow + common + check SKILL 拼接 = **6415B** | **~2500** |

场景 B 的注入在 Codex 侧发生在 SessionStart 与**每轮 UserPromptSubmit**（`codex/hook.mjs` 每轮全量重建），DSH 侧为 required systemPrompt——长会话累计 N × 6.4KB。

### 设计降耗机制的落实判断

| 机制 | 状态 | 证据 |
|---|---|---|
| 200 Token 投影预算 | **纸面** | `build.mjs` `tokenBudget:{status:'unverified'}`；`prompts/README.md` "Token 计量与预算裁剪待实现" |
| 超预算 defer | **纸面** | 仅 `contracts/resolution.md` 文字描述，无裁剪代码 |
| 两级路由按需加载 | 已实现但空转 | 7 个 targets 均为空，构建输出 `routes:[]` |
| 阶段投影/渐进分发 | **已实现** | inject common 1110B vs check common 1883B；契约正文不进注入 |
| 不打断调试 | 以建议文本实现 | `AGENTS.fragment.md` "do not interrupt…"；`automaticReview:false` |
| 24KB 熔断 | **已实现** | `adapters/contract.mjs` 超 24000B 抛错 |
| 三态预筛 | 未实现 | bundle coverage："Automatic prefilter not implemented" |

### 结论

**已大范围降耗，但离承诺还差一个量级**：相对"全量源文件塞入"（22KB ≈ 10k Token），现状注入 6.4KB，**节省约 71%（3.4×）**——主要靠阶段投影（剔除 resolution/context/results/triggers/entries 共 14.6KB）与 check 正文懒加载。但对 200 Token 的名义目标**超标 12.7 倍**，其中 `workflow.md`（3393B）独占注入的 53%。

### 剩余优化点（按性价比排序）

| # | 优化点 | 预期节省 | 难度 |
|---|---|---|---|
| 1 | **每轮重注入改 digest 去重**：SessionStart 注入一次，后续轮带 sourceDigest 跳过重建 | 长会话省 (N−1)×6.4KB | 低 |
| 2 | **workflow.md 条件化拆分**：prototype/授权/豁免段按任务需要加载 | 每次 800–1500 Token | 中 |
| 3 | **落地 200 Token 计量 + defer**：用目标模型 tokenizer 真实裁剪，预算不足整条延后 | 注入压至规则投影量级（数百 Token） | 中 |
| 4 | **规则正文外链懒加载**：注入只留生效条件 + 摘要 + 链接，命中再读规则文件（1073/1119B） | 注入可 <500 Token | 中 |
| 5 | **按任务触发**：现仅文案声明排除 doc-only 任务，无实际检测 | 非编码任务全额省 | 中 |
| 6 | **check 结果外置 + clear 静默**：预筛账本实现后，通过时不再输出规则与清单 | 省审阅输出与规则加载 | 中偏难 |

若 1+3+4 全部落地，每轮注入可从 ~2500 Token 压到 **<500 Token**（约 80% 再降），同时不损失"预算不足延后不截断语义"的契约。

---

## 7. 专题四：本轮修改记录（300/40 建议化 + 文档对齐现实）

### 7.1 300/40 改为建议限制

| 文件 | 修改 |
|---|---|
| `AGENTS.md` | 规则 1/2 补充"这是建议限制，确有需要时允许超出，不作为提交阻断" |
| `scripts/check-limits.mjs` | 超限从 `exit 1` 改为**只报告不阻断**（保留完整清单输出），已实测：62 处超限报告、`exit=0` |
| `docs/technical-designs/2026-11-06/ast-runtime.md` | `check:limits` 描述同步为"建议报告，不阻断验证" |
| `docs/technical-designs/2026-11-07/code-formatting.md` | "规模规则"一节同步为建议限制表述 |

效果：`verify:ast` 链条中 `check:limits` 不再因超限中断全流程（脚本级错误如原生工具缺失仍会失败）；规则-现实冲突消除，agent 不再面临"遵守规则就与代码库现状矛盾"的决策困境。历史记录（`docs/reports/`、`docs/changes/`）按"记录不追溯修改"原则保持原样。

### 7.2 文档对齐现实

核实代码现实：`collector.python/java/go/rust.ts` 均存在且在 `service.ts` 注册，`native-collector.ts` 输出 `coverage.level='syntax'`，`scope.ts`/`complexity.ts` 对 syntax 证据给 `partial` 而非 `unsupported`。

| 文件 | 修改 |
|---|---|
| `docs/technical-designs/2026-11-07/assessment-collection.md` | ① 流程第 3 步补记四原生语言 tree-sitter 采集；② 语言范围表 Python/Java/Go/Rust 行由"专项细粒度采集尚未实现、标记 unsupported"改为现状（syntax 级采集、partial 结论、真实缺项）；③ 采集器组织描述由"与 collector.js-ts.ts"改为五个专项采集器；④ 后续交付清单移除已完成项（语言专项采集、数值评分），保留未做项（数据流、职责契约、参数标定） |
| `README.md` | "当前状态"补记语义能力与四语言细粒度采集、评分实验引擎现状；后续阶段清单改为"MCP 入口、前端工作台、提示词自动预筛、更多审查规则与框架深度语义" |

验证：`npm run check:limits` 在修改后 `exit=0`；`git diff` 共 6 文件、+18/−12 行；无测试依赖旧的失败语义（`tests/` 中无 check-limits 断言）。

---

## 8. 对不同 agent 的提升/降低预估

> 前提：机制推断，无 A/B 实测；方向可信、量级仅供参考。"agent"指 AI 编码/审查 agent 及其运行宿主（Harness）。§7 修改后，原"规则与现实冲突"的负向因素已基本消除。

| Agent 类型 | 提升面 | 降低/风险面 | 净效应 |
|---|---|---|---|
| **Codex / DSH 编码 agent**（已适配注入） | 编码前获得反过度设计约束；收尾有差分审阅流程；注入默认关闭、不打断调试 | 每轮 ~2500 Token 注入（优化未落地前）；豁免/授权条款密集，小任务流程负担重；规则仅 2 条，初期收益有限 | **低～中正向**（规则补齐 + token 优化后可升中～高） |
| **Claude Code / Cursor 等编码 agent**（无原生适配） | 手动装通用 Skills 获得 check 流程；无需为 300/40 建议化担心决策冲突 | 无 Hook 注入，inject 预防约束大概率被跳过；主动调用 Skill 仍花 ~2300–2700 Token | **弱正向**（主要只有编码后审阅价值） |
| **审查 / 评审 agent** | 拿到 AST 结构事实、语法诊断、S/C/P 差分证据，补齐"凭印象打分"短板；三态语义强制区分"没证据"和"通过" | 评分未标定不能给总分；后端工具链缺失时返回 unknown，摩擦增加 | **中～高正向**（最确定的受益方） |
| **CI / 提交守护 agent** | 继承校验、`verify:ast` 六步机制扎实可接流水线；行数超限不再误伤流水线 | hooks 本机未装齐、`check:limits` 曾因缺 Java 中止——全量校验环境依赖仍需固化 | **中正向**（闭环后更稳） |
| **开发 code-eer 本身的 agent** | AGENTS.md + 继承校验器约束明确；300/40 建议化后不再与 62 处存量冲突 | 文档量大，冷启动理解成本高 | **弱～中正向**（原接近中性，本轮转正） |
| **非编码 / 通用对话 agent** | 基本不接触这些能力 | — | **可忽略** |

跨类型共同判断：

- **提升来源是"确定性"而非"智能"**：AST 证据、三态语义、差分快照都在降低 agent 输出方差，对弱模型收益大于强模型。
- **降低的三大来源**：① 上下文开销（每轮 2500 Token 对小任务是净负担，见 §6 优化路径）；② 流程条款认知税（豁免状态机、授权边界需 agent 维护状态）；③ 规则-现实冲突（**已在本轮消除**）。
- **反过度设计约束是双刃剑**：对有过度分层偏好的模型是强纠偏；弱模型可能机械执行"能单文件闭环绝不新建文件"，折叠掉合理抽象——设计已用例外条款缓解，代价是条款变长。

---

## 9. 结论与优先级建议

**总评**：设计纪律高、文档诚实、地基（AST + 契约 + 继承体系）扎实；评分与提示词两条线是"设计先行、实现追赶"的骨架期状态，不存在方向性错误，主要是落地次序问题。

**建议的行动优先级**：

1. ~~清理规则-现实冲突~~（**本轮已完成**：300/40 建议化 + 文档对齐）。
2. **注入降耗三件套**（§6 #1/#3/#4）：digest 去重、200 Token 计量落地、规则外链懒加载——单点收益最大，直接决定编码 agent 侧净效应的正负号。
3. **预筛检测器 + 规则扩写**（§5）：把 `anti-degradation-signals.md` 已设计的 5+4 信号落地，填 `targets/js-ts.json`，预筛从全 unknown 变可用。
4. **AST 生产化 P0**（§4）：符号/类型协议闭环 + 错误恢复一致性。
5. **评分人工标定**（`scoring-validation.md` 计划）：标定前只发布证据、不发布等级；标定后 A–E 双路合成是最大功能缺口。
