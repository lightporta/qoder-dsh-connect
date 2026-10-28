import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngine } from '../lib/engine.js'
import { createLab } from '../lib/lab.js'
import { createMarket } from '../lib/market.js'
import { makeRoute } from '../lib/routes.js'
import { createStore } from '../lib/store.js'
import { API_ROOT } from '../lib/protocol.js'

const FAKE_DSH = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url))

async function makeHost(token) {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-routes-'))
  const config = {
    profile: 'headless',
    bin: FAKE_DSH,
    dir,
    timeoutMs: 10000,
    maxTimeoutMs: 20000,
    concurrency: 2,
    tailLines: 20,
    retainRuns: 50,
    retainLearnings: 50,
    market: { indexes: [], preferHost: false, timeoutMs: 5000, cacheMs: 0, maxBytes: 1024 * 1024 },
    lab: { enabled: false, dir: join(dir, 'lab'), profiles: [], allowCurrentProfile: false, dshHome: join(dir, '.dsh'), timeoutMs: 5000, currentProfile: 'web' },
  }
  const store = createStore({ dir, retainRuns: 50, retainLearnings: 50, warn: () => {} })
  await store.ready()
  const engine = createEngine({ config, store, warn: () => {}, jobs: () => undefined })
  const market = createMarket({ ctx: { get: () => undefined }, config: config.market, warn: () => {} })
  const lab = createLab({ config: config.lab, warn: () => {}, dshBin: FAKE_DSH, currentProfile: 'web' })
  let server
  const route = makeRoute({
    engine,
    store,
    market,
    lab,
    config,
    version: '0.0.0-test',
    token,
    server: () => ({ host: '127.0.0.1', port: server?.address()?.port }),
    integrations: () => ({ jobs: 'absent', pluginMarket: 'absent' }),
  })
  server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (!pathname.startsWith(API_ROOT)) {
      res.writeHead(404).end('not found')
      return
    }
    void route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`
  return {
    dir,
    engine,
    store,
    server,
    base,
    async close() {
      engine.disposeAll()
      await new Promise(resolve => server.close(resolve))
      await new Promise(resolve => setTimeout(resolve, 100))
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    },
  }
}

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body, headers: response.headers }
}

test('routes expose status, delegation, logs, learnings, and graceful market degradation', async () => {
  const host = await makeHost()
  try {
    const status = await json(host.base, '/status')
    assert.equal(status.status, 200)
    assert.equal(status.body.plugin, 'qoder-dsh-connect')
    assert.equal(status.body.ready, true)
    assert.equal(status.body.market.available, false)
    assert.equal(status.body.lab.enabled, false)
    assert.ok(status.body.endpoints.length > 10)

    const market = await json(host.base, '/market/sources')
    assert.equal(market.status, 200)
    assert.equal(market.body.available, false)
    const marketSearch = await json(host.base, '/market/search?text=x')
    assert.equal(marketSearch.status, 409)

    const created = await json(host.base, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'hello', label: 'route-test', wait: 10000 }),
    })
    assert.equal(created.status, 200)
    assert.equal(created.body.status, 'completed')
    assert.equal(created.body.result, '收到。')
    const id = created.body.id

    const listed = await json(host.base, '/runs?limit=5')
    assert.equal(listed.status, 200)
    assert.equal(listed.body.count, 1)
    assert.equal(listed.body.runs[0].id, id)

    const fetched = await json(host.base, `/runs/${id}?full=1&tail=5`)
    assert.equal(fetched.status, 200)
    assert.equal(fetched.body.id, id)
    assert.ok(Array.isArray(fetched.body.tail))

    let logText = ''
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const log = await fetch(`${host.base}/runs/${id}/log?limit=50`)
      assert.equal(log.status, 200)
      logText = await log.text()
      if (logText.includes('"type":"final"')) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.match(logText, /"type":"final"/)

    const learning = await json(host.base, '/learnings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Route note', body: 'Captured by the route test', topic: 'test', tags: ['routes'] }),
    })
    assert.equal(learning.status, 201)
    const learnings = await json(host.base, '/learnings?topic=test')
    assert.equal(learnings.body.count, 1)

    const digest = await fetch(`${host.base}/export?results=1`)
    assert.equal(digest.status, 200)
    assert.match(digest.headers.get('content-type'), /text\/markdown/)
    assert.match(await digest.text(), /Route note/)

    const lab = await json(host.base, '/lab')
    assert.equal(lab.status, 200)
    assert.equal(lab.body.enabled, false)
    assert.equal((await json(host.base, '/lab/ops')).status, 403)

    const missing = await json(host.base, '/nope')
    assert.equal(missing.status, 404)

    const badBody = await json(host.base, '/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal(badBody.status, 400)
  } finally {
    await host.close()
  }
})

test('routes long-poll, kill, and enforce client errors', async () => {
  const host = await makeHost()
  try {
    const started = await json(host.base, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'SLOW task', wait: 0 }),
    })
    assert.equal(started.status, 202)
    assert.equal(started.body.status, 'running')

    const killed = await json(host.base, `/runs/${started.body.id}/kill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'route kill' }),
    })
    assert.equal(killed.status, 200)
    assert.equal(killed.body.admission, 'requested')

    const settled = await json(host.base, `/runs/${started.body.id}?wait=5000&tail=5`)
    assert.equal(settled.status, 200)
    assert.equal(settled.body.status, 'killed')
    assert.equal(settled.body.detail, 'route kill')

    const empty = await json(host.base, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '   ' }),
    })
    assert.equal(empty.status, 400)

    const badCwd = await json(host.base, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'x', cwd: 'relative' }),
    })
    assert.equal(badCwd.status, 400)

    const unknown = await json(host.base, '/runs/run-missing')
    assert.equal(unknown.status, 404)
  } finally {
    await host.close()
  }
})

