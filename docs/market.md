# 市场研究

[English](en/market.md) | 简体中文

插件把 dsh 插件市场当作**只读研究源**：搜索、比较、读取安装参数，不替用户安装。

## 配置 source

市场没有默认索引。必须显式配置，或依赖宿主挂载的 `ctx.pluginMarket`：

```yaml
- id: qoder-dsh-connect
  config:
    market:
      indexes:
        - url: https://awesome-dsh-plugin.com/plugins.json
          title: Community dsh market
        - url: https://your-mirror.example/dsh-index.json
          title: Internal mirror
      preferHost: true
      allowAdHocIndexes: false
      timeoutMs: 15000
      cacheMs: 300000
      maxBytes: 4194304
```

- `indexes` 支持字符串或 `{url, title}`。
- 只接受 `http:`/`https:`，URL 里不能带用户名/密码。
- `allowAdHocIndexes: false` 时，`?url=` 必须是已配置 source；打开后才会拉任意 URL，仍受 loopback 栅栏限制。
- 不提供索引时 `/market/sources` 返回空列表，`/market/search` 返回 `409`。

## 支持的格式

### format-1

```json
{
  "format": 1,
  "title": "Index",
  "metadata": {},
  "plugins": [
    {
      "name": "pkg",
      "title": { "en": "Pkg" },
      "description": { "en": "…" },
      "author": "…",
      "homepage": "…",
      "repository": { "url": "…" },
      "versions": [
        {
          "version": "1.0.0",
          "publishTimestamp": 1767225600,
          "source": { "type": "npm", "registry": "https://registry.npmjs.org" },
          "engines": { "dsh": "^0.2.1" }
        }
      ],
      "metadata": { "category": "tools", "keywords": [], "labels": [] }
    }
  ]
}
```

原始 format-1 的安装来源在各版本的 `source` 中。插件从 npm 来源生成 `{spec: "pkg@1.0.0", registry?}`；Git 来源生成固定到完整 commit 的 `git+https://…git#<commit>&path:/<package-dir>` spec，并保留 `source`。已有索引提供 `install` 时仍保留该字段。`compatibility` 由宿主市场服务补充，HTTP 原始索引不保证包含它。

### 社区 `plugins.json`

`awesome-dsh-plugin.com/plugins.json` 这类索引是平铺对象：

```json
{
  "name": "…",
  "url": "…",
  "updated": "…",
  "count": 6084,
  "plugins": [
    {
      "name": "dsh-workbuddy-connect",
      "owner": "corrinehu",
      "url": "https://github.com/…",
      "page": "https://awesome-dsh-plugin.com/p/…",
      "category": "model",
      "description": { "en": "…", "zh": "…" },
      "npm": "dsh-workbuddy-connect",
      "version": "0.7.9",
      "stars": 1450,
      "downloads": 46968,
      "capabilities": ["shell", "network"],
      "install": "dsh plugin --profile web add dsh-workbuddy-connect"
    }
  ]
}
```

插件会自动识别（有 `format: 1` 视为 format-1，否则按社区格式），并归一化为统一字段：

| 字段 | 来源 |
| --- | --- |
| `name` | `npm` 或 `name` |
| `author` | `owner` |
| `repository` | `url` |
| `homepage` | `page` 或 `url` |
| `category` | `category` |
| `install` | `install` |
| `stars` / `downloads` | 社区索引原字段 |
| `capabilities` | 社区索引原字段 |
| `versions` | format-1 的多版本；社区格式只有单版本 |

## 宿主 `pluginMarket`

如果 profile 挂载了 `@deepseek-ai/dsh-plugin-market`，`/market/sources` 会把它列成
`kind: "host"` 的 source；搜索/详情会透传该服务。

宿主服务通常没有默认索引；未配置时它可能返回空列表或错误。插件会优雅降级，不影响 HTTP source。

## 查询

```bash
# 列出 source
curl -s http://127.0.0.1:3080/api/qoder-dsh-connect/market/sources

# 搜索
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/search?text=workbuddy&limit=5'

# 单插件
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/entry?name=dsh-workbuddy-connect'

# 原始记录
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/entry?name=dsh-workbuddy-connect&full=1'
```

搜索参数：

- `text`：对 name/title/author/category/description/keywords/capabilities 做模糊匹配并打分；
- `category`：精确匹配；
- `sort`：`relevance`（默认有 text 时）/ `index` / `stars`；
- `offset`、`limit`（1..100）；
- `refresh=1`：绕过缓存；
- `full=1`：带原始记录。

## 缓存与限制

- 同一 URL 默认缓存 5 分钟（`cacheMs`）。
- 缓存最多保留 16 个索引，淘汰最久未使用的项；`cacheMs: 0` 不保存缓存。
- 每个索引响应上限 4 MiB（`maxBytes`），防止大文件拖垮宿主。
- 拉取超时 `timeoutMs`，默认 15 秒。
- 搜索在内存中对归一化后的条目过滤；几千条索引足够快。

## 研究建议

1. 先看 `capabilities` 和 `install`，再看版本兼容。
2. 社区索引的 `stars/downloads` 只是参考，不是安全背书。
3. 安装前走 [实验室](lab.md)，不要直接装进正在用的 profile。
4. 结论写入学习台账，`topic` 用 `plugin-market`，并保留 source URL。
