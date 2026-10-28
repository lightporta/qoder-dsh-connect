# qoder-dsh-connect — host plugin

[English](README.md) | [简体中文](README.zh-CN.md)

Turn a local DeepSeek Harness (dsh) host into a Qoder sub-agent, a plugin-market research source, and a guarded plugin/skill lab. This is the host package in the `qoder-dsh-connect` monorepo; its source directory is `packages/dsh-plugin-qoder-connect`.

The [Qoder CLI and stdio MCP server](../qoder-dsh-connect-cli/README.md) connect to this plugin over loopback HTTP. The client package also includes the Qoder Skill. Both packages use only Node built-in modules.

## Installation

Install dsh and ensure `pnpm` is on PATH before running `dsh plugin add/remove`. Stop the host using the target profile before changing its installation.

```bash
# Development: link to the working copy.
dsh plugin --profile web add "link:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"

# Copy installation: replace the linked package with a local file package.
dsh plugin --profile web remove qoder-dsh-connect
dsh plugin --profile web add "file:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
```

Use your actual absolute path; on Windows, for example, use `file:C:/path/to/…`. Always specify `--profile`. Restart the host after installation and check that `dsh --profile web --dump-config` contains a `qoder-dsh-connect` entry. `/status` must also report `ready: true` before delegation can run.

Desktop uses the app's bundled CLI and `desktop` profile. Its launch and packaging requirements differ from Web; see the [Web](../../docs/en/install-web.md) and [Desktop](../../docs/en/install-desktop.md) installation guides.

## HTTP API

All endpoints are relative to `/api/qoder-dsh-connect` and require loopback access. Setting the plugin's `token` adds shared-token authentication through Bearer, `x-qoder-token`, or the query token.

| Method | Path | Purpose / parameters |
| --- | --- | --- |
| GET | `/status` | Engine readiness, concurrency, market, lab, and integrations |
| POST | `/runs` | Delegate `{ task, cwd?, sessionId?, timeoutMs?, label?, wait? }` |
| GET | `/runs` | List recent runs; `?limit=&live=1` |
| GET | `/runs/<id>` | Read or long-poll; `?wait=&tail=&full=1&raw=1` |
| GET | `/runs/<id>/log` | Tail raw ndjson events; `?limit=&compact=1` |
| POST | `/runs/<id>/kill` | Stop a live run; `{ reason? }` |
| GET/POST | `/learnings` | Read or append learning notes; reads accept `?topic=&limit=` |
| GET | `/export` | Markdown ledger digest; `?topic=&results=1&limit=` |
| GET | `/market/sources` | Configured market sources |
| GET | `/market/search` | `?source=&url=&text=&category=&sort=&offset=&limit=&refresh=1&full=1` |
| GET | `/market/entry` | `?name=&source=&url=&refresh=1&full=1` |
| GET | `/lab` | Lab policy and directories |
| GET | `/lab/ops` | Operation journal; `?limit=` |
| POST | `/lab/scaffold` | `{ kind, name, description?, force? }` |
| POST | `/lab/check` | `{ path }` |
| POST | `/lab/install` | `{ path, profile, mode? }` |
| POST | `/lab/uninstall` | `{ name, profile }` |
| POST | `/lab/restore` | `{ backupId, confirm }` |
| POST | `/lab/verify` | `{ profile, name?, boot? }` |

Delegation returns `200` when settled within the requested wait, or `202` with a live run id. Waits are capped at 120,000 ms. A failed child run is represented by its run status. Run views sum token usage across `step_end` events, including `reasoningTokens`; the ledger preserves full tasks and results while ordinary API views project large values. See the [API reference](../../docs/en/api.md) for response shapes, limits, and errors.

## Configuration

Add `config` to the plugin entry in the profile's `cordis.patch.yml`. All fields are optional; the following shows defaults and an example current host profile.

