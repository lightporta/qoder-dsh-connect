[English](../../README.md) | [简体中文](../api.md)

# HTTP API

The API root is `/api/qoder-dsh-connect`. Responses are JSON unless noted: `/export` returns Markdown, and `/runs/<id>/log` returns newline-delimited output. All paths below are relative to the API root.

## Access and errors

The socket address must be IPv4 loopback (`127.0.0.0/8`), `::1`, or IPv4-mapped loopback. `Host` must identify `localhost` or a loopback address. Cross-site fetch markers are rejected; an `Origin`, when present, must match the host's scheme and authority. `X-Forwarded-For` is never trusted.

If a plugin token is configured, every route also requires `Authorization: Bearer <token>`, `x-qoder-token: <token>`, or `?token=<token>`. See the [security model](security.md).

Errors normally have this shape:

```json
{ "error": "human-readable reason" }
```

| HTTP status | Meaning |
| --- | --- |
| 200 | Successful read, settled run view, or completed control operation |
| 201 | Learning record or scaffold created |
| 202 | Run is still active after the requested wait |
| 400 | Invalid JSON, non-object request body, invalid parameter, or invalid working directory |
| 401 | Missing or incorrect token |
| 403 | Loopback fence rejected the request, or lab policy/path checks refused it |
| 404 | Unknown run, path, plugin, or backup |
| 405 | Unsupported HTTP method |
| 409 | No market source configured, or scaffold already exists without `force` |
| 413 | Request body or task exceeds its limit |
| 429 | Run concurrency limit reached |
| 502 | Market fetch/read/size validation, lab command, or another upstream operation failed |
| 503 | Required dsh CLI or host service is unavailable |

Failed `lab.install`, `lab.uninstall`, and `lab.verify` operations can return `502` with an `ok:false` report and command diagnostics. A sub-agent that exits unsuccessfully is represented by a run with `status:"failed"`; reading that settled run still returns `200`.

## Default budgets

| Setting | Default |
| --- | --- |
| Child profile | `headless` |
| Run timeout / maximum requested timeout | 900000 / 3600000 ms |
| Concurrent runs / maximum HTTP wait | 2 / 120000 ms |
| Compact tail / retained run summaries / retained learning records | 60 / 200 / 500 |
| Market fetch timeout / cache TTL / response size | 15000 ms / 300000 ms / 4 MiB |
| Lab command timeout | 180000 ms |

JSON body limits are 64 KiB for run creation, 8 KiB for run controls, 256 KiB for learning records, and 16 KiB for lab operations. Text limits below use JavaScript string length; request and market response budgets use bytes.

## Status

### `GET /status`

`GET /` is an alias. The response includes:

```json
{
  "plugin": "qoder-dsh-connect",
  "version": "0.1.0",
  "ready": true,
  "host": { "host": "127.0.0.1", "port": 3080 },
  "engine": { "bin": "…/dsh/lib/bin.js", "source": "host-entry", "profile": "headless" },
  "auth": { "mode": "loopback" },
  "limits": { "concurrency": 2, "liveRuns": 0, "timeoutMs": 900000, "maxTimeoutMs": 3600000, "maxWaitMs": 120000 },
  "market": { "available": true, "hostAvailable": false, "sourceCount": 1 },
  "lab": { "enabled": false, "profiles": [], "currentProfile": "web", "dir": "…" },
  "integrations": { "jobs": "object", "pluginMarket": "absent", "webServer": "object" },
  "ledger": { "dir": "…" },
  "endpoints": ["GET  /status", "…"]
}
```

`ready` indicates that the engine resolved a CLI entry; it does not confirm a model request succeeded.

## Runs

### `POST /runs`

```json
{
  "task": "Required task text",
  "cwd": "/absolute/path/to/project",
  "sessionId": "session-to-resume",
  "timeoutMs": 900000,
  "label": "Optional short label",
  "wait": 110000
}
```

- `task`: non-blank string, at most 61440 characters.
- `cwd`: optional existing absolute directory; defaults to the host working directory.
- `sessionId`: optional non-blank string, at most 512 characters. Omit it for a new session. dsh also enforces session ownership, working-directory, and preset compatibility.
- `timeoutMs`: optional finite number, at least 1000 ms; capped by `maxTimeoutMs`.
- `label`: optional; trimmed and capped at 200 characters.
- `wait`: optional wait budget. `?wait=<ms>` overrides the body value. The default is zero and the maximum is 120000 ms.

