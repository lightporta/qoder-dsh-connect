---
name: qoder-dsh-connect
description: Control a local DeepSeek Harness host as a sub-agent, research the dsh plugin market, and scaffold/check/install/verify dsh plugins or Qoder skills in a guarded lab. Use when Qoder should get a second opinion from Harness, test an immature tool or plugin before adopting it, learn from the plugin market, or file Harness learnings into QMind.
---

# Qoder × DeepSeek Harness

[English](SKILL.md) | [简体中文](SKILL.zh-CN.md)

Use the local DeepSeek Harness (dsh) host for three workflows:

1. Delegate to a headless sub-agent and receive its result, events, token usage, and session id.
2. Research plugin markets, compare versions, and inspect installation metadata.
3. Scaffold plugins or Skills, check them, install into an allowlisted lab profile, verify, and roll back.

## Prerequisites

- The `qoder-dsh-connect` host plugin is installed in a dsh Web or Desktop profile, and the host has restarted. Desktop has runtime-specific launch requirements.
- Qoder has the `qoder-dsh-connect` MCP server configured, or can run:

  ```bash
  node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs --help
  ```

  If `skill install` created `references/local-paths.md`, use its absolute CLI path instead of `<repo>`.
- Start with `dsh_status` or CLI `status`. Resolve `ready:false` before delegation.

## When to use it

- An independent second opinion, another model/tool perspective, or a long investigation outside the main context would help.
- An immature plugin or tool needs testing in a separate profile.
- You need to understand a market plugin's capabilities, dependencies, and risks.
- A Harness experiment should become a reusable QMind note or Qoder Skill.

For routine single-file changes and local refactors covered by existing tests, use the current tools directly. Respect a user's request not to call Harness. Obtain the required user authorization for production writes, deletion of shared state, or other actions outside the approved task.

## Safety rules

1. Use the lab workflow rather than directly editing dsh profile package files, lockfiles, or patches.
2. The lab starts disabled. Do not install or modify profiles while `lab.enabled=false`; enabling scaffold/check operations also requires the user's agreement to enable the lab.
3. Use a separate lab profile. The current host profile and its aliases are refused by default; do not change that policy without explicit user authorization.
4. Install only statically checked plugin directories within the lab. The lab is not a general npm installer.
5. Retain the `backup.id` returned by install/uninstall. Restore requires `confirm === backupId` and creates a `preRestoreBackup` before changing files.
6. Do not read, paste, or request model credential files, `.npmrc`, tokens, or cookies.
7. Keep the endpoint on loopback; do not expose it on `0.0.0.0` or try remote access.
8. Delegated tasks run with real host credentials, tools, and permissions. State the task scope, writable paths, and permitted commands explicitly. Process separation is not an OS sandbox.

## Workflow 1: delegate a task

Call `dsh_delegate`:

```json
{"task":"Inspect the project and report the smallest supported fix.","cwd":"/path/to/demo","label":"second-opinion","waitMs":110000}
```

Use an absolute working directory for the current machine; Windows paths such as `C:/work/demo` are supported. If the result is still `running`, poll its `id` with `dsh_run` and `waitMs`; use `dsh_kill` to stop it. Do not resubmit the same task while it is running.

CLI equivalent:

```bash
node "<repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs" run "Inspect the project" \
  --cwd "/path/to/demo" --label second-opinion --wait 110000
```

Pass a returned non-empty `sessionId` into the next delegation to continue the Harness session, for example from research to implementation.

Read the result with its evidence:

- `result` is the final answer; `tail` contains compact progress.
- `usage` sums per-step input/output/cache/reasoning/total token usage.
- `counts` helps establish whether tools actually ran; `completed` alone does not prove the requested outcome.
- `jobMirror.attached=false` means GUI job integration is unavailable, not that delegation failed.

POSIX termination uses a process group and escalates from SIGTERM to SIGKILL. Windows first invokes `taskkill /T /F` to stop the tree.

## Workflow 2: research a market

