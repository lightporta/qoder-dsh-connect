# Publish to GitHub or npm

[English home](../../README.md) · [中文](../publishing.md)

Repository metadata points to [lightporta/qoder-dsh-connect](https://github.com/lightporta/qoder-dsh-connect). Both packages are currently version `0.1.0`. The steps below are manual publishing instructions; preparing documentation or running checks does not publish a package or push commits.

## 1. Check project identity

- Both package manifests contain `repository`, `homepage`, and `bugs` metadata for `lightporta/qoder-dsh-connect`.
- The copyright holder in [LICENSE](../../LICENSE) is **Asher Zeqi**.
- Placeholders such as `<repo>` and `<you>` describe local directories or OS usernames, not the repository's GitHub identity.
- Absolute paths in [examples/mcp.json](../../examples/mcp.json) and the documentation are templates. Replace them with the actual clone location.
- If the repository is renamed or transferred, update both packages' metadata and the documentation URLs together.

## 2. Run release checks

From the repository root:

```bash
npm test
npm run check
git status
git diff --check
```

Review the following:

- No `.env`, tokens, `credentials.yaml`, or `.npmrc` are staged or packaged.
- Package source does not contain temporary `/tmp` paths or machine-specific absolute paths.
- The bundle patch's `id`/`name` agree with the package name.
- The host package includes `lib`, `cordis.patch.yml`, `assets`, and `README.md` in `files`; the CLI includes its executable, library, Skill, and README.
- Skill frontmatter is complete.
- Required CI checks pass after the push. The workflow is configured for Node 22/24 on Linux, Windows, and macOS; local checks do not establish remote CI success.

The automated test suite uses fake dsh processes. It does not prove real model execution or Desktop compatibility.

## 3. Push to GitHub

For an existing clone, inspect its branch, remotes, and changes before staging the files you intend to publish:

```bash
git status
git remote -v
git diff
```

After staging and reviewing those files, create a commit and push it yourself:

```bash
git diff --cached
git commit -m "docs: update project documentation"
git push origin main
```

Use the actual branch name if it differs from `main`. For a new repository, configure your own Git identity and add the remote before the first push; do not replace an existing remote without reviewing it.

Recommended repository features:

- GitHub Actions, using [the included CI workflow](../../.github/workflows/ci.yml).
- Issues and security advisories.
- Trusted Publishing or two-factor authentication if you later publish to npm.

## 4. Distribute the dsh plugin

Users can clone the repository and install the host package locally:

```bash
git clone https://github.com/lightporta/qoder-dsh-connect.git
cd qoder-dsh-connect
```

In a macOS/Linux shell:

```bash
REPO_DIR="$(pwd)"
dsh plugin --profile web add "file:$REPO_DIR/packages/dsh-plugin-qoder-connect"
```

In Windows Git Bash, use `pwd -W` to obtain a Windows absolute path:

```bash
REPO_DIR="$(pwd -W)"
dsh plugin --profile web add "file:$REPO_DIR/packages/dsh-plugin-qoder-connect"
```

The target host must be stopped, and pnpm must be on `PATH`. See [Web installation](install-web.md) for platform-specific absolute paths and verification.

Before an optional npm publication, inspect each package's contents:

```bash
npm pack --dry-run --workspace packages/dsh-plugin-qoder-connect
npm pack --dry-run --workspace packages/qoder-dsh-connect-cli
```

Publish only when you intend to release and have checked the npm account, package ownership, and registry:

```bash
npm publish --workspace packages/dsh-plugin-qoder-connect --access public
npm publish --workspace packages/qoder-dsh-connect-cli --access public
```

The host and CLI can be published independently. Check that the package being published is not marked `private: true`; the workspace root is intentionally private. Confirm `repository`, `homepage`, and `author` before publishing.

After the host package has actually been published to the intended registry, users can install it by name:

```bash
dsh plugin --profile web add qoder-dsh-connect
```

## 5. Prepare a market entry

A format-1 entry uses per-version `source` metadata. This example illustrates the package's current version; replace the timestamp with the actual release time in Unix seconds:

```json
{
  "name": "qoder-dsh-connect",
  "versions": [
    {
      "version": "0.1.0",
      "publishTimestamp": 1792454400,
      "source": { "type": "npm", "registry": "https://registry.npmjs.org" },
      "engines": { "dsh": "^0.2.1" }
    }
  ],
  "metadata": {
    "category": "integration",
    "keywords": ["qoder", "subagent", "mcp", "plugin-market", "plugin-lab"],
    "labels": ["host-only"]
  }
}
```

Community indexes such as `awesome-dsh-plugin.com` use a different flat format. Follow the chosen index's submission requirements. Supporting an index format does not mean that this project is listed, reviewed, or endorsed by that index. See [market research](market.md) for the formats the plugin reads.

## 6. Keep versions and documentation aligned

- Host and CLI versions are both `0.1.0` and can be released separately.
- Update [CHANGELOG.md](../../CHANGELOG.md) and the relevant documentation when APIs or configuration change.
- After upgrading dsh, repeat local tests and the appropriate manual smoke/live checks, then update the compatibility statement with the actual evidence. Real smoke/live tests make model calls; run them deliberately.

## 7. Release checklist

- [ ] `npm test` and `npm run check` pass.
- [ ] Installation commands can be reproduced from a clean clone.
- [ ] Package metadata points to lightporta / Asher Zeqi.
- [ ] LICENSE identifies Asher Zeqi as copyright holder.
- [ ] Staged files and package contents contain no credentials or sensitive local paths.
- [ ] GitHub Actions has passed for the pushed revision.
- [ ] For npm publication, both relevant `npm pack --dry-run` outputs have been reviewed.
- [ ] For a market submission, the format, version, source, and installation target match the released package.
