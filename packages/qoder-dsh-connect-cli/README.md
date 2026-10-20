# qoder-dsh-connect-cli

`qoder-dsh-connect` 的 Qoder 侧客户端：零依赖 Node CLI + stdio MCP 服务器。它只和本机宿主插件的 loopback HTTP API 通信。

## 使用

```bash
node bin/qoder-dsh-connect.mjs --help
node bin/qoder-dsh-connect.mjs status
node bin/qoder-dsh-connect.mjs run "只回复：收到"
node bin/qoder-dsh-connect.mjs run - < task.md
node bin/qoder-dsh-connect.mjs runs --limit 5
node bin/qoder-dsh-connect.mjs get <run-id> --wait 60000
node bin/qoder-dsh-connect.mjs kill <run-id> --reason "not needed"
node bin/qoder-dsh-connect.mjs learn --title "cordis ctx.get" --body "可选服务用 ctx.get 读取" --topic dsh-plugin-dev --tags cordis,services
node bin/qoder-dsh-connect.mjs export --results
node bin/qoder-dsh-connect.mjs market search --text workbuddy --limit 5
node bin/qoder-dsh-connect.mjs market entry dsh-workbuddy-connect
node bin/qoder-dsh-connect.mjs lab status
```

所有命令输出 JSON，`export` 输出 Markdown，`mcp` 输出 JSON-RPC。

## 连接配置

优先级：命令行 `--url/--token` → 环境变量 → 配置文件 → 默认值。

| 项 | 默认 / 环境变量 |
| --- | --- |
| host URL | `http://127.0.0.1:3080` / `QODER_DSH_CONNECT_URL` |
| token | 无 / `QODER_DSH_CONNECT_TOKEN` |
| 配置文件 | `~/.qoder-dsh-connect/client.json` / `QODER_DSH_CONNECT_CONFIG` |

```json
{
  "url": "http://127.0.0.1:3080",
  "token": ""
}
```

如果直接把 dsh 启动时打印的 `http://127.0.0.1:3080/?token=...` 传给 `--url`，客户端会保留
origin 并自动把 query 里的 token 作为认证凭据。

## MCP

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

MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `dsh_status` | 宿主状态 |
| `dsh_delegate` | 委派任务；`waitMs` 内完成则直接返回终局 |
| `dsh_runs` / `dsh_run` | 列出/读取运行 |
| `dsh_kill` | 终止运行 |
| `dsh_learn` / `dsh_learnings` | 写入/读取学习台账 |
| `dsh_export` | 导出 Markdown 台账 |
| `dsh_market_sources` / `dsh_market_search` / `dsh_market_entry` | 市场研究 |
| `dsh_lab_status` / `dsh_lab_scaffold` / `dsh_lab_check` | 实验室状态、脚手架、静态检查 |
| `dsh_lab_install` / `dsh_lab_uninstall` | 白名单 profile 的安装/卸载（有备份） |
| `dsh_lab_verify` | dump-config 或临时启动验证 |
| `dsh_lab_restore` / `dsh_lab_ops` | 回滚与操作日志 |

## Skill 安装

```bash
node bin/qoder-dsh-connect.mjs skill install
# 或指定目录
node bin/qoder-dsh-connect.mjs skill install --dest "C:/Users/<you>/.qoder-cn/skills/qoder-dsh-connect"
```

## 兼容性

- Node `^22.19.0 || >=24.0.0`
- 无第三方依赖，不需要安装即可运行
- 只支持 loopback 宿主；宿主插件负责安全栅栏