```yaml
- id: qoder-dsh-connect
  config:
    profile: headless
    bin: ''                       # Explicit dsh JavaScript CLI entry; blank enables discovery.
    dir: ''                       # Default: ~/.qoder-dsh-connect
    concurrency: 2
    timeoutMs: 900000
    maxTimeoutMs: 3600000
    tailLines: 60
    retainRuns: 200
    retainLearnings: 500
    token: ''                     # Optional plugin shared token.
    market:
      indexes: []                 # Explicit index URLs; no default source.
      preferHost: true
      allowAdHocIndexes: false
      timeoutMs: 15000
      cacheMs: 300000
      maxBytes: 4194304
    lab:
      enabled: false
      dir: ''                     # Default: <dir>/lab
      profiles: []                # Allowlist of profiles the lab may modify.
      allowCurrentProfile: false
      currentProfile: web         # Set to the actual host profile; otherwise auto-detected.
      dshHome: ''                 # Default: $DSH_HOME or ~/.dsh
      bin: ''                     # Default: the engine's resolved JavaScript entry.
      timeoutMs: 180000
```

CLI discovery tries `bin`, the host's real filesystem CLI entry, then module resolution of `@deepseek-ai/dsh/lib/bin.js`. Supply a JavaScript entry rather than a `.cmd`, `.bat`, or shell wrapper. `/status` reports the resolved path and discovery source. Electron/app.asar Desktop entry discovery has additional limits described in the installation guide.

## Market and lab behavior

Market indexes have no default URL. The plugin reads configured format-1/community indexes or an available host `pluginMarket` service. Ad-hoc URLs require `allowAdHocIndexes: true`; HTTP caching is bounded to 16 indexes. Market queries are read-only, and listed capabilities or popularity are not a security endorsement. With no source, `/market/search` returns `409` while `/market/sources` remains available. See [market research](../../docs/en/market.md).

The lab starts disabled. Enable it and explicitly allowlist target profiles before writing. Installation accepts statically checked plugin directories within the lab; it backs up four profile configuration files before installation or removal. Operations that change lab/profile state are serialized, and modifying the current host profile or its alias is refused by default. Restore also removes configuration files that were absent in the selected backup; `confirm` must equal `backupId`. Backups do not include `node_modules` or the pnpm store.

For `verify`, pass `name` to check a specific plugin id. Without it, the lab infers the latest installed plugin from up to 500 recent operations, or checks only profile configuration when none can be inferred. Results expose `expected`, `missing`, and `verificationScope`. `boot: true` adds a temporary host reachability check and waits for shutdown; configuration presence and reachability do not prove runtime plugin activation. See the [lab guide](../../docs/en/lab.md).

## Security and operating limits

- Child processes inherit the host's real model credentials, tools, environment, and permissions. Process separation is not an OS sandbox; submit trusted tasks.
- Requests require a loopback socket and Host, with same-origin checks when Origin is present. This is not a security boundary between local users. The plugin token is configured separately from the host's launch token.
- Tasks travel through stdin; subprocesses use argument arrays without a shell. Request bodies, output buffers, timeouts, and concurrency are bounded.
- Timeout, explicit kill, and plugin unload terminate process trees. POSIX uses a process group with SIGTERM followed by SIGKILL; Windows first invokes `taskkill /T /F`.
- Runs use the configured `headless` profile by default and do not automatically load the Web/Desktop profile's third-party plugins. The headless profile still supplies real credentials and tool policy.
- The Web profile commonly disables top-level `tool-jobs`; job mirroring can degrade while delegation continues. Enable it explicitly in the profile if needed.
- Run ids are held in host memory and become unavailable through run lookup after restart. Persisted ledgers remain available for export. Tasks, results, and tool events may contain sensitive user data.
- Path and symlink checks protect the configured lab boundaries; they do not provide a filesystem sandbox against concurrent external file replacement.

See the [security model](../../docs/en/security.md) and [architecture](../../docs/en/architecture.md).

## Development and validation

Requires Node `^22.19.0 || >=24.0.0`.

```bash
# Run from the repository root; no dependency installation is required.
npm run test:host
npm run check

# Run from this package directory; these contact a real dsh runtime.
node test/smoke.mjs [dsh-bin.js]
node test/live.mjs http://127.0.0.1:3080
```

CI covers Node 22/24 on Linux, Windows, and macOS using fake dsh child processes and local HTTP fixtures. These tests validate the bridge without model calls; they do not establish real Desktop E2E behavior or OS sandboxing. The real smoke script consumes a model call, and live E2E requires a running host.
