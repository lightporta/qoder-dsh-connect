import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, readNdjson } from '../lib/store.js'

test('ledger and event reads include writes already queued, including zero limits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-store-'))
  const store = createStore({ dir, retainRuns: 10, retainLearnings: 10, warn() {} })
  try {
    await store.ready()
    const writes = [store.recordRun({ id: 'run-1' }), store.appendLearning({ id: 'learn-1' }), store.appendEvent('run-1', '{"type":"final"}')]
    const [runs, learnings, events] = await Promise.all([store.listRuns(10), store.listLearnings(10), store.readEventTail('run-1', 10)])
    await Promise.all(writes)
    assert.deepEqual(runs, [{ id: 'run-1' }])
    assert.deepEqual(learnings, [{ id: 'learn-1' }])
    assert.deepEqual(events, ['{"type":"final"}'])
    assert.deepEqual(await store.listRuns(0), [])
    assert.deepEqual(await store.listLearnings(0), [])
    assert.deepEqual(await store.readEventTail('run-1', 0), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('learning writes report persistence failures to their caller', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-store-'))
  const warnings = []
  const store = createStore({ dir, retainRuns: 10, retainLearnings: 10, warn: message => warnings.push(message) })
  try {
    await store.ready()
    await mkdir(join(dir, 'learnings.ndjson'))
    await assert.rejects(store.appendLearning({ id: 'learn-1' }))
    assert.equal(warnings.length, 1)
    // A rejected write must not poison the subsequent queue.
    await store.recordRun({ id: 'run-1' })
    assert.deepEqual(await store.listRuns(10), [{ id: 'run-1' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('learning topic selection happens before limiting the recent records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-topic-'))
  const store = createStore({ dir, retainRuns: 10, retainLearnings: 10, warn() {} })
  try {
    await store.ready()
    for (const record of [
      { id: 'older-match', topic: 'wanted' },
      { id: 'latest-match', topic: 'wanted' },
      { id: 'other-topic', topic: 'other' },
    ]) await store.appendLearning(record)
    assert.deepEqual(await store.listLearnings(1, { topic: 'wanted' }), [{ id: 'latest-match', topic: 'wanted' }])
    assert.deepEqual(await store.listLearnings(0, { topic: 'wanted' }), [])
    assert.deepEqual(await store.listLearnings(1), [{ id: 'other-topic', topic: 'other' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('torn or invalid ledger rows do not consume the valid record limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qdc-torn-'))
  const path = join(dir, 'ledger.ndjson')
  try {
    await writeFile(path, '{"id":"older"}\n{"id":"latest"}\nnull\n[]\n{"id":')
    assert.deepEqual(await readNdjson(path, 1), [{ id: 'latest' }])
    assert.deepEqual(await readNdjson(path, 0), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
