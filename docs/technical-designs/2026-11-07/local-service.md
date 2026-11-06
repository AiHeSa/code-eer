# 本地后台服务运行记录

- 日期：2026-11-07
- 部署位置：当前 macOS 用户会话，本机 `127.0.0.1:4317`。
- 入口：`services/server/index.ts`，部署运行编译后的 `dist/services/server/index.js`。
- 评分阶段：已接入[实验评分引擎](scoring-runtime.md)，参数未标定，无法证明的项目保留未完成状态。

## 1. Go 构建问题与修复

拉取仓库后缺少 `.cache/bin/go-ast`，因为这是被 Git 忽略的本地构建产物；
本机 PATH 中也没有 Go 工具链，所以之前未能执行原生 Go 解析器。

本次使用 [Go 官方发行元数据](https://go.dev/dl/?mode=json)选择 darwin/arm64 归档，
核对发行元数据中的 SHA-256 后，将 Go 1.27.3 解压到 `.cache/toolchains/go/`。
实际版本与校验信息保存在 `.cache/toolchains/go-release.json`。
通过 `setup-backends.mjs go` 生成 `.cache/bin/go-ast`，真实声明解析测试已通过。
构建脚本支持 CODE_EER_GO，并在 PATH 中没有 Go 时可使用此项目内工具链。

构建方式：

```sh
node scripts/setup-backends.mjs go
```

这不是 Go 自身的网络服务：Go 二进制按请求由 AST 后端调用，常驻 HTTP 服务由 Node.js 管理。
因此无需单独长期运行 go-ast 或给它分配端口。

## 2. 服务管理

用户级 LaunchAgent：`~/Library/LaunchAgents/com.code-eer.local-review.plist`。
固定工作目录和项目根 `/Users/wangzh/code/code-eer`，端口 4317；只监听 127.0.0.1。
使用已安装的 Node.js 绝对路径，避免图形会话 PATH 缺少 Node 导致启动失败。
登录加载，异常退出后由 launchd 重启；正常停止不自动重启。

```sh
launchctl print gui/501/com.code-eer.local-review
launchctl kickstart -k gui/501/com.code-eer.local-review
launchctl bootout gui/501 ~/Library/LaunchAgents/com.code-eer.local-review.plist
```

501 是本次部署的用户 ID；其他机器使用其实际用户 ID。
重新编译后需重启服务进程加载新代码。`CODE_EER_PROJECT_ROOT` 和 `CODE_EER_PORT` 在启动环境中固定。
日志：`.cache/logs/review-service.log`、`.cache/logs/review-service.error.log`。
启动配置不纳入仓库；Node 工具路径或仓库位置改变后需更新 LaunchAgent。

## 3. 已实现接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | /health | 实际后端可用性、版本、服务固定项目根 |
| POST | /v1/ast | 已有 AST 协议，支持 capabilities/analyze |
| POST | /v1/assessment/collect | 已有 collectAssessment 编程接口的 HTTP 适配 |
| POST | /v1/assessments | 实验评分、区间、规则账本及报告保存 |

AST 请求可省略 params.root，服务注入固定项目根；显式传入不同根时拒绝。
采集请求只接受 backend、params 和 configuration，其中 params 不接受 root。
POST 必须使用 application/json；不接受跨站 Origin；并发请求上限 8，请求体上限 1 MiB。
HTTP 200 表示请求已处理，AST/采集结果内部的 ok/status/errors 仍必须检查。
采集返回 null 分数不代表异常，当前只有事实与结构指标。

```json
{"protocolVersion":"1.0","requestId":"go-check","backend":"go","method":"analyze","params":{"files":["tests/fixtures/ast/go/sample.go"]}}
```

```json
{"backend":"js-ts","params":{"files":["services/server/index.ts"]}}
```

上面两个请求分别发送至 /v1/ast 和 /v1/assessment/collect。
评分接口的配置、预算、职责证明和区间含义见[运行契约](scoring-runtime.md)。

## 4. 当前能力与验证边界

健康检查中，必需 JS/TS 与 Go 后端可用时 ready=true；可选后端有缺失时 status=degraded。
本次实际运行：JS/TS、Python 和 Go 可用，Java 与 Rust 因本机环境/产物未就绪而不可用。
Python 是本机 3.9.6，不等同于先前 AST 基线验证环境 3.14.4。
这次没有声称五种语言全部就绪或重新通过完整 AST 验证。

HTTP 集成测试验证健康状态、真实 Go 解析、评分证据采集、错误输入、根目录固定和跨站拒绝。
已从独立请求访问实际 LaunchAgent 进程，确认服务在工具命令结束后仍保持运行。
