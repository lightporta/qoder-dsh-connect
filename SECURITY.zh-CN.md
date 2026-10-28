# Security Policy

[English](SECURITY.md) | 简体中文

## 报告漏洞

不要在公开 issue 中披露 token、凭据、可利用细节或用户数据。请使用 GitHub Security Advisory（私密报告）或直接联系维护者。

## 范围

重点关注：

- loopback/token 栅栏绕过；
- 命令注入或 shell 逃逸；
- 实验室路径越界或任意 profile 写入；
- 子进程未终止/孤儿进程；
- 市场响应导致的资源耗尽；
- 凭据泄漏到日志、台账、响应。

## 运行建议

- 不要把 dsh host 暴露到 `0.0.0.0` 或公网。
- 给插件配置随机 `token`，不要提交到 Git。
- 实验室使用独立 profile；不要打开 `allowCurrentProfile`，除非你明确接受重启与风险。
- 委派任务视为拥有真实文件/命令权限的 agent；只给它必要的范围。
