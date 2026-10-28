# qoder-dsh-connect

English | [简体中文](README.zh-CN.md)

[![CI](https://github.com/lightporta/qoder-dsh-connect/actions/workflows/ci.yml/badge.svg)](https://github.com/lightporta/qoder-dsh-connect/actions/workflows/ci.yml)

Connect Qoder to a local **DeepSeek Harness (dsh)** host. Delegate tasks to Harness, research plugin markets, and develop plugins or Skills in a lab with backups and rollback. The host plugin and the Qoder CLI/stdio MCP server use only Node.js built-in modules.

Author: [Asher Zeqi (@lightporta)](https://github.com/lightporta) · Repository: [lightporta/qoder-dsh-connect](https://github.com/lightporta/qoder-dsh-connect)

```text
Qoder Desktop
  │  stdio MCP or CLI
  ▼
loopback HTTP + optional token
  │
  ▼
dsh host plugin (web / desktop profile)
  ├─ Delegation: dsh --profile headless --json
  ├─ Market: format-1 / community indexes / host pluginMarket
  └─ Lab: scaffold → check → install → verify → rollback
```

This monorepo replaces the earlier `qoder-dsh-proxy` layout. It has its own package names, API root, and ledger directory, so the two can coexist.

## Features

| Capability | Behavior |
| --- | --- |
| Task delegation | Start a native headless Harness process; return its answer, session ID, event counts, and accumulated token usage. |
| Session continuation | Pass a previous `sessionId` to continue the same Harness session. |
| Long-running tasks | Wait for a result or receive a run ID immediately, then poll or cancel the process tree. |
| Market research | Search explicitly configured format-1/community indexes or the host `pluginMarket` service, with pagination and optional raw records. |
| Plugin and Skill lab | Scaffold and check source under the lab directory, install checked plugins into allowlisted profiles, verify configuration, and restore profile files. |
| Learning ledger | Store runs and notes under `~/.qoder-dsh-connect/` and export a Markdown digest for QMind or another knowledge base. |
| Shared host format | Use the plugin bundle format in web or desktop profiles; Desktop has additional CLI and launch requirements. |
| No runtime dependencies | Run the CLI and tests from the checkout without installing third-party Node packages. |

Harness handles model authentication and its native tool loop. Delegated processes inherit the host's environment, tools, and permissions. Each run has a separate process and can be terminated; this project does not add a filesystem sandbox.

## Requirements and validation

- Node.js `^22.19.0 || >=24.0.0`.
- A local dsh installation and an existing host profile. The recorded native compatibility baseline is dsh `0.2.1-rc.2`.
- `pnpm` on `PATH` for `dsh plugin add/remove`.
- A running dsh web/desktop host with this plugin loaded before connecting Qoder.

The [CI run for commit `357d9e3`](https://github.com/lightporta/qoder-dsh-connect/actions/runs/40723142017) passed tests and static checks in all six combinations of Ubuntu, Windows, and macOS with Node 22/24. The suite contains 85 tests; platform-specific symlink cases are skipped on Windows. These tests use fake dsh processes and local HTTP fixtures. Native model execution and Desktop integration have separate validation requirements.

On macOS Desktop, the CLI is packaged in Electron's `app.asar`; automatic discovery of that launcher is currently unsupported. See [Desktop installation](docs/en/install-desktop.md) before configuring a Desktop host.

## Quick start

Run the shell examples in macOS/Linux or Windows Git Bash. On Windows, use an absolute path such as `C:/path/to/qoder-dsh-connect`; on macOS/Linux, use `/absolute/path/to/qoder-dsh-connect`.

```bash
dsh --version
pnpm --version
```

### 1. Back up the host profile

Stop any host using the target profile before installing or changing plugins.

```bash
qdc_profile_dir="${DSH_HOME:-$HOME/.dsh}/profiles/web"
qdc_backup_dir="${DSH_HOME:-$HOME/.dsh}/backups/$(date +%Y%m%d-%H%M%S)-qoder-connect"
mkdir -p "$qdc_backup_dir"
for file in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
  if [ -f "$qdc_profile_dir/$file" ]; then
    cp "$qdc_profile_dir/$file" "$qdc_backup_dir/"
  fi
done
```

Back up these profile files only. Keep credential files, `.npmrc`, and tokens out of backups and Git.

### 2. Install the host plugin

```bash
qdc_repo_dir="/absolute/path/to/qoder-dsh-connect"
dsh plugin --profile web add "file:$qdc_repo_dir/packages/dsh-plugin-qoder-connect"
```

Use `file:` for a copied installation. For development, use `link:` instead and keep the checkout in place. A bare directory is treated as a link by pnpm. After changing a copied installation's source, remove and add the plugin again, then restart the host.

For a Desktop profile, use the Desktop CLI and `--profile desktop`; follow the [platform-specific guide](docs/en/install-desktop.md).

### 3. Start the host and check its status

```bash
dsh web --no-open
```

In another terminal, use the host's actual port:

```bash
curl -s http://127.0.0.1:3080/api/qoder-dsh-connect/status
```

Expect `"plugin":"qoder-dsh-connect"` and `"ready":true`. If the host or plugin requires authentication, supply the token from your local configuration. `/status` reports how the dsh JavaScript entry was resolved; an unresolved entry requires an explicit plugin `bin` setting.

See [Web installation](docs/en/install-web.md) for configuration, checks, and removal.

### 4. Connect Qoder through MCP

Add this to Qoder's MCP settings and replace the paths and URL:

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
        "QODER_DSH_CONNECT_URL": "http://127.0.0.1:3080"
      }
    }
  }
}
```

If a token is required, provide `QODER_DSH_CONNECT_TOKEN` in your local MCP environment. [examples/mcp.json](examples/mcp.json) and [examples/client.json](examples/client.json) are templates; keep actual tokens out of the repository.

The same client is available as a CLI. Run these from the repository root:

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs status
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run "Reply with: received"
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run - < task.md
```

