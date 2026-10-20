---
name: qoder-dsh-connect
description: Control a local DeepSeek Harness host as a sub-agent, research the dsh plugin market, and scaffold/check/install/verify dsh plugins or Qoder skills in a guarded lab. Use when Qoder should get a second opinion from Harness, test an immature tool or plugin before adopting it, learn from the plugin market, or file Harness learnings into QMind.
---

# Qoder × DeepSeek Harness

这个 Skill 让 Qoder 把本机 DeepSeek Harness (dsh) 当作：

1. **子代理**：把任务委派给 `headless` 子进程，拿回终局、事件、token 用量和会话 id；
2. **市场研究源**：搜索 dsh 插件市场，比较插件、版本和安装方式；
3. **试错实验室**：生成插件/Skill 骨架，静态检查，安装到白名单 profile，验证，回滚。

## 前置条件

- 宿主插件 `qoder-dsh-connect` 已安装到 dsh `web` 或 `desktop` profile，并且宿主已重启。
- Qoder 已配置 MCP server `qoder-dsh-connect`，或能用：

  ```bash
  node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs --help
  ```

  如果 `skill install` 生成的 `references/local-paths.md` 存在，优先用里面的 CLI 绝对路径替换 `<repo>`。

- 先跑 `dsh_status`（或 CLI `status`）。如果 `ready:false`，先修宿主，不要继续。

## 什么时候用

- 需要一个**独立第二意见**、另一套工具/模型视角，或希望主上下文不被长任务污染。
- 想验证一个**未成熟插件或工具**，但不想直接装进正在使用的 `web` profile。
- 想学习 dsh 插件市场：`dsh-workbuddy-connect` 这类插件装了什么、依赖什么、有哪些能力。
- 想把一次 Harness 试错的结论沉淀成 QMind 知识或新的 Qoder Skill。

## 什么时候不用

- 普通单文件编辑、已有测试能覆盖的本地重构：直接用当前工具，不要为了委派而委派。
- 需要真实用户授权、生产环境写入、共享状态删除：先问用户。
- 用户明确说不要调用 Harness。

## 安全规则（硬约束）

1. **不要绕过实验室**直接改 `~/.dsh/profiles/*/package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`。
2. 实验室默认关闭。`lab.enabled=false` 时，不要尝试安装或修改 profile；只做 scaffold/check 也要先征得用户同意开启。
3. **永远不要改当前宿主 profile**。`lab.currentProfile` 默认是 `web`；`allowCurrentProfile` 未显式打开时，安装必须被拒绝。
4. 只安装 lab 目录内、通过 `check` 的插件；不要用实验室的接口装任意 npm 包。
5. 安装/卸载/恢复前确认返回里有 `backup.id`；回滚时 `confirm` 必须等于 `backupId`。
6. 不读取、不粘贴、不请求 `~/.dsh/credentials.yaml`、`.npmrc`、token 或 cookie。
7. 不把宿主端口暴露到 `0.0.0.0`；不尝试远程访问这些接口。
8. 委派任务是真实的自主 agent，拥有真实工具权限。任务范围要写清楚，尤其是写入路径和命令。

## 模式一：子代理委派

### MCP

```json
{"task": "阅读 ... 并给出 ...", "cwd": "C:/work/demo", "label": "second-opinion", "waitMs": 110000}
```

调用 `dsh_delegate`。如果返回 `status: "running"`，用 `dsh_run` 带 `waitMs` 继续等；需要停止时用 `dsh_kill`。

### CLI

```bash
node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs run "任务" \
  --cwd "C:/work/demo" --label second-opinion --wait 110000
```

### 续接同一会话

把返回的 `sessionId` 作为下一次 `dsh_delegate` 的 `sessionId`。适合“先调研，再基于结果实现”的两步任务。

### 结果怎么用

- `result` 是终局回答；`tail` 是紧凑进度；`usage` 是累计 token 快照。
- `counts` 里的工具调用数可以用来判断任务是否真的执行了动作。
- `jobMirror.attached=false` 只表示 GUI 任务面板没挂上，不代表委派失败。

