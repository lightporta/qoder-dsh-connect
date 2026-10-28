# Workflows

[English](workflows.md) | [简体中文](workflows.zh-CN.md)

## 1. Delegate and bring back evidence

Use Harness for an independent investigation or experiment, then return verifiable findings to Qoder.

1. Confirm `ready:true` with `dsh_status`.
2. In the delegated task, state the objective, acceptance criteria, allowed directories, excluded actions, and whether dependency installation or profile changes are authorized.
3. If the run is still active after the initial wait, poll its `id` with `dsh_run` and `waitMs`; do not duplicate the task.
4. Inspect `status`, `counts.toolCalls`, and `result`. `completed` alone does not prove the requested outcome.
5. Record the finding, rationale, and applicability with `dsh_learn`, using the run id as `source`.

Example task:

```text
In /path/to/demo, check whether the package.json dependencies load with the current Node version.
Use read-only operations. Report failures, error codes, and the smallest supported fixes.
End with a three-line summary.
```

Use a real absolute directory for the current machine, such as `C:/work/demo` on Windows. Delegation inherits the host's real credentials and permissions; it does not create an OS sandbox.

## 2. Research a market and choose a candidate

1. Confirm the source with `dsh_market_sources`. If absent, ask the user to configure an explicit index URL.
2. Search and record the candidate's `name`, `install`, `capabilities`, and `stars`.
3. Read details with `dsh_market_entry`; use `full:true` for the raw index record.
4. Add a comparison note covering capabilities, dependencies, risks, and the selection rationale. External market metadata is not a security endorsement.
5. When a trial is authorized, use a separate lab profile rather than the active Web profile.

## 3. Plugin lab

```text
lab.status
  → lab.scaffold(kind=plugin)
  → lab.check(path)
  → lab.install(path, profile=qoder-lab, mode=file)
  → lab.verify(profile=qoder-lab, name=my-plugin)
  → iterate on lab source
  → lab.uninstall / lab.restore
  → learn + export
```

Before installation, confirm the lab is enabled, the target profile is allowlisted, it is not the active host profile under the default policy, and `check.ok` is true. Retain and report the returned `backup.id`. Use the configured `lab.dshHome`; the lab passes that directory as `DSH_HOME` to its commands.

### Verification

- `verify(profile, name=my-plugin)` runs `dsh --profile <profile> --dump-config`, inspects top-level enabled ids, and checks the expected id and stderr warnings. A missing entry produces `ok:false` and `missing`.
- Without `name`, inference uses up to 500 recent operations to find a successful installation not subsequently uninstalled. When no candidate can be inferred, only profile configuration is checked.
- `verify(profile, name=my-plugin, boot=true)` first verifies configuration, then starts `dsh --profile <profile> --no-open --port 0`, probes its printed URL, terminates the process tree, and waits for shutdown. The profile must include a Web app/webServer.

Check `verificationScope` and `stopped` before reporting the result. Configuration presence and host reachability do not prove runtime plugin activation. Lab changes and verification are serialized, but the lab cannot detect another host already using the target profile; check that separately.

### Restore

```text
lab.restore({ backupId, confirm: backupId })
```

Restore first saves the current configuration as `preRestoreBackup`. `restored` lists copied files; `removed` lists configuration files absent in the selected backup that were removed from the profile. The backup covers `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `cordis.patch.yml`, including their existence state. It does not cover `node_modules` or the pnpm store. Retain backup directories until recovery is no longer needed.

## 4. Skill lab

1. Scaffold with `kind=skill`, `name`, and `description`.
2. Check that frontmatter contains `name` and `description` and the body is non-empty.
3. Edit `SKILL.md` and `references/` within the lab.
4. Let the user decide whether to copy the finished Skill to `~/.qoder-cn/skills/`; the lab does not install generated Skills into the user's Skill directory.
5. Use a Skill for repeated workflows and the ledger for a one-off finding.

## 5. Preserve reusable findings

```text
dsh_learn({ title, body, topic, tags, source })
dsh_export({ topic, results })
```

Transfer a finding to QMind when it is reusable, has a source (run id, URL, or file path), and states its applicability or failure conditions. Avoid copying an entire task log as knowledge. Ledgers and exports can contain sensitive task text and tool output; review them before sharing.

[Tools and parameters](tools.md) · [Skill](../SKILL.md)
