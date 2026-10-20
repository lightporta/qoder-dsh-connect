# 安全模型

## 资产

- 本机 dsh 的模型凭据、工具权限、文件系统访问；
- dsh profile 配置与已安装插件；
- 运行台账、学习记录、实验插件源码。

## 信任边界

```text
Qoder / 本机进程
  │  loopback + 可选 token
  ▼
宿主插件（dsh web/desktop）
  ├─ headless 子进程（拥有真实凭据与工具）
  ├─ 市场 HTTP 拉取（只读）
  └─ 实验室（受控 profile 写入）
```

插件不扩大本机能力：任何本地进程本来就能自己启动 `dsh --profile headless`。它增加的是便利、可观测性和回滚，不是新的权限。

## Loopback 栅栏

- 套接字地址是权威来源：只允许 127/8、`::1`、`::ffff:127/8`。
- `Host` 头必须指向 loopback。
- 拒绝 `sec-fetch-site: cross-site`。
- 有 `Origin` 时必须与 Host 同源。
- 永不信任 `X-Forwarded-For`。

这防止把“启动自主 agent”的能力暴露给局域网。它**不是**本机用户之间的权限边界。

## Token

- 可选 `token`，设置后所有路由要求 Bearer / `x-qoder-token` / query token。
- 比较使用 `timingSafeEqual`。
- token 不写入台账、日志或响应；CLI 不会打印它。
- 如果宿主本身有 token 栅栏，使用宿主打印的带 token URL；不要从日志/注册表翻凭据。

## 子进程

- `spawn(process.execPath, [bin, ...args], { shell: false })`。
- 任务文本走 stdin，不进入 argv。
- 请求体、任务长度、行缓冲、stderr、日志尾部都有上限。
- 墙钟超时、显式 kill、插件卸载三条路径都会终止子进程树；POSIX 下子进程进入独立进程组，
  先 SIGTERM 再 SIGKILL；Windows 上 SIGTERM 后升级为 `taskkill /pid <pid> /T /F`。
- 子进程继承宿主环境（包括模型凭据）。这是设计目标，也意味着委派任务必须是可信的。

## 市场

- 只允许已配置的 source；`allowAdHocIndexes` 默认关闭。
- 只接受 http/https，拒绝 URL 内嵌凭据。
- 响应大小、拉取超时、缓存 TTL 都有上限。
- 市场只读：不安装、不改索引、不写宿主配置。
- 社区索引的 `capabilities`/`stars` 不是安全背书。

## 实验室

- 默认关闭；profile 写入必须显式开启。
- 目标 profile 必须在白名单；当前宿主 profile 默认拒绝。
- 只接受 lab 目录内、静态检查通过的插件目录；不是通用 npm 安装器。
- 安装/卸载前备份 profile 的四个配置文件；恢复前再备份一次。
- 操作日志记录命令、退出码、输出尾部、backup id。
- 备份不包含 `credentials.yaml`、`.npmrc`、token。
- 实验室的 boot 输出、URL、命令 stdout/stderr 和引擎 stderr 会脱敏 token、Bearer、CSV/API key；`verify` 不返回完整 `dump-config`，只返回插件 id 和告警。

## 明确不做

- 不提供远程访问、反向代理或 0.0.0.0 绑定。
- 不自动打开 job controller、不自动改 profile patch。
- 不扫描或上传凭据。
- 不在返回体里回显完整环境变量。

## 已知限制

- 本机其他进程可以绕过插件直接读文件/起进程；loopback 栅栏不防本机恶意进程。
- 子代理拥有和宿主相同的权限；提示注入或恶意任务可能造成真实文件改动。
- 市场索引是外部内容，字段和链接不可全信。
- 台账会保存任务文本、工具输入/输出和运行结果；它们是本机数据，按敏感文件保护。
- 实验室的 `link:` 模式依赖 lab 目录存在；删除 lab 会导致插件失效。
- 实验室只备份 profile 的四个配置文件，不备份 `node_modules` 或 pnpm 共享 store；依赖层的变化需要用户自行恢复。
- dsh 仍是 developer preview，升级后 API 可能变化；升级后重跑验证三连。

## 报告问题

如果你发现安全问题，请不要在公开 issue 里贴 token、凭据或可利用细节。先私下联系仓库维护者，或在 GitHub Security Advisory 中报告。