Task commands invoke Harness and may consume model usage. Status, documentation checks, and the automated test suite do not invoke a real model.

### 5. Install the Qoder Skill

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs skill install
```

The default destination is `~/.qoder-cn/skills/qoder-dsh-connect`. Use `--dest` for a different Skills directory. The Skill describes delegation, market research, lab operations, and learning exports.

## Plugin and Skill lab

The lab is disabled by default. Enable it explicitly and allowlist an existing experimental profile in the host profile's `cordis.patch.yml`:

```yaml
- id: qoder-dsh-connect
  config:
    lab:
      enabled: true
      profiles:
        - qoder-lab
      currentProfile: web
      allowCurrentProfile: false
```

The workflow is:

1. `dsh_lab_scaffold`: generate a plugin bundle or Skill under the lab directory.
2. `dsh_lab_check`: validate metadata, entry files, patch structure, and path boundaries.
3. `dsh_lab_install`: back up four profile configuration files, then install the checked plugin into an allowlisted profile.
4. `dsh_lab_verify`: pass the expected plugin `name` to check its enabled top-level configuration entry; optionally use `boot:true` to probe a temporary web host.
5. `dsh_learn` / `dsh_export`: record findings and export a digest.
6. `dsh_lab_uninstall` / `dsh_lab_restore`: remove the experimental plugin or restore the saved profile files.

Configuration presence and host reachability are reported as distinct verification scopes. They do not establish runtime plugin activation. Lab writes are serialized; commands use the same `DSH_HOME` that was checked and backed up. Restore also removes configuration files that did not exist in the original backup.

The currently running host profile is refused unless `allowCurrentProfile:true` is explicitly configured. See [the lab guide](docs/en/lab.md) for exact checks and rollback limits.

## Market research

There is no default index URL. Configure sources explicitly:

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

The market supports format-1 and community `plugins.json` indexes, plus an optional host `pluginMarket` service. It normalizes names, descriptions, versions, capabilities, and install targets. For raw format-1 records, npm/Git install targets are derived from each version's `source`.

```bash
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market search --text workbuddy --limit 5
node packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market entry dsh-workbuddy-connect
```

Only configured sources are accepted unless `allowAdHocIndexes:true` is enabled. Responses have size and time limits; the cache retains at most 16 indexes. Market research is read-only. See [market formats and queries](docs/en/market.md).

## Security defaults

- Request sockets and Host headers must point to loopback. Cross-site markers and mismatched Origins are rejected; forwarded client addresses are never trusted.
- An optional token protects every route through Bearer, `x-qoder-token`, or query authentication.
- Processes use argument arrays and `shell:false`; task text travels through stdin.
- Requests, prompts, output lines, diagnostic tails, waits, and market responses have limits.
- Timeouts, explicit cancellation, and plugin disposal terminate process trees. POSIX uses process groups; Windows invokes `taskkill /T /F` first.
- The lab requires explicit enablement, profile allowlists, path checks, and backups. It backs up profile configuration rather than credential files.

Delegated Harness processes retain the host's real permissions. Ledgers can contain task text, tool inputs/outputs, and answers, so protect the ledger directory as local sensitive data. See the [security model](docs/en/security.md) and [security policy](SECURITY.md).

## Development

```bash
npm test       # Unit/integration tests with fake dsh; no model calls
npm run check  # Syntax, metadata, patch, Skill frontmatter, and unsafe-pattern checks
```

Optional manual commands:

```bash
npm run smoke                     # Real headless Harness; consumes model usage
npm run smoke:live -- http://127.0.0.1:3080  # E2E against a running host
```

The host plugin is a host-only bundle with no injected frontend assets. If the host's jobs service is unavailable, `jobMirror` reports the reason and delegation remains available.

```text
packages/dsh-plugin-qoder-connect/  Host plugin, engine, routes, market, lab, tests
packages/qoder-dsh-connect-cli/    CLI, stdio MCP, HTTP client, bundled Qoder Skill
docs/en/                          English installation and reference guides
docs/                             Chinese guides and the audit record
examples/                         MCP, client, and profile templates
scripts/                          Test runner and static checks
```

## Documentation

- [Web installation](docs/en/install-web.md) · [Desktop installation](docs/en/install-desktop.md)
- [HTTP API](docs/en/api.md) · [MCP and CLI](docs/en/mcp.md)
- [Lab](docs/en/lab.md) · [Market research](docs/en/market.md)
- [Architecture](docs/en/architecture.md) · [Security model](docs/en/security.md)
- [Publishing](docs/en/publishing.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
- [简体中文文档](README.zh-CN.md)

## License

MIT. See [LICENSE](LICENSE).
