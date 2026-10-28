const CONDENSED_VERSIONS = 3
const MAX_CACHED_INDEXES = 16

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function versionsOf(entry) {
  return Array.isArray(entry.versions) ? entry.versions.filter(isRecord) : []
}

function installTarget(name, version) {
  if (version?.install !== undefined) return version.install
  if (typeof name !== 'string') return undefined
  const source = version?.source
  if (source?.type === 'npm' && typeof version.version === 'string' && version.version.length > 0
    && (source.registry === undefined || httpUrl(source.registry) !== undefined)) {
    return { spec: `${name}@${version.version}`, ...(source.registry === undefined ? {} : { registry: source.registry }) }
  }
  if (source?.type === 'git' && httpUrl(source.url) !== undefined
    && typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit)
    && (source.path === undefined || (typeof source.path === 'string' && source.path.length > 0
      && source.path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
      && !/[\\#&]/.test(source.path)))) {
    const repository = source.url.endsWith('.git') ? source.url : `${source.url}.git`
    return { spec: `git+${repository}#${source.commit}${source.path === undefined ? '' : `&path:/${source.path}`}` }
  }
  return undefined
}

function text(value) {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  for (const key of ['zh-CN', 'zh', 'en-US', 'en']) {
    if (typeof value[key] === 'string') return value[key]
  }
  return Object.values(value).find(candidate => typeof candidate === 'string')
}

function repositoryUrl(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.url === 'string') return value.url
  return undefined
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizeVersions(entry, selected) {
  const listed = versionsOf(entry)
  return listed.slice(0, CONDENSED_VERSIONS).map(candidate => ({
    version: candidate.version,
    publishedAt: candidate.publishTimestamp ?? candidate.publishedAt,
    enginesDsh: candidate.engines?.dsh,
    compatible: candidate.compatibility?.compatible,
    requirements: candidate.compatibility?.compatible === false ? candidate.compatibility.requirements : undefined,
    source: candidate.source,
  })).concat(selected !== undefined && listed.length === 0 ? [{
    version: selected,
    publishedAt: entry.added,
    enginesDsh: undefined,
    compatible: undefined,
    requirements: undefined,
  }] : [])
}

function normalizeFormatOne(entry) {
  const versions = versionsOf(entry)
  const defaultVersion = entry.defaultVersion ?? versions[0]?.version
  const chosen = versions.find(candidate => candidate.version === defaultVersion) ?? versions[0]
  return {
    name: entry.name,
    title: text(entry.title) ?? entry.name,
    description: text(entry.description),
    author: entry.author,
    homepage: entry.homepage,
    repository: repositoryUrl(entry.repository),
    category: entry.metadata?.category,
    keywords: entry.metadata?.keywords ?? [],
    labels: entry.metadata?.labels ?? [],
    capabilities: entry.metadata?.capabilities,
    defaultVersion,
    install: installTarget(entry.name, chosen),
    source: chosen?.source ?? entry.source,
    versionCount: versions.length,
    versions: normalizeVersions(entry, defaultVersion),
  }
}

function normalizeCommunity(entry) {
  const name = entry.npm ?? entry.name
  return {
    name,
    title: entry.name ?? name,
    description: text(entry.description),
    author: entry.owner,
    homepage: entry.page ?? entry.url,
    repository: entry.url,
    category: entry.category,
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    labels: [],
    capabilities: entry.capabilities,
    capabilityRedLines: entry.capabilityRedLines,
    defaultVersion: entry.version,
    install: entry.install,
    stars: entry.stars,
    downloads: entry.downloads,
    page: entry.page,
    screenshots: Array.isArray(entry.screenshots) ? entry.screenshots.slice(0, 4) : undefined,
    versionCount: entry.version === undefined ? 0 : 1,
    versions: normalizeVersions(entry, entry.version),
  }
}

function normalizeHost(entry) {
  const versions = versionsOf(entry)
  const defaultVersion = entry.defaultVersion ?? versions[0]?.version
  const byDefault = versions.find(candidate => candidate.version === defaultVersion) ?? versions[0]
  return {
    name: entry.name,
    title: text(entry.title) ?? entry.name,
    description: text(entry.description),
    author: entry.author,
    homepage: entry.homepage,
    repository: repositoryUrl(entry.repository),
    category: entry.metadata?.category,
    keywords: entry.metadata?.keywords ?? [],
    labels: entry.metadata?.labels ?? [],
    defaultVersion,
    installation: entry.installation,
    install: installTarget(entry.name, byDefault),
    source: byDefault?.source,
    versionCount: versions.length,
    versions: normalizeVersions(entry, defaultVersion),
  }
}

function detectFormat(document) {
  if (document === null || typeof document !== 'object') return { error: 'index is not a JSON object' }
  if (Array.isArray(document.plugins)) {
    return { format: document.format === 1 ? 'format-1' : 'community', entries: document.plugins }
  }
  if (Array.isArray(document)) return { format: 'array', entries: document }
  return { error: 'index has no `plugins` array (format-1 or community index required)' }
}

function normalizeConfigured(indexes) {
  if (!Array.isArray(indexes)) return []
  const sources = []
  for (const item of indexes) {
    const candidate = typeof item === 'string' ? { url: item } : item
    if (candidate === null || typeof candidate !== 'object') continue
    const url = httpUrl(candidate.url)
    if (url === undefined) continue
    sources.push({ url, title: typeof candidate.title === 'string' ? candidate.title : undefined })
  }
  return sources
}

function scoreEntry(entry, query) {
  const needle = query.toLowerCase()
  const fields = [
    [entry.name, 12],
    [entry.title, 10],
    [entry.author, 5],
    [entry.category, 4],
    [entry.description, 3],
    ...(Array.isArray(entry.keywords) ? entry.keywords.map(value => [value, 2]) : []),
    ...(Array.isArray(entry.capabilities) ? entry.capabilities.map(value => [value, 1]) : []),
  ]
  let score = 0
  for (const [value, weight] of fields) {
    if (typeof value !== 'string') continue
    const field = value.toLowerCase()
    if (field === needle) score += weight * 4
    else if (field.startsWith(needle)) score += weight * 2
    else if (field.includes(needle)) score += weight
  }
  return score
}

function compactEntry(entry, full) {
  if (full) return entry
  const { raw, _index, ...rest } = entry
  return rest
}

async function readBounded(response, maxBytes) {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        const error = new Error(`market index is larger than ${maxBytes} bytes`)
        error.status = 502
        throw error
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export function createMarket({ ctx, config, warn = () => {} }) {
  const configured = normalizeConfigured(config.indexes)
  const cache = new Map()

  function hostService() {
    try {
      return typeof ctx?.get === 'function' ? ctx.get('pluginMarket') : undefined
    } catch {
      return undefined
    }
  }

  function hostIndexes() {
    const service = hostService()
    if (service === undefined) return []
    try {
      const indexes = service.listIndexes()
      return Array.isArray(indexes) ? indexes : []
    } catch (error) {
      warn(`pluginMarket.listIndexes failed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  function sources() {
    const httpSources = configured.map(item => ({
      id: `http:${item.url}`,
      kind: 'http',
      url: item.url,
      title: item.title,
    }))
    const seen = new Set(httpSources.map(source => source.url))
    const hostSources = hostIndexes()
      .filter(item => typeof item?.url === 'string' && !seen.has(item.url))
      .map(item => ({
        id: `host:${item.url}`,
        kind: 'host',
        url: item.url,
        title: text(item.title),
        description: text(item.description),
        error: item.error,
      }))
    return config.preferHost ? [...hostSources, ...httpSources] : [...httpSources, ...hostSources]
  }

  function resolveSource({ source, url }) {
    const available = sources()
    if (source !== undefined) {
      const found = available.find(candidate => candidate.id === source || candidate.url === source)
      if (found === undefined) {
        const error = new Error(`unknown market source: ${source}`)
        error.status = 400
        throw error
      }
      return found
    }
    if (url !== undefined) {
      const found = available.find(candidate => candidate.url === url)
      if (found !== undefined) return found
      if (config.allowAdHocIndexes === true && httpUrl(url) !== undefined) {
        return { id: `http:${httpUrl(url)}`, kind: 'http', url: httpUrl(url) }
      }
      const error = new Error('market url is not a configured source (set market.allowAdHocIndexes to permit ad-hoc indexes)')
      error.status = 400
      throw error
    }
    if (available.length === 0) {
      const error = new Error('no market source is configured: set market.indexes to an explicit index URL, or mount the host pluginMarket service')
      error.status = 409
      throw error
    }
    return available[0]
  }

  async function loadHttp(source, refresh) {
    const cached = cache.get(source.url)
    if (refresh !== true && cached !== undefined && Date.now() - cached.fetchedAt < config.cacheMs) {
      cache.delete(source.url)
      cache.set(source.url, cached)
      return cached
    }

    let response
    try {
      response = await fetch(source.url, {
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'follow',
      })
    } catch (error) {
      const failure = new Error(`market index fetch failed: ${error instanceof Error ? error.message : String(error)}`)
      failure.status = 502
      throw failure
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const error = new Error(`market index returned HTTP ${response.status}`)
      error.status = 502
      throw error
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > config.maxBytes) {
      await response.body?.cancel().catch(() => {})
      const error = new Error(`market index is larger than ${config.maxBytes} bytes`)
      error.status = 502
      throw error
    }
    let buffer
    try {
      buffer = await readBounded(response, config.maxBytes)
    } catch (error) {
      const failure = new Error(`market index read failed: ${error instanceof Error ? error.message : String(error)}`)
      failure.status = 502
      throw failure
    }

    let document
    try {
      document = JSON.parse(buffer.toString('utf8'))
    } catch {
      const error = new Error('market index is not valid JSON')
      error.status = 502
      throw error
    }
    const detected = detectFormat(document)
    if (detected.error !== undefined) {
      const error = new Error(detected.error)
      error.status = 502
      throw error
    }
    const normalized = []
    for (const [index, raw] of detected.entries.entries()) {
      if (!isRecord(raw)) continue
      const entry = detected.format === 'format-1' ? normalizeFormatOne(raw) : normalizeCommunity(raw)
      if (typeof entry.name !== 'string' || entry.name.length === 0) continue
      normalized.push({ ...entry, _index: index, raw })
    }

    const record = {
      source,
      format: detected.format,
      fetchedAt: Date.now(),
      title: text(document.title) ?? source.title,
      entries: normalized,
    }
    for (const [url, entry] of cache) {
      if (Date.now() - entry.fetchedAt >= config.cacheMs) cache.delete(url)
    }
    cache.delete(source.url)
    if (config.cacheMs > 0) cache.set(source.url, record)
    while (cache.size > MAX_CACHED_INDEXES) cache.delete(cache.keys().next().value)
    return record
  }

  async function searchHttp(source, query) {
    const loaded = await loadHttp(source, query.refresh)
    const textNeedle = typeof query.text === 'string' ? query.text.trim() : ''
    const category = typeof query.category === 'string' ? query.category.trim() : ''
    let entries = loaded.entries
    if (category.length > 0) entries = entries.filter(entry => entry.category === category)
    if (textNeedle.length > 0) {
      entries = entries
        .map(entry => ({ entry, score: scoreEntry(entry, textNeedle) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.entry._index - right.entry._index)
        .map(item => item.entry)
    } else if (query.sort === 'stars') {
      entries = entries.slice().sort((left, right) => (right.stars ?? 0) - (left.stars ?? 0))
    }
    const offset = query.offset
    const limit = query.limit
    const page = entries.slice(offset, offset + limit)
    return {
      source,
      format: loaded.format,
      title: loaded.title,
      fetchedAt: loaded.fetchedAt,
      total: entries.length,
      count: page.length,
      nextOffset: offset + page.length < entries.length ? offset + page.length : undefined,
      entries: page.map(entry => compactEntry(entry, query.full)),
    }
  }

  async function searchHost(source, query) {
    const service = hostService()
    if (service === undefined) {
      const error = new Error('this host mounts no pluginMarket service')
      error.status = 503
      throw error
    }
    const result = await service.search(source.url, {
      ...(typeof query.text === 'string' && query.text.length > 0 ? { text: query.text } : {}),
      ...(typeof query.category === 'string' && query.category.length > 0 ? { category: query.category } : {}),
      sort: query.sort === 'stars' ? { kind: 'index' } : { kind: query.text ? 'relevance' : 'index' },
      offset: query.offset,
      limit: query.limit,
      ...(query.refresh === true ? { refresh: true } : {}),
    })
    const entries = Array.isArray(result.entries) ? result.entries.filter(isRecord) : []
    return {
      source,
      format: 'host',
      title: text(result.title) ?? source.title,
      fetchedAt: result.fetchedAt ?? Date.now(),
      total: result.total ?? entries.length,
      count: entries.length,
      nextOffset: result.nextOffset,
      entries: entries.map(entry => compactEntry({ ...normalizeHost(entry), raw: query.full ? entry : undefined }, query.full)),
    }
  }

  return {
    available() {
      return sources().length > 0
    },

    sources() {
      return {
        available: sources().length > 0,
        preferHost: config.preferHost === true,
        hostAvailable: hostService() !== undefined,
        sources: sources(),
      }
    },

    async search(query) {
      const source = resolveSource(query)
      return source.kind === 'host' ? searchHost(source, query) : searchHttp(source, query)
    },

    async entry(query) {
      if (typeof query.name !== 'string' || query.name.length === 0) {
        const error = new Error('name is required')
        error.status = 400
        throw error
      }
      const source = resolveSource(query)
      if (source.kind === 'host') {
        const service = hostService()
        if (service === undefined) {
          const error = new Error('this host mounts no pluginMarket service')
          error.status = 503
          throw error
        }
        const entry = await service.entry(source.url, query.name)
        if (entry === undefined) return undefined
        return compactEntry({ ...normalizeHost(entry), raw: query.full ? entry : undefined }, query.full)
      }
      const loaded = await loadHttp(source, query.refresh)
      const found = loaded.entries.find(entry => entry.name === query.name)
      if (found === undefined) return undefined
      return compactEntry(found, query.full)
    },
  }
}
