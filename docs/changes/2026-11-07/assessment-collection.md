# 三项评分算法细化与 AST 采集

- 日期：2026-11-07
- 需求：[REQ-SCP-001](../../requirements/code-review/scope-complexity-placement.md)
- 采集与运行：[事实采集](../../technical-designs/2026-11-07/assessment-collection.md)
- 算法：[作用域](../../technical-designs/2026-11-07/scope-algorithm.md)、[复杂度](../../technical-designs/2026-11-07/complexity-algorithm.md)、[代码位置](../../technical-designs/2026-11-07/placement-algorithm.md)

## 本次实现

- 新增 collectAssessment 编程接口，复用 AST 文件选择和解析诊断，保留源码与配置摘要；撤回本次自行扩展的 CLI 采集入口。
- 新增通用采集契约、通用回退和 JS/TS 专项采集；不改现有公共 AST 协议。
- JS/TS 提取词法作用域、声明、引用读写、捕获、本地调用、IIFE、循环、分支、退出和分配位置。
- React 保留原框架事实；Vue 内联脚本映射回原文件，两个脚本块分别建词法作用域。
- 输出三项结构指标，模块归属支持配置与最长完整路径前缀，保留未知角色。
- 细化纯度/逃逸/影响链路、成本 IR/循环/空间/严重问题、模块角色/职责适配及计分算法。
- 锁文件下载源由不可访问的内网镜像改为公共 npm，依赖版本和完整性校验不变。

## 范围与验证

新增集成用例覆盖三项采集、框架源码位置、异常输入和通用回退；提供 test:assessment。
本次实际验证结果：

- 19 项新增测试与 52 项相关 JS/TS、框架和能力继承回归测试通过，总计 71 项。
- TypeScript 构建、类型检查、能力继承校验、改动文件及函数长度检查通过。
- 编译产物采集仓库 52 个服务文件，得到 348 个函数、56 个循环，无错误或跳过项；证据 ID、作用域层级及引用/调用目标一致性检查通过。
- 全仓 check:limits 因未构建 `.cache/bin/go-ast` 而中止；本次没有重跑完整多语言 AST 验证。

本地复现产物：`.cache/verification/assessment-tests.log`、`.cache/verification/assessment-collection.json`，不纳入版本控制。

当前交付是事实采集和算法规格。数值评分和综合评分尚未启用，score 为 null。
其他语言目前只复用公共 AST 结构事实，细粒度专项采集、跨文件符号、调用图与数据流仍待实现。
基础分、属性比例、扣分映射、预算和职责契约确认并校准后，再将相应算法转换为数值评分。
