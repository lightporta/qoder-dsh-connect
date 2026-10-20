# Changelog

## 0.1.0 — 2026-10-20

- 初版：dsh 宿主插件 + Qoder CLI/MCP + Skill。
- 子代理委派：headless 子进程、会话续接、并发、超时、进程树终止、job 镜像降级。
- 台账：运行摘要、事件日志、学习记录、Markdown 导出。
- 市场：format-1 / 社区索引 / host pluginMarket，缓存、大小/超时限制。
- 实验室：插件/Skill scaffold、静态检查、白名单 profile 安装、备份、dump-config/boot 验证、回滚。
- 安全：loopback 栅栏、可选 token、无 shell、有界 IO、默认关闭实验室、诊断输出脱敏。
- 测试：33 项，使用假 dsh CLI，不消耗真实模型调用。
- 实测：dsh 0.2.1-rc.2 真实 headless 委派；独立临时 web profile 加载、status、委派、学习台账与 Markdown 导出通过。
