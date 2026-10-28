# Plugin and Skill lab

[English home](../../README.md) · [中文](../lab.md)

The lab provides a sequence of checks, backups, installation, verification, and rollback for trying a plugin in a separate profile.

## Default policy

```yaml
lab:
  enabled: false
  dir: /absolute/path/to/lab     # Optional; defaults to ~/.qoder-dsh-connect/lab
  profiles: []                   # Empty means no profile writes are allowed
  allowCurrentProfile: false
  currentProfile: web
  dshHome: /absolute/path/to/.dsh # Optional; defaults to $DSH_HOME or ~/.dsh
  timeoutMs: 180000
```

Use absolute paths in configuration. A literal `~` inside a configuration string is not expanded.

Profile operations require the lab to be enabled, the profile to be allowlisted, and the target to differ from the current host profile unless `allowCurrentProfile: true`. Plugin installation additionally requires a path inside `lab.dir` and a successful static check.

`scaffold`, `check`, and `ops` also require the lab to be enabled. Path checks reject links that escape the authorized directories, and backups accept only regular profile configuration files.

## Plugin workflow

### 1. Scaffold

Request:

```json
{ "kind": "plugin", "name": "my-plugin", "description": "What it does" }
```

Generated files:

```text
~/.qoder-dsh-connect/lab/plugins/my-plugin/
├─ package.json
├─ cordis.patch.yml
├─ lib/index.js          # Loopback guard and /api/<name> health route
├─ test/smoke.mjs
└─ README.md
```

The generated package declares `type: module`, `dsh.bundle.patch`, and the package's `files` list.

### 2. Check

For a plugin, static checks cover:

- Package name, version, `type`, `main`, `exports["."]`, and `dsh.bundle.patch`.
- Matching `id` and `name` entries in `cordis.patch.yml`.
- An existing entry file that exports `name` and `apply`.
- `lib` and the patch in the `files` list.
- A `test/` directory, with a warning if absent.
- Source patterns such as `shell: true` or `0.0.0.0`, which produce warnings.
- Paths remaining inside the authorized lab and plugin directories.

For a Skill, checks cover YAML frontmatter, a valid `name`, a description, and a nonempty body. A name that differs from the directory name produces a warning.

Static checks do not execute the plugin or prove that it works in a host.

### 3. Install

All lab subprocesses receive `DSH_HOME` set to the checked and backed-up `lab.dshHome`. This keeps the actual CLI operation in the same environment as its profile policy and backup.

Request, with your actual absolute plugin path:

```json
{ "path": "/absolute/path/to/lab/plugins/my-plugin", "profile": "qoder-lab", "mode": "file" }
```

Installation proceeds as follows:

1. Back up the target profile's four configuration files under `<lab.dshHome>/backups/<timestamp>-qoder-connect-<profile>-<rand>/`.
2. Run `dsh plugin --profile <profile> add file:<lab-path>`, or use `link:` for link mode.
3. Record the result, exit code, output tail, and backup ID in `lab/ops.ndjson`.

`file:` copies the package. `link:` is useful during development but depends on the lab directory remaining available. A copied install is closer to the final distribution workflow.

### 4. Verify

Specify the expected plugin explicitly when checking a particular installation:

```json
{ "profile": "qoder-lab", "name": "my-plugin", "boot": false }
```

- `boot: false`, the default, runs `dsh --profile <profile> --dump-config`. It collects top-level entries that are not explicitly disabled. A missing expected `name` returns `ok: false` and lists it in `missing`.
- Without `name`, the lab examines the latest 500 operations for the profile's most recent successful installation that has not been uninstalled. If it cannot infer a target, it checks only the profile configuration. Pass `name` explicitly for a specific plugin.
- `boot: true` first performs the configuration check. If it passes, the lab starts a temporary host, parses its printed `dsh web:` URL, requests that URL once, and terminates the process tree. The profile must include the web app; a pure headless/minimal profile is not suitable.

The result's `verificationScope` describes what was checked:

| Value | Evidence |
| --- | --- |
| `profile-configuration` | The profile configuration command succeeded. |
| `plugin-configuration` | The expected plugin appears in the collected configuration entries. |
| `host-reachability` | The profile configuration check passed and the temporary host was reachable. |
| `plugin-configuration-and-host-reachability` | Both the expected configuration entry and host reachability were checked. |

Neither configuration presence nor a reachable host proves that the plugin activated at runtime. Boot verification waits for the temporary host to close before releasing the operation queue. A cleanup failure blocks further lab operations until the host is restarted.

### 5. Learn and export

Record useful conclusions after installations, verification, or failures:

```json
{
  "title": "my-plugin: bundle patch ID must match the package name",
  "body": "The dump-config entry was missing because the patch used the directory name instead of package.json name.",
  "topic": "dsh-plugin-dev",
  "tags": ["bundle", "patch"],
  "source": "run-example"
}
```

Export the ledger as Markdown, review it, and copy selected material to QMind or another knowledge base.

### 6. Uninstall or restore

Uninstall request:

```json
{ "name": "my-plugin", "profile": "qoder-lab" }
```

Uninstall also takes a backup first. To restore, send the exact backup ID returned by the lab in both fields:

```json
{
  "backupId": "20261029-120000-qoder-connect-qoder-lab-abc123",
  "confirm": "20261029-120000-qoder-connect-qoder-lab-abc123"
}
```

Restore first validates the backup and creates a `pre-restore` backup. Among the four covered configuration files, it removes files that did not exist in the saved state but were created later, listing them in `removed`. Lab writes and verification run sequentially so installation and restore do not interleave.

## Skill workflow

```json
{ "kind": "skill", "name": "my-skill", "description": "What it does and when to use it" }
```

This generates `SKILL.md` and `references/notes.md`. The lab does not install the generated Skill into Qoder's user Skill directory automatically; copy it there when it is ready. The CLI's separate `skill install` command installs the bundled `qoder-dsh-connect` Skill.

## Directories and ledgers

Default ledger layout:

```text
~/.qoder-dsh-connect/
├─ runs.ndjson              # Run summaries
├─ learnings.ndjson         # Learning records
├─ runs/<run-id>.ndjson     # Raw events
└─ lab/
   ├─ plugins/<name>/
   ├─ skills/<name>/
   └─ ops.ndjson            # Lab operations
```

Backup layout under the configured dsh home:

```text
<lab.dshHome>/backups/<timestamp>-qoder-connect-<profile>-<rand>/
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ cordis.patch.yml
└─ backup.json
```

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Install returns 502 | Read `stderr`; check the profile, pnpm on `PATH`, and package-name conflicts. |
| No entry in `dump-config` | Check that the patch's `id`/`name` match the package name. |
| Boot verification times out | The profile may lack the web app or have slow startup plugins. Try `boot: false` first. |
| Restore returns 403 | The saved profile may no longer be allowlisted, or a path/file guard rejected it. Check the policy and paths. |
| Current profile is rejected | Use a separate lab profile, or explicitly accept the effects of `allowCurrentProfile`. |

## Limits

- The lab blocks the current host profile by default. It cannot tell whether another host is using a target lab profile; stop that host before installation or verification.
- Backups and restore cover only `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `cordis.patch.yml`. They do not cover `node_modules` or the shared pnpm store. Use a separate lab profile, or reinstall its dependencies when you need a clean rollback.
- Deleting the lab directory breaks linked installations. Prefer `file:` when checking a distribution.
- The lab installs checked plugin directories already inside the lab. It does not download arbitrary market packages for you.
- Backups exclude credentials. Path checks do not turn execution of a plugin into a filesystem sandbox.
