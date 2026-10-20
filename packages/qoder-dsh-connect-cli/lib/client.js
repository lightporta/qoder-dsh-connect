import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const API_ROOT = '/api/qoder-dsh-connect'

export class ConnectError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ConnectError'
    this.status = status
    this.body = body
  }
}

async function readConfig(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return {}
  }
}

export async function resolveOptions(options = {}) {
  const configPath = options.config ?? process.env.QODER_DSH_CONNECT_CONFIG
    ?? join(homedir(), '.qoder-dsh-connect', 'client.json')
  const file = await readConfig(configPath)
  const raw = options.url ?? process.env.QODER_DSH_CONNECT_URL ?? file.url ?? 'http://127.0.0.1:3080'
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new ConnectError(`invalid host URL: ${raw}`, 0)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConnectError('host URL must use http or https', 0)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ConnectError('host URL must not contain credentials', 0)
  }
  const token = options.token ?? process.env.QODER_DSH_CONNECT_TOKEN
    ?? parsed.searchParams.get('token') ?? file.token ?? undefined
  const requestedTimeout = Number(options.timeoutMs ?? file.timeoutMs ?? 135000)
  return {
    baseUrl: parsed.origin,
    token: typeof token === 'string' && token.length > 0 ? token : undefined,
    timeoutMs: Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 135000,
    configPath,
  }
}

export async function createClient(options = {}) {
  const resolved = await resolveOptions(options)

  async function request(path, init = {}) {
    const url = new URL(`${resolved.baseUrl}${API_ROOT}${path}`)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    if (resolved.token !== undefined) url.searchParams.set('token', resolved.token)
    const headers = { accept: 'application/json', ...(init.headers ?? {}) }
    if (resolved.token !== undefined) headers.authorization = `Bearer ${resolved.token}`
    let body
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    let response
    try {
      response = await fetch(url, {
        method: init.method ?? (body === undefined ? 'GET' : 'POST'),
        headers,
        body,
        signal: AbortSignal.timeout(init.timeoutMs ?? resolved.timeoutMs),
      })
    } catch (error) {
      throw new ConnectError(`cannot reach ${resolved.baseUrl}: ${error instanceof Error ? error.message : String(error)}`, 0)
    }
    const text = await response.text()
    let parsed
    try {
      parsed = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const message = parsed !== null && typeof parsed === 'object' && typeof parsed.error === 'string'
        ? parsed.error
        : `host returned HTTP ${response.status}`
      throw new ConnectError(message, response.status, parsed)
    }
    return init.text === true ? text : parsed
  }

  return {
    baseUrl: resolved.baseUrl,
    token: resolved.token,
    request,
    status: () => request('/status'),
    run: body => request('/runs', { body, timeoutMs: Math.max(resolved.timeoutMs, Number(body.wait ?? 0) + 15000) }),
    runs: query => request('/runs', { query }),
    get: (id, query) => request(`/runs/${encodeURIComponent(id)}`, { query }),
    kill: (id, reason) => request(`/runs/${encodeURIComponent(id)}/kill`, { body: { reason } }),
    learnings: query => request('/learnings', { query }),
    learn: body => request('/learnings', { body }),
    exportMarkdown: query => request('/export', { query, text: true }),
    marketSources: () => request('/market/sources'),
    marketSearch: query => request('/market/search', { query }),
    marketEntry: query => request('/market/entry', { query }),
    labStatus: () => request('/lab'),
    labOps: query => request('/lab/ops', { query }),
    labScaffold: body => request('/lab/scaffold', { body }),
    labCheck: body => request('/lab/check', { body }),
    labInstall: body => request('/lab/install', { body, timeoutMs: Math.max(resolved.timeoutMs, 185000) }),
    labUninstall: body => request('/lab/uninstall', { body, timeoutMs: Math.max(resolved.timeoutMs, 185000) }),
    labRestore: body => request('/lab/restore', { body, timeoutMs: Math.max(resolved.timeoutMs, 185000) }),
    labVerify: body => request('/lab/verify', { body, timeoutMs: Math.max(resolved.timeoutMs, 185000) }),
  }
}
