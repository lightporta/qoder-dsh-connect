import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
  if (context.fixtureDir) await rm(context.fixtureDir, { recursive: true, force: true })
}

async function makeScriptEngine(source) {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'qdc-stdout-'))
  const bin = join(fixtureDir, 'fake.mjs')
  await writeFile(bin, source)
  return { ...await makeEngine({ bin }), fixtureDir }
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
    const ledger = await context.store.listRuns(10)
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].id, run.id)
  } finally {
    await cleanup(context)
  }
})

test('settlement preserves full tasks in the ledger and full views', async () => {
  const context = await makeEngine()
  const task = `long task ${'x'.repeat(5000)}`
  try {
    const run = startOrThrow(context.engine, { task })
    await context.engine.wait(run, 5000)
    assert.equal(context.engine.view(run).task.length, 2001)
    assert.equal(context.engine.view(run, { full: true }).task, task)
    const ledger = await context.store.listRuns(1)
    assert.equal(ledger[0].task, task)
  } finally {
    await cleanup(context)
  }
})

test('invalid event values do not crash a run and oversized lines are discarded whole', async () => {
  const context = await makeScriptEngine(`
    process.stdout.write('null\\n42\\n');
    process.stdout.write('x'.repeat(2 * 1024 * 1024));
    process.stdout.write(JSON.stringify({ type: 'final', text: 'part of an oversized line' }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'final', text: 'complete answer' }) + '\\n');
  `)
  try {
    const run = startOrThrow(context.engine, { task: 'output fixture' })
    await context.engine.wait(run, 5000)
    assert.equal(run.status, 'completed')
    assert.equal(context.engine.view(run).result, 'complete answer')
    const logs = await context.store.readEventTail(run.id, 20)
    const events = logs.map(line => JSON.parse(line))
    assert.equal(events.filter(event => event?.type === 'proxy/output-discarded').length, 1)
    assert.deepEqual(events.filter(event => event?.type === 'final').map(event => event.text), ['complete answer'])
    assert.ok(logs.every(line => Buffer.byteLength(line) <= 1024 * 1024))
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

test('launch passes task bytes through stdin and pins cwd while preserving host environment', async () => {
  const context = await makeScriptEngine(`
    let task = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { task += chunk });
    process.stdin.on('end', () => {
      const text = JSON.stringify({ task, args: process.argv.slice(2), cwd: process.cwd(), marker: process.env.QDC_LAUNCH_TEST });
      console.log(JSON.stringify({ type: 'final', text }));
    });
  `)
  const previous = process.env.QDC_LAUNCH_TEST
  process.env.QDC_LAUNCH_TEST = 'inherited-for-launch-test'
  try {
    const task = '中文 task; $(literal)\n--help\n'
    const run = startOrThrow(context.engine, { task, cwd: context.dir, sessionId: 'session-resume' })
    await context.engine.wait(run, 5000)
    assert.equal(run.status, 'completed')
    const captured = JSON.parse(context.engine.view(run).result)
    assert.equal(captured.task, task)
    assert.deepEqual(captured.args, ['--profile', 'headless', '--json', '--session-id', 'session-resume', '-'])
    assert.equal(captured.cwd, await realpath(context.dir))
    assert.equal(captured.marker, 'inherited-for-launch-test')
  } finally {
    if (previous === undefined) delete process.env.QDC_LAUNCH_TEST
    else process.env.QDC_LAUNCH_TEST = previous
    await cleanup(context)
  }
})

test('blank resume session IDs are rejected before starting a child', async () => {
  const context = await makeEngine()
  try {
    for (const sessionId of ['', '   ', '\n']) {
      const result = context.engine.start({ task: 'resume', sessionId })
      assert.equal(result.status, 400)
    }
    assert.equal(context.engine.liveCount(), 0)
  } finally {
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
