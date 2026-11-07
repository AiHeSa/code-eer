# 四空格格式、语义分段与注释约定

- 日期：2026-11-07
- 变更：[全仓格式与质量评估](../../changes/2026-11-07/formatting-quality-review.md)
- 评估：[当前仓库质量报告](../../reports/2026-11-07/repository-format-quality.md)

## 格式与范围

统一四空格、UTF-8、LF 和末尾换行。Prettier 负责 JS／TS／MJS／Java／JSON，配置见根目录 .prettierrc.json。
保留单引号，参考换行宽度为 120；禁用嵌入语言重排，避免改写测试字符串中的源码样例。
Python 使用 Ruff，Rust 使用 rustfmt；Go 使用标准库 go/printer 的 UseSpaces 与四列缩进，不直接替换文件文本中的 Tab。
Java POM 已展开为四空格的嵌套 XML；Cargo／Ruff 配置遵循各自 TOML 格式。

排除依赖、构建、缓存、锁文件、生成产物和 tests/fixtures。
样例文件的源码位置及刻意构造的语法形态属于测试数据，不因生产代码排版而变动。
Markdown 文档不参与本轮 Prettier 重排，避免把格式变更扩大到文档表格和示例。

## 重复执行

```sh
npm ci
python3 -m pip install -r requirements-dev.txt
npm run format
npm run format:check
```

Node.js 要求 24+。原生格式化需要 Go、rustfmt 和 Ruff；优先使用现有 .cache/toolchains/ 工具链，缺失时使用 PATH 或显式配置。
可通过 CODE_EER_GO、CODE_EER_RUFF、CODE_EER_RUSTFMT 指定路径，Cargo／Rustup 用户路径沿用现有环境。
Go 格式化小工具仅生成在 .cache/format-go/，不会作为新的 Go 业务模块进入评估范围。
format:check 不改受检查源码，原生工具的编译缓存仍可能更新。

## 空行与注释

相邻函数／方法，以及类型声明与执行逻辑之间保留空行；连续的导入或同一组初始化不机械拆散。
同一函数中，在输入准备、批次执行、结果验证和发布等阶段之间用空行与必要说明分隔。
注释解释公开契约、字节／字符坐标、保守推断边界、未知传播、去重所有权及持久化保证。
不为显然的赋值和控制流添加复述注释，不用注释掩盖函数承担过多阶段的问题。

## 规模规则与验证边界

继续保留 AGENTS.md 的单文件 300 行、单函数 40 行原则，不通过改回压缩写法规避检查。
格式展开后暴露的规模超限作为后续结构改进项记录；本轮不为达到物理行数阈值随意新增跨文件调用层。
格式化、类型／构建、回归测试和评分分别验证；样式统一不能证明复杂度或代码健康度已经改善。

工具行为依据：[Prettier 选项](https://prettier.io/docs/options)、[Java 插件](https://github.com/jhipster/prettier-java)、[Ruff 格式化](https://docs.astral.sh/ruff/formatter/)、[Go printer](https://pkg.go.dev/go/printer)。
