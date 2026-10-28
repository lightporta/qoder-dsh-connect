import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createMarket } from '../lib/market.js'

const formatOne = {
  format: 1,
  title: { en: 'Test index' },
  plugins: [
    {
      name: 'alpha-plugin',
      title: { en: 'Alpha Plugin' },
      description: { en: 'Reads and summarizes files' },
      author: 'alice',
      homepage: 'https://example.test/alpha',
      repository: { type: 'git', url: 'https://github.com/example/alpha' },
      defaultVersion: '1.2.0',
      versions: [
        {
          version: '1.2.0',
          publishTimestamp: '2026-01-01T00:00:00Z',
          install: 'alpha-plugin@1.2.0',
          engines: { dsh: '^0.2.1' },
          compatibility: { compatible: true },
        },
        { version: '1.0.0', publishTimestamp: '2025-01-01T00:00:00Z' },
      ],
      metadata: { category: 'tools', keywords: ['files', 'summary'], labels: ['stable'] },
    },
    {
      name: 'beta-plugin',
      title: { en: 'Beta UI' },
      description: { en: 'Adds a panel' },
      defaultVersion: '0.4.0',
      versions: [{ version: '0.4.0', install: 'beta-plugin@0.4.0', compatibility: { compatible: false, requirements: { dsh: '^0.3.0' } } }],
      metadata: { category: 'ui', keywords: ['panel'] },
    },
  ],
}

const community = {
  name: 'community',
  url: 'https://awesome.example/plugins.json',
  updated: '2026-10-20',
  count: 1,
  categories: [],
  plugins: [
    {
      name: 'dsh-workbuddy-connect',
      owner: 'corrinehu',
      url: 'https://github.com/corrinehu/dsh-workbuddy-connect',
      page: 'https://awesome.example/p/corrinehu/dsh-workbuddy-connect/',
      category: 'model',
      description: { en: 'Brings WorkBuddy models into DSH', zh: '把 WorkBuddy 的模型接进 DSH' },
      npm: 'dsh-workbuddy-connect',
      version: '0.7.9',
      stars: 1450,
      downloads: 46968,
      capabilities: ['shell', 'network'],
      install: 'dsh plugin --profile web add dsh-workbuddy-connect',
    },
  ],
}

async function serve(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

test('format-1 market supports sources, search, entry, pagination, and full records', async () => {
  let requests = 0
  const { server, base } = await serve((req, res) => {
    if (req.url === '/index.json') {
      requests += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatOne))
      return
    }
    res.writeHead(404).end()
  })
  try {
    const market = createMarket({
      ctx: { get: () => undefined },
      config: { indexes: [{ url: `${base}/index.json`, title: 'Local' }], preferHost: false, timeoutMs: 5000, cacheMs: 60000, maxBytes: 1024 * 1024 },
    })
    const sources = market.sources()
    assert.equal(sources.available, true)
    assert.equal(sources.sources.length, 1)
    assert.equal(sources.sources[0].kind, 'http')
    assert.equal(sources.sources[0].title, 'Local')

    const first = await market.search({ text: 'alpha', offset: 0, limit: 10 })
    assert.equal(first.count, 1)
    assert.equal(first.total, 1)
    assert.equal(first.entries[0].name, 'alpha-plugin')
    assert.equal(first.entries[0].install, 'alpha-plugin@1.2.0')
    assert.equal(first.entries[0].versions[0].enginesDsh, '^0.2.1')
    assert.equal(first.entries[0].raw, undefined)

    const ui = await market.search({ category: 'ui', offset: 0, limit: 10 })
    assert.equal(ui.count, 1)
    assert.equal(ui.entries[0].name, 'beta-plugin')
    assert.equal(ui.entries[0].versions[0].compatible, false)
    assert.equal(ui.entries[0].versions[0].requirements.dsh, '^0.3.0')

    const page = await market.search({ offset: 1, limit: 1 })
    assert.equal(page.count, 1)
    assert.equal(page.entries[0].name, 'beta-plugin')
    assert.equal(page.nextOffset, undefined)

    const full = await market.search({ text: 'alpha', offset: 0, limit: 1, full: true })
    assert.equal(full.entries[0].raw.name, 'alpha-plugin')

    const entry = await market.entry({ name: 'alpha-plugin' })
    assert.equal(entry.author, 'alice')
    assert.equal(entry.repository, 'https://github.com/example/alpha')

    assert.equal(requests, 1)
    await market.search({ text: 'beta', offset: 0, limit: 10 })
    assert.equal(requests, 1, 'the second search should hit the cache')
    await market.search({ text: 'beta', offset: 0, limit: 10, refresh: true })
    assert.equal(requests, 2, 'refresh should refetch')

    await assert.rejects(() => market.search({ source: 'unknown', offset: 0, limit: 10 }), error => error.status === 400)
    await assert.rejects(() => market.search({ url: 'https://evil.example/index.json', offset: 0, limit: 10 }), error => error.status === 400)
  } finally {
    server.close()
  }
})

