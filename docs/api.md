# HTTP API

根路径：`/api/qoder-dsh-connect`。所有响应为 JSON（`/export` 为 Markdown，`/runs/<id>/log` 为 ndjson）。

## 信任栅栏

- 套接字地址必须是 `127.0.0.0/8`、`::1` 或 `::ffff:127.0.0.0/8`。
- `Host` 头必须是 `localhost`、`[::1]` 或 127/8。
- 拒绝 `sec-fetch-site: cross-site`；有 `Origin` 时必须与 Host 同源。
- `X-Forwarded-For` 从不被信任。
- 配置了 `token` 时，还必须提供 `Authorization: Bearer <token>`、`x-qoder-token: <token>` 或 `?token=<token>`。

不满足栅栏返回 `403`；缺少 token 返回 `401`。

## 错误模型

```json
{ "error": "human-readable reason" }
```

| 状态 | 含义 |
| --- | --- |
| 400 | 参数/JSON 无效，或 cwd 不合法 |
| 401 | token 缺失/错误 |
| 403 | 非 loopback、实验室未开启/白名单拒绝/路径越界 |
| 404 | 未知 run/path/plugin |
| 405 | 方法不允许 |
| 409 | 没有市场 source |
| 413 | 请求体/任务超限 |
| 429 | 并发上限 |
| 502 | 子进程/市场/实验室命令失败 |
| 503 | dsh CLI 或宿主服务不可用 |

`lab.install` / `lab.uninstall` / `lab.verify` 的执行失败可能返回 `200` 之外的 `502`，响应体同时带 `ok:false` 和命令输出。

## 状态

### `GET /status`

```json
{
  "plugin": "qoder-dsh-connect",
  "version": "0.1.0",
  "ready": true,
  "host": { "host": "127.0.0.1", "port": 3080 },
  "engine": { "bin": "…/dsh/lib/bin.js", "source": "host-entry", "profile": "headless" },
  "auth": { "mode": "loopback" },
  "limits": { "concurrency": 2, "liveRuns": 0, "timeoutMs": 900000, "maxTimeoutMs": 3600000, "maxWaitMs": 120000 },
  "market": { "available": true, "hostAvailable": false, "sourceCount": 1 },
  "lab": { "enabled": false, "profiles": [], "currentProfile": "web", "dir": "…" },
  "integrations": { "jobs": "object", "pluginMarket": "absent", "webServer": "object" },
  "ledger": { "dir": "…" },
  "endpoints": ["GET  /status", "…"]
}
```

## 运行

### `POST /runs`

请求：

```json
{
  "task": "必填，最多 60 KiB",
  "cwd": "绝对路径，可选；默认宿主 cwd",
  "sessionId": "可选，续接已有会话",
  "timeoutMs": 900000,
  "label": "可选，最多 200 字符",
  "wait": 110000
}
```

- `wait` 也可以放在 query。query 优先。
- 在 `wait` 内结束返回 `200` + 终态视图；仍在运行返回 `202` + 当前视图。
- 并发达到上限返回 `429`。

### `GET /runs`

`?limit=1..100&live=1`，返回本进程创建的运行，新的在前。

### `GET /runs/<id>`

`?wait=<ms>&tail=<n>&full=1&raw=1`

- `wait` 长轮询，最大 120000 ms；仍运行返回 `202`。
- `raw=1` 不携带 `tail`。
- `full=1` 返回完整 `result`（默认投影 32 KiB）。

### `GET /runs/<id>/log`

`?limit=1..5000&compact=1`，返回原始 ndjson 尾部；`compact=1` 转成可读进度行。

### `POST /runs/<id>/kill`

```json
{ "reason": "killed by the caller" }
```

返回 `{ "id": "…", "admission": "requested" | "already-finished" }`。

### 运行视图字段

