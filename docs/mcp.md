# Qoder MCP 与 CLI

[English](en/mcp.md) | 简体中文

Qoder 侧有两种接入方式：推荐 MCP；没有 MCP 时用 CLI。两者共用同一个零依赖 HTTP 客户端。

## MCP 配置

把下面内容加入 Qoder 的 MCP 设置，替换仓库路径和 host URL：

```json
{
  "mcpServers": {
    "qoder-dsh-connect": {
      "command": "node",
      "args": [
        "C:/path/to/qoder-dsh-connect/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs",
        "mcp"
      ],
      "env": {
        "QODER_DSH_CONNECT_URL": "http://127.0.0.1:3080",
        "QODER_DSH_CONNECT_TOKEN": ""
      }
    }
  }
}
```

也可以直接用 `examples/mcp.json` 作为模板。

连接优先级：`--url/--token` → 环境变量 → `~/.qoder-dsh-connect/client.json` → `http://127.0.0.1:3080`。

## 工具

| 工具 | 用途 |
| --- | --- |
| `dsh_status` | 宿主状态与能力 |
| `dsh_delegate` | 委派任务；可等待终局 |
| `dsh_runs` / `dsh_run` | 运行列表 / 单个运行 |
| `dsh_kill` | 终止运行 |
| `dsh_learn` / `dsh_learnings` | 学习台账 |
| `dsh_export` | Markdown 台账 |
| `dsh_market_sources` / `dsh_market_search` / `dsh_market_entry` | 市场 |
| `dsh_lab_status` / `dsh_lab_scaffold` / `dsh_lab_check` | 实验室 |
| `dsh_lab_install` / `dsh_lab_uninstall` / `dsh_lab_verify` | 安装/卸载/验证 |
| `dsh_lab_restore` / `dsh_lab_ops` | 回滚/日志 |

完整参数见 [Skill 参考](../packages/qoder-dsh-connect-cli/skill/qoder-dsh-connect/references/tools.md)。

## 典型调用

### 委派并等待

```json
{
  "name": "dsh_delegate",
  "arguments": {
    "task": "只回复：收到",
    "label": "mcp-smoke",
    "waitMs": 110000
  }
}
```

如果返回 `status: "running"`：

```json
{ "name": "dsh_run", "arguments": { "id": "run-…", "waitMs": 60000 } }
```

### 市场

```json
{ "name": "dsh_market_search", "arguments": { "text": "workbuddy", "limit": 5 } }
```

### 实验室

```json
{ "name": "dsh_lab_status", "arguments": {} }
```

```json
{ "name": "dsh_lab_scaffold", "arguments": { "kind": "plugin", "name": "my-plugin", "description": "demo" } }
```

## CLI

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs status
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run "任务" --cwd "C:/work/demo" --wait 110000
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs get <id> --wait 60000
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs export --results
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs lab status
```

`--help` 查看全部子命令。除 `export`（Markdown）和 `mcp`（JSON-RPC）外，输出都是 JSON。

## 配置文件

```bash
mkdir -p ~/.qoder-dsh-connect
cat > ~/.qoder-dsh-connect/client.json <<'EOF'
{
  "url": "http://127.0.0.1:3080",
  "token": ""
}
EOF
```

如果 dsh 打印的是 `http://127.0.0.1:3080/?token=...`，可以直接填完整 URL；客户端会提取 token。

## 认证

- 宿主配置 `token` 后，客户端自动发送 `Authorization: Bearer` 和 query token。
- 不要把 token 写进 MCP 配置的仓库文件或提交到 Git；用环境变量或本地配置文件。
- 桌面端 host 的 token 由应用管理，使用桌面端实际打印的地址。

## 故障排查

| 症状 | 处理 |
| --- | --- |
| MCP 启动失败 | 直接在终端运行 `... mcp --url ...`，看 stderr |
| `cannot reach` | 宿主没启动、端口不对、或 URL 写成了插件路径 |
| 401 | token 缺失/错误 |
| 403 | 请求源不是 loopback，或 Origin 不同源 |
| `dsh_delegate` 超时 | 宿主仍在跑；用 `dsh_run` 轮询，不要重复提交 |
| 工具列表为空 | MCP 客户端连接到了旧进程；重启 MCP server |
