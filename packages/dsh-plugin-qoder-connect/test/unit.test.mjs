import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAuthorized, isLoopbackRequest } from '../lib/loopback.js'
import { compact, createAggregate, fold } from '../lib/events.js'
import { normalizeLearning, renderDigest } from '../lib/digest.js'
import { resolveCwd, resolveDshBin } from '../lib/engine.js'
import { redactSecrets } from '../lib/redact.js'

const request = (remoteAddress, headers = {}, url = '/api/qoder-dsh-connect/status') => ({
  socket: { remoteAddress },
  headers: { host: '127.0.0.1:3080', ...headers },
  url,
})

test('loopback fence accepts loopback sockets and authorities', () => {
  assert.equal(isLoopbackRequest(request('127.0.0.1')), true)
  assert.equal(isLoopbackRequest(request('127.42.0.9')), true)
  assert.equal(isLoopbackRequest(request('::1')), true)
  assert.equal(isLoopbackRequest(request('::ffff:127.0.0.1')), true)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { host: 'localhost:3080' })), true)
  assert.equal(isLoopbackRequest(request('::1', { host: '[::1]:3080' })), true)
})

test('loopback fence rejects public addresses, non-loopback hosts, and cross-site markers', () => {
  assert.equal(isLoopbackRequest(request('192.168.1.2')), false)
  assert.equal(isLoopbackRequest(undefined), false)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { host: 'evil.example' })), false)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { origin: 'http://evil.example' })), false)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { origin: 'http://127.0.0.1:3080' })), true)
  assert.equal(isLoopbackRequest(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })), true)
})

test('token auth accepts bearer, shared header, and query token', () => {
  const token = 'local-secret'
  assert.equal(isAuthorized(request('127.0.0.1'), undefined), true)
  assert.equal(isAuthorized(request('127.0.0.1'), token), false)
  assert.equal(isAuthorized(request('127.0.0.1', { authorization: 'Bearer local-secret' }), token), true)
  assert.equal(isAuthorized(request('127.0.0.1', { authorization: 'Bearer wrong' }), token), false)
  assert.equal(isAuthorized(request('127.0.0.1', { 'x-qoder-token': token }), token), true)
  assert.equal(isAuthorized(request('127.0.0.1', {}, '/api/qoder-dsh-connect/status?token=local-secret'), token), true)
})

test('event folding sums per-step usage and keeps final text', () => {
  const aggregate = createAggregate()
  const events = [
    { type: 'session', sessionId: 'session-1' },
    { type: 'status', phase: 'turn_start', turn: 1 },
    { type: 'status', phase: 'step_start', step: 1 },
    { type: 'tool_call', tool: 'read' },
    { type: 'tool_result', status: 'error' },
    { type: 'thinking', text: 'abc' },
    { type: 'text', text: 'hello' },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18, reasoningTokens: 3 } },
    { type: 'status', phase: 'turn_end', reason: 'stop' },
    { type: 'final', text: 'done' },
  ]
  for (const event of events) fold(aggregate, event)
  assert.equal(aggregate.eventCount, events.length)
  assert.equal(aggregate.sessionId, 'session-1')
  assert.equal(aggregate.turns, 1)
  assert.equal(aggregate.steps, 1)
  assert.equal(aggregate.toolCalls, 1)
  assert.equal(aggregate.toolErrors, 1)
  assert.equal(aggregate.thinkingChars, 3)
  assert.equal(aggregate.textChars, 5)
  assert.equal(aggregate.usage.inputTokens, 22)
  assert.equal(aggregate.usage.outputTokens, 15)
  assert.equal(aggregate.usage.totalTokens, 37)
  assert.equal(aggregate.usage.reasoningTokens, 3)
  assert.equal(aggregate.endReason, 'stop')
  assert.equal(aggregate.finalText, 'done')
})

test('event projections tolerate JSON values that are not event objects', () => {
  const aggregate = createAggregate()
  for (const value of [null, false, 42, 'diagnostic', []]) {
    assert.doesNotThrow(() => fold(aggregate, value))
    assert.equal(typeof compact(value), 'string')
  }
})

test('CLI discovery resolves a symlinked host entry and honors configured paths', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-bin-'))
  const previous = process.argv[1]
  try {
    const cliDir = join(dir, '@deepseek-ai', 'dsh', 'lib')
    await mkdir(cliDir, { recursive: true })
    const entry = join(cliDir, 'bin.js')
    await writeFile(entry, '')
    const link = join(dir, 'dsh')
    await symlink(entry, link)
    process.argv[1] = link
    assert.deepEqual(resolveDshBin(), { bin: await realpath(entry), source: 'host-entry', reason: undefined })
    const configured = join(dir, 'custom-cli.mjs')
    await writeFile(configured, '')
    assert.equal(resolveDshBin(configured).bin, await realpath(configured))
    process.argv[1] = join(dir, 'missing')
    assert.notEqual(resolveDshBin().source, 'host-entry')
  } finally {
    process.argv[1] = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('compact projections hide bulky thinking text', () => {
  assert.equal(compact({ type: 'thinking', text: 'x'.repeat(10000) }), 'thinking 10000 chars')
  assert.equal(compact({ type: 'session', sessionId: 's' }), 'session s')
  assert.equal(compact({ type: 'text', text: 'hi' }), 'text hi')
  assert.equal(compact({ type: 'tool_call', tool: 'read', input: { path: 'a' } }), 'tool read {"path":"a"}')
})

test('learning validation and markdown rendering', () => {
  const bad = normalizeLearning({ body: 'no title' })
  assert.equal(typeof bad.error, 'string')
  const normalized = normalizeLearning({ title: 'A note', body: 'Body text', topic: 'dsh', tags: ['one', 'two'], source: 'run-1' })
  assert.equal(normalized.error, undefined)
  assert.equal(normalized.record.title, 'A note')
  assert.deepEqual(normalized.record.tags, ['one', 'two'])
  const digest = renderDigest({
    runs: [{ id: 'run-1', status: 'completed', createdAt: 1, finishedAt: 2, durationMs: 1, label: 'demo', cwd: 'C:/work', task: 'do it', result: 'ok', counts: { events: 3 }, usage: { totalTokens: 4 } }],
    learnings: [normalized.record],
    results: true,
  })
  assert.match(digest, /Qoder × DeepSeek Harness 代理台账/)
  assert.match(digest, /A note/)
  assert.match(digest, /run-1/)
  assert.match(digest, /结果：/)
})

test('redaction masks tokens and API keys in diagnostics', () => {
  const text = 'url=http://127.0.0.1:3080/?token=abc123 Authorization: Bearer secret-token sk-1234567890abcdef'
  const redacted = redactSecrets(text)
  assert.equal(redacted.includes('abc123'), false)
  assert.equal(redacted.includes('secret-token'), false)
  assert.equal(redacted.includes('1234567890abcdef'), false)
  assert.match(redacted, /token=<redacted>/)
  assert.match(redacted, /Bearer <redacted>/)
  assert.match(redacted, /sk-<redacted>/)
})

test('cwd validation requires an existing absolute directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-cwd-'))
  try {
    assert.equal(resolveCwd(undefined).cwd, process.cwd())
    assert.equal(resolveCwd('relative').error, 'cwd must be an absolute path')
    assert.equal(resolveCwd(join(dir, 'missing')).error, 'cwd does not exist')
    const file = join(dir, 'file.txt')
    await writeFile(file, 'x')
    assert.equal(resolveCwd(file).error, 'cwd is not a directory')
    assert.equal(resolveCwd(dir).cwd, dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
