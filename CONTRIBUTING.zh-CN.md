# Contributing

[English](CONTRIBUTING.md) | 简体中文

## 开发

```bash
npm test
npm run check
```

不需要 `npm install`；仓库没有第三方运行时依赖。

## 代码约定

- 只用 Node 内置模块；新增依赖前先说明理由。
- 宿主插件代码放在 `packages/dsh-plugin-qoder-connect/lib`，客户端放在 `packages/qoder-dsh-connect-cli/lib`。
- 任何启动子进程的地方必须用 argv 数组 + `shell: false`；任务/用户文本走 stdin 或参数值，不拼命令行。
- 路由必须走 loopback 栅栏；新增写操作要评估备份/回滚。
- 不读取、不记录、不返回凭据。
- 注释只写“为什么”和非显而易见的约束，不复述代码。

## 测试

- 单元/集成测试使用 `node:test` 和 `test/fixtures/fake-dsh.mjs`，不消耗真实模型调用。
- 真实 dsh 冒烟用 `npm run smoke`，会产生一次模型调用。
- 对运行中宿主做 E2E 用 `node packages/dsh-plugin-qoder-connect/test/live.mjs <url>`。

## 提交

- 一个 PR 聚焦一个改动。
- 先跑测试和 check。
- 如果改动 API、配置、安全边界或兼容版本，同步更新 `docs/` 和 `CHANGELOG.md`。
