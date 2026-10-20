import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, ConnectError, resolveOptions } from '../lib/client.js'

const execFileAsync = promisify(execFile)
const BIN = fileURLToPath(new URL('../bin/qoder-dsh-connect.mjs', import.meta.url))

async function serve() {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      const path = new URL(req.url, 'http://localhost').pathname
      if (path.endsWith('/status')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ plugin: 'qoder-dsh-connect', ready: true }))
        return
      }
      if (path.endsWith('/runs') && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'run-1', status: 'completed', result: 'ok', request: JSON.parse(body) }))
        return
      }
      if (path.endsWith('/export')) {
        res.writeHead(200, { 'content-type': 'text/markdown' })
        res.end('# digest\n')
        return
      }
      if (path.endsWith('/lab')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ enabled: false }))
        return
      }
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not available' }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}`, seen }
}

test('resolveOptions accepts a full dsh URL with a token and keeps the origin', async () => {
  const resolved = await resolveOptions({ url: 'http://127.0.0.1:3080/?token=abc', config: join(tmpdir(), 'does-not-exist.json') })
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:3080')
  assert.equal(resolved.token, 'abc')
  await assert.rejects(
    () => resolveOptions({ url: 'http://user:pass@127.0.0.1:3080', config: join(tmpdir(), 'does-not-exist.json') }),
    /credentials/,
  )
})

test('client sends JSON, token auth, query token, and reads markdown', async () => {
  const { server, base, seen } = await serve()
  try {
    const client = await createClient({ url: `${base}/?token=secret`, config: join(tmpdir(), 'missing-client.json') })
    const status = await client.status()
    assert.equal(status.ready, true)
    const statusRequest = seen.find(entry => entry.url.includes('/status'))
    assert.equal(statusRequest.headers.authorization, 'Bearer secret')
    assert.match(statusRequest.url, /token=secret/)

    const run = await client.run({ task: 'hello', wait: 0 })
    assert.equal(run.id, 'run-1')
    const runRequest = seen.find(entry => entry.url.includes('/runs') && entry.method === 'POST')
    assert.equal(JSON.parse(runRequest.body).task, 'hello')

    assert.equal(await client.exportMarkdown({ results: '1' }), '# digest\n')
    assert.equal((await client.labStatus()).enabled, false)
    await assert.rejects(() => client.marketSources(), error => error instanceof ConnectError && error.status === 503)
  } finally {
    server.close()
  }
})

test('client config file supplies the URL and token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-client-'))
  const { server, base } = await serve()
  try {
    const config = join(dir, 'client.json')
    await writeFile(config, JSON.stringify({ url: base, token: 'file-token' }))
    const client = await createClient({ config })
    assert.equal(client.baseUrl, base)
    assert.equal(client.token, 'file-token')
    assert.equal((await client.status()).ready, true)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('skill install copies the skill and writes local CLI paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-skill-'))
  try {
    const destination = join(dir, 'qoder-dsh-connect')
    await execFileAsync(process.execPath, [BIN, 'skill', 'install', '--dest', destination], { timeout: 10000 })
    assert.match(await readFile(join(destination, 'SKILL.md'), 'utf8'), /name: qoder-dsh-connect/)
    assert.match(await readFile(join(destination, 'references', 'local-paths.md'), 'utf8'), /CLI:/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('CLI prints JSON status from a live endpoint', async () => {
  const { server, base } = await serve()
  try {
    const { stdout } = await execFileAsync(process.execPath, [BIN, 'status', '--url', base], { timeout: 10000 })
    const parsed = JSON.parse(stdout)
    assert.equal(parsed.ready, true)
  } finally {
    server.close()
  }
})

test('MCP stdio server exposes tools and calls status', async () => {
  const { server, base } = await serve()
  const child = spawn(process.execPath, [BIN, 'mcp', '--url', base], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = []
  lines.on('line', line => {
    if (line.trim().length > 0) pending.push(JSON.parse(line))
  })
  const next = async () => {
    const deadline = Date.now() + 10000
    while (pending.length === 0) {
      if (Date.now() > deadline) throw new Error('timed out waiting for MCP response')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return pending.shift()
  }
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n')
    const initialized = await next()
    assert.equal(initialized.id, 1)
    assert.equal(initialized.result.serverInfo.name, 'qoder-dsh-connect')

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
    const listed = await next()
    const names = listed.result.tools.map(tool => tool.name)
    assert.ok(names.includes('dsh_delegate'))
    assert.ok(names.includes('dsh_market_search'))
    assert.ok(names.includes('dsh_lab_install'))

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dsh_status', arguments: {} } }) + '\n')
    const called = await next()
    assert.equal(called.id, 3)
    assert.match(called.result.content[0].text, /qoder-dsh-connect/)
  } finally {
    child.stdin.end()
    child.kill()
    server.close()
  }
})
