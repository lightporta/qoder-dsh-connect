# Security Policy

English | [简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Keep tokens, credentials, user data, and exploit details out of public issues. Use GitHub's private vulnerability reporting if available, or contact the [maintainer](https://github.com/lightporta) privately.

## Scope

Relevant issues include:

- Bypassing loopback or token authentication.
- Command injection or unintended shell execution.
- Lab path escapes or writes to unauthorized profiles.
- Processes that remain alive after cancellation.
- Resource exhaustion through market responses.
- Credentials leaking into logs, ledgers, responses, or backups.

## Operating guidance

- Keep the dsh host on loopback.
- Use a random plugin token and keep it out of Git.
- Use a separate lab profile. Enable `allowCurrentProfile` only with an explicit understanding of the restart and write implications.
- Scope delegated tasks carefully: Harness uses real file and tool permissions inherited from the host.

See the [security model](docs/en/security.md) for the implemented controls and their limits.
