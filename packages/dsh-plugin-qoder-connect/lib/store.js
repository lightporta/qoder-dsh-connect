import { appendFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TAIL_READ_BYTES = 512 * 1024
const LEDGER_READ_BYTES = 8 * 1024 * 1024
const TRIM_READ_BYTES = 32 * 1024 * 1024

export async function tailLines(path, maxLines, maxBytes = TAIL_READ_BYTES) {
  if (maxLines <= 0) return []
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    if (size === 0) return []
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    const text = buffer.toString('utf8')
    const lines = text.split('\n')
    if (start > 0) lines.shift()
    return lines.filter(line => line.trim().length > 0).slice(-maxLines)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  } finally {
    await handle?.close()
  }
}

export async function readNdjson(path, maxRecords, maxBytes = LEDGER_READ_BYTES) {
  if (maxRecords <= 0) return []
  const lines = await tailLines(path, Number.MAX_SAFE_INTEGER, maxBytes)
  const records = []
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed)
    } catch {
      // A torn trailing write from a killed host is expected.
    }
  }
  return records.slice(-maxRecords)
}

export function createStore({ dir, retainRuns, retainLearnings, warn }) {
  const runsLedger = join(dir, 'runs.ndjson')
  const learningsLedger = join(dir, 'learnings.ndjson')
  const runsDir = join(dir, 'runs')

  let chain = Promise.resolve()

  function enqueue(task) {
    const result = chain.then(task, task)
    chain = result.then(() => undefined, () => undefined)
    return result
  }

  async function trim(path, retain) {
    const lines = await tailLines(path, Number.MAX_SAFE_INTEGER, TRIM_READ_BYTES)
    if (lines.length <= retain) return
    const kept = lines.slice(-retain).join('\n') + '\n'
    const temporary = `${path}.trim`
    await writeFile(temporary, kept, 'utf8')
    await rename(temporary, path)
  }

  return {
    dir,

    async ready() {
      await mkdir(runsDir, { recursive: true })
    },

    appendEvent(id, line) {
      return enqueue(async () => {
        try {
          await appendFile(join(runsDir, `${id}.ndjson`), line + '\n', 'utf8')
        } catch (error) {
          warn(`run log append failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    },

    async readEventTail(id, maxLines) {
      await chain
      return tailLines(join(runsDir, `${id}.ndjson`), maxLines)
    },

    recordRun(summary) {
      return enqueue(async () => {
        try {
          await appendFile(runsLedger, JSON.stringify(summary) + '\n', 'utf8')
          await trim(runsLedger, retainRuns)
        } catch (error) {
          warn(`run ledger append failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    },

    async listRuns(limit) {
      await chain
      return readNdjson(runsLedger, limit)
    },

    appendLearning(record) {
      return enqueue(async () => {
        try {
          await appendFile(learningsLedger, JSON.stringify(record) + '\n', 'utf8')
          await trim(learningsLedger, retainLearnings)
        } catch (error) {
          warn(`learning ledger append failed: ${error instanceof Error ? error.message : String(error)}`)
          throw error
        }
      })
    },

    async listLearnings(limit, { topic } = {}) {
      await chain
      if (limit <= 0) return []
      if (topic === undefined) return readNdjson(learningsLedger, limit)
      const records = await readNdjson(learningsLedger, Number.MAX_SAFE_INTEGER)
      return records.filter(record => record.topic === topic).slice(-limit)
    },

    async readText(name) {
      try {
        return await readFile(join(dir, name), 'utf8')
      } catch {
        return undefined
      }
    },
  }
}
