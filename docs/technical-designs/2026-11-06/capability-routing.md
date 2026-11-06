# 能力分类、回退与提交校验

- 日期：2026-11-06
- 范围：后续新增的通用、语言及框架专项能力。
- 实现：[能力契约](../../../services/code-review/internal/capabilities/contract.ts)、[路由组合](../../../services/code-review/internal/capabilities/router.ts)、[文档解析与组合](../../../services/code-review/internal/capabilities/document.ts)。

## 1. 文件与目标

| 文件 | 含义 |
| --- | --- |
| `xx.ts`、`xx.md`、`xx.java` | 通用能力 |
| `xx.java.ts` | TypeScript 实现的 Java 专项 |
| `xx.go.md` | Go 专项文档或规则 |
| `xx.react.ts`、`xx.vue.md` | 框架专项 |

文件末尾扩展名表示实现格式，倒数第二段表示专项适用目标。通用文件与专项文件位于同一目录，基础名称和实现扩展名一致。目标列表登记在 [capability-targets.json](../../../config/capability-targets.json)。测试样例与声明文件具有各自的文件命名范围。

## 2. 方法契约与回退

通用文件定义完整公开入口集合。专项只实现该集合中的部分入口；其余入口自动使用通用实现。专项可以定义私有辅助函数，公开方法的参数和返回值遵守通用契约。

通用 `review.ts`：

```ts
import { defineCapability } from '../services/code-review/internal/capabilities/contract.js';

export default defineCapability({
  parse(source: string): string { return source; },
  count(source: string): number { return source.length; },
});
```

专项 `review.java.ts`：

```ts
import common from './review.js';

export default common.specialize({
  parse(source: string): string { return source.trim(); },
});
```

示例文件位于根目录的 `rules/` 下。专项的 `methods.parse` 使用专项实现，`methods.count` 使用通用实现。入口以对象字面量声明，使用静态方法名；模块通过一个 default 定义公开能力。

`resolveCapability(common, language, framework)` 按通用、语言、框架顺序组合公开方法。每层只覆盖显式提供的方法；缺少整个专项时继续使用已选实现。语言与框架专项均直接关联通用定义，返回结果保持通用入口集合。

## 3. Markdown 契约

通用文档通过 `## parse`、`## count` 等二级标题定义稳定的条目标识；条目内部可使用三级及更深层级标题。

专项 `review.go.md`：

```md
---
extends: ./review.md
---
# Go 审查

## parse
读取 Go 源码结构。
```

`resolveDocument` 按通用条目顺序组合内容；专项同名条目使用专项内容，缺项使用通用内容。标题和前言取自通用文档。代码围栏中的标题作为正文保存。

## 4. 提交前校验

安装依赖时，`prepare` 配置仓库本地 `core.hooksPath=.githooks`。已有其他 hooks 路径时，安装器报告需要整合的路径。

```sh
npm run setup:hooks
npm run check:inheritance
node scripts/check-inheritance.mjs --staged
```

Git `pre-commit` 执行暂存区校验。每次检查全部能力关系，涵盖通用入口变更、目标配置变更和文件删除。暂存快照在临时目录执行类型检查；工作区及暂存区保持原状，临时目录在结束时清理。

以下情况阻止提交：

- 通用文件缺失、专项指向其他通用文件、目标未登记。
- 专项公开入口超出通用集合，出现额外模块导出、重复入口、展开或动态入口名称。
- 方法参数或返回值与通用契约不兼容。
- Markdown 继承声明、条目标识或唯一性不满足约定。
- 专项实现格式缺少校验器，或暂存快照类型检查失败。

当前校验器覆盖 TS / JS 方法及 Markdown 条目。Java、Go、Python、Rust 等原生实现文件的专项继承须接入相应校验器；`xx.java.ts` 和 `xx.go.md` 分别使用 TS、Markdown 校验器。

## 5. 验证

```sh
npm test
npm run check:inheritance
npm run check:limits
```

能力专项验证使用 `npm run test:capabilities`，AST 验证使用 `npm run test:ast`。真实临时 Git 仓库验证提交成功、额外入口拦截、暂存与工作区差异、签名不兼容、通用删除及目标配置变更。
