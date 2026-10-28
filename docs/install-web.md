# 安装到 dsh Web profile

[English](en/install-web.md) | 简体中文

## 前置检查

```bash
dsh --version
pnpm --version
ls ~/.dsh/profiles/web
```

本仓库实测 dsh `0.2.1-rc.2`。升级内核后先重跑本文的验证步骤。

`dsh plugin add/remove` 需要 PATH 中能找到 pnpm；若出现 `spawn pnpm ENOENT`，先修复 pnpm 的安装或 PATH。macOS/Linux 安装命令中的 `C:/path/to/…` 应替换为本机绝对路径，例如 `/Users/<you>/Documents/qoder-dsh-connect/…`。

确认目标 profile 没有被宿主占用（不要在 `dsh web` 运行时改 `node_modules`）。

## 备份

```bash
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.dsh/backups/$DATE-qoder-connect
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
  [ -f ~/.dsh/profiles/web/$f ] && cp ~/.dsh/profiles/web/$f ~/.dsh/backups/$DATE-qoder-connect/
done
```

不要备份或复制 `~/.dsh/credentials.yaml`、`~/.npmrc`。

## 安装

开发态（软链，改代码后重启宿主）：

```bash
dsh plugin --profile web add "link:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

交付态（复制，源目录可移动）：

```bash
dsh plugin --profile web remove qoder-dsh-connect 2>/dev/null || true
dsh plugin --profile web add "file:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

- 裸目录会被 pnpm 当成 `link:`，复制必须写 `file:`。
- 复制安装后改源码不会自动同步；重新 `remove` + `add` 才会刷新。
- `--profile` 是必填参数。

## 可选配置

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，给插件行加 `config`。先备份该文件。

```yaml
- id: qoder-dsh-connect
  config:
    # 子代理
    profile: headless
    concurrency: 2
    timeoutMs: 900000
    # 可选共享 secret；设置后 Qoder 侧也必须提供
    token: ''
    # 市场：没有默认索引，必须显式配置
    market:
      indexes:
        - url: https://awesome-dsh-plugin.com/plugins.json
          title: Community dsh market
    # 实验室：默认关闭，开启后也只允许白名单 profile
    lab:
      enabled: false
      profiles:
        - qoder-lab
      currentProfile: web
```

配置字段完整表见宿主包的 [README](../packages/dsh-plugin-qoder-connect/README.md)。

## 验证

### 1. 配置合成

```bash
dsh --profile web --dump-config > /tmp/dsh-dump.out 2> /tmp/dsh-dump.err
cat /tmp/dsh-dump.err
grep -n -A3 'qoder-dsh-connect' /tmp/dsh-dump.out
```

stderr 应为空；条目应出现。

### 2. 启动

```bash
dsh web --no-open
```

等待 `dsh web: http://127.0.0.1:<port>/?token=...` 打印出来（`dsh-memory` 等插件可能拖慢启动）。
另开一个终端：

```bash
curl -s http://127.0.0.1:<port>/api/qoder-dsh-connect/status
```

期望：`"plugin":"qoder-dsh-connect"`、`"ready":true`。如果宿主要求 token，把启动 URL 里的
`?token=` 一起带上，或使用 `Authorization: Bearer <token>`。

### 3. 实时 E2E

```bash
node packages/dsh-plugin-qoder-connect/test/live.mjs http://127.0.0.1:<port>
```

会新增几条运行和学习记录，并做一次 kill 测试。

## 连接 Qoder

见 [MCP 与 CLI](mcp.md) 和 [examples/mcp.json](../examples/mcp.json)。

## 卸载

```bash
dsh plugin --profile web remove qoder-dsh-connect
```

台账目录 `~/.qoder-dsh-connect/` 默认保留；确认不需要后再手动删除。卸载插件会终止所有存活子进程。

## 常见问题

| 症状 | 处理 |
| --- | --- |
| `dump-config` 无条目 | 检查 `package.json` 的 `dsh.bundle.patch` 和 patch 里的 id/name |
| `did not activate` | 宿主未提供 `webServer`，或插件等待服务；查看启动日志 |
| 改了代码不生效 | link 安装也需要重启宿主；copy 安装需要重新 add |
| `/status` 404 | 插件没加载，或基础路径写错 |
| 启动 URL 很久不出现 | 等慢插件完成；不要用 `dsh web --help` 判断 |
| 端口被占用 | `dsh web --no-open --port 0` 让系统分配 |
