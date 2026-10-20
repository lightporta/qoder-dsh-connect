import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_ROOT } from '../lib/protocol.js'
import { apply, inject, name as pluginName } from '../lib/index.js'

const FAKE_DSH = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url))

test('plugin entry mounts its route and service through a cordis-like context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-plugin-'))
  let route
  let service
  let cleanup

  const ctx = {
    logger: { info() {}, warn() {} },
    get(serviceName) {
      if (serviceName === 'webServer') return ctx.webServer
      return undefined
    },
    effect(fn) {
      cleanup = fn()
      return cleanup
    },
    provide(serviceName, api) {
      service = { name: serviceName, api }
      return () => { service = undefined }
    },
    webServer: {
      host: '127.0.0.1',
      port: 0,
      register(candidate) {
        route = candidate
        return () => { route = undefined }
      },
    },
  }

  apply(ctx, {
    bin: FAKE_DSH,
    dir,
    profile: 'headless',
    timeoutMs: 10000,
    maxTimeoutMs: 20000,
    concurrency: 1,
    market: { indexes: [], preferHost: false },
    lab: { enabled: false, dir: join(dir, 'lab'), profiles: [], dshHome: join(dir, '.dsh'), currentProfile: 'web' },
  })

  assert.equal(pluginName, 'qoder-dsh-connect')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, API_ROOT)
  assert.equal(service.name, 'qoder-dsh-connect')
  assert.equal(service.api.ready(), true)
  assert.equal(typeof service.api.market.search, 'function')
  assert.equal(service.api.lab.status().enabled, false)

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (!pathname.startsWith(API_ROOT)) {
      res.writeHead(404).end()
      return
    }
    void route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  ctx.webServer.port = server.address().port
  const base = `http://127.0.0.1:${server.address().port}${API_ROOT}`
  try {
    const status = await (await fetch(`${base}/status`)).json()
    assert.equal(status.plugin, 'qoder-dsh-connect')
    assert.equal(status.ready, true)
    assert.equal(status.lab.enabled, false)

    const response = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'hello', wait: 10000 }),
    })
    const run = await response.json()
    assert.equal(response.status, 200)
    assert.equal(run.status, 'completed')
    assert.equal(run.result, '收到。')
  } finally {
    cleanup?.()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(route, undefined)
    assert.equal(service, undefined)
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
