# qoder-dsh-connect-cli

[English](README.md) | [简体中文](README.zh-CN.md)

A zero-dependency Node CLI and stdio MCP server for Qoder. It connects to the local [qoder-dsh-connect host plugin](../dsh-plugin-qoder-connect/README.md) over loopback HTTP to delegate work to DeepSeek Harness, research plugin markets, manage a guarded lab, and export learning notes.

## CLI usage

Run these commands from this package directory, or use the installed `qoder-dsh-connect` executable with the same arguments.

```bash
node bin/qoder-dsh-connect.mjs --help
node bin/qoder-dsh-connect.mjs version
node bin/qoder-dsh-connect.mjs status
node bin/qoder-dsh-connect.mjs run "Reply with: received"
node bin/qoder-dsh-connect.mjs run - < task.md
node bin/qoder-dsh-connect.mjs runs --limit 5
node bin/qoder-dsh-connect.mjs get "<run-id>" --wait 60000
node bin/qoder-dsh-connect.mjs kill "<run-id>" --reason "not needed"
node bin/qoder-dsh-connect.mjs learn --title "Optional services" --body "Read optional services with ctx.get" --topic dsh-plugin-dev --tags cordis,services
node bin/qoder-dsh-connect.mjs learnings --topic dsh-plugin-dev --limit 10
node bin/qoder-dsh-connect.mjs export --results
node bin/qoder-dsh-connect.mjs market sources
node bin/qoder-dsh-connect.mjs market search --text workbuddy --limit 5
node bin/qoder-dsh-connect.mjs market entry dsh-workbuddy-connect
node bin/qoder-dsh-connect.mjs lab status
node bin/qoder-dsh-connect.mjs lab ops --limit 10
node bin/qoder-dsh-connect.mjs lab scaffold --kind plugin --name example-plugin
node bin/qoder-dsh-connect.mjs lab check "<lab-plugin-path>"
node bin/qoder-dsh-connect.mjs lab install "<lab-plugin-path>" --profile qoder-lab
node bin/qoder-dsh-connect.mjs lab verify --profile qoder-lab --name example-plugin
node bin/qoder-dsh-connect.mjs lab uninstall example-plugin --profile qoder-lab
node bin/qoder-dsh-connect.mjs lab restore "<backup-id>" --confirm "<backup-id>"
```

Commands print JSON; `export` prints Markdown and `mcp` writes JSON-RPC messages. `run -` reads the task from stdin; `learn --body -` reads the learning body from stdin. `lab scaffold --kind skill` generates a Skill instead of a plugin. See the [CLI/MCP guide](../../docs/en/mcp.md) and [HTTP API](../../docs/en/api.md) for options and response fields.

## Connection settings

URL/token settings resolve from command-line options, then environment variables, then the client configuration file, then defaults. A token in the selected URL is used before a token from the configuration file.

| Setting | CLI / environment | Default |
| --- | --- | --- |
| Host URL | `--url` / `QODER_DSH_CONNECT_URL` | `http://127.0.0.1:3080` |
| Plugin token | `--token` / `QODER_DSH_CONNECT_TOKEN` | None |
| Config file | `--config` / `QODER_DSH_CONNECT_CONFIG` | `~/.qoder-dsh-connect/client.json` |
| HTTP timeout | `--request-timeout-ms` / config `timeoutMs` | 135,000 ms |

```json
{
  "url": "http://127.0.0.1:3080",
  "token": "",
  "timeoutMs": 135000
}
```

Passing a full URL such as `http://127.0.0.1:3080/?token=...` keeps its origin and extracts the query token for authentication. Use the host plugin's configured shared token; a dsh Web launch token is not automatically the plugin token. Keep real tokens in local configuration or environment variables rather than committed examples.

Long-poll requests reserve time for the requested wait, which the host caps at 120,000 ms. A delegated run can return while still running; use `get`/`dsh_run` to poll it. Run usage sums per-step input/output/cache/reasoning/total tokens, and `full` requests the full result instead of its ordinary projection.

## MCP setup

Replace the paths and URL with those on your machine. Use an absolute Node executable path if Qoder cannot resolve `node` from PATH.

