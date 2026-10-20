#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const args = process.argv.slice(2)
if (process.env.FAKE_DSH_LOG) {
  appendFileSync(process.env.FAKE_DSH_LOG, JSON.stringify({ args }) + '\n')
}

if (args[0] === 'plugin') {
  process.exit(0)
}

if (args.includes('--dump-config')) {
  process.stdout.write(process.env.FAKE_DSH_DUMP ?? "- id: qoder-dsh-connect\n  name: 'qoder-dsh-connect'\n- id: candidate-lab\n  name: 'candidate-lab'\n")
  process.exit(0)
}

if (args.includes('--no-open')) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('fake dsh web')
  })
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`dsh web: http://127.0.0.1:${server.address().port}/?token=fake\n`)
  })
  const stop = () => {
    server.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  setInterval(() => {}, 1000)
} else if (args.includes('--json')) {
  let task = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { task += chunk })
  process.stdin.on('end', () => {
    const sessionIndex = args.indexOf('--session-id')
    const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : 'session-fake-1'
    const send = event => process.stdout.write(JSON.stringify(event) + '\n')
    send({ type: 'session', sessionId, cwd: process.cwd() })
    send({ type: 'status', phase: 'turn_start', turn: 1 })
    send({ type: 'thinking', text: 'checking the request' })
    send({ type: 'tool_call', callId: 'call-1', tool: 'read', input: { path: 'fixture' } })
    send({ type: 'tool_result', callId: 'call-1', status: 'ok', result: 'ok' })
    send({ type: 'text', text: '收到。' })
    send({ type: 'status', phase: 'step_end', step: 1, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15 } })
    if (task.includes('FAIL')) {
      process.stderr.write('fake failure\n')
      process.exit(2)
    }
    if (task.includes('SLOW')) {
      const timer = setInterval(() => {}, 1000)
      const stop = () => {
        clearInterval(timer)
        process.exit(0)
      }
      process.on('SIGTERM', stop)
      process.on('SIGINT', stop)
      return
    }
    send({ type: 'status', phase: 'turn_end', reason: 'stop' })
    send({ type: 'final', text: '收到。' })
    process.exit(0)
  })
}
