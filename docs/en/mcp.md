[English](../../README.md) | [简体中文](../mcp.md)

# Qoder MCP and CLI

Use the stdio MCP server when Qoder supports MCP. The CLI exposes the same host operations through the same Node HTTP client, with no runtime dependencies. Both require the dsh host plugin to be running.

## MCP configuration

Add this to Qoder's MCP settings and replace the repository path and host URL:

```json
{
  "mcpServers": {
    "qoder-dsh-connect": {
      "command": "node",
      "args": [
        "/absolute/path/to/qoder-dsh-connect/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs",
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

On Windows, use an absolute path such as `C:/path/to/qoder-dsh-connect/...`. The repository also provides an [MCP configuration template](../../examples/mcp.json).

URL precedence is `--url` → `QODER_DSH_CONNECT_URL` → the client configuration file → `http://127.0.0.1:3080`. Token precedence is `--token` → `QODER_DSH_CONNECT_TOKEN` → the token in the selected URL → the configuration file token. The configuration file defaults to `~/.qoder-dsh-connect/client.json`; select another with `--config` or `QODER_DSH_CONNECT_CONFIG`.

## Tools and parameters

| Tool | Required arguments | Optional arguments |
| --- | --- | --- |
| `dsh_status` | None | None |
| `dsh_delegate` | `task` | `cwd`, `sessionId`, `timeoutMs`, `label`, `waitMs` |
| `dsh_runs` | None | `limit`, `live` |
| `dsh_run` | `id` | `waitMs`, `full`, `tail` |
| `dsh_kill` | `id` | `reason` |
| `dsh_learn` | `title`, `body` | `topic`, `tags`, `source` |
| `dsh_learnings` | None | `topic`, `limit` |
| `dsh_export` | None | `topic`, `results`, `limit` |
| `dsh_market_sources` | None | None |
| `dsh_market_search` | None | `text`, `category`, `source`, `offset`, `limit`, `refresh`, `full` |
| `dsh_market_entry` | `name` | `source`, `full` |
| `dsh_lab_status` | None | None |
| `dsh_lab_scaffold` | `kind`, `name` | `description`, `force` |
| `dsh_lab_check` | `path` | None |
| `dsh_lab_install` | `path`, `profile` | `mode` |
| `dsh_lab_uninstall` | `name`, `profile` | None |
| `dsh_lab_verify` | `profile` | `name`, `boot` |
| `dsh_lab_restore` | `backupId`, `confirm` | None |
| `dsh_lab_ops` | None | `limit` |

See the [HTTP API](api.md) for host limits and response fields, and the bundled [Skill tool reference](../../packages/qoder-dsh-connect-cli/skill/qoder-dsh-connect/references/tools.md) for workflow guidance.

`dsh_delegate.waitMs` defaults to 110000; the host caps waits at 120000 ms. A running response includes a run ID for polling. `dsh_run.full:true` returns the retained full task and result. Learning topic filtering happens before the record limit. `dsh_lab_verify.name` selects an expected enabled top-level plugin ID; without an explicit or inferred name, verification covers only the profile configuration. Boot verification adds temporary host reachability, not proof of plugin activation.

## Typical calls

Delegate a task and wait:

```json
{
  "name": "dsh_delegate",
  "arguments": {
    "task": "Inspect the project and report the result.",
    "cwd": "/absolute/path/to/project",
    "label": "project-review",
    "waitMs": 110000
  }
}
```

If the result is still `running`, poll the existing run:

```json
{ "name": "dsh_run", "arguments": { "id": "run-…", "waitMs": 60000 } }
```

Search a configured market source:

```json
{ "name": "dsh_market_search", "arguments": { "text": "workbuddy", "limit": 5 } }
```

Inspect the lab policy, then create a scaffold if enabled:

```json
{ "name": "dsh_lab_status", "arguments": {} }
```

```json
{ "name": "dsh_lab_scaffold", "arguments": { "kind": "plugin", "name": "my-plugin", "description": "Demo plugin" } }
```

## Protocol behavior

The server implements JSON-RPC 2.0 and advertises MCP protocol version `2024-11-05`. It supports initialization, ping, tool listing, and tool calls; resource and prompt lists are empty.

- Tool inputs are checked against the published schemas before dispatch: object shape, required properties, types, finite numbers, enum values, string-array items, and `additionalProperties:false`. The host applies length, range, path, and policy checks as well.
- Invalid requests, arguments, and methods use JSON-RPC errors. HTTP/host failures during a valid tool call return text content with `isError:true`, including host details when available.
- Notifications produce no response and do not invoke request-only tools. `notifications/cancelled` does not terminate a dsh run; use `dsh_kill` explicitly.
- Long tools are dispatched concurrently, so ping, status, and explicit cancellation can proceed while a delegation waits.
- Input accepts newline-delimited JSON and legacy `Content-Length: <UTF-8 byte count>\r\n\r\n<body>` frames. Parsing uses byte buffers, preserving UTF-8 characters across split chunks. Responses are newline-delimited JSON.
- Messages are capped at 1 MiB and Content-Length headers at 8192 bytes. Parse errors and incomplete frames are reported; oversized input closes the input stream. Diagnostics go to stderr.

## CLI

From the repository root:

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs status
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run "Review the project" --cwd "/absolute/path/to/project" --wait 110000
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs get "<id>" --wait 60000
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs export --results
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs lab status
```

Run `--help` for the full command list. Output is JSON except for `export` (Markdown) and `mcp` (JSON-RPC). Install the bundled Qoder Skill with `skill install`; its default location is `~/.qoder-cn/skills/qoder-dsh-connect`.

## Local configuration and authentication

Create `~/.qoder-dsh-connect/client.json`:

```json
{
  "url": "http://127.0.0.1:3080",
  "token": ""
}
```

A complete host URL such as `http://127.0.0.1:3080/?token=...` also works: the client extracts the token and addresses the API at that origin. The client rejects non-HTTP(S) URLs and embedded username/password credentials.

When a token is present, the client sends both a Bearer header and a query token for compatibility with host-level authentication. Keep tokens in local configuration or environment variables; do not commit them. For Desktop, use the actual address provided by the application.

The default HTTP timeout is 135000 ms. Run waits receive at least their capped wait budget plus 15000 ms; lab install, uninstall, restore, and verify receive at least 185000 ms. A client timeout does not itself cancel the host run.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| MCP fails to start | Run `node …/qoder-dsh-connect.mjs mcp --url …` in a terminal and inspect stderr |
| `cannot reach` | Check that the host is running and the origin/port are correct |
| HTTP 401 | Supply the correct token |
| HTTP 403 | Check loopback access, matching Origin, and lab policy where relevant |
| Delegation wait expires | Poll with `dsh_run`; avoid submitting a duplicate task |
| Empty tool list | Restart the MCP process to ensure the client uses the current server |
| `ready:false` | Check the configured Node-loadable dsh `bin.js`; see [installation](install-web.md) |

See [security](security.md) for the authority granted to delegated tasks.
