import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngine } from '../lib/engine.js'
import { createStore } from '../lib/store.js'

const FAKE_DSH = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url))

async function makeEngine(overrides = {}, jobs = () => undefined) {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-engine-'))
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
    ...overrides,
  }
  const store = createStore({ dir, retainRuns: 50, retainLearnings: 50, warn: () => {} })
  await store.ready()
  const engine = createEngine({ config, store, warn: () => {}, jobs })
  return { engine, store, dir }
}

async function cleanup(context) {
  context.engine.disposeAll()
  await new Promise(resolve => setTimeout(resolve, 150))
  await rm(context.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

function startOrThrow(engine, request) {
  const started = engine.start(request)
  if ('error' in started) throw new Error(started.error)
  return started.run
}

test('engine reports its resolved CLI entry and starts a headless delegation', async () => {
  const context = await makeEngine()
  try {
    assert.equal(context.engine.ready(), true)
    assert.equal(context.engine.engine.source, 'config')

    const run = startOrThrow(context.engine, { task: 'hello', label: 'first' })
    const settled = await context.engine.wait(run, 5000)
    assert.equal(settled.status, 'completed')
    assert.equal(settled.aggregate.finalText, '收到。')
    assert.equal(settled.aggregate.sessionId, 'session-fake-1')
    assert.equal(settled.aggregate.toolCalls, 1)
    assert.equal(settled.aggregate.turns, 1)
    assert.equal(settled.aggregate.usage.totalTokens, 15)

    const view = context.engine.view(settled, { tail: 10 })
    assert.equal(view.status, 'completed')
    assert.equal(view.result, '收到。')
    assert.equal(view.label, 'first')
    assert.equal(view.jobMirror.attached, false)
    assert.ok(view.tail.some(line => line.includes('tool read')))
    await new Promise(resolve => setTimeout(resolve, 100))
    const ledger = await context.store.listRuns(10)
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].id, run.id)
  } finally {
    await cleanup(context)
  }
})

test('engine resumes a session and passes the id to the child argv', async () => {
  const context = await makeEngine()
  const log = join(context.dir, 'fake.log')
  process.env.FAKE_DSH_LOG = log
  try {
    const run = startOrThrow(context.engine, { task: 'resume', sessionId: 'session-resume' })
    const settled = await context.engine.wait(run, 5000)
    assert.equal(settled.status, 'completed')
    assert.equal(settled.resumeSessionId, 'session-resume')
    assert.equal(settled.aggregate.sessionId, 'session-resume')
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.ok(calls.some(call => call.args.includes('--session-id') && call.args.includes('session-resume')))
  } finally {
    delete process.env.FAKE_DSH_LOG
    await cleanup(context)
  }
})

test('engine surfaces a non-zero child exit and stderr', async () => {
  const context = await makeEngine()
  try {
    const run = startOrThrow(context.engine, { task: 'FAIL now' })
    const settled = await context.engine.wait(run, 5000)
    assert.equal(settled.status, 'failed')
    assert.equal(settled.exitCode, 2)
    assert.match(settled.stderrTail, /fake failure/)
    assert.match(settled.detail, /exit code 2/)
  } finally {
    await cleanup(context)
  }
})

test('engine kills a live child and records the reason', async () => {
  const context = await makeEngine()
  try {
    const run = startOrThrow(context.engine, { task: 'SLOW task' })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(context.engine.liveCount(), 1)
    assert.equal(context.engine.kill(run.id, 'test kill'), 'requested')
    const settled = await context.engine.wait(run, 5000)
    assert.equal(settled.status, 'killed')
    assert.equal(settled.detail, 'test kill')
  } finally {
    await cleanup(context)
  }
})

test('engine enforces its wall-clock timeout and concurrency budget', async () => {
  const context = await makeEngine({ timeoutMs: 1200, concurrency: 1 })
  try {
    const first = startOrThrow(context.engine, { task: 'SLOW timeout' })
    const rejected = context.engine.start({ task: 'second' })
    assert.equal(rejected.status, 429)
    const settled = await context.engine.wait(first, 5000)
    assert.equal(settled.status, 'failed')
    assert.match(settled.detail, /timeout after 1200ms/)
  } finally {
    await cleanup(context)
  }
})

test('job mirror attaches when a registry is available and degrades when it refuses', async () => {
  let done
  const jobs = {
    start(spec) {
      const hooks = spec.run({ append() {}, updateProgress() {} })
      done = hooks.done
      return 'job-1'
    },
  }
  const context = await makeEngine({}, () => jobs)
  try {
    const run = startOrThrow(context.engine, { task: 'hello' })
    await context.engine.wait(run, 5000)
    const outcome = await done
    assert.equal(outcome.status, 'completed')
    const view = context.engine.view(run)
    assert.deepEqual(view.jobMirror, { attached: true, id: 'job-1' })
  } finally {
    await cleanup(context)
  }

  const refusing = await makeEngine({}, () => ({ start() { throw new Error('no job controller') } }))
  try {
    const run = startOrThrow(refusing.engine, { task: 'hello' })
    await refusing.engine.wait(run, 5000)
    const view = refusing.engine.view(run)
    assert.equal(view.jobMirror.attached, false)
    assert.match(view.jobMirror.reason, /no job controller/)
  } finally {
    await cleanup(refusing)
  }
})

test('unloading the engine stops every live child', async () => {
  const context = await makeEngine()
  try {
    const run = startOrThrow(context.engine, { task: 'SLOW dispose' })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(context.engine.disposeAll(), 1)
    const settled = await context.engine.wait(run, 5000)
    assert.equal(settled.status, 'killed')
    assert.equal(settled.detail, 'proxy plugin unloaded')
  } finally {
    await cleanup(context)
  }
})
