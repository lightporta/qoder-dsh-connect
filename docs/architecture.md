# 架构

## 组件

```text
packages/dsh-plugin-qoder-connect     dsh 宿主插件（host-only bundle）
  lib/index.js                        组装 store / engine / market / lab / routes
  lib/protocol.js                     路径、默认值、上限
  lib/loopback.js                     loopback 栅栏 + token
  lib/engine.js                       headless 子进程引擎
  lib/process-tree.js                 POSIX 进程组 / Windows taskkill 终止
  lib/events.js                       --json 事件折叠与紧凑投影
  lib/store.js                        ndjson 台账
  lib/market.js                       市场 source / 归一化 / 缓存
  lib/lab.js                          scaffold / check / install / verify / restore
  lib/routes.js                       /api/qoder-dsh-connect 路由族
  lib/digest.js                       学习记录与 Markdown 导出
packages/qoder-dsh-connect-cli        零依赖 Node CLI + stdio MCP
  skill/qoder-dsh-connect             Qoder Skill（随 CLI 包发布）
```

## 一次委派的生命周期

```text
Qoder / MCP
  │ POST /runs { task, cwd, sessionId?, wait }
  ▼
routes → engine.start
  │ 验证 task/cwd/timeout/并发
  │ 分配 run id
  │ 可选：镜像到 ctx.jobs
  │ spawn(node, [dsh/bin.js, --profile headless, --json, -])
  │ task → child.stdin
  ▼
child stdout 逐行 JSON
  │ session/status/thinking/text/tool_call/tool_result/final
  │ → events.fold（聚合）
  │ → events.compact（tail / job 输出）
  │ → store.appendEvent（原始 ndjson）
  ▼
child close
  │ 结算 completed/failed/killed
  │ 唤醒长轮询
  │ 写入 runs.ndjson
  ▼
GET /runs/<id> 返回终局投影
```

### 为什么用子进程

- headless 是官方的一次性驱动器，组合真实的 Agent、模型凭据、工具和权限策略；
- 进程隔离让 kill/超时/卸载可靠；
- 不会把长任务塞进正在服务 Web GUI 的宿主事件循环。

### 会话续接

`--session-id <id> -` 让下一次委派复用同一个 Harness 会话。返回视图里的 `sessionId` 来自：

1. 请求传入的 `resumeSessionId`；
2. 否则用流里的 `session` 事件。

## 市场

```text
GET /market/sources
  ├─ configured HTTP indexes（显式 URL）
  └─ ctx.get('pluginMarket').listIndexes()（可选）
GET /market/search
  ├─ http source → fetch（超时/大小/缓存）→ 识别 format-1 / community → 归一化 → 过滤/分页
  └─ host source → pluginMarket.search → normalizeHost
```

设计要点：

- 不硬编码任何索引地址；
- HTTP 与宿主服务共存；
- 只读；
- `full=1` 才暴露原始记录。

## 实验室

```text
scaffold → 写 lab/plugins|skills/<name>
check    → 静态规则（不执行候选代码）
install  → 备份 profile → dsh plugin add file:/link:
verify   → dump-config 或临时 boot + GET + kill
restore  → 从 backup 目录复制四个 profile 文件
```

安全不变量：

- `lab.enabled` 默认 false；
- profile 白名单；
- 当前 profile 默认拒绝；
- 路径必须在 lab 目录；
- 只接受静态检查通过的 lab 插件；
- 每次写操作前备份。

## 数据目录

```text
~/.qoder-dsh-connect/
├─ runs.ndjson           # 已结算运行摘要（保留最近 N 条）
├─ learnings.ndjson      # 学习记录
├─ runs/<id>.ndjson      # 原始事件
└─ lab/                  # 实验插件/技能 + ops.ndjson

~/.dsh/backups/<timestamp>-qoder-connect-<profile>-<rand>/
```

## 配置解析

- 插件配置来自 profile 的 `cordis.patch.yml` 中 `- id: qoder-dsh-connect` 行。
- 所有数值都有上下限；`maxTimeoutMs` 不小于 `timeoutMs`。
- 可选服务（`jobs`, `pluginMarket`）在调用点用 `ctx.get()` 读取，不缓存，避免服务晚挂载。
- 当前宿主 profile：`lab.currentProfile` → `process.argv` 里的 `--profile` → `web`。

## 兼容性

- 实测 dsh `0.2.1-rc.2`。
- 事件词表：`session` / `status` / `thinking` / `text` / `tool_call` / `tool_result` / `final`。
- `step_end.usage` 是累计快照，折叠时取 max，不累加。
- `web` profile 顶层 `tool-jobs` 可能被禁用；job 镜像失败只降级。
- `pluginMarket` 可能未挂载；市场 HTTP source 不受影响。
- dsh 升级后按 [安装文档](install-web.md) 的验证三连重跑，并检查事件/市场格式是否变化。
