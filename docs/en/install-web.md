# Install in the dsh Web profile

[English home](../../README.md) · [中文](../install-web.md)

## Prerequisites

Run these commands in a POSIX shell on macOS/Linux, or in Git Bash on Windows:

```bash
dsh --version
pnpm --version
ls "$HOME/.dsh/profiles/web"
```

The project was checked with dsh `0.2.1-rc.2`. Repeat the verification steps below after upgrading dsh.

`dsh plugin add/remove` requires pnpm on `PATH`. If you see `spawn pnpm ENOENT`, fix the pnpm installation or `PATH` first. Stop any host using the target profile before changing its `node_modules`.

Set the repository path for your platform. Replace the example with your actual absolute path.

macOS/Linux:

```bash
REPO_DIR="/absolute/path/to/qoder-dsh-connect"
```

Windows, in Git Bash:

```bash
REPO_DIR="C:/path/to/qoder-dsh-connect"
```

## Back up the profile

These examples use the default `~/.dsh` location. If you use a custom `DSH_HOME`, use that same directory for the backup and profile paths.

```bash
BACKUP_STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$HOME/.dsh/backups/$BACKUP_STAMP-qoder-connect"
mkdir -p "$BACKUP_DIR"
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
  if [ -f "$HOME/.dsh/profiles/web/$f" ]; then
    cp "$HOME/.dsh/profiles/web/$f" "$BACKUP_DIR/"
  fi
done
```

Do not back up or copy `~/.dsh/credentials.yaml` or `~/.npmrc`.

## Install

For development, use a symlink and restart the host after changing the source:

```bash
dsh plugin --profile web add "link:$REPO_DIR/packages/dsh-plugin-qoder-connect"
```

For a copied installation that can survive moving the source directory:

```bash
dsh plugin --profile web remove qoder-dsh-connect 2>/dev/null || true
dsh plugin --profile web add "file:$REPO_DIR/packages/dsh-plugin-qoder-connect"
```

- pnpm treats a bare directory as `link:`. Use an explicit `file:` prefix for a copy.
- Source changes do not update a copied installation. Remove and add the plugin again to refresh it.
- The `--profile` argument is required.

## Optional configuration

Back up `~/.dsh/profiles/web/cordis.patch.yml`, then add `config` to the plugin entry:

```yaml
- id: qoder-dsh-connect
  config:
    # Sub-agent execution
    profile: headless
    concurrency: 2
    timeoutMs: 900000
    # Optional shared secret; the Qoder client must also provide it
    token: ''
    # No default market index: configure sources explicitly
    market:
      indexes:
        - url: https://awesome-dsh-plugin.com/plugins.json
          title: Community dsh market
    # Disabled by default; enabled labs still require allowlisted profiles
    lab:
      enabled: false
      profiles:
        - qoder-lab
      currentProfile: web
```

See the host package [README](../../packages/dsh-plugin-qoder-connect/README.md) for the full configuration table.

## Verify

### 1. Check the composed configuration

```bash
dsh --profile web --dump-config > /tmp/dsh-dump.out 2> /tmp/dsh-dump.err
cat /tmp/dsh-dump.err
grep -n -A3 'qoder-dsh-connect' /tmp/dsh-dump.out
```

Check stderr for errors and confirm the plugin entry is present. Configuration presence alone does not prove runtime activation.

### 2. Start the host

```bash
dsh web --no-open
```

Wait for `dsh web: http://127.0.0.1:<port>/?token=...`. Plugins such as `dsh-memory` may delay startup. In another terminal, set `HOST_URL` to the printed address, using its actual port:

```bash
HOST_URL="http://127.0.0.1:3080"
curl -s "$HOST_URL/api/qoder-dsh-connect/status"
```

Expect `"plugin":"qoder-dsh-connect"` and `"ready":true`. If authentication is required, include the printed URL's token or send the required token in an `Authorization: Bearer <token>` header.

### 3. Run the manual live test

From the repository root:

```bash
node packages/dsh-plugin-qoder-connect/test/live.mjs "$HOST_URL"
```

This test submits real model tasks, resumes a session, creates run and learning records, and tests cancellation. It does not add authentication headers; its local test configuration must allow those requests. The ordinary `npm test` suite uses fake dsh processes and does not establish live compatibility.

## Connect Qoder

See [MCP and CLI](mcp.md) and [examples/mcp.json](../../examples/mcp.json).

## Uninstall

```bash
dsh plugin --profile web remove qoder-dsh-connect
```

The ledger directory, `~/.qoder-dsh-connect/`, is retained by default. Remove it manually only when you no longer need its contents. Disposing the plugin terminates its active child processes.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No entry in `dump-config` | Check `package.json`'s `dsh.bundle.patch` and the patch's `id`/`name`. |
| `did not activate` | The host may not provide `webServer`, or the plugin may be waiting for a service. Read the startup logs. |
| Source changes have no effect | Restart the host after a link install; add the plugin again after a copy install. |
| `/status` returns 404 | The plugin is not loaded, or the API base path is wrong. |
| No startup URL yet | Wait for slow plugins to finish. `dsh web --help` is not a startup check. |
| Port already in use | Use `dsh web --no-open --port 0` to let the OS choose a port. |
| `/status` reports `ready:false` | Check the resolved dsh JavaScript entry and the configured `bin`; shell and `.cmd` wrappers cannot be used as `bin`. |