| 字段 | 说明 |
| --- | --- |
| `id` / `label` / `status` | 运行身份与 `running/completed/failed/killed` |
| `result` | 终局文本（32 KiB 投影） |
| `sessionId` / `resumed` | 当前/续接的会话 id |
| `counts` | `events/turns/steps/toolCalls/toolErrors` |
| `usage` | 累计 token 快照 |
| `tail` | 紧凑进度行 |
| `jobMirror` | `{attached, id?}` 或 `{attached:false, reason}` |
| `stderrTail` | 子进程 stderr 尾部（最多 4 KiB） |
| `timedOut` / `detail` | 超时/终态说明 |

## 学习与导出

### `GET /learnings`

`?limit=1..500&topic=...`

### `POST /learnings`

```json
{
  "title": "必填，最多 200 字符",
  "body": "必填，最多 64 KiB",
  "topic": "默认 general",
  "tags": ["最多 10 个"],
  "source": "run id 或 URL"
}
```

返回 `201` + 记录。

### `GET /export`

`?topic=&results=1&limit=50`，返回 `text/markdown` 台账。

## 市场

### `GET /market/sources`

```json
{
  "available": true,
  "preferHost": true,
  "hostAvailable": false,
  "sources": [
    { "id": "http:https://…/plugins.json", "kind": "http", "url": "https://…/plugins.json", "title": "…" }
  ]
}
```

`/market/indexes` 是兼容别名。

### `GET /market/search`

参数：`source`, `url`（仅已配置 source，除非 `allowAdHocIndexes`）, `text`, `category`, `sort`, `offset`, `limit=1..100`, `refresh=1`, `full=1`。

返回归一化的 `entries`：`name/title/description/author/homepage/repository/category/keywords/labels/install/defaultVersion/versions/stars/downloads/capabilities`。

### `GET /market/entry`

`?name=&source=&full=1`，找不到返回 `404`。

## 实验室

### `GET /lab`

返回 `{enabled, dir, dshHome, currentProfile, profiles, allowCurrentProfile, bin}`。

### `GET /lab/ops`

`?limit=1..500`，返回操作日志（新的在前）。

### `POST /lab/scaffold`

```json
{ "kind": "plugin", "name": "my-plugin", "description": "…", "force": false }
```

`kind` 为 `plugin` 或 `skill`。已存在且没有 `force` 返回 `409`。返回 `path` 和 `check` 报告。需要 `lab.enabled=true`。

### `POST /lab/check`

```json
{ "path": "C:/Users/…/.qoder-dsh-connect/lab/plugins/my-plugin" }
```

路径必须在 lab 目录内。

### `POST /lab/install`

```json
{ "path": "…/lab/plugins/my-plugin", "profile": "qoder-lab", "mode": "file" }
```

- `mode`: `file`（默认）或 `link`。
- 先备份 profile 的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.patch.yml`。
- 目标 profile 必须在 `lab.profiles`，且默认不能是当前宿主 profile。
- 返回 `ok`、`backup.id`、`backup.dir`、`command`、`stdout/stderr`。

### `POST /lab/uninstall`

```json
{ "name": "my-plugin", "profile": "qoder-lab" }
```

### `POST /lab/verify`

```json
{ "profile": "qoder-lab", "boot": false }
```

`boot:false`：`dsh --profile <profile> --dump-config`，返回 `configured`、`warnings`、`ok`。

`boot:true`：临时启动 `dsh --profile <profile> --no-open --port 0`，解析 `dsh web: http://…`，发一个 GET，然后终止进程树。目标 profile 必须包含 web app/webServer。

### `POST /lab/restore`

```json
{ "backupId": "20261020-…-qoder-connect-qoder-lab-abc123", "confirm": "同上" }
```

恢复前会再备份当前状态。`confirm` 必须等于 `backupId`。

## 插件内服务

其他 dsh 插件可以 `inject: ['qoder-dsh-connect']` 消费同名服务：

```js
const api = ctx.get('qoder-dsh-connect')
api.ready()
await api.run({ task, cwd, sessionId, timeoutMs, label }, waitMs)
api.get(id)
api.list(limit)
api.kill(id, reason)
api.market
api.lab
api.store
```

服务缺席时消费方应容忍。
