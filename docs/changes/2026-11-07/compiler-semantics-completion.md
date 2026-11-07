# 五语言语义与原生细粒度后端完成

- 日期：2026-11-07。
- 用户要求：补全缺失语义与后端，完成后部署并按当前评分系统复评。
- 设计：[编译器语义接入](../../technical-designs/2026-11-07/compiler-semantics.md)。
- 实测：[仓库复评](../../reports/2026-11-07/repository-compiler-semantics.md)。

## 交付

五语言提供实际符号、类型、定义与诊断：TypeScript Checker、Pyright、javac、go/types、rust-analyzer。
Python、Java、Go、Rust 的声明、引用、调用、循环、退出、分配及作用域证据由专项采集器输出，接入统一加权评分。
原生静态跨文件调用、传递效果与有限 primitive 成本、编译器确认的模块依赖都进入评分和持久化证据。
修复 Python global/nonlocal、推导式与生成器执行域、Rust 遮蔽、Java 字段存储归属及 Go 无 module 同包加载。
未知动态分派、绑定改写与 compiler diagnostics 保留为未决状态。

## 验证与部署

263 项集成测试通过；27 项 AST 能力基线全部通过、缺失 0 项；六组大型源码语料通过。
类型检查、能力继承校验、284 个文件的文件/函数长度检查及 diff 空白检查通过。
编译产物已更新，LaunchAgent 已重载；localhost:4317 五后端 ready。
引擎升级为 scoring-engine-4；engine-1/2/3 历史报告读取验证通过。
