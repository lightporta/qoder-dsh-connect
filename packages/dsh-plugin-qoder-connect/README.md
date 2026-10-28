# dsh-plugin-qoder-connect

DeepSeek Harness 宿主插件：把本机 Harness 变成 Qoder 可调用的子代理、插件市场研究源和受控实验室。

这是 `qoder-dsh-connect` monorepo 的宿主半部分。Qoder 侧的 CLI / MCP 在
`packages/qoder-dsh-connect-cli`，Qoder Skill 在 `packages/qoder-dsh-connect-cli/skill/qoder-dsh-connect`。

## 安装

```bash
# 开发态
dsh plugin --profile web add "link:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"

# 交付态
dsh plugin --profile web remove qoder-dsh-connect
dsh plugin --profile web add "file:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

`--profile` 必填。桌面端把 `web` 换成 `desktop`，并使用桌面端自带 CLI。安装后重启宿主；
`dsh --profile web --dump-config` 应出现 `qoder-dsh-connect` 条目。

## 路由

根路径 `/api/qoder-dsh-connect`，全部 loopback 限定。可选 `token` 会额外要求 Bearer 认证。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/status` | 健康、引擎、并发、市场、实验室、集成探测 |
| POST | `/runs` | `{ task, cwd?, sessionId?, timeoutMs?, label?, wait? }` |
| GET | `/runs` | `?limit=&live=1` |
| GET | `/runs/<id>` | `?wait=&tail=&full=1` |
| GET | `/runs/<id>/log` | 原始 ndjson 事件尾部 |
| POST | `/runs/<id>/kill` | `{ reason? }` |
| GET/POST | `/learnings` | 学习台账 |
| GET | `/export` | Markdown 摘要 |
| GET | `/market/sources` | 市场 source 列表 |
| GET | `/market/search` | `?source=&url=&text=&category=&offset=&limit=&refresh=1&full=1` |
| GET | `/market/entry` | `?name=&source=&full=1` |
| GET | `/lab` | 实验室策略与目录 |
| GET | `/lab/ops` | 操作日志 |
| POST | `/lab/scaffold` | `{ kind, name, description?, force? }` |
| POST | `/lab/check` | `{ path }` |
| POST | `/lab/install` | `{ path, profile, mode? }` |
| POST | `/lab/uninstall` | `{ name, profile }` |
| POST | `/lab/restore` | `{ backupId, confirm }` |
| POST | `/lab/verify` | `{ profile, name?, boot? }` |

完整请求/响应与错误码见 [../../docs/api.md](../../docs/api.md)。

## 配置

在 profile 的 `cordis.patch.yml` 中给插件行加 `config`；所有字段可选。

```yaml
- id: qoder-dsh-connect
  config:
    profile: headless
    bin: ''                       # 显式 dsh CLI bin.js；留空自动解析
    dir: ''                       # 台账目录，默认 ~/.qoder-dsh-connect
    concurrency: 2
    timeoutMs: 900000
    maxTimeoutMs: 3600000
    tailLines: 60
    retainRuns: 200
    retainLearnings: 500
    token: ''                     # 可选共享 secret；空 = 只靠 loopback 栅栏
    market:
      indexes: []                 # 显式索引 URL；没有默认地址
      preferHost: true
      allowAdHocIndexes: false
      timeoutMs: 15000
      cacheMs: 300000
      maxBytes: 4194304
    lab:
      enabled: false              # 默认关闭
      dir: ''                     # 默认 <dir>/lab
      profiles: []                # 允许写入的 profile 白名单
      allowCurrentProfile: false
      currentProfile: web         # 当前宿主 profile；用于拒绝自改
      dshHome: ''                 # 默认 $DSH_HOME 或 ~/.dsh
      bin: ''                     # 实验室专用 dsh bin.js；留空复用 engine.bin
      timeoutMs: 180000
```

CLI 入口解析链：`bin` → 宿主自身 `process.argv[1]` → 解析 `@deepseek-ai/dsh/lib/bin.js`。
`bin` 必须是 `bin.js` 入口，不要填 `.cmd`/`.bat` 包装器；`/status` 会报告实际命中方式。

## 已知取舍

- 委派子进程使用 `headless` profile，不加载 `web`/`desktop` 的第三方插件。它拿到的是真实模型凭据、工具和权限策略。
- `web` profile 顶层 `tool-jobs` 默认禁用，因此 job 镜像通常会降级；委派本身不受影响。要打开需显式在 profile patch 里启用 `tool-jobs`，插件不替用户改。
- 运行记录在宿主进程内存 + 台账；宿主重启后旧 run id 在内存中查不到，但 `/export` 与台账仍完整。
- 市场索引没有默认地址。未配置 source 时 `/market/search` 返回 409；`/market/sources` 仍可读。
- 实验室不提供“远程安装任意 npm 包”的能力：只接受 lab 目录内、静态检查通过的插件目录。

## 开发

```bash
npm test                                   # 在仓库根目录运行
node test/smoke.mjs [dsh-bin.js]           # 真实 headless 冒烟
node test/live.mjs http://127.0.0.1:3080   # 对运行中的宿主做 E2E
```

测试不依赖 cordis 宿主；路由测试使用普通 loopback HTTP server，子进程使用
`test/fixtures/fake-dsh.mjs`。
