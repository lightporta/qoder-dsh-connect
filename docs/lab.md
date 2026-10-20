# 插件与 Skill 实验室

实验室解决的是“想试一个插件，但不想污染正在使用的 profile”。它把试错过程拆成可检查、可回滚的步骤。

## 默认策略

```yaml
lab:
  enabled: false
  dir: ~/.qoder-dsh-connect/lab
  profiles: []                 # 空 = 谁都不允许写
  allowCurrentProfile: false
  currentProfile: web
  dshHome: ~/.dsh
  timeoutMs: 180000
```

安装/卸载/恢复必须同时满足：

1. `enabled: true`；
2. `profile` 在 `profiles` 白名单；
3. 目标不是当前宿主 profile（除非 `allowCurrentProfile: true`）；
4. 插件路径在 `lab.dir` 内；
5. 插件静态检查 `ok: true`。

`scaffold`、`check`、`ops` 也在实验室开关之内，避免在关闭状态下误写 lab 目录。

## 插件闭环

### 1. Scaffold

请求：

```json
{ "kind": "plugin", "name": "my-plugin", "description": "What it does" }
```

生成：

```text
~/.qoder-dsh-connect/lab/plugins/my-plugin/
├─ package.json
├─ cordis.patch.yml
├─ lib/index.js          # 已带 loopback 栅栏和 /api/<name> 健康路由
├─ test/smoke.mjs
└─ README.md
```

生成的包是合法的 dsh bundle：`type: module`、`dsh.bundle.patch`、`files` 都齐。

### 2. Check

检查项：

- `package.json` 名称、版本、`type`、`main`、`exports["."]`、`dsh.bundle.patch`；
- `cordis.patch.yml` 是否有匹配的 `id` 和 `name`；
- 入口是否存在并导出 `name` 和 `apply`；
- `files` 是否包含 `lib` 和 patch；
- `test/` 是否存在（warning）；
- 是否出现 `shell: true` 或 `0.0.0.0`（warning）；
- 路径是否在 lab 目录内。

Skill 检查：

- `SKILL.md` 是否有 YAML frontmatter；
- `name`、`description` 是否存在；
- 正文是否为空；
- skill 名与目录名是否一致（warning）。

### 3. Install

```json
{ "path": "…/lab/plugins/my-plugin", "profile": "qoder-lab", "mode": "file" }
```

执行前：

1. 备份目标 profile 的四个文件到 `~/.dsh/backups/<timestamp>-qoder-connect-<profile>-<rand>/`；
2. 运行 `dsh plugin --profile <profile> add file:<lab path>`（`link` 模式用 `link:`）；
3. 把命令、退出码、输出尾部、backup id 写入 `lab/ops.ndjson`。

注意：`file:` 是复制安装，`link:` 是软链。开发迭代用 `link:` 更方便，但软链指向 lab 目录；交付验证用 `file:` 更接近真实安装。

### 4. Verify

- `boot:false`（默认）：运行 `dsh --profile <profile> --dump-config`，返回配置里的插件 id、stderr 告警、是否出现 `patch: entry` / `did not activate`。
- `boot:true`：临时启动 host，解析 `dsh web: http://127.0.0.1:<port>/?token=…`，GET 一次，然后终止整个进程树。目标 profile 需要 web app；纯 headless/minimal profile 不适合 boot 验证。

### 5. Learn / Export

每次安装、验证、失败都建议写一条学习记录：

```json
{
  "title": "my-plugin: bundle patch id must match package name",
  "body": "dump-config 没有条目，原因是 patch id 用了目录名而不是 package.json name。",
  "topic": "dsh-plugin-dev",
  "tags": ["bundle", "patch"],
  "source": "run-…"
}
```

然后 `export` 成 Markdown，筛选后写入 QMind。

### 6. Uninstall / Restore

```json
{ "name": "my-plugin", "profile": "qoder-lab" }
```

卸载同样先备份。恢复：

```json
{ "backupId": "20261020-…-qoder-lab-abc123", "confirm": "20261020-…-qoder-lab-abc123" }
```

恢复前会再创建一个 `pre-restore` 备份，避免“回滚本身丢失当前状态”。

## Skill 闭环

```json
{ "kind": "skill", "name": "my-skill", "description": "What it does and when to use it" }
```

生成 `SKILL.md` + `references/notes.md`。实验室**不会**自动安装到 Qoder 的用户 Skill 目录；成熟后再由用户或 `skill install` 命令复制。

## 目录与台账

```text
~/.qoder-dsh-connect/
├─ runs.ndjson              # 运行摘要
├─ learnings.ndjson         # 学习记录
├─ runs/<run-id>.ndjson     # 原始事件
└─ lab/
   ├─ plugins/<name>/
   ├─ skills/<name>/
   └─ ops.ndjson            # 实验室操作日志
```

备份：

```text
~/.dsh/backups/<timestamp>-qoder-connect-<profile>-<rand>/
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ cordis.patch.yml
└─ backup.json
```

## 失败处理

| 症状 | 处理 |
| --- | --- |
| install 502 | 看返回的 `stderr`；确认 profile 存在、pnpm 可执行、包名不冲突 |
| `dump-config` 没有条码 | 检查 patch id/name 与 package.json 是否一致 |
| boot 验证超时 | profile 可能缺少 web app，或慢插件拖慢启动；先用 `boot:false` |
| restore 403 | 备份所属 profile 已不在白名单；先修配置或手动处理 |
| 当前 profile 被拒绝 | 这是预期安全行为；换独立 lab profile，或明确接受 `allowCurrentProfile` |

## 设计原则

- **不替用户改共享状态**：所有写入都显式、可回滚、可审计。
- **不装任意包**：只接受 lab 目录内、通过静态检查的插件目录；不是通用 npm 安装器。
- **不碰凭据**：备份只含四个 profile 配置文件。

## 已知限制

- 实验室只拒绝**当前宿主 profile**；它无法知道另一个 host 是否正在使用目标 lab profile。安装/验证前请确认目标 profile 没有被别的宿主占用。
- 备份与恢复只覆盖 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.patch.yml`，**不覆盖 `node_modules` 或 pnpm 共享 store**。需要完全干净的回滚时，使用独立 lab profile，或重新安装该 profile 的依赖。
- `link:` 模式依赖 lab 目录存在；删除 lab 会让插件失效。交付验证优先用 `file:`。
- 实验室不是通用包管理器：它不会替你从市场下载并安装任意 npm 包。