test('community indexes are normalized, including workbuddy-style fields', async () => {
  const { server, base } = await serve((req, res) => {
    if (req.url === '/plugins.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(community))
      return
    }
    res.writeHead(404).end()
  })
  try {
    const market = createMarket({
      ctx: { get: () => undefined },
      config: { indexes: [`${base}/plugins.json`], preferHost: false, timeoutMs: 5000, cacheMs: 0, maxBytes: 1024 * 1024 },
    })
    const result = await market.search({ text: 'workbuddy', offset: 0, limit: 10 })
    assert.equal(result.format, 'community')
    assert.equal(result.count, 1)
    const entry = result.entries[0]
    assert.equal(entry.name, 'dsh-workbuddy-connect')
    assert.equal(entry.author, 'corrinehu')
    assert.equal(entry.category, 'model')
    assert.equal(entry.defaultVersion, '0.7.9')
    assert.equal(entry.install, 'dsh plugin --profile web add dsh-workbuddy-connect')
    assert.equal(entry.stars, 1450)
    assert.deepEqual(entry.capabilities, ['shell', 'network'])
    assert.equal(entry.description, '把 WorkBuddy 的模型接进 DSH')

    const found = await market.entry({ name: 'dsh-workbuddy-connect' })
    assert.equal(found.name, 'dsh-workbuddy-connect')

    const adHoc = createMarket({
      ctx: { get: () => undefined },
      config: { indexes: [], preferHost: false, allowAdHocIndexes: true, timeoutMs: 5000, cacheMs: 0, maxBytes: 1024 * 1024 },
    })
    const adHocResult = await adHoc.search({ url: `${base}/plugins.json`, text: 'workbuddy', offset: 0, limit: 1 })
    assert.equal(adHocResult.count, 1)
  } finally {
    server.close()
  }
})

test('market rejects an oversized streamed index', async () => {
  const { server, base } = await serve((req, res) => {
    if (req.url === '/large.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"plugins":[')
      for (let index = 0; index < 20; index += 1) res.write(`{"name":"plugin-${index}"},`)
      res.end(']}')
      return
    }
    res.writeHead(404).end()
  })
  try {
    const market = createMarket({
      ctx: { get: () => undefined },
      config: { indexes: [`${base}/large.json`], preferHost: false, timeoutMs: 5000, cacheMs: 0, maxBytes: 64 },
    })
    await assert.rejects(() => market.search({ offset: 0, limit: 10 }), error => error.status === 502)
  } finally {
    server.close()
  }
})

test('host pluginMarket indexes are exposed alongside HTTP sources', async () => {
  const hostEntry = {
    name: 'host-plugin',
    title: { en: 'Host Plugin' },
    description: { en: 'Provided by the host service' },
    author: 'bob',
    defaultVersion: '2.0.0',
    versions: [{ version: '2.0.0', install: 'host-plugin@2.0.0', compatibility: { compatible: true } }],
    metadata: { category: 'model', keywords: ['host'] },
  }
  const ctx = {
    get(name) {
      if (name !== 'pluginMarket') return undefined
      return {
        listIndexes: () => [{ url: 'https://host.example/index.json', title: { en: 'Host Index' } }],
        search: async url => ({ url, title: { en: 'Host Index' }, fetchedAt: 123, total: 1, entries: [hostEntry] }),
        entry: async (url, name) => name === 'host-plugin' ? hostEntry : undefined,
      }
    },
  }
  const market = createMarket({
    ctx,
    config: { indexes: [], preferHost: true, timeoutMs: 5000, cacheMs: 0, maxBytes: 1024 },
  })
  const sources = market.sources()
  assert.equal(sources.hostAvailable, true)
  assert.equal(sources.sources[0].kind, 'host')
  assert.equal(sources.sources[0].title, 'Host Index')

  const result = await market.search({ text: 'host', offset: 0, limit: 10 })
  assert.equal(result.format, 'host')
  assert.equal(result.entries[0].name, 'host-plugin')
  assert.equal(result.entries[0].install, 'host-plugin@2.0.0')

  const entry = await market.entry({ name: 'host-plugin' })
  assert.equal(entry.author, 'bob')
  assert.equal(await market.entry({ name: 'missing' }), undefined)
})

