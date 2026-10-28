[English](../../README.md) | [简体中文](../security.md)

# Security model

The bridge gives local clients access to dsh delegation, read-only market research, and explicitly enabled lab operations. Delegated children inherit the host's environment, credentials, tools, and permission policy. Use it for trusted tasks.

## Assets and trust boundaries

Protected assets include model credentials and tool access, dsh profile configuration and installed plugins, local run and learning ledgers, and experimental plugin source.

```text
Qoder / local process
  │ loopback HTTP + optional token
  ▼
dsh host plugin (web / desktop profile)
  ├─ headless child with real credentials and tools
  ├─ read-only market HTTP fetches
  └─ lab operations on allowlisted profiles
```

The plugin provides a controllable local entry point, progress reporting, and configuration backups. It is not an operating-system sandbox or a permission boundary between local users. A local process that already has account access can launch dsh directly.

## Loopback fence

- The socket address is authoritative: only `127.0.0.0/8`, `::1`, and IPv4-mapped loopback are accepted.
- `Host` must identify a loopback address or `localhost`; malformed authorities and embedded credentials are rejected.
- `sec-fetch-site: cross-site` is rejected.
- If `Origin` is present, its scheme and authority must match the request host.
- `X-Forwarded-For` is never used to establish trust.

The fence prevents exposing autonomous-agent controls directly to the LAN. It does not defend against a malicious process already running under the local account.

## Authentication and diagnostics

An optional plugin token protects every route through a Bearer header, `x-qoder-token`, or a query token. Equal-length comparisons use `timingSafeEqual`.

Use the address supplied by the running host when it has its own token gate. The client supports token-bearing URLs and sends both a Bearer header and a query token. Keep configuration containing tokens out of Git; host or proxy access logs may retain request URLs.

The bridge does not intentionally persist authentication tokens in its ledger or print them as client configuration. Diagnostic redaction covers recognized query-token, Bearer, shared-token-header, and `sk-` API-key patterns. It is not a general detector for every possible secret. Raw tasks and tool events can still contain sensitive user-provided data.

## Child processes and limits

- Children start with `spawn(process.execPath, [bin, ...args], {shell:false})`.
- Task text travels through stdin instead of shell commands or argv.
- The engine uses the configured child profile (`headless` by default), task working directory, and inherited host environment. It does not create an isolated temporary profile.
- Request bodies, task strings, stdout lines, stderr tails, progress tails, and market responses have explicit limits; see the [API budgets](api.md#default-budgets).
- Malformed or non-object JSON event values do not crash the host. A stdout line over 1 MiB is discarded through its next newline and recorded as an output-discard event.
- Timeout, explicit kill, and plugin unload request process-tree termination. POSIX children use a detached process group: SIGTERM is followed by SIGKILL even if the group leader exits first. Windows uses `taskkill /pid <pid> /T /F` before killing the leader, with a direct-child fallback when unavailable.

POSIX descendants that deliberately create a new session/process group can escape group signals. Process separation helps lifecycle control; it does not reduce the child's filesystem or tool authority.

## Market research

- Sources must be explicitly configured; `allowAdHocIndexes` defaults to false.
- Index URLs must use HTTP(S) and cannot contain embedded credentials.
- Fetch timeouts, streamed response size, cache TTL, and cache entries are bounded. The HTTP cache holds at most 16 indexes.
- Market operations are read-only: they do not install packages or alter host configuration.
- External descriptions, links, `capabilities`, stars, and download counts are untrusted metadata rather than security assurances.

See [market research](market.md) for source selection and normalized fields.

## Lab safeguards

- The lab is disabled by default. Profile operations require an explicitly allowlisted target.
- The active host profile and filesystem aliases of it are refused unless `allowCurrentProfile:true` is explicitly configured.
- Candidate paths must remain inside the lab directory. Existing ancestors and real paths are checked, including forced scaffold writes; package entry paths cannot escape the candidate directory.
- A plugin must pass static checks before installation. These checks do not establish that executing its code is safe.
- Install and uninstall back up `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `cordis.patch.yml`. Restore validates backup contents and destinations and makes a further pre-restore backup.
- Restoring also removes those four files when they were absent from the selected backup. Regular-file checks reject redirected profile files.
- Lab child commands explicitly receive the same resolved `DSH_HOME` used for profile validation and backups, avoiding writes to a different dsh home.
- Scaffold, install, uninstall, restore, and verify operations are serialized within a lab instance. Boot verification waits for the temporary child to close; failed cleanup blocks further serialized operations until restart.
- The journal records operation results, exit codes, bounded diagnostics, and backup IDs. Backups exclude credential files, `.npmrc`, and authentication tokens.
- Verification returns configured plugin IDs and warnings rather than the complete `dump-config` output. Boot output and diagnostic URL/token patterns are redacted.

An explicit `verify.name` checks for an enabled top-level configuration entry. Without a name or an inferred recent install, verification covers only profile configuration. Boot verification adds host reachability. Neither configuration presence nor a successful GET proves runtime plugin activation. See the [lab workflow](lab.md).

## Scope and limitations

The bridge does not add remote access, a reverse proxy, or a `0.0.0.0` listener. It does not automatically enable a job controller, scan/upload credentials, or return the complete child environment.

Delegated tasks retain real host authority: malicious prompts or prompt injection can cause real file changes. Run ledgers preserve full task and accepted result strings; event logs preserve tool inputs/outputs. Protect these files as sensitive local data.

`link:` installations depend on the lab source directory remaining available. Configuration backups do not include `node_modules` or pnpm's shared store; restoring dependency contents may require additional user action. Lab serialization is local to one instance and does not coordinate unrelated processes editing profiles. Real-path checks do not create an OS isolation boundary against another process concurrently altering files.

dsh is a developer preview. Recheck CLI, event, and market contracts after upgrades. Tests using fake dsh children validate bridge behavior on CI runners, including Windows; real Harness model execution and Desktop integration require separate verification.

## Reporting a vulnerability

Avoid posting tokens, credentials, or exploit details in public issues. Contact the repository maintainer privately or use GitHub's private security advisory flow when available.