Run and response parameters are validated before starting the child. Completion within the wait returns `200`; otherwise the response is `202` with the current run view. A full concurrency slot returns `429`.

### `GET /runs`

Parameters: `limit` (default 20, maximum 100) and `live=1`. Returns `{count, live, runs}` for runs created by this host process, newest first. Live filtering occurs before the count limit. `limit=0` returns an empty list.

### `GET /runs/<id>`

Parameters: `wait=<ms>`, `tail=<n>`, `full=1`, and `raw=1`.

- Long polling is capped at 120000 ms; an active run returns `202`.
- `tail` defaults to the configured tail length and is capped at 1000; zero omits it.
- `raw=1` omits the compact `tail` field; it does not turn the response into raw event JSON.
- `full=1` returns complete retained `result` and `task` strings. Default views project them to 32768 and 2000 characters respectively, with an ellipsis when truncated. The run ledger stores both full strings accepted by the engine.

| Run view fields | Meaning |
| --- | --- |
| `id`, `label`, `status` | Identity and `running`, `completed`, `failed`, or `killed` |
| `task`, `taskChars`, `result`, `resultChars` | Task/result projections and original string lengths |
| `cwd`, `profile`, `pid`, `jobId` | Child execution context and optional job identity |
| `createdAt`, `startedAt`, `finishedAt`, `durationMs` | Timestamps and duration in milliseconds |
| `exitCode`, `signal`, `detail`, `timedOut` | Process outcome and explanation |
| `sessionId`, `resumed` | Current session identity and requested resume identity |
| `counts` | `events`, `turns`, `steps`, `toolCalls`, `toolErrors` |
| `usage` | Sum of reported per-step input, output, cache-read, cache-write, reasoning, and total tokens |
| `endReason`, `tail` | Reported turn-end reason and compact progress lines |
| `jobMirror` | `{attached:true, id}` or `{attached:false, reason}` |
| `stderrTail` | Redacted child stderr tail, capped at 4096 characters |

### `GET /runs/<id>/log`

Parameters: `limit` (default 200, maximum 5000; zero returns no lines) and `compact=1`. Returns the raw event tail as `application/x-ndjson`; compact mode renders readable progress lines instead of JSON records. Reads have a 512 KiB tail budget.

### `POST /runs/<id>/kill`

```json
{ "reason": "killed by the caller" }
```

The optional reason is capped at 200 characters. Returns `{ "id": "…", "admission": "requested" }` or `"already-finished"`. Poll the run to observe its final status.

## Learning records and export

### `GET /learnings`

Parameters: `limit` (default 50, maximum 500; zero returns none) and optional `topic`. Returns `{count, learnings}`, newest first. Topic filtering happens before selecting the latest `limit` records, within the ledger's 8 MiB read budget.

### `POST /learnings`

```json
{
  "title": "Required title",
  "body": "Required Markdown or plain text",
  "topic": "general",
  "tags": ["optional-tag"],
  "source": "run id or URL"
}
```

`title` is non-blank and at most 200 characters; `body` is non-blank and at most 65536. Up to 10 string tags are accepted, each at most 40 characters. Topic defaults to `general` and is capped at 80 characters; source is capped at 200. Returns `201` with `{id, at, topic, title, body, tags, source?}` after persistence. A failed write is reported as an error.

### `GET /export`

Parameters: `topic`, `results=1`, and `limit` (default 50, maximum 500). Returns `text/markdown`. Topic filtering applies to learning records before the count limit; it does not filter runs. The digest renders up to 4000 task characters and, with `results=1`, up to 32768 result characters per run. The ledger itself retains the full task and accepted result.

## Market

### `GET /market/sources`

Returns `{available, preferHost, hostAvailable, sources}`. Each source includes `id`, `kind`, `url`, and optional `title`. `/market/indexes` is a compatibility alias.

### `GET /market/search`

Parameters: `source`, `url`, `text`, `category`, `sort`, `offset` (default 0, maximum 100000), `limit` (default 20, 1–100), `refresh=1`, and `full=1`.