test('market skips invalid records without mismatching full raw records', async t => {
  const raw = { name: 'valid-plugin', versions: [null, { version: '1.0.0', source: { type: 'npm' } }] }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ format: 1, plugins: [null, 42, {}, raw] }))
  const market = createMarket({ config: { indexes: ['https://example.test/index.json'], cacheMs: 0, timeoutMs: 1000, maxBytes: 4096 } })
  const result = await market.search({ offset: 0, limit: 10, full: true })
  assert.equal(result.count, 1)
  assert.deepEqual(result.entries[0].raw, raw)
  assert.deepEqual(result.entries[0].install, { spec: 'valid-plugin@1.0.0' })
  assert.deepEqual(result.entries[0].source, { type: 'npm' })
})

test('format-1 derives npm and pinned Git install targets from version sources', async t => {
  const commit = 'a'.repeat(40)
  const npmSource = { type: 'npm', registry: 'https://registry.example.test' }
  const gitSource = { type: 'git', url: 'https://github.com/example/plugins', commit, path: 'packages/plugin' }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ format: 1, plugins: [
    { name: '@example/npm-plugin', versions: [{ version: '2.0.0', publishTimestamp: 1767225600, source: npmSource, engines: {} }] },
    { name: 'git-plugin', versions: [{ version: '1.0.0', source: gitSource, engines: {} }] },
  ] }))
  const market = createMarket({ config: { indexes: ['https://example.test/index.json'], cacheMs: 0, timeoutMs: 1000, maxBytes: 4096 } })
  const npm = await market.entry({ name: '@example/npm-plugin' })
  assert.deepEqual(npm.install, { spec: '@example/npm-plugin@2.0.0', registry: npmSource.registry })
  assert.equal(npm.versions[0].publishedAt, 1767225600)
  const git = await market.entry({ name: 'git-plugin' })
  assert.deepEqual(git.install, { spec: `git+https://github.com/example/plugins.git#${commit}&path:/packages/plugin` })
  assert.deepEqual(git.versions[0].source, gitSource)
})

test('market evicts old ad-hoc indexes from its bounded cache', async t => {
  const requested = []
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url)
    return Response.json({ plugins: [{ name: 'cached-plugin' }] })
  })
  const market = createMarket({ config: { indexes: [], allowAdHocIndexes: true, cacheMs: 60000, timeoutMs: 1000, maxBytes: 4096 } })
  const query = index => ({ url: `https://example.test/${index}.json`, offset: 0, limit: 10 })
  for (let index = 0; index < 17; index += 1) await market.search(query(index))
  await market.search(query(16))
  assert.equal(requested.length, 17, 'recent indexes should use the cache')
  await market.search(query(0))
  assert.equal(requested.length, 18, 'the oldest index must be fetched again')
})

test('malformed version sources do not produce unusable install targets', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ format: 1, plugins: [
    { name: 'missing-version', versions: [{ source: { type: 'npm' } }] },
    { name: 'unpinned-git', versions: [{ version: '1.0.0', source: { type: 'git', url: 'https://example.test/repo', commit: '' } }] },
    { name: 'bad-git-path', versions: [{ version: '1.0.0', source: { type: 'git', url: 'https://example.test/repo', commit: 'a'.repeat(40), path: '../outside' } }] },
  ] }))
  const market = createMarket({ config: { indexes: ['https://example.test/index.json'], cacheMs: 0, timeoutMs: 1000, maxBytes: 4096 } })
  const result = await market.search({ offset: 0, limit: 10 })
  assert.equal(result.count, 3)
  assert.ok(result.entries.every(entry => entry.install === undefined))
})

test('market reports failed response streams as upstream errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('connection terminated')) },
  })))
  const market = createMarket({ config: { indexes: ['https://example.test/index.json'], cacheMs: 0, timeoutMs: 1000, maxBytes: 4096 } })
  await assert.rejects(() => market.search({ offset: 0, limit: 10 }), error => error.status === 502 && /connection terminated/.test(error.message))
})
