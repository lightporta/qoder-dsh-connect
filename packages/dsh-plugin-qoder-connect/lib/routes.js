import { normalizeLearning, renderDigest } from './digest.js'
import { compact } from './events.js'
import { isAuthorized, isLoopbackRequest } from './loopback.js'
import { API_ROOT, BODY_LIMITS, DEFAULTS, PLUGIN_NAME } from './protocol.js'

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'RequestError'
    this.status = status
  }
}

function write(res, status, body, type) {
  const isText = type !== undefined && !type.startsWith('application/json')
  const payload = isText ? String(body) : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': type ?? 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

async function readJson(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new RequestError(413, `request body too large (max ${limit} bytes)`)
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'request body is not valid JSON')
  }
}

function intParam(params, key, fallback, max, min = 0) {
  const raw = params.get(key)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min) throw new RequestError(400, `${key} must be a number >= ${min}`)
  return Math.min(Math.trunc(value), max)
}

function flag(params, key) {
  const raw = params.get(key)
  return raw === '1' || raw === 'true' || raw === ''
}

function textParam(params, key) {
  const raw = params.get(key)
  return raw === null || raw.length === 0 ? undefined : raw
}

export function makeRoute(deps) {
  const { engine, store, market, lab, config, version, token } = deps
  const fence = deps.fence ?? isLoopbackRequest

  function status(res) {
    const marketInfo = market.sources()
    write(res, 200, {
      plugin: PLUGIN_NAME,
      version,
      ready: engine.ready(),
      host: deps.server(),
      engine: engine.engine,
      auth: { mode: token === undefined || token.length === 0 ? 'loopback' : 'loopback+token' },
      limits: {
        concurrency: config.concurrency,
        liveRuns: engine.liveCount(),
        timeoutMs: config.timeoutMs,
        maxTimeoutMs: config.maxTimeoutMs,
        maxWaitMs: DEFAULTS.maxWaitMs,
      },
      market: {
        available: marketInfo.available,
        hostAvailable: marketInfo.hostAvailable,
        sourceCount: marketInfo.sources.length,
      },
      lab: lab.status(),
      integrations: deps.integrations?.() ?? {},
      ledger: { dir: store.dir },
      endpoints: [
        'GET  /status',
        'POST /runs            { task, cwd?, sessionId?, timeoutMs?, label?, wait? }  ?wait=<ms>',
        'GET  /runs            ?limit=&live=1',
        'GET  /runs/<id>       ?tail=&full=1&raw=1&wait=<ms>',
        'GET  /runs/<id>/log   ?limit=&compact=1   (application/x-ndjson)',
        'POST /runs/<id>/kill  { reason? }',
        'GET  /learnings       ?limit=&topic=',
        'POST /learnings       { title, body, topic?, tags?, source? }',
        'GET  /export          ?topic=&results=1&limit=   (text/markdown)',
        'GET  /market/sources',
        'GET  /market/search   ?source=&text=&category=&offset=&limit=&refresh=1&full=1',
        'GET  /market/entry    ?name=&source=&full=1',
        'GET  /lab             lab status',
        'GET  /lab/ops         ?limit=',
        'POST /lab/scaffold    { kind, name, description?, force? }',
        'POST /lab/check       { path }',
        'POST /lab/install     { path, profile, mode? }',
        'POST /lab/uninstall   { name, profile }',
        'POST /lab/restore     { backupId, confirm }',
        'POST /lab/verify      { profile, boot? }',
      ],
    })
  }

  function expectRun(id) {
    const run = id === undefined ? undefined : engine.find(id)
    if (run === undefined) throw new RequestError(404, `unknown run ${id ?? ''}`)
    return run
  }

  async function answerRun(res, run, params) {
    const waitMs = intParam(params, 'wait', 0, DEFAULTS.maxWaitMs)
    const settled = waitMs > 0 ? await engine.wait(run, waitMs) : run
    const tail = flag(params, 'raw') ? 0 : intParam(params, 'tail', config.tailLines, 1000)
    write(res, settled.status === 'running' ? 202 : 200, engine.view(settled, { tail, full: flag(params, 'full') }))
  }

  async function labResult(res, result) {
    const statusCode = result?.ok === false ? 502 : 200
    write(res, statusCode, result)
  }

  return {
    kind: 'prefix',
    path: API_ROOT,
    handler: async (req, res) => {
      if (!fence(req)) {
        write(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (!isAuthorized(req, token)) {
        write(res, 401, { error: 'unauthorized: send Authorization: Bearer <token> or x-qoder-token' })
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = req.method ?? 'GET'
      const sub = url.pathname.slice(API_ROOT.length).replace(/^\/+|\/+$/g, '')
      const segments = sub.length === 0 ? [] : sub.split('/')
      const params = url.searchParams

      try {
        if (segments.length === 0 || segments[0] === 'status') {
          if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
          status(res)
          return
        }

        switch (segments[0]) {
          case 'runs': {
            if (segments.length === 1) {
              if (method === 'GET') {
                const limit = intParam(params, 'limit', 20, 100)
                const liveOnly = flag(params, 'live')
                const listed = engine.list(limit).filter(run => !liveOnly || run.status === 'running')
                write(res, 200, { count: listed.length, live: engine.liveCount(), runs: listed })
                return
              }
              if (method === 'POST') {
                const body = await readJson(req, BODY_LIMITS.run) ?? {}
                if (body.wait !== undefined && !params.has('wait')) params.set('wait', String(body.wait))
                const started = engine.start({
                  task: body.task,
                  cwd: body.cwd,
                  sessionId: body.sessionId,
                  timeoutMs: body.timeoutMs,
                  label: body.label,
                })
                if ('error' in started) {
                  write(res, started.status ?? 400, { error: started.error })
                  return
                }
                await answerRun(res, started.run, params)
                return
              }
              throw new RequestError(405, `method not allowed: ${method}`)
            }

            const run = expectRun(segments[1])
            const action = segments[2]
            if (action === undefined) {
              if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
              await answerRun(res, run, params)
              return
            }
            if (action === 'kill') {
              if (method !== 'POST') throw new RequestError(405, `method not allowed: ${method}`)
              const body = await readJson(req, BODY_LIMITS.control) ?? {}
              const reason = typeof body.reason === 'string' && body.reason.length > 0
                ? body.reason.slice(0, 200)
                : 'killed by the caller'
              const admission = engine.kill(run.id, reason)
              if (admission === 'unknown') throw new RequestError(404, `unknown run ${run.id}`)
              write(res, 200, { id: run.id, admission })
              return
            }
            if (action === 'log') {
              if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
              const limit = intParam(params, 'limit', 200, 5000)
              const lines = await store.readEventTail(run.id, limit)
              const rendered = flag(params, 'compact')
                ? lines.map(line => {
                  try {
                    return compact(JSON.parse(line))
                  } catch {
                    return line
                  }
                })
                : lines
              res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' })
              res.end(rendered.join('\n') + (rendered.length > 0 ? '\n' : ''))
              return
            }
            throw new RequestError(404, `unknown run action: ${action}`)
          }

          case 'learnings': {
            if (segments.length !== 1) throw new RequestError(404, `unknown path: ${sub}`)
            if (method === 'GET') {
              const limit = intParam(params, 'limit', 50, 500)
              const topic = textParam(params, 'topic')
              const all = await store.listLearnings(limit)
              const kept = topic === undefined ? all : all.filter(record => record.topic === topic)
              write(res, 200, { count: kept.length, learnings: kept.slice().reverse() })
              return
            }
            if (method === 'POST') {
              const normalized = normalizeLearning(await readJson(req, BODY_LIMITS.learning))
              if (normalized.error !== undefined) throw new RequestError(400, normalized.error)
              await store.appendLearning(normalized.record)
              write(res, 201, normalized.record)
              return
            }
            throw new RequestError(405, `method not allowed: ${method}`)
          }

          case 'export': {
            if (segments.length !== 1) throw new RequestError(404, `unknown path: ${sub}`)
            if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
            const limit = intParam(params, 'limit', 50, 500)
            const [runs, learnings] = await Promise.all([store.listRuns(limit), store.listLearnings(limit)])
            const digest = renderDigest({
              runs,
              learnings,
              topic: textParam(params, 'topic'),
              results: flag(params, 'results'),
            })
            write(res, 200, digest, 'text/markdown; charset=utf-8')
            return
          }

          case 'market': {
            if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
            const action = segments[1]
            if (action === 'sources' || action === 'indexes') {
              write(res, 200, market.sources())
              return
            }
            if (action === 'search') {
              write(res, 200, await market.search({
                source: textParam(params, 'source'),
                url: textParam(params, 'url'),
                text: textParam(params, 'text'),
                category: textParam(params, 'category'),
                sort: textParam(params, 'sort'),
                offset: intParam(params, 'offset', 0, 100000),
                limit: intParam(params, 'limit', 20, 100, 1),
                refresh: flag(params, 'refresh'),
                full: flag(params, 'full'),
              }))
              return
            }
            if (action === 'entry') {
              const entry = await market.entry({
                name: textParam(params, 'name'),
                source: textParam(params, 'source'),
                url: textParam(params, 'url'),
                refresh: flag(params, 'refresh'),
                full: flag(params, 'full'),
              })
              if (entry === undefined) throw new RequestError(404, 'the index does not list that plugin')
              write(res, 200, entry)
              return
            }
            throw new RequestError(404, `unknown market action: ${action ?? ''}`)
          }

          case 'lab': {
            const action = segments[1]
            if (action === undefined) {
              if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
              write(res, 200, lab.status())
              return
            }
            if (action === 'ops') {
              if (method !== 'GET') throw new RequestError(405, `method not allowed: ${method}`)
              const limit = intParam(params, 'limit', 50, 500, 1)
              const ops = await lab.ops(limit)
              write(res, 200, { count: ops.length, ops })
              return
            }
            if (method !== 'POST') throw new RequestError(405, `method not allowed: ${method}`)
            const body = await readJson(req, BODY_LIMITS.lab) ?? {}
            if (action === 'scaffold') {
              write(res, 201, await lab.scaffold(body))
              return
            }
            if (action === 'check') {
              write(res, 200, await lab.check(body))
              return
            }
            if (action === 'install') {
              await labResult(res, await lab.install(body))
              return
            }
            if (action === 'uninstall') {
              await labResult(res, await lab.uninstall(body))
              return
            }
            if (action === 'restore') {
              write(res, 200, await lab.restore(body))
              return
            }
            if (action === 'verify') {
              await labResult(res, await lab.verify(body))
              return
            }
            throw new RequestError(404, `unknown lab action: ${action}`)
          }

          default:
            throw new RequestError(404, `unknown path: ${sub}`)
        }
      } catch (error) {
        const known = error instanceof RequestError
        const carried = typeof error?.status === 'number' ? error.status : undefined
        const statusCode = known ? error.status : carried ?? 502
        const payload = { error: error instanceof Error ? error.message : String(error) }
        if (error?.details !== undefined) payload.details = error.details
        write(res, statusCode, payload)
      }
    },
  }
}
