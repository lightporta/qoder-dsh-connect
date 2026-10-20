# 发布到 GitHub / npm

仓库已经按 `lightporta/qoder-dsh-connect` 配置好 GitHub 元数据。下面的检查用于确认信息一致。

## 1. 确认身份信息

- 两个包的 `package.json` 已写入 `repository` / `homepage` / `bugs`，指向
  `https://github.com/lightporta/qoder-dsh-connect`。
- `LICENSE` 版权人为 **Asher Zeqi**。
- 文档里的 `<repo>`、`<you>` 是本地路径占位符（例如克隆目录、Windows 用户名），不是 GitHub
  身份；保留它们可以让文档适用于其他机器。
- `examples/mcp.json` 和文档里的绝对路径是模板，按你的实际克隆位置替换。
- 如果以后改仓库名或转组织，同步修改两个包的 `repository` / `homepage` / `bugs` 和本文档里的 URL。

## 2. 发布前检查

```bash
npm test
npm run check
git status
git diff --check
```

确认：

- 没有 `.env`、token、`credentials.yaml`、`.npmrc`；
- 没有把 `/tmp` 或本机绝对路径写进包源码；
- `cordis.patch.yml` 的 id/name 与包名一致；
- `files` 字段包含 `lib`、`cordis.patch.yml`、`assets`、`README.md`；
- Skill frontmatter 完整；
- CI 通过（Node 22/24）。

## 3. GitHub 仓库

```bash
# 如果本机还没有 git 身份
git config --global user.name "Asher Zeqi"
git config --global user.email "<你的 GitHub 邮箱或 GitHub noreply 地址>"

git init
git add .
git commit -m "feat: initial qoder-dsh-connect bridge"
git branch -M main
git remote add origin https://github.com/lightporta/qoder-dsh-connect.git
git push -u origin main
```

建议开启：

- GitHub Actions（仓库已带 `.github/workflows/ci.yml`）；
- Issues；
- Security advisories；
- 如果以后发布 npm，开启 Trusted Publishing 或 2FA。

## 4. 作为 dsh 插件分发

用户可以直接从 GitHub clone 后本地安装：

```bash
git clone https://github.com/lightporta/qoder-dsh-connect.git
dsh plugin --profile web add "file:<clone>/packages/dsh-plugin-qoder-connect"
```

如果发布到 npm：

```bash
cd packages/dsh-plugin-qoder-connect
npm publish --access public
```

然后：

```bash
dsh plugin --profile web add qoder-dsh-connect
```

发布前确认 `package.json` 没有 `private: true`，且 `repository`/`homepage`/`author` 已指向
`lightporta/qoder-dsh-connect` 和 **Asher Zeqi**。

## 5. 作为市场条目

dsh 官方市场使用 format-1 索引。一个最小条目：

```json
{
  "name": "qoder-dsh-connect",
  "versions": [
    {
      "version": "0.1.0",
      "publishTimestamp": "2026-10-20T00:00:00Z",
      "source": "https://registry.npmjs.org/qoder-dsh-connect/-/qoder-dsh-connect-0.1.0.tgz",
      "engines": { "dsh": "^0.2.1" },
      "install": "qoder-dsh-connect@0.1.0"
    }
  ],
  "metadata": {
    "category": "integration",
    "keywords": ["qoder", "subagent", "mcp", "plugin-market", "plugin-lab"],
    "labels": ["host-only"]
  }
}
```

社区 `awesome-dsh-plugin.com` 使用另一套平铺格式；按该站要求提交即可。插件本身两种格式都能读。

## 6. 版本与变更

- 宿主和 CLI 版本目前都是 `0.1.0`，可以分别发布。
- 修改 API/配置时更新 `CHANGELOG.md` 和文档。
- 升级 dsh 内核后，重跑 `npm test`、真实 smoke、live E2E，并更新兼容性说明。

## 7. 发布清单

- [ ] `npm test` / `npm run check` 通过
- [ ] README 里的安装命令可从干净 clone 复现
- [ ] 两个 `package.json` 的 repository/homepage/author 已指向 lightporta / Asher Zeqi
- [ ] LICENSE 版权人为 Asher Zeqi
- [ ] 没有凭据或本机敏感路径
- [ ] GitHub Actions 通过
- [ ] 如果发布 npm：`npm pack --dry-run` 检查包内容
- [ ] 如果提交市场：索引格式、版本、install 参数与包一致