## 模式二：市场研究

```json
{"text": "workbuddy", "limit": 10}
```

1. `dsh_market_sources` 看有没有配置 source；没有就告诉用户在插件配置里加 `market.indexes`，不要猜地址。
2. `dsh_market_search` 搜索；结果字段包括 `name`、`description`、`author`、`install`、`stars`、`capabilities`、`versions`。
3. `dsh_market_entry` 看单个插件的完整归一化记录；`full:true` 才返回原始索引记录。
4. 把“这个插件的能力/依赖/风险”写入 `dsh_learn`，主题用 `plugin-market`，之后可 `dsh_export` 到 QMind。

CLI：

```bash
node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market search --text workbuddy --limit 5
node <repo>/packages/qoder-dsh-connect-cli/bin/qoder-dsh-connect.mjs market entry dsh-workbuddy-connect
```

## 模式三：插件 / Skill 实验室

先看 `dsh_lab_status`：`enabled` 必须是 `true`，目标 profile 必须在 `profiles` 里。

### 插件闭环

1. **Scaffold**：`dsh_lab_scaffold`，`{kind:"plugin", name:"my-plugin", description:"..."}`。生成的是可安装 dsh bundle（package.json + cordis.patch.yml + lib + test）。
2. **Check**：`dsh_lab_check`，`{path:"<lab>/plugins/my-plugin"}`。必须 `ok:true`；有 `errors` 先修。
3. **Install**：`dsh_lab_install`，`{path, profile:"qoder-lab", mode:"file"}`。确认返回值有 `backup.id`。
4. **Verify**：`dsh_lab_verify`，`{profile:"qoder-lab"}`；如果该 profile 含 web app，可 `boot:true` 做临时启动验证。
5. **Learn**：把验证结论写入 `dsh_learn`；主题用 `dsh-plugin-dev` 或 `plugin-market`。
6. **Cleanup**：`dsh_lab_uninstall`；需要恢复原 profile 文件时用 `dsh_lab_restore`，`confirm` 等于 `backupId`。

### Skill 闭环

1. `dsh_lab_scaffold`，`{kind:"skill", name:"my-skill", description:"..."}`。
2. `dsh_lab_check` 校验 frontmatter 和正文。
3. 在 lab 目录迭代 `SKILL.md`；成熟后由用户决定是否复制到 `~/.qoder-cn/skills/`。
4. 把可复用的结论写入台账，并在回复里指出源文件路径。

## 知识沉淀

- 每条学习记录至少包含：结论、为什么、适用范围、来源 run id 或 URL。
- 用 `dsh_export` 导出 Markdown；只把真正有复用价值的段落写入 QMind，不要整份倾倒。
- 如果结论改变了你的做法，更新对应的 Skill 或用户记忆，而不是只留在台账里。

## 错误处理

| 症状 | 处理 |
| --- | --- |
| `ready:false` | 检查 dsh CLI、profile、宿主是否重启 |
| 401 | 宿主配置了 token；让用户提供，或通过 `QODER_DSH_CONNECT_TOKEN` |
| 403 loopback-only | 请求不是从本机 loopback 发出；不要尝试绕过 |
| `/market/search` 409 | 没有配置市场 source；让用户显式添加 |
| `/market/*` 503 | 宿主没有 `pluginMarket` 且没有 HTTP source；正常降级 |
| lab 403 | `lab.enabled=false`、profile 不在白名单、或目标就是当前宿主 profile |
| lab install 502 | 看返回的 `stderr`；备份已保留，可用 `dsh_lab_restore` 回滚 |
| `jobMirror.attached=false` | 顶层 job controller 不存在；不影响委派 |

## 参考

- [工具与参数](references/tools.md)
- [实验室与市场完整工作流](references/workflows.md)
- 宿主 API：`docs/api.md`；安全：`docs/security.md`
