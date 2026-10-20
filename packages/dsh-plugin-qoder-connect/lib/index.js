import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from './engine.js'
import { createLab } from './lab.js'
import { createMarket } from './market.js'
import { API_ROOT, DEFAULTS, PLUGIN_NAME } from './protocol.js'
import { makeRoute } from './routes.js'
import { createStore } from './store.js'

export const name = PLUGIN_NAME
export const inject = ['webServer']

function integer(value, fallback, min, max) {
  if (value === undefined || value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function detectHostProfile() {
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--profile' && typeof args[index + 1] === 'string') return args[index + 1]
    if (args[index].startsWith('--profile=')) return args[index].slice('--profile='.length)
  }
  return undefined
}

function pluginVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function apply(ctx, config = {}) {
  const version = pluginVersion()
  const rootDir = text(config.dir, join(homedir(), '.qoder-dsh-connect'))
  const resolved = {
    profile: text(config.profile, DEFAULTS.profile),
    bin: typeof config.bin === 'string' && config.bin.length > 0 ? config.bin : undefined,
    dir: rootDir,
    timeoutMs: integer(config.timeoutMs, DEFAULTS.timeoutMs, 5 * 1000, 24 * 60 * 60 * 1000),
    maxTimeoutMs: integer(config.maxTimeoutMs, DEFAULTS.maxTimeoutMs, 30 * 1000, 24 * 60 * 60 * 1000),
    concurrency: integer(config.concurrency, DEFAULTS.concurrency, 1, 8),
    tailLines: integer(config.tailLines, DEFAULTS.tailLines, 5, 2000),
    retainRuns: integer(config.retainRuns, DEFAULTS.retainRuns, 10, 5000),
    retainLearnings: integer(config.retainLearnings, DEFAULTS.retainLearnings, 10, 5000),
    token: typeof config.token === 'string' && config.token.length > 0 ? config.token : undefined,
    market: {
      indexes: Array.isArray(config.market?.indexes) ? config.market.indexes : [],
      preferHost: config.market?.preferHost !== false,
      allowAdHocIndexes: config.market?.allowAdHocIndexes === true,
      timeoutMs: integer(config.market?.timeoutMs, DEFAULTS.marketTimeoutMs, 1000, 120 * 1000),
      cacheMs: integer(config.market?.cacheMs, DEFAULTS.marketCacheMs, 0, 24 * 60 * 60 * 1000),
      maxBytes: integer(config.market?.maxBytes, DEFAULTS.marketMaxBytes, 64 * 1024, 64 * 1024 * 1024),
    },
    lab: {
      enabled: config.lab?.enabled === true,
      dir: text(config.lab?.dir, join(rootDir, 'lab')),
      profiles: Array.isArray(config.lab?.profiles) ? config.lab.profiles.filter(profile => typeof profile === 'string') : [],
      allowCurrentProfile: config.lab?.allowCurrentProfile === true,
      currentProfile: text(config.lab?.currentProfile, detectHostProfile() ?? 'web'),
      dshHome: text(config.lab?.dshHome, process.env.DSH_HOME ?? join(homedir(), '.dsh')),
      bin: typeof config.lab?.bin === 'string' && config.lab.bin.length > 0 ? config.lab.bin : undefined,
      timeoutMs: integer(config.lab?.timeoutMs, DEFAULTS.labTimeoutMs, 10 * 1000, 30 * 60 * 1000),
    },
  }
  if (resolved.maxTimeoutMs < resolved.timeoutMs) resolved.maxTimeoutMs = resolved.timeoutMs

  const warn = message => ctx.logger.warn(`[${PLUGIN_NAME}] ${message}`)
  const store = createStore({
    dir: resolved.dir,
    retainRuns: resolved.retainRuns,
    retainLearnings: resolved.retainLearnings,
    warn,
  })
  const engine = createEngine({
    config: resolved,
    store,
    warn,
    jobs: () => {
      try {
        return typeof ctx.get === 'function' ? ctx.get('jobs') : undefined
      } catch {
        return undefined
      }
    },
  })
  const market = createMarket({ ctx, config: resolved.market, warn })
  const lab = createLab({
    config: resolved.lab,
    warn,
    dshBin: resolved.lab.bin ?? engine.engine.bin,
    currentProfile: resolved.lab.currentProfile,
  })

  const probe = serviceName => {
    try {
      const value = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
      return value === undefined ? 'absent' : typeof value
    } catch (error) {
      return `throws: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const api = {
    ready: () => engine.ready(),
    async run(request, waitMs = 0) {
      const started = engine.start(request)
      if ('error' in started) throw new Error(started.error)
      const settled = waitMs > 0 ? await engine.wait(started.run, Math.min(waitMs, DEFAULTS.maxWaitMs)) : started.run
      return engine.view(settled, { tail: resolved.tailLines })
    },
    get(id) {
      const run = engine.find(id)
      return run === undefined ? undefined : engine.view(run, { tail: resolved.tailLines })
    },
    list(limit = 20) {
      return engine.list(limit)
    },
    kill(id, reason) {
      return engine.kill(id, reason)
    },
    market,
    lab,
    store,
  }

  ctx.effect(() => {
    void store.ready().catch(error => warn(`ledger directory unavailable: ${error instanceof Error ? error.message : String(error)}`))
    const disposers = [
      ctx.provide(PLUGIN_NAME, api),
      ctx.webServer.register(makeRoute({
        engine,
        store,
        market,
        lab,
        config: resolved,
        version,
        token: resolved.token,
        server: () => ({ host: ctx.webServer.host, port: ctx.webServer.port }),
        integrations: () => ({
          jobs: probe('jobs'),
          pluginMarket: probe('pluginMarket'),
          webServer: probe('webServer'),
        }),
      })),
    ]
    ctx.logger.info(`[${PLUGIN_NAME}] routes on ${API_ROOT}; ledger ${resolved.dir}; engine ${engine.engine.bin ?? `unavailable (${engine.engine.reason})`} (profile ${resolved.profile}); lab ${resolved.lab.enabled ? 'enabled' : 'disabled'}`)
    return () => {
      const stopped = engine.disposeAll()
      if (stopped > 0) warn(`unloading: stopped ${stopped} live run(s)`)
      for (const dispose of disposers) dispose()
    }
  }, `${PLUGIN_NAME}: routes`)
}
