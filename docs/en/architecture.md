[English](../../README.md) | [简体中文](../architecture.md)

# Architecture

The project has a dsh host plugin and a Node CLI/stdio MCP client. The client talks to one loopback HTTP API; delegation, market research, and lab workflows share that interface. Both packages use Node built-in modules and have no runtime dependencies.

## Components

```text
packages/dsh-plugin-qoder-connect    dsh host-only plugin bundle
  lib/index.js                       composes store, engine, market, lab, routes
  lib/protocol.js                    API paths, defaults, budgets
  lib/loopback.js                    loopback fence and token checks
  lib/engine.js                      headless child lifecycle
  lib/process-tree.js                POSIX process groups / Windows taskkill
  lib/events.js                      JSON event aggregation and compact rendering
  lib/store.js                       NDJSON ledgers and event logs
  lib/market.js                      sources, normalization, bounded HTTP cache
  lib/lab.js                         scaffold, check, install, verify, restore
  lib/routes.js                      /api/qoder-dsh-connect HTTP routes
  lib/digest.js                      learning validation and Markdown export
packages/qoder-dsh-connect-cli       Node CLI, HTTP client, and stdio MCP server
  skill/qoder-dsh-connect             bundled Qoder Skill
```

The host bundle injects no frontend UI and requires no client asset build. See [MCP and CLI](mcp.md) and the [HTTP API](api.md).

## Delegation lifecycle

```text
Qoder / CLI / MCP
  │ POST /runs {task, cwd?, sessionId?, timeoutMs?, label?, wait?}
  ▼
routes → engine.start
  │ validate input, response options, cwd, timeout, concurrency
  │ allocate run ID; optionally mirror to the host jobs registry
  │ spawn(node, [dsh/bin.js, --profile, headless, --json, ...resumeArgs, -])
  │ task → child.stdin
  ▼
newline-delimited child stdout
  ├─ events.fold → counters, usage, session, final text
  ├─ events.compact → progress tail and optional job output
  └─ store.appendEvent → raw event log
  ▼
child close
  │ settle completed / failed / killed; record timeout if applicable
  │ release concurrency slot and wake long-poll waiters
  │ enqueue complete run record in runs.ndjson
  ▼
GET /runs/<id> → current or settled run view
```

The official headless driver composes the real Agent, credentials, tools, and permission policy in a separate process. This keeps long execution out of the serving host's main task flow and provides a target for cancellation. It is process separation rather than an OS sandbox: the child inherits the host environment and authority.

CLI discovery tries the configured entry, the real path of the host entry (including npm symlinks), and local module resolution. The entry must be loadable by the current Node runtime. Desktop carriers using Electron/app.asar can require explicit setup; source-level contract checks are not proof that every carrier works.

### Events, results, and usage

The expected event vocabulary is `session`, `status`, `thinking`, `text`, `tool_call`, `tool_result`, and `final`. Unknown/non-object JSON values are tolerated. Invalid JSON becomes a raw diagnostic event. Oversized stdout lines are discarded whole until the next newline; parsing then resumes.

`step_end.usage` reports per-step usage, so the bridge sums input, output, cache-read, cache-write, reasoning, and total tokens. A `final` event supplies the answer; text events also build a bounded fallback buffer.

Ordinary HTTP views project task/result text to 2000/32768 characters. `full=1` returns complete retained strings; settled ledger records preserve the full task and accepted result. The Markdown digest applies its own display limits. Full output is still subject to the engine's line and buffer budgets.

### Session resumption

Passing a non-blank `sessionId` adds `--session-id <id>` before the stdin task argument. The returned session ID prefers the requested resume ID, otherwise the stream's `session` event. dsh decides whether the persisted session can be adopted; its working directory, ownership, and preset restrictions still apply. Omit the field when starting a new session.

### Cancellation and optional jobs

Wall-clock timeout, explicit kill, and plugin unload terminate the child process tree. POSIX uses a detached process group with SIGTERM/SIGKILL escalation that survives early leader exit. Windows invokes `taskkill /T /F` first. A killed run settles when the child closes.

The host job registry is an optional mirror. An absent/disabled registry appears in `jobMirror` and does not prevent delegation. MCP transport notifications do not automatically cancel runs; clients call the explicit kill tool.

