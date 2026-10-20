export const PLUGIN_NAME = 'qoder-dsh-connect'
export const API_ROOT = '/api/qoder-dsh-connect'

export const PATHS = {
  status: 'status',
  runs: 'runs',
  learnings: 'learnings',
  export: 'export',
  market: 'market',
  lab: 'lab',
}

export const DEFAULTS = {
  profile: 'headless',
  timeoutMs: 15 * 60 * 1000,
  maxTimeoutMs: 60 * 60 * 1000,
  concurrency: 2,
  retainRuns: 200,
  retainLearnings: 500,
  tailLines: 60,
  maxWaitMs: 120 * 1000,
  marketTimeoutMs: 15 * 1000,
  marketCacheMs: 5 * 60 * 1000,
  marketMaxBytes: 4 * 1024 * 1024,
  labTimeoutMs: 3 * 60 * 1000,
}

export const BODY_LIMITS = {
  run: 64 * 1024,
  control: 8 * 1024,
  learning: 256 * 1024,
  lab: 16 * 1024,
}

export const MAX_TASK_CHARS = 60 * 1024
export const MAX_LABEL_CHARS = 200
export const MAX_SESSION_ID_CHARS = 512
export const MAX_RESULT_CHARS = 32 * 1024

export const RUN_STATUS = ['running', 'completed', 'failed', 'killed']
