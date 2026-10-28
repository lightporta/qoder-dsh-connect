# MCP tools and parameters

[English](tools.md) | [简体中文](tools.zh-CN.md)

Call these tools through the `qoder-dsh-connect` MCP server. Results normally contain JSON text; execution failures use `isError: true`. Invalid tool names or arguments return a JSON-RPC parameter error before dispatch.

| Tool | Required | Optional | Purpose |
| --- | --- | --- | --- |
| `dsh_status` | — | — | Host readiness, engine, limits, markets, and lab policy |
| `dsh_delegate` | `task` | `cwd`, `sessionId`, `timeoutMs`, `label`, `waitMs` | Delegate; default wait 110,000 ms, host cap 120,000 ms |
| `dsh_runs` | — | `limit`, `live` | List runs created by this host, newest first |
| `dsh_run` | `id` | `waitMs`, `full`, `tail` | Read a run, optionally long-polling |
| `dsh_kill` | `id` | `reason` | Terminate the child process tree |
| `dsh_learn` | `title`, `body` | `topic`, `tags`, `source` | Append a learning note |
| `dsh_learnings` | — | `topic`, `limit` | Read notes; topic filtering precedes the count limit |
| `dsh_export` | — | `topic`, `results`, `limit` | Return a Markdown ledger digest |
| `dsh_market_sources` | — | — | Sources and host `pluginMarket` availability |
| `dsh_market_search` | — | `text`, `category`, `source`, `offset`, `limit`, `refresh`, `full` | Search a configured source |
| `dsh_market_entry` | `name` | `source`, `full` | Read one plugin entry |
| `dsh_lab_status` | — | — | Lab enablement, allowlist, directories, and current profile |
| `dsh_lab_scaffold` | `kind`, `name` | `description`, `force` | Generate a lab plugin or Skill; `kind` is `plugin` or `skill` |
| `dsh_lab_check` | `path` | — | Statically check a plugin or Skill inside the lab |
| `dsh_lab_install` | `path`, `profile` | `mode` (`file`/`link`) | Back up and install into an allowlisted profile |
| `dsh_lab_uninstall` | `name`, `profile` | — | Back up and uninstall |
| `dsh_lab_verify` | `profile` | `name`, `boot` | Check expected plugin configuration, optionally temporary host reachability |
| `dsh_lab_restore` | `backupId`, `confirm` | — | Restore configuration; `confirm` must equal `backupId` |
| `dsh_lab_ops` | — | `limit` | Read the lab operation journal |

## CLI equivalent

```bash
node "<repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs" "<command>" [options]
```

Connection options are `--url`, `--token`, and `--config`; `--request-timeout-ms` controls the HTTP timeout. Run `--help` for command mappings, including `lab verify --profile <profile> --name <plugin> [--boot]`.

## Run fields

- `id`, `label`, `status`, and `detail` identify the run and its outcome.
- `result` is projected to at most 32 × 1024 JavaScript string units by default; MCP `full:true` requests the full result. HTTP/CLI use `full=1`/`--full`.
- `sessionId` and `resumed` describe session continuation. Supply a non-empty `sessionId` to resume.
- `counts.events/turns/steps/toolCalls/toolErrors` summarize activity.
- `usage.inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens/totalTokens` sum per-step usage.
- `tail` contains compact progress, while `stderrTail` and `timedOut` help diagnose failures.
- `jobMirror.attached/reason` describe optional GUI job integration.

## Verification and restore fields

Pass `name` when verifying a specific plugin id. `configured` contains top-level enabled ids; `expected` and `missing` describe the expected entry. Without `name`, inference is limited to 500 recent lab operations, and may fall back to checking only profile configuration.

`verificationScope` distinguishes profile/plugin configuration from host reachability. `boot:true` requires a profile with a Web app, performs configuration verification first, then probes and terminates a temporary host. The result includes `stopped`; configuration presence and reachability do not prove plugin activation.

Restore returns `restored`, `removed`, and `preRestoreBackup`. `removed` lists profile configuration files absent in the selected backup that were removed from the current profile. The four-file backup excludes `node_modules` and the pnpm store.

[Workflows](workflows.md) · [Skill](../SKILL.md)
