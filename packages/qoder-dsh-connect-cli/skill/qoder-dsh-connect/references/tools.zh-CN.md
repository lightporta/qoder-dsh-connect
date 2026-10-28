# MCP 工具与参数

[English](tools.md) | [简体中文](tools.zh-CN.md)

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
| `dsh_lab_verify` | `profile` | `name`, `boot` | 校验预期插件配置；可选临时启动及可达性检查 |
| `dsh_lab_restore` | `backupId`, `confirm` | — | `confirm` 必须等于 `backupId`；返回 `restored`、`removed` 和 `preRestoreBackup` |
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
- `usage.inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens/totalTokens`（按步累加）
- `tail`（紧凑进度行）
- `jobMirror.attached/reason`
- `stderrTail`、`timedOut`

## 验证与恢复范围

`dsh_lab_verify` 的 `name` 为可选预期插件 id；验证特定插件时请显式传入。`expected`、`missing`、`verificationScope` 区分配置检查和 host 可达性；两者均不证明运行时激活。未传 `name` 时从最近 500 条操作推断，无法推断时仅检查 profile 配置。恢复时移除的配置文件列在 `removed`；依赖目录和 pnpm store 不在备份范围。

[工作流](workflows.zh-CN.md) · [Skill](../SKILL.zh-CN.md)
