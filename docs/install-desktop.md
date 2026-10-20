# 安装到 dsh Desktop profile

桌面端使用 `desktop` profile。插件格式与 Web 完全相同，只是 CLI 路径和 profile 名不同。

## 找到桌面端 CLI

Windows 默认路径：

```text
C:/Users/<you>/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd
```

```bash
DSH="C:/Users/<you>/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd"
"$DSH" --version
```

桌面端 CLI 不一定在 PATH 里。不要从日志或注册表里翻 token；用桌面端自己打印的地址。

## 备份

```bash
DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.dsh/backups/$DATE-qoder-connect-desktop
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml; do
  [ -f ~/.dsh/profiles/desktop/$f ] && cp ~/.dsh/profiles/desktop/$f ~/.dsh/backups/$DATE-qoder-connect-desktop/
done
```

完全退出桌面端后再安装，避免宿主占用 `node_modules`。

## 安装

```bash
"$DSH" plugin --profile desktop add "file:C:/path/to/qoder-dsh-connect/packages/dsh-plugin-qoder-connect"
"$DSH" --profile desktop --dump-config | grep -A3 qoder-dsh-connect
```

然后重新启动桌面端。桌面端会自动加载 `desktop` profile。

## 验证

桌面端宿主端口和 token 由应用管理。最稳妥的验证方式：

1. 重启桌面端；
2. 在桌面端内确认没有插件加载失败提示；
3. 用桌面端允许的方式打开本地 API 地址，访问：

```text
/api/qoder-dsh-connect/status
```

如果桌面端 host 要求 token，使用它自己打印的带 token URL，不要手写猜测。

Qoder 侧连接时把 `QODER_DSH_CONNECT_URL` 设为桌面端实际地址；token 通过
`QODER_DSH_CONNECT_TOKEN` 提供。

如果 `/status` 显示 `ready:false`，说明宿主没有自动解析到 dsh CLI。把插件配置的 `bin` 指向
桌面端 runtime 里的 `@deepseek-ai/dsh/lib/bin.js`；不要指向 `.cmd` 包装器（实验室只接受
`bin.js`，因为子进程使用 `process.execPath` + argv 启动）。

## 注意

- 不要同时启动两个使用同一 `desktop` profile 的 host。
- 桌面端可能自带插件市场或宠物类插件；安装前先：

```bash
"$DSH" plugin --profile desktop list
```

- 桌面端升级后，CLI 路径可能随版本目录变化；重新确认路径，再重跑 `dump-config`。
- 实验室默认关闭；桌面端同样建议只操作独立实验 profile，不要直接改 `desktop`。

## 卸载

```bash
"$DSH" plugin --profile desktop remove qoder-dsh-connect
```

退出桌面端后操作，完成后再启动。