`url` must select a configured source unless `market.allowAdHocIndexes=true`. Results contain normalized entries such as `name`, `title`, `description`, `author`, `homepage`, `repository`, `category`, `keywords`, `labels`, `install`, `source`, `defaultVersion`, `versions`, `stars`, `downloads`, and `capabilities`, where available. `full=1` includes the original record. See [market research](market.md).

### `GET /market/entry`

Parameters: required `name`, optional `source`, `url`, `refresh=1`, and `full=1`. Returns `404` when the selected index does not list that plugin.

## Lab

Except for `GET /lab`, lab endpoints require `lab.enabled=true`. Profile operations also require an allowlisted profile; the active host profile and aliases of it are refused by default. Candidate paths must remain inside the lab directory. Lab commands receive `DSH_HOME` set to the same resolved `lab.dshHome` used for profile checks and backups. See the [lab workflow](lab.md).

### `GET /lab`

Returns `{enabled, dir, dshHome, currentProfile, profiles, allowCurrentProfile, bin}`. Status can be read while the lab is disabled.

### `GET /lab/ops`

`?limit=1..500` (default 50). Returns `{count, ops}` with the newest journal entries first.

### `POST /lab/scaffold`

```json
{ "kind": "plugin", "name": "my-plugin", "description": "Demo plugin", "force": false }
```

`kind` is `plugin` or `skill`. Existing output without `force:true` returns `409`. Returns `201` with the generated `path`, file list, and static `check` report. Existing output paths are checked before forced writes.

### `POST /lab/check`

```json
{ "path": "/absolute/path/to/lab/plugins/my-plugin" }
```

Returns a static plugin or skill check report. Candidate code is not executed by this check.

### `POST /lab/install`

```json
{ "path": "/absolute/path/to/lab/plugins/my-plugin", "profile": "qoder-lab", "mode": "file" }
```

`mode` is `file` (default, copy install) or `link`. A passing plugin check is required. Before installation, the host backs up `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `cordis.patch.yml`. The report includes `ok`, `backup`, `command`, exit code, stdout/stderr tails, and the check report.

### `POST /lab/uninstall`

```json
{ "name": "my-plugin", "profile": "qoder-lab" }
```

Creates a backup before removing the package and returns command diagnostics.

### `POST /lab/verify`

```json
{ "profile": "qoder-lab", "name": "my-plugin", "boot": false }
```

With `boot:false`, runs `dsh --profile <profile> --dump-config`. Returns `configured` top-level enabled IDs, `expected`, `missing`, `warnings`, `verificationScope`, and `ok`. An explicit `name` must be present among those IDs or verification fails.

If `name` is omitted, the lab reads the latest 500 journal entries and filters them for that profile to infer its latest successful install not subsequently uninstalled. A restore ends that inference history. If no candidate can be inferred, the scope is only `profile-configuration`; pass `name` when checking a particular plugin.

With `boot:true`, configuration must pass first. The lab then starts `dsh --profile <profile> --no-open --port 0`, parses the advertised web URL, issues a GET, and terminates the temporary process tree before returning. The profile must include the web app/web server. `stopped` reports cleanup. Failed cleanup blocks further serialized operations until restart. Configuration presence and host reachability do not prove that the candidate plugin activated at runtime.

### `POST /lab/restore`

```json
{ "backupId": "20261020-120000-qoder-connect-qoder-lab-abc123", "confirm": "20261020-120000-qoder-connect-qoder-lab-abc123" }
```

`confirm` must exactly match `backupId`. The lab validates backup sources and profile destinations, then backs up the current state before restoring the four profile files. Files absent from the selected backup are removed and listed in `removed`. Dependencies and package stores are outside the backup scope.

## In-process plugin service

Other dsh plugins can inject `qoder-dsh-connect` and consume its service:

```js
const api = ctx.get('qoder-dsh-connect')
api.ready()
await api.run({ task, cwd, sessionId, timeoutMs, label }, waitMs)
api.get(id)
api.list(limit)
api.kill(id, reason)
api.market
api.lab
api.store
```

Consumers should tolerate the service being absent. The [architecture](architecture.md) describes lifecycle and storage behavior.
