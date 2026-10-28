import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createDispatcher, runStdioServer } from '../lib/mcp.js'

function stdio(client = {}) {
  const input = new PassThrough()
  const output = new PassThrough()
  const error = new PassThrough()
  const messages = []
  let text = ''
  output.on('data', chunk => {
    text += chunk
    let newline
    while ((newline = text.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(text.slice(0, newline)))
      text = text.slice(newline + 1)
    }
  })
  error.resume()
  const done = runStdioServer({ client, input, output, error })
  return { input, messages, done }
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params })

test('MCP parses fragmented UTF-8 Content-Length frames and the following message', async () => {
  const server = stdio({ run: async args => args.task })
  const body = Buffer.from(JSON.stringify(rpc(1, 'tools/call', {
    name: 'dsh_delegate', arguments: { task: '请回复：收到🌙' },
  })))
  const frame = Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body,
    Buffer.from(JSON.stringify(rpc(2, 'ping')) + '\n'),
  ])
  for (let offset = 0; offset < frame.length; offset += 7) server.input.write(frame.subarray(offset, offset + 7))
  server.input.end()
  await server.done
  assert.equal(server.messages.find(message => message.id === 1).result.content[0].text, '请回复：收到🌙')
  assert.deepEqual(server.messages.find(message => message.id === 2).result, {})
})

test('MCP reports parse and invalid-request errors and continues reading', async () => {
  const server = stdio()
  server.input.end('{broken}\nnull\n[]\n' + JSON.stringify(rpc(9, 'ping')) + '\n')
  await server.done
  assert.deepEqual(server.messages.map(message => message.error?.code), [-32700, -32600, -32600, undefined])
  assert.equal(server.messages.at(-1).id, 9)
})

test('MCP accepts a final JSON line without a newline', async () => {
  const server = stdio()
  server.input.end(JSON.stringify(rpc('last', 'ping')))
  await server.done
  assert.deepEqual(server.messages, [{ jsonrpc: '2.0', id: 'last', result: {} }])
})

test('MCP allows status requests while a delegated run is still pending', async () => {
  let finishRun
  const result = new Promise(resolve => { finishRun = resolve })
  const server = stdio({ run: () => result, status: async () => ({ ready: true }) })
  server.input.write(JSON.stringify(rpc(1, 'tools/call', { name: 'dsh_delegate', arguments: { task: 'slow task' } })) + '\n')
  server.input.write(JSON.stringify(rpc(2, 'tools/call', { name: 'dsh_status' })) + '\n')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(server.messages.length, 1)
  assert.equal(server.messages[0].id, 2)
  finishRun({ status: 'completed' })
  server.input.end()
  await server.done
  assert.equal(server.messages.length, 2)
})

test('MCP ignores notifications and rejects malformed params and tool arguments', async () => {
  let calls = 0
  const dispatch = createDispatcher({ status: async () => { calls += 1 } })
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'ping' }), undefined)
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'dsh_status' } }), undefined)
  for (const params of [null, [], 'invalid']) {
    assert.equal((await dispatch(rpc(1, 'ping', params))).error.code, -32602)
  }
  for (const args of [null, [], 'invalid']) {
    assert.equal((await dispatch(rpc(2, 'tools/call', { name: 'dsh_status', arguments: args }))).error.code, -32602)
  }
  assert.equal(calls, 0)
})

test('MCP lab verification forwards the expected plugin id', async () => {
  let seen
  const dispatch = createDispatcher({ labVerify: async args => { seen = args; return { ok: true } } })
  const response = await dispatch(rpc(1, 'tools/call', {
    name: 'dsh_lab_verify', arguments: { profile: 'lab', name: 'sample', boot: false },
  }))
  assert.equal(response.result.isError, undefined)
  assert.deepEqual(seen, { profile: 'lab', name: 'sample', boot: false })
})


test('MCP initialization advertises its supported version for an unknown requested version', async () => {
  const dispatch = createDispatcher({})
  const response = await dispatch(rpc(1, 'initialize', { protocolVersion: '2099-01-01' }))
  assert.equal(response.result.protocolVersion, '2024-11-05')
})


test('MCP rejects oversized input and incomplete frames', async () => {
  for (const data of ['x'.repeat(1024 * 1024 + 1), 'Content-Length: 1048577\r\n\r\n', 'Content-Length: 30\r\n\r\n{}']) {
    const server = stdio()
    server.input.end(data)
    await server.done
    assert.equal(server.messages.length, 1)
    assert.equal(server.messages[0].error.code, -32700)
  }
})


test('MCP waits for in-flight requests after stdin ends and emits tool errors', async () => {
  let finishRun
  const result = new Promise(resolve => { finishRun = resolve })
  const server = stdio({
    run: () => result,
    status: async () => { throw new Error('host disconnected') },
  })
  let ended = false
  void server.done.then(() => { ended = true })
  server.input.end(JSON.stringify(rpc(1, 'tools/call', { name: 'dsh_delegate', arguments: { task: 'slow task' } })) + '\n'
    + JSON.stringify(rpc(2, 'tools/call', { name: 'dsh_status' })) + '\n')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ended, false)
  assert.equal(server.messages[0].result.isError, true)
  finishRun({ status: 'completed' })
  await server.done
  assert.equal(server.messages.find(message => message.id === 1).result.isError, undefined)
})

test('MCP validates tool schemas before invoking any client side effects', async () => {
  const calls = []
  const client = new Proxy({}, { get: (_, name) => async args => { calls.push({ name, args }); return { ok: true } } })
  const dispatch = createDispatcher(client)
  const cases = [
    ['dsh_delegate', {}],
    ['dsh_delegate', { task: 'test', waitMs: '100' }],
    ['dsh_delegate', { task: 'test', timeoutMs: Infinity }],
    ['dsh_kill', { id: 12 }],
    ['dsh_lab_scaffold', { kind: 'unknown', name: 'test' }],
    ['dsh_lab_install', { profile: 'lab' }],
    ['dsh_lab_install', { path: '/tmp/plugin', profile: 'lab', mode: 'unknown' }],
    ['dsh_lab_verify', { profile: 'lab', boot: 'false' }],
    ['dsh_learn', { title: 'test', body: 'text', tags: ['valid', {}] }],
    ['dsh_status', { undeclared: true }],
  ]
  for (const [name, args] of cases) {
    const response = await dispatch(rpc(1, 'tools/call', { name, arguments: args }))
    assert.equal(response.error?.code, -32602, `expected invalid params for ${name}: ${JSON.stringify(args)}`)
  }
  assert.equal(calls.length, 0)
  const response = await dispatch(rpc(2, 'tools/call', {
    name: 'dsh_delegate', arguments: { task: 'test', timeoutMs: 1000, waitMs: 0 },
  }))
  assert.equal(response.result.isError, undefined)
  assert.equal(calls.length, 1)
})

test('MCP rejects a non-string tool name and emits string content for an empty result', async () => {
  const dispatch = createDispatcher({ status: async () => undefined })
  for (const name of [null, 12, { toString: null }]) {
    const response = await dispatch(rpc(1, 'tools/call', { name }))
    assert.equal(response.error.code, -32602)
  }
  const response = await dispatch(rpc(2, 'tools/call', { name: 'dsh_status' }))
  assert.equal(response.result.content[0].text, 'null')
})
