# MCP 工具与参数

所有工具都通过 `qoder-dsh-connect` MCP server 调用。返回值通常是 JSON 文本；错误会用 `isError: true` 标记。

| 工具 | 必填 | 常用可选 | 说明 |
| --- | --- | --- | --- |
| `dsh_status` | — | — | 宿主状态、引擎、并发、市场 source 数、实验室策略 |
| `dsh_delegate` | `task` | `cwd`, `sessionId`, `timeoutMs`, `label`, `waitMs` | 委派一次任务；`waitMs` 默认 110000，宿主上限 120000 |
| `dsh_runs` | — | `limit`, `live` | 本进程创建的运行，新的在前 |
| `dsh_run` | `id` | `waitMs`, `full`, `tail` | 读取一次运行；`waitMs` 长轮询 |
| `dsh_kill` | `id` | `reason` | 终止子进程树 |
| `dsh_learn` | `title`, `body` | `topic`, `tags`, `source` | 追加学习记录 |
| `dsh_learnings` | — | `topic`, `limit` | 读取学习记录 |
| `dsh_export` | — | `topic`, `results`, `limit` | 返回 Markdown 台账 |
| `dsh_market_sources` | — | — | 市场 source 和宿主 `pluginMarket` 可用性 |
| `dsh_market_search` | — | `text`, `category`, `source`, `offset`, `limit`, `refresh`, `full` | 搜索已配置 source |
| `dsh_market_entry` | `name` | `source`, `full` | 单个插件详情 |
| `dsh_lab_status` | — | — | 实验室开关、白名单、目录、当前 profile |
| `dsh_lab_scaffold` | `kind`, `name` | `description`, `force` | 生成 lab 插件或 Skill |
| `dsh_lab_check` | `path` | — | 静态检查 lab 内的插件/Skill |
| `dsh_lab_install` | `path`, `profile` | `mode` (`file`/`link`) | 备份后安装到白名单 profile |
| `dsh_lab_uninstall` | `name`, `profile` | — | 备份后卸载 |
| `dsh_lab_verify` | `profile` | `boot` | `dump-config` 或临时启动验证 |
| `dsh_lab_restore` | `backupId`, `confirm` | — | `confirm` 必须等于 `backupId` |
| `dsh_lab_ops` | — | `limit` | 实验室操作日志 |

## CLI 对照

MCP 不可用时，用同一个 client 的 CLI：

```bash
node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs <command> [options]
```

连接参数：`--url`、`--token`、`--config`。命令映射见 `qoder-dsh-connect --help`。

## 结果字段

运行视图的关键字段：

- `id`、`label`、`status`、`detail`
- `result`（默认 32 KiB 投影；`full=1` 全量）
- `sessionId`、`resumed`
- `counts.events/turns/steps/toolCalls/toolErrors`
- `usage.inputTokens/outputTokens/totalTokens`
- `tail`（紧凑进度行）
- `jobMirror.attached/reason`
- `stderrTail`、`timedOut`
