# Market research

[English home](../../README.md) · [中文](../market.md)

The plugin treats dsh plugin markets as read-only research sources: search, compare, and inspect installation metadata. Market queries do not install packages.

## Configure sources

There is no default index. Configure one explicitly, or use a host-provided `ctx.pluginMarket` service:

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

- `indexes` accepts URL strings or `{url, title}` objects.
- URLs must use `http:` or `https:` and must not contain a username or password.
- With `allowAdHocIndexes: false`, a request's `url` must match a configured source. Enabling it permits other index URLs; the HTTP API remains protected by the loopback request guard.
- With no configured or available host source, `/market/sources` returns an empty list and `/market/search` returns `409`.

The URLs above are configuration examples, not a certification of any index or package.

## Supported formats

### format-1

Example structure:

```json
{
  "format": 1,
  "title": "Index",
  "metadata": {},
  "plugins": [
    {
      "name": "pkg",
      "title": { "en": "Pkg" },
      "description": { "en": "Example plugin" },
      "author": "Example author",
      "homepage": "https://example.com/pkg",
      "repository": { "url": "https://github.com/example/pkg" },
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

Raw format-1 installation information belongs in each version's `source`; `publishTimestamp` is a Unix timestamp in seconds. For npm sources, the plugin derives `{spec: "pkg@1.0.0", registry?}`. For Git sources, it derives a spec pinned to a full commit, such as `git+https://example.com/repo.git#<commit>&path:/<package-dir>`, and preserves `source`.

If an index already supplies `install`, that value is retained. The host market service adds `compatibility`; raw HTTP indexes do not necessarily include it.

### Community `plugins.json`

Community indexes such as `awesome-dsh-plugin.com/plugins.json` use a flat format. The following values are illustrative:

```json
{
  "name": "Example community index",
  "url": "https://example.com",
  "updated": "2026-10-29",
  "count": 1,
  "plugins": [
    {
      "name": "example-plugin",
      "owner": "example-owner",
      "url": "https://github.com/example/example-plugin",
      "page": "https://example.com/p/example-plugin",
      "category": "model",
      "description": { "en": "Example plugin", "zh": "示例插件" },
      "npm": "example-plugin",
      "version": "0.1.0",
      "stars": 10,
      "downloads": 100,
      "capabilities": ["shell", "network"],
      "install": "dsh plugin --profile web add example-plugin"
    }
  ]
}
```

The plugin selects format-1 when `format: 1` is present; otherwise it uses the community format. It normalizes both into common fields:

| Field | Source |
| --- | --- |
| `name` | `npm` or `name` for community entries |
| `author` | Community `owner` |
| `repository` | Community `url` |
| `homepage` | Community `page` or `url` |
| `category` | Entry category |
| `install` | Existing installation metadata, or a target derived from a format-1 version's `source` |
| `source` | The selected format-1 version's source |
| `stars` / `downloads` | Community index values |
| `capabilities` | Index metadata |
| `versions` | A condensed format-1 version list; one version for community entries |

## Host `pluginMarket`

If the profile provides `@deepseek-ai/dsh-plugin-market`, `/market/sources` lists it as a source with `kind: "host"`. Searches and entry requests can be delegated to that service.

The host service generally needs its own configured index. An unconfigured service may return an empty list or an error; HTTP sources remain available independently.

## Query the API

Use the actual local host address and any required authentication. These examples use port `3080`:

```bash
# List sources
curl -s http://127.0.0.1:3080/api/qoder-dsh-connect/market/sources

# Search
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/search?text=workbuddy&limit=5'

# Read one entry
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/entry?name=dsh-workbuddy-connect'

# Include the raw entry
curl -s 'http://127.0.0.1:3080/api/qoder-dsh-connect/market/entry?name=dsh-workbuddy-connect&full=1'
```

Search parameters:

- `text`: match and score name, title, author, category, description, keywords, and capabilities.
- `category`: exact category match.
- `sort`: `relevance` by default when text is supplied, `index`, or `stars`.
- `offset` and `limit`: pagination, with a limit of 1–100.
- `refresh=1`: bypass the cache.
- `full=1`: include raw records.

## Cache and limits

- Each URL is cached for five minutes by default, controlled by `cacheMs`.
- The cache holds at most 16 indexes and evicts the least recently used entry. `cacheMs: 0` disables cache storage.
- Index responses are capped at 4 MiB by default, controlled by `maxBytes`.
- The default fetch timeout, `timeoutMs`, is 15 seconds.
- Searches filter normalized entries in memory, suitable for indexes containing a few thousand entries.

## Research workflow

1. Read capabilities and installation metadata, then check version requirements.
2. Treat stars and downloads as context, not a security endorsement.
3. Use a separate profile and the [lab workflow](lab.md) before installing into a working profile.
4. Save conclusions in the learning ledger with topic `plugin-market` and the source URL.
