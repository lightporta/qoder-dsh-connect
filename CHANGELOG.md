# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

## Unreleased — 2026-10-29

- Add English project and package READMEs, installation/reference guides, contribution and security policies, and bundled Qoder Skill documentation; preserve Chinese versions with language links.
- Record the successful six-job CI matrix for commit `357d9e3`: Ubuntu, Windows, and macOS with Node 22/24, using fake dsh and local HTTP fixtures.
- Fix a Windows CI assertion by canonicalizing both actual and expected working directories with `realpath`, preserving the directory check while accepting 8.3 short paths.

## Unreleased — 2026-10-28

- Fix MCP UTF-8 byte framing, stdin task input, status/cancellation during long tasks, HTTP long-poll budgets, and interrupted response handling.
- Fix npm symlink CLI discovery, non-object event crashes, oversized output lines, per-step token totals, and process-tree cleanup after the leader exits. Preserve full tasks/results in the ledger and wait for queued writes before reading.
- Strengthen lab path and symlink checks, serialize mutations, restore the original presence of profile files, and verify an expected plugin ID with an explicit verification scope.
- Validate HTTP query parameters before starting tasks, return readable 413 responses, match exact routes, filter live runs before pagination, and improve IPv6 loopback and Origin checks.
- Preserve matching raw market records, derive format-1 install targets from version sources, tolerate malformed entries, and bound the index cache. Exclude external simulation runtimes from source checks.
- Add regression coverage and correct usage, lab verification, pnpm prerequisites, and macOS Desktop documentation.
- Fix lab `DSH_HOME` consistency, malformed configuration checks, delayed activation warnings, null client configuration, MCP argument validation, and blank session IDs. Filter learning topics before limiting results and exclude broken rows from valid-record limits.

## 0.1.0 — 2026-10-20

- Initial host plugin, Qoder CLI/stdio MCP server, and bundled Skill.
- Native headless delegation, session continuation, concurrency, timeouts, process-tree cancellation, and optional job mirroring.
- Run summaries, event logs, learning notes, and Markdown export.
- Format-1/community/host market sources with caching, response limits, and timeouts.
- Plugin/Skill scaffolding, static checks, allowlisted installation, profile backups, config/boot checks, and rollback.
- Loopback checks, optional token authentication, argument-array process launching, bounded I/O, an opt-in lab, and diagnostic redaction.
- 33 initial tests with a fake dsh CLI. The original release record includes native dsh `0.2.1-rc.2` delegation and a temporary web-profile integration run; the later audit skipped real model calls.