## Market research

```text
GET /market/sources
  ├─ explicitly configured HTTP indexes
  └─ optional ctx.get('pluginMarket').listIndexes()

GET /market/search or /market/entry
  ├─ HTTP source → bounded fetch/cache → format detection → normalization
  └─ host source → pluginMarket service → host normalization
```

No index URL is hardcoded. Configured HTTP sources and host sources can coexist; ad-hoc URLs require an explicit option. Operations are read-only, and `full=1` includes the original record.

Official format-1 version sources are preserved and used to derive supported npm or pinned Git install targets. Community indexes and host listings are normalized into shared fields. Invalid entries are skipped while preserving the association between each normalized entry and its raw record. The HTTP cache expires entries by TTL and is bounded to 16 indexes.

See [market research](market.md).

## Lab lifecycle

```text
scaffold → lab/plugins/<name> or lab/skills/<name>
check    → static metadata, patch, entry, and path checks
install  → back up profile files → dsh plugin add file:/link:
verify   → dump-config → optional temporary boot + GET + stop
restore  → validate backup → pre-restore backup → restore existence/content
```

The lab defaults to disabled. Profile operations require an allowlist, and the current host profile and aliases of it are refused by default. Candidate paths must stay inside the lab directory; filesystem containment is checked before forced scaffold writes, entry reads, and profile restoration.

Static checks do not execute candidate code. Installation requires a passing plugin report. Profile changes use the dsh CLI with `DSH_HOME` explicitly set to the same resolved `lab.dshHome` used for validation and backup paths.

Scaffold, install, uninstall, restore, and verify share a per-instance serial queue. Verification first checks enabled top-level configuration IDs. An explicit `name` selects the expected plugin; otherwise the journal can supply the latest successful install not later removed. After a restore, or without an inferred candidate, verification covers profile configuration only.

Boot verification additionally starts a temporary web-capable profile, probes its advertised URL, and waits for process shutdown. A cleanup failure blocks subsequent serialized operations until restart. Configuration presence and host reachability are narrower claims than runtime activation of the plugin.

Install and uninstall back up four profile configuration files; restore first validates sources and destinations and takes a further backup. It restores file contents and original existence, deleting newly added files absent from the selected backup. Dependency directories and package stores are not included. See [lab](lab.md) and [security](security.md).

## Persistence

```text
~/.qoder-dsh-connect/
├─ runs.ndjson           settled run records, retaining the latest configured N
├─ learnings.ndjson      learning records
├─ runs/<id>.ndjson      raw events
└─ lab/                 candidate source, skills, and ops.ndjson

<dshHome>/backups/<timestamp>-qoder-connect-<profile>-<random>/
```

The store queues writes to avoid interleaving within one instance. Reads wait for previously queued writes; ledger trimming uses a temporary file and rename. The reader skips malformed NDJSON records before applying the count limit. Learning topic filtering also precedes the count limit, within the read budget.

Default retention is 200 run records and 500 learning records. Event-tail reads are bounded to 512 KiB, ledger reads to 8 MiB, and trimming reads to 32 MiB. Ledger retention counts do not automatically prune individual event-log files. These queues do not provide a lock across unrelated host processes.

## Configuration and compatibility

Plugin configuration comes from the `qoder-dsh-connect` entry in the profile patch. Numeric values are clamped, and `maxTimeoutMs` is raised when needed to cover the configured default timeout. Defaults and HTTP limits are listed in the [API reference](api.md#default-budgets).

Optional `jobs` and `pluginMarket` services are read through `ctx.get()` at the point of use, allowing late service availability. The current host profile is selected from `lab.currentProfile`, then `--profile` in process arguments, then `web`.

The original implementation targeted dsh `0.2.1-rc.2`. Its installed CLI/headless source contracts informed this integration. Fake-child tests cover argv/stdin transfer, event handling, process lifecycle, HTTP, MCP, and lab behavior without model calls. The [CI for commit `357d9e3`](https://github.com/lightporta/qoder-dsh-connect/actions/runs/40723142017) passed all six OS/Node jobs, including native Windows runners. Real Harness model execution and Desktop integration remain separate checks. After a dsh upgrade, repeat the checks in [installation](install-web.md) and recheck event and market formats.
