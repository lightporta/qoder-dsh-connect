/**
 * Manual real-model smoke test. It boots the engine against a real dsh CLI and
 * consumes one model call:
 *
 *   node test/smoke.mjs [path/to/@deepseek-ai/dsh/lib/bin.js]
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createEngine, resolveDshBin } from '../lib/engine.js'
import { createStore } from '../lib/store.js'

const candidates = [
  process.argv[2],
  process.env.DSH_BIN,
  process.platform === 'win32' ? join(homedir(), 'AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js') : undefined,
].filter(Boolean)
const resolution = resolveDshBin(candidates.find(candidate => existsSync(candidate)))
if (resolution.bin === undefined) {
  console.error('cannot find a dsh CLI entry; pass the path to @deepseek-ai/dsh/lib/bin.js')
  process.exit(2)
}
console.log(`engine: ${resolution.bin} (via ${resolution.source})`)

const dir = await mkdtemp(join(tmpdir(), 'qoder-dsh-connect-smoke-'))
const store = createStore({ dir, retainRuns: 20, retainLearnings: 20, warn: message => console.error(`warn: ${message}`) })
await store.ready()
const config = {
  profile: 'headless',
  bin: resolution.bin,
  dir,
  timeoutMs: 2 * 60 * 1000,
  maxTimeoutMs: 5 * 60 * 1000,
  concurrency: 1,
  tailLines: 40,
  retainRuns: 20,
  retainLearnings: 20,
}
const engine = createEngine({ config, store, warn: message => console.error(`warn: ${message}`), jobs: () => undefined })
const started = engine.start({
  task: '不要调用任何工具。只回复两个字：收到',
  cwd: process.cwd(),
  label: 'real-smoke',
  timeoutMs: 120000,
})
if ('error' in started) {
  console.error(`start failed: ${started.error}`)
  process.exit(1)
}
const settled = await engine.wait(started.run, 120000)
const view = engine.view(settled, { tail: 20 })
console.log(JSON.stringify({
  id: view.id,
  status: view.status,
  result: view.result,
  sessionId: view.sessionId,
  counts: view.counts,
  usage: view.usage,
  detail: view.detail,
  stderrTail: view.stderrTail,
}, null, 2))

engine.disposeAll()
await new Promise(resolve => setTimeout(resolve, 300))
await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
process.exit(view.status === 'completed' ? 0 : 1)