1. Use `dsh_market_sources`. If no source is configured, ask the user to add an explicit `market.indexes` entry; do not guess a URL.
2. Search with `dsh_market_search`, for example `{"text":"workbuddy","limit":10}`. Compare `name`, `description`, `author`, `install`, `stars`, `capabilities`, and `versions`.
3. Read an entry with `dsh_market_entry`; `full:true` includes the original index record. Treat external metadata as research, not a security endorsement.
4. Record capabilities, dependencies, risks, and the selection rationale with `dsh_learn`, using topic `plugin-market`. Export selected reusable findings to QMind with `dsh_export`.

```bash
node "<repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs" market search --text workbuddy --limit 5
node "<repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs" market entry dsh-workbuddy-connect
```

## Workflow 3: plugin or Skill lab

Check `dsh_lab_status`: `enabled` must be true and the target profile must be allowlisted.

### Plugin cycle

1. Scaffold: `dsh_lab_scaffold` with `{"kind":"plugin","name":"my-plugin","description":"..."}`. This creates a dsh bundle with package metadata, patch, source, and a smoke test.
2. Check: `dsh_lab_check` with `{"path":"<lab>/plugins/my-plugin"}`. Resolve all errors before installation.
3. Install: `dsh_lab_install` with `path`, `profile:"qoder-lab"`, and `mode:"file"`. Retain the returned `backup.id`.
4. Verify: `dsh_lab_verify` with `{"profile":"qoder-lab","name":"my-plugin"}`. If the profile includes a Web app, `boot:true` also checks a temporary host's reachability and shutdown.
5. Learn: record the outcome under `dsh-plugin-dev` or `plugin-market`.
6. Clean up: uninstall, or restore the saved backup with `confirm` equal to `backupId`.

Read `expected`, `missing`, and `verificationScope` before describing verification as successful. Omitting `name` infers the most recent successful installation not subsequently uninstalled from up to 500 recent operations; if inference fails, only profile configuration is checked. Configuration presence and host reachability do not prove runtime plugin activation.

Restore reports `restored`, `removed`, and `preRestoreBackup`. It restores the existence state of four profile configuration files, removing files that were absent in the selected backup. It does not restore `node_modules` or the pnpm store. Lab state changes and verification are serialized; commands use the configured `lab.dshHome`.

### Skill cycle

1. Scaffold with `{"kind":"skill","name":"my-skill","description":"..."}`.
2. Check frontmatter and body with `dsh_lab_check`.
3. Iterate on `SKILL.md` and `references/` within the lab.
4. Let the user decide whether to copy the finished Skill to `~/.qoder-cn/skills/`.
5. Record reusable findings and give the source file paths in the response.

## Preserve useful knowledge

Each learning should explain the conclusion, why it holds, where it applies, and its source run id or URL. Use `dsh_export` for Markdown and transfer only reusable findings into QMind. With the required authorization, update the relevant Skill or user memory when a finding changes the workflow.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `ready:false` | Check the dsh JavaScript CLI path, profile, and host restart |
| `401` | Supply the host plugin's shared token, for example through `QODER_DSH_CONNECT_TOKEN` |
| `403 loopback-only` | Use local loopback access; do not bypass the fence |
| Market search `409` | Configure an explicit source |
| Market `503` | Check whether the selected host `pluginMarket` service is available; configured HTTP indexes remain independent |
| Lab `403` | Check lab enablement, profile allowlisting, and the current-profile restriction |
| Lab install `502` | Inspect `stderr`; retain the backup for `dsh_lab_restore` |
| Verify returns `missing` | Check the expected plugin id and root enabled configuration entry |
| `jobMirror.attached=false` | The job controller is absent; delegation can still work |

## References

- [Tools and parameters](references/tools.md)
- [Lab and market workflows](references/workflows.md)
- [Host API](https://github.com/lightporta/qoder-dsh-connect/blob/main/docs/en/api.md) · [Security model](https://github.com/lightporta/qoder-dsh-connect/blob/main/docs/en/security.md)
