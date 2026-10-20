# 完整工作流

## 1. 把任务交给 Harness，再把结论带回来

**目标**：让 Harness 独立调研或试错，Qoder 只接收可验证的结论。

1. `dsh_status` 确认 `ready:true`。
2. `dsh_delegate`，任务里写清楚：
   - 目标与验收标准；
   - 允许改动的目录；
   - 明确“不要做”的范围；
   - 是否允许安装包或改 profile。
3. 如果 110 秒内没结束，拿 `id` 用 `dsh_run` 带 `waitMs` 轮询；不要重复提交同一任务。
4. 检查 `status`、`counts.toolCalls`、`result`，不要只看 `status=completed`。
5. 把“发现了什么 / 为什么 / 适用范围”写入 `dsh_learn`，`source` 用 run id。

示例任务文本：

```text
在 C:/work/demo 里检查 package.json 的依赖是否能被当前 Node 版本加载。
不要修改任何文件；只读。列出失败项、错误码和建议的最小修复。最后用三行总结。
```

## 2. 市场研究 → 候选插件 → 小范围试用

1. `dsh_market_sources` 确认 source；没有就停下来让用户配置。
2. `dsh_market_search` 用关键词找候选；记录 `name`、`install`、`capabilities`、`stars`。
3. `dsh_market_entry` 看目标插件详情；`full:true` 才拿原始索引记录。
4. 在 `dsh_learn` 写一条对比：候选、能力、风险、为什么选它。
5. 如果用户同意试用，走实验室流程；不要直接装进 `web`。

## 3. 插件实验室（推荐顺序）

```text
lab.status
  → lab.scaffold(kind=plugin)
  → lab.check(path)
  → lab.install(path, profile=qoder-lab, mode=file)
  → lab.verify(profile=qoder-lab)
  → 在 lab 里迭代源码
  → lab.uninstall / lab.restore
  → learn + export
```

### 安装前检查

- `lab.enabled === true`
- `profile` 在 `lab.profiles`
- `profile !== lab.currentProfile`（除非用户明确接受 `allowCurrentProfile`）
- `check.ok === true`
- 返回里有 `backup.id`；把 id 记在回复里

### 验证模式

- `verify(profile)`：`dsh --profile <profile> --dump-config`，检查条目和 stderr 告警。
- `verify(profile, boot=true)`：临时启动 `dsh --profile <profile> --no-open --port 0`，解析 URL、发一个 GET、然后杀掉。目标 profile 必须包含 web app/webServer。

### 回滚

```text
lab.restore({ backupId, confirm: backupId })
```

恢复前实验室会再备份一次当前状态（`preRestoreBackup`）。不要手动删备份目录。

## 4. Skill 实验室

1. `lab.scaffold(kind=skill, name=..., description=...)`。
2. `lab.check(path)`：frontmatter 必须有 `name`、`description`，正文不能为空。
3. 在 lab 目录编辑 `SKILL.md` 和 `references/`。
4. 让用户决定是否安装到 `~/.qoder-cn/skills/`；实验室本身不写用户 Skill 目录。
5. 如果反复用到同一流程，把它沉淀成 Skill；如果只是一次性结论，写台账即可。

## 5. 知识沉淀

```text
dsh_learn({ title, body, topic, tags, source })
dsh_export({ topic, results })
```

只把满足以下条件的段落写进 QMind：

- 能在未来复用；
- 有来源（run id、URL、文件路径）；
- 有适用范围或失败条件；
- 不是一次性的任务日志。
