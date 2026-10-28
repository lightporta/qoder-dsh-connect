# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

## Development

```bash
npm test
npm run check
```

No `npm install` step is needed: the project uses Node.js built-in modules and has no third-party runtime dependencies.

## Code conventions

- Keep host code in `packages/dsh-plugin-qoder-connect/lib` and client code in `packages/qoder-dsh-connect-cli/lib`.
- Use built-in modules; explain the need for any proposed dependency.
- Start subprocesses with an argument array and `shell:false`. Send task text through stdin and never construct a shell command from user input.
- Apply the loopback fence to routes. Review backup and rollback behavior for new write operations.
- Keep credentials out of source, logs, API responses, and backups.
- Explain non-obvious constraints in comments rather than restating the code.

## Testing

- Unit and integration tests use `node:test`, fake dsh processes, and local HTTP services without real model calls.
- CI runs Node 22/24 on Ubuntu, Windows, and macOS. Canonicalize both sides when comparing filesystem paths across processes.
- `npm run smoke` is a manual native Harness test and consumes model usage.
- `node packages/dsh-plugin-qoder-connect/test/live.mjs <url>` runs E2E against an existing host.

Treat automated fixture tests, native Harness execution, and Desktop integration as separate validation scopes.

## Changes and commits

Keep each PR focused. Run the relevant tests and static check before submitting. Update the English and Chinese documentation and changelog when changing APIs, configuration, security boundaries, or compatibility.

Do not add local deployment simulations, credentials, or generated runtime directories to a commit. See [publishing](docs/en/publishing.md) for package checks.