```json
{
  "mcpServers": {
    "qoder-dsh-connect": {
      "command": "node",
      "args": ["/path/to/qoder-dsh-connect/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs", "mcp"],
      "env": {
        "QODER_DSH_CONNECT_URL": "http://127.0.0.1:3080"
      }
    }
  }
}
```

On Windows, use an absolute path such as `C:/path/to/qoder-dsh-connect/…`. The server advertises MCP protocol `2024-11-05`. Input accepts newline-delimited JSON and `Content-Length` frames measured in UTF-8 bytes, with a 1 MiB message limit. Long-running tools allow concurrent status and kill requests, and EOF waits for accepted requests to finish. Tool arguments are checked against the advertised schemas before dispatch; execution errors return `isError: true`.

| MCP tool | Purpose and required arguments |
| --- | --- |
| `dsh_status` | Host readiness, limits, integrations, and policy |
| `dsh_delegate` | Delegate `task`; optional `cwd`, `sessionId`, `timeoutMs`, `label`, `waitMs` (default 110,000) |
| `dsh_runs` | List runs; optional `limit`, `live` |
| `dsh_run` | Read `id`; optional `waitMs`, `full`, `tail` |
| `dsh_kill` | Stop `id`; optional `reason` |
| `dsh_learn` | Append `title` and `body`; optional `topic`, `tags`, `source` |
| `dsh_learnings` | Read notes; optional `topic`, `limit` |
| `dsh_export` | Markdown digest; optional `topic`, `results`, `limit` |
| `dsh_market_sources` | List configured market sources |
| `dsh_market_search` | Search; optional `text`, `category`, `source`, `offset`, `limit`, `refresh`, `full` |
| `dsh_market_entry` | Read plugin `name`; optional `source`, `full` |
| `dsh_lab_status` | Lab policy and directories |
| `dsh_lab_scaffold` | Generate `kind` (`plugin`/`skill`) and `name`; optional `description`, `force` |
| `dsh_lab_check` | Statically check lab `path` |
| `dsh_lab_install` | Install lab `path` into `profile`; optional `mode` (`file`/`link`); takes a backup |
| `dsh_lab_uninstall` | Remove plugin `name` from `profile`; takes a backup |
| `dsh_lab_verify` | Verify `profile`; optional expected plugin `name` and `boot` |
| `dsh_lab_restore` | Restore `backupId`; `confirm` must exactly equal it |
| `dsh_lab_ops` | Read the operation journal; optional `limit` |

For `dsh_lab_verify`, `name` checks that the expected top-level, enabled plugin entry is configured. Without it, the host infers a recent installation when possible, or checks only profile configuration. Results include `expected`, `missing`, and `verificationScope`. `boot: true` adds temporary host reachability and shutdown checks; neither configuration presence nor reachability proves runtime plugin activation. See the [lab guide](../../docs/en/lab.md).

## Bundled Qoder Skill

```bash
node bin/qoder-dsh-connect.mjs skill install
# Or choose a destination.
node bin/qoder-dsh-connect.mjs skill install --dest "/path/to/qoder-skills/qoder-dsh-connect"
```

The default destination is `~/.qoder-cn/skills/qoder-dsh-connect`. Use `--force` to overwrite an existing installation. The command also writes local CLI/repository paths into the installed Skill references. Lab-generated Skills remain in the lab until you copy them to the intended Skill directory.

## Security and validation scope

The intended endpoint is a local loopback host. The host plugin enforces loopback/origin checks and its optional token. Delegated dsh processes inherit real host credentials, tools, and permissions; this bridge does not provide an OS sandbox. It sends tasks through stdin and launches children with argument arrays. Host timeouts, explicit kill, and unload stop process trees; POSIX escalates from SIGTERM to SIGKILL, while Windows first runs `taskkill /T /F`.

The lab starts disabled and requires explicit profile allowlisting. Modifying the current host profile is refused by default. Market sources are explicitly configured, queries are read-only, and market metadata is not a security endorsement. Ledgers persist tasks, results, and tool events, which may contain sensitive user data. See the [security model](../../docs/en/security.md).

Requires Node `^22.19.0 || >=24.0.0`, with no third-party runtime dependencies. From the repository root, run `npm run test:cli` and `npm run check`. CI runs Node 22/24 on Linux, Windows, and macOS using fake dsh processes and local fixtures; it does not call a model or prove real Desktop E2E behavior.