test('routes enforce the loopback origin fence and the optional token', async () => {
  const host = await makeHost()
  try {
    const crossOrigin = await fetch(`${host.base}/status`, { headers: { origin: 'http://evil.example' } })
    assert.equal(crossOrigin.status, 403)
  } finally {
    await host.close()
  }

  const tokenHost = await makeHost('secret-token')
  try {
    const denied = await json(tokenHost.base, '/status')
    assert.equal(denied.status, 401)
    const bearer = await json(tokenHost.base, '/status', { headers: { authorization: 'Bearer secret-token' } })
    assert.equal(bearer.status, 200)
    const query = await json(tokenHost.base, '/status?token=secret-token')
    assert.equal(query.status, 200)
    const wrong = await json(tokenHost.base, '/status', { headers: { authorization: 'Bearer wrong' } })
    assert.equal(wrong.status, 401)
  } finally {
    await tokenHost.close()
  }
})

test('routes validate run queries and body shapes before starting a child', async () => {
  const host = await makeHost()
  try {
    for (const path of ['/runs?wait=invalid', '/runs?tail=-1']) {
      const response = await json(host.base, path, { method: 'POST', body: JSON.stringify({ task: 'SLOW invalid' }) })
      assert.equal(response.status, 400)
    }
    for (const body of ['null', '[]', 'true', '"task"', '{"task":"SLOW invalid","wait":"invalid"}']) {
      assert.equal((await json(host.base, '/runs', { method: 'POST', body })).status, 400)
    }
    assert.equal(host.engine.liveCount(), 0)
    assert.equal(host.engine.list(100).length, 0)

    for (const path of ['/status/extra', '/market/sources/extra', '/lab/install/extra']) {
      assert.equal((await json(host.base, path, { method: path.startsWith('/lab/') ? 'POST' : 'GET' })).status, 404)
    }
    assert.equal((await json(host.base, '-other/status')).status, 404)
  } finally {
    await host.close()
  }
})

test('routes send a readable 413 response for an oversized body', async () => {
  const host = await makeHost()
  try {
    const response = await json(host.base, '/runs', { method: 'POST', body: JSON.stringify({ task: 'x'.repeat(70 * 1024) }) })
    assert.equal(response.status, 413)
    assert.match(response.body.error, /request body too large/)
    assert.equal(host.engine.list(100).length, 0)
  } finally {
    await host.close()
  }
})

test('live runs are filtered before pagination and invalid kill paths cannot kill them', async () => {
  const host = await makeHost()
  try {
    const live = await json(host.base, '/runs', { method: 'POST', body: JSON.stringify({ task: 'SLOW task' }) })
    assert.equal(live.status, 202)
    const completed = await json(host.base, '/runs?wait=10000', { method: 'POST', body: JSON.stringify({ task: 'hello' }) })
    assert.equal(completed.body.status, 'completed')
    const listed = await json(host.base, '/runs?live=1&limit=1')
    assert.equal(listed.body.count, 1)
    assert.equal(listed.body.runs[0].id, live.body.id)
    assert.equal((await json(host.base, `/runs/${live.body.id}/kill/extra`, { method: 'POST' })).status, 404)
    assert.equal(host.engine.find(live.body.id).status, 'running')
  } finally {
    await host.close()
  }
})

test('topic queries and exports apply their limit to matching learning records', async () => {
  const host = await makeHost()
  try {
    for (const note of [
      { title: 'Older wanted note', topic: 'wanted' },
      { title: 'Latest wanted note', topic: 'wanted' },
      { title: 'Other topic note', topic: 'other' },
    ]) {
      const response = await json(host.base, '/learnings', { method: 'POST', body: JSON.stringify({ ...note, body: 'A saved note' }) })
      assert.equal(response.status, 201)
    }
    const response = await json(host.base, '/learnings?topic=wanted&limit=1')
    assert.equal(response.body.count, 1)
    assert.equal(response.body.learnings[0].title, 'Latest wanted note')
    const digest = await (await fetch(`${host.base}/export?topic=wanted&limit=1`)).text()
    assert.match(digest, /Latest wanted note/)
    assert.doesNotMatch(digest, /Older wanted note|Other topic note/)
  } finally {
    await host.close()
  }
})
