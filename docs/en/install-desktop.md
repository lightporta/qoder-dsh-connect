# Install in the dsh Desktop profile

[English home](../../README.md) · [中文](../install-desktop.md)

Desktop uses the `desktop` profile. Its plugin format is the same as Web; the CLI path and profile name differ.

## Find the Desktop CLI

On a default macOS installation, use the CLI wrapper at:

```text
/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh
```

In a macOS shell:

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
REPO_DIR="/absolute/path/to/qoder-dsh-connect"
"$DSH" --version
pnpm --version
```

On Windows, the default wrapper is:

```text
C:/Users/<you>/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd
```

In Windows Git Bash, replace the username and repository path:

```bash
DSH="C:/Users/<you>/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd"
REPO_DIR="C:/path/to/qoder-dsh-connect"
"$DSH" --version
pnpm --version
```

The Desktop CLI may not be on `PATH`. Plugin installation also requires pnpm on `PATH`; fix `spawn pnpm ENOENT` before continuing. Use the address printed by Desktop itself rather than searching logs or the registry for tokens.

## Back up the profile

Fully quit Desktop before installing or removing plugins so that its host is not using `node_modules`.

The following shell commands work in macOS shells and Windows Git Bash. They use the default `~/.dsh`; use your custom `DSH_HOME` location instead if applicable.

```bash
BACKUP_STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$HOME/.dsh/backups/$BACKUP_STAMP-qoder-connect-desktop"
mkdir -p "$BACKUP_DIR"
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
  if [ -f "$HOME/.dsh/profiles/desktop/$f" ]; then
    cp "$HOME/.dsh/profiles/desktop/$f" "$BACKUP_DIR/"
  fi
done
```

Do not copy credentials or `.npmrc` into the backup.

## Install

Using the `DSH` and `REPO_DIR` values set for your platform:

```bash
"$DSH" plugin --profile desktop add "file:$REPO_DIR/packages/dsh-plugin-qoder-connect"
"$DSH" --profile desktop --dump-config | grep -A3 qoder-dsh-connect
```

Restart Desktop after installation. It loads the `desktop` profile automatically.

## Verify

Desktop manages the host port and token. To check the installation:

1. Restart Desktop.
2. Check the app for plugin activation errors.
3. Use Desktop's supported way of opening its local API and request:

```text
/api/qoder-dsh-connect/status
```

If the host requires authentication, use the token URL printed by the app. Set Qoder's `QODER_DSH_CONNECT_URL` to the actual Desktop host address and provide the required token through `QODER_DSH_CONNECT_TOKEN`.

If `/status` reports `ready:false`, the host has not found a dsh JavaScript entry it can execute directly. The plugin's `bin` configuration must point to an entry runnable by the host's `process.execPath`. A `.cmd` file or shell wrapper is suitable for the manual installation commands above, but cannot serve as the plugin's `bin`.

macOS Desktop stores the CLI inside `app.asar` and starts it through an Electron wrapper. Automatic discovery does not currently support that layout. A separately installed npm CLI can supply an explicit absolute path to `@deepseek-ai/dsh/lib/bin.js`; check its version and execution environment first. Desktop delegation still requires an actual runtime test. Source inspection and fake dsh tests do not establish Desktop compatibility.

## Operational notes

- Do not run two hosts against the same `desktop` profile.
- Desktop may include its own market or pet plugins. Review installed plugins before making changes:

```bash
"$DSH" plugin --profile desktop list
```

- After upgrading Desktop, confirm the CLI path and repeat `dump-config`; installation paths can change.
- The lab is disabled by default. Use a separate experimental profile for lab operations instead of modifying `desktop` directly.

## Uninstall

Quit Desktop, then run:

```bash
"$DSH" plugin --profile desktop remove qoder-dsh-connect
```

Start Desktop again after the command completes.
