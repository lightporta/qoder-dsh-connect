/**
 * Manual end-to-end test against a running dsh web/desktop host:
 *
 *   node test/live.mjs http://127.0.0.1:3080
 */
const base = process.argv[2]
if (base === undefined) {
  console.error('usage: node test/live.mjs http://127.0.0.1:<port>')
  process.exit(2)
}
const api = `${base.replace(/\/$/, '')}/api/qoder-dsh-connect`
let failures = 0

function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 800)}`}`)
  if (!ok) failures += 1
}

async function json(path, init) {
  const response = await fetch(`${api}${path}`, init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body, headers: response.headers }
}

const status = await json('/status')
check('status 200', status.status === 200, status.body)
check('engine ready', status.body.ready === true, status.body.engine)
check('lab policy visible', typeof status.body.lab?.enabled === 'boolean', status.body.lab)

const started = await json('/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    task: '不要调用任何工具。只回复两个字：收到',
    cwd: process.cwd(),
    label: 'live-e2e',
    wait: 110000,
  }),
})
check('run settled', started.status === 200, { status: started.status, body: started.body })
const run = started.body
check('run completed', run.status === 'completed', run.status)
check('run has a result', typeof run.result === 'string' && run.result.length > 0, run.result)
check('run has a session id', typeof run.sessionId === 'string' && run.sessionId.startsWith('session-'), run.sessionId)

const resumed = await json('/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ task: '只回复：收到', sessionId: run.sessionId, cwd: run.cwd, label: 'live-e2e-resume', wait: 110000 }),
})
check('resume completed', resumed.body.status === 'completed', resumed.body.status)
check('resume kept session identity', resumed.body.sessionId === run.sessionId, resumed.body.sessionId)

const killTarget = await json('/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ task: '先思考三十秒再回答：ok', label: 'live-kill' }),
})
check('kill target accepted', killTarget.status === 202, { status: killTarget.status, body: killTarget.body })
await new Promise(resolve => setTimeout(resolve, 2000))
const killed = await json(`/runs/${killTarget.body.id}/kill`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ reason: 'live verification kill' }),
})
check('kill admitted', killed.status === 200 && killed.body.admission === 'requested', killed.body)
const killedView = await json(`/runs/${killTarget.body.id}?wait=30000&tail=5`)
check('run settled as killed', killedView.body.status === 'killed', killedView.body.status)
check('kill reason recorded', killedView.body.detail === 'live verification kill', killedView.body.detail)

const learning = await json('/learnings', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    title: 'live verification note',
    body: 'The host plugin accepted a delegation, resumed a session, killed a run, and rendered a digest.',
    topic: 'live-verification',
    tags: ['live', 'e2e'],
    source: run.id,
  }),
})
check('learning stored', learning.status === 201, learning.body)

const digest = await fetch(`${api}/export?topic=live-verification&results=1`)
const markdown = await digest.text()
check('digest is markdown', digest.headers.get('content-type')?.includes('text/markdown') === true, digest.headers.get('content-type'))
check('digest carries the note', markdown.includes('live verification note'), markdown.length)

const sources = await json('/market/sources')
check('market sources readable', sources.status === 200, sources.body)
const crossOrigin = await fetch(`${api}/status`, { headers: { origin: 'http://evil.example' } })
check('cross-origin fence holds', crossOrigin.status === 403, crossOrigin.status)

console.log(failures === 0 ? '\nall live checks passed' : `\n${failures} live check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
