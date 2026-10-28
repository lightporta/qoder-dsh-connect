# qoder-dsh-connect

让 Qoder 直接控制本机的 **DeepSeek Harness (dsh)**：把 Harness 当作子代理，把插件市场当作研究源，把插件与 Skill 的开发当作可回滚的实验室。

作者：[Asher Zeqi (@lightporta)](https://github.com/lightporta) · 仓库：[lightporta/qoder-dsh-connect](https://github.com/lightporta/qoder-dsh-connect)

```text
Qoder Desktop
  │  MCP (stdio) 或 CLI
  ▼
loopback HTTP + 可选 token
  │
  ▼
dsh host plugin（web / desktop profile）
  ├─ 子代理：dsh --profile headless --json
  ├─ 市场：format-1 / 社区索引 / host pluginMarket
  └─ 实验室：scaffold → check → install → verify → rollback
```

> 这是对先前 `qoder-dsh-proxy` 的完整重构版：宿主插件、Qoder CLI、MCP 服务器、Skill、实验室和市场研究都在一个可发布的 monorepo 里。名称、API 根路径和台账目录均已独立，可与旧插件并存。

## 能做什么

| 能力 | 说明 |
| --- | --- |
| 子代理委派 | Qoder 提交任务，宿主启动 `dsh --profile headless --json` 子进程执行；返回终局、事件计数、token 用量和会话 id |
| 多轮续接 | 把上一次的 `sessionId` 传回去，在同一个 Harness 会话上继续 |
| 长任务观察 | `POST /runs` 可等待，也可先返回 `202`；`GET /runs/<id>?wait=` 长轮询，`POST /runs/<id>/kill` 杀整棵进程树 |
| 市场研究 | 读取显式配置的 format-1 或社区索引，也可透传宿主 `pluginMarket`；支持搜索、分页、单插件详情和原始记录 |
| 插件/技能实验室 | 在 lab 目录生成插件或 Skill 骨架，做静态检查，安装到白名单 profile，跑 `dump-config` 或临时启动验证，失败可回滚 |
| 学习台账 | 每次运行和每条学习记录落在 `~/.qoder-dsh-connect/`，可导出 Markdown 给 QMind 或其他知识库 |
| 双端 | 同一宿主插件可用于 dsh `web` 和 `desktop` profile；桌面端只是 CLI 路径和 profile 不同 |
| 零运行时依赖 | 宿主与 CLI 都只用 Node 内置模块，不需要 `npm install` 也能跑测试 |

## 为什么是“宿主插件 + Qoder 客户端”

- **子代理拿真实凭据和真实工具**：headless 是 dsh 官方的一次性驱动器，继承用户已有的模型凭据、工具和权限策略，而不是在插件里伪造一个 agent。
- **隔离**：一次委派就是一个子进程。跑飞了只需 kill 这个进程树，不会拖垮正在服务 Web GUI 的宿主。
- **可审计**：所有委派、学习记录、实验室操作都落盘；市场研究只读，安装操作必须显式开启并有备份。
- **两端解耦**：Qoder 侧只认一个 loopback HTTP API。MCP、CLI、以后其他客户端都可以复用同一套接口。

## 快速开始（Windows / Git Bash）

先确认 `dsh --version` 和 `pnpm --version` 可执行；`dsh plugin add/remove` 需要 PATH 中的 pnpm。macOS/Linux 将示例里的 `C:/path/to/…` 换成本机绝对路径；Desktop 的启动方式与限制见 [安装说明](docs/install-desktop.md)。

### 1. 备份 profile

```bash
mkdir -p ~/.dsh/backups/$(date +%Y%m%d)-qoder-connect
cp ~/.dsh/profiles/web/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml,cordis.patch.yml} \
  ~/.dsh/backups/$(date +%Y%m%d)-qoder-connect/ 2>/dev/null || true
```

不要备份 `~/.dsh/credentials.yaml`、`~/.npmrc` 或任何 token。

### 2. 安装宿主插件

先确认没有正在使用目标 profile 的宿主；安装后需要重启宿主。

```bash
# 开发态：软链，改 lib/*.js 后重启宿主即可
dsh plugin --profile web add "link:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"

# 交付态：复制安装，源目录可移动；改源码后需要重新 add
dsh plugin --profile web remove qoder-dsh-connect
dsh plugin --profile web add "file:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

裸路径会被 pnpm 当成 `link:`；要复制安装必须显式写 `file:`。

桌面端把 `--profile web` 换成 `--profile desktop`，并使用桌面端自带 CLI：

```bash
DSH="C:/Users/<you>/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd"
"$DSH" plugin --profile desktop add "file:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

### 3. 启动并验证

```bash
dsh web --no-open
# 看到 dsh web: http://127.0.0.1:3080/?token=... 后
curl -s http://127.0.0.1:3080/api/qoder-dsh-connect/status
```

期望看到 `"plugin":"qoder-dsh-connect"`、`"ready":true`。如果 profile 设了插件 `token`，请求要带 `Authorization: Bearer <token>` 或 `?token=<token>`。

完整的安装、验证与卸载见 [docs/install-web.md](docs/install-web.md) 和 [docs/install-desktop.md](docs/install-desktop.md)。

### 4. 连接 Qoder（推荐 MCP）

把 [examples/mcp.json](examples/mcp.json) 的内容导入 Qoder 的 MCP 设置，替换其中的仓库路径和 host URL：

```json
{
  "mcpServers": {
    "qoder-dsh-connect": {
      "command": "node",
      "args": ["C:/path/to/qoder-dsh-connect/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs", "mcp"],
      "env": {
        "QODER_DSH_CONNECT_URL": "http://127.0.0.1:3080"
      }
    }
  }
}
```

没有 MCP 时，同一套能力可以直接走 CLI：

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs status
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run "只回复：收到"
```

### 5. 安装 Qoder Skill

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs skill install
```

默认安装到 `~/.qoder-cn/skills/qoder-dsh-connect`，让 Qoder 知道何时委派、如何做市场研究、如何安全地跑实验室。

## 实验室：插件与 Skill 的试错闭环

实验室默认是**关闭**的。开启需要两步：在 profile 的 `cordis.patch.yml` 里给插件加配置，并显式列出允许写入的 profile。

```yaml
- id: qoder-dsh-connect
  config:
    lab:
      enabled: true
      profiles:
        - qoder-lab          # 只允许这个实验 profile
      currentProfile: web    # 当前宿主 profile；不允许改它
      allowCurrentProfile: false
```

然后 Qoder 可以走完整闭环：

1. `dsh_lab_scaffold`：在 `~/.qoder-dsh-connect/lab/plugins/<name>` 生成可安装的 dsh 插件（含 `package.json`、`cordis.patch.yml`、入口、smoke 测试和 README），或生成一个 Qoder Skill 骨架。
2. `dsh_lab_check`：静态校验包字段、bundle patch、入口导出、路径约束；Skill 校验 frontmatter 和正文。
3. `dsh_lab_install`：先备份目标 profile 的四个配置文件，再执行 `dsh plugin --profile <lab-profile> add file:<lab-path>`。
4. `dsh_lab_verify`：跑 `dsh --profile <profile> --dump-config`；`boot: true` 时临时启动一个 host 并探测 URL（profile 需要 web app）。
5. `dsh_learn`：把结论写入学习台账，`dsh_export` 导出 Markdown 到 QMind。
6. `dsh_lab_uninstall` / `dsh_lab_restore`：移除实验插件，或按备份 id 回滚 profile 文件。

安装、卸载、恢复都要求 `lab.enabled=true`、目标 profile 在白名单、目标路径在 lab 目录内。宿主不会修改自己正在运行的 profile，除非显式设置 `allowCurrentProfile: true`。

详细说明见 [docs/lab.md](docs/lab.md)。

## 市场研究

市场索引**没有默认地址**。你需要在插件配置里显式给出：

```yaml
- id: qoder-dsh-connect
  config:
    market:
      indexes:
        - url: https://awesome-dsh-plugin.com/plugins.json
          title: Community dsh market
      preferHost: true
      allowAdHocIndexes: false
```

- 支持官方 format-1 索引和社区 `plugins.json` 格式（自动识别）。
- 宿主挂载了 `ctx.pluginMarket` 时，会把它作为额外 source 暴露；没有挂载也不会影响 HTTP 索引。
- 默认只允许查询已配置 source。`allowAdHocIndexes: true` 才会接受任意 `url` 参数。
- 返回结果会归一化 `name / description / author / install / versions / stars / capabilities` 等字段；`full=1` 可查看原始记录。

示例：

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market search --text workbuddy --limit 5
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market entry dsh-workbuddy-connect
```

见 [docs/market.md](docs/market.md)。

## 安全默认值

- **只监听 loopback**：套接字必须是 127/8、`::1` 或 IPv4-mapped loopback；Host 头必须指向 loopback；拒绝跨站标记和不同源的 Origin；永不信任 `X-Forwarded-For`。
- **可选 token**：配置 `token` 后，所有路由要求 Bearer / `x-qoder-token` / 查询 token。
- **无 shell**：子进程用 argv 数组启动，任务文本走 stdin，绝不做字符串拼命令。
- **有界**：请求体、任务长度、行缓冲、stderr、日志尾部、市场响应都有上限。
- **可终止**：墙钟超时、显式 kill、插件卸载都会终止子进程树；POSIX 使用独立进程组，Windows 升级为 `taskkill /T /F`。
- **实验室默认关闭**：profile 写入必须显式开启、显式白名单、安装前备份；当前宿主 profile 默认拒绝。
- **不碰凭据**：不读取、不复制、不返回 `credentials.yaml`、`.npmrc`、token。

完整威胁模型见 [docs/security.md](docs/security.md)。

## 兼容性

- 实测内核：dsh `0.2.1-rc.2`（Web / Desktop profile 共用宿主插件格式）。
- Node：`^22.19.0 || >=24.0.0`。
- 宿主插件是 host-only bundle：没有 `dsh.client` 前端注入，因此不需要构建客户端资源。
- 顶层 `tool-jobs` 被 `web` profile 禁用时，job 镜像会降级；委派本身不受影响。`/status` 会显示 `jobMirror` 原因。

## 开发与测试

```bash
npm test          # 单元与回归测试，使用假 dsh 子进程，不消耗模型调用
npm run check     # 语法、包元数据、patch、Skill frontmatter、危险模式扫描
npm run smoke     # 真实 dsh headless 冒烟，会消耗一次模型调用
npm run smoke:live -- http://127.0.0.1:3080   # 对运行中的宿主做 E2E；参数写法见脚本
```

仓库结构：

```text
qoder-dsh-connect/
├─ packages/dsh-plugin-qoder-connect/   # dsh 宿主插件
│  ├─ lib/                              # engine / routes / market / lab / store ...
│  ├─ cordis.patch.yml
│  ├─ assets/icon.svg
│  └─ test/                             # 单元、假 dsh、smoke、live
├─ packages/qoder-dsh-connect-cli/      # Qoder 侧零依赖 CLI + stdio MCP
│  └─ skill/qoder-dsh-connect/          # 随 CLI 包发布的 Qoder Skill
├─ docs/                                # 安装、API、市场、实验室、安全、发布
├─ examples/                            # MCP / client / cordis patch 示例
└─ scripts/check.mjs                    # CI 静态检查
```

## 文档

- [Web 安装](docs/install-web.md) · [Desktop 安装](docs/install-desktop.md)
- [HTTP API](docs/api.md) · [MCP 与 CLI](docs/mcp.md)
- [实验室](docs/lab.md) · [市场研究](docs/market.md)
- [架构](docs/architecture.md) · [安全](docs/security.md)
- [发布到 GitHub / npm](docs/publishing.md)

## 许可

MIT。见 [LICENSE](LICENSE)。
