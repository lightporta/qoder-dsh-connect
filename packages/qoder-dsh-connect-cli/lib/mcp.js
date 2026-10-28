const PROTOCOL_VERSION = '2024-11-05'
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_HEADER_BYTES = 8192

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const string = description => ({ type: 'string', description })
const number = description => ({ type: 'number', description })
const boolean = description => ({ type: 'boolean', description })

export function toolDefinitions() {
  return [
    {
      name: 'dsh_status',
      description: 'Report the qoder-dsh-connect host status: engine, concurrency, auth, market sources, and lab policy.',
      inputSchema: objectSchema({}),
      handler: client => client.status(),
    },
    {
      name: 'dsh_delegate',
      description: 'Delegate one task to DeepSeek Harness as a headless sub-agent. Returns the settled run view when it finishes inside waitMs, otherwise a running run id for dsh_run polling.',
      inputSchema: objectSchema({
        task: string('Task prompt. It travels over stdin and never reaches a command line.'),
        cwd: string('Absolute working directory for the child harness.'),
        sessionId: string('Resume an existing dsh session id.'),
        timeoutMs: number('Wall-clock budget for the child run in milliseconds.'),
        label: string('Short label for the run list and ledger.'),
        waitMs: number('How long the HTTP call may wait for settlement; capped by the host at 120000.'),
      }, ['task']),
      handler: async (client, args) => client.run({
        task: args.task,
        cwd: args.cwd,
        sessionId: args.sessionId,
        timeoutMs: args.timeoutMs,
        label: args.label,
        wait: args.waitMs ?? 110000,
      }),
    },
    {
      name: 'dsh_runs',
      description: 'List runs created by this host process, newest first.',
      inputSchema: objectSchema({
        limit: number('Maximum number of runs (1-100).'),
        live: boolean('Only show runs that are still live.'),
      }),
      handler: async (client, args) => client.runs({ limit: args.limit, live: args.live === true ? '1' : undefined }),
    },
    {
      name: 'dsh_run',
      description: 'Read one run, optionally long-polling until it settles.',
      inputSchema: objectSchema({
        id: string('Run id.'),
        waitMs: number('Long-poll budget in milliseconds (host cap 120000).'),
        full: boolean('Return the full result instead of the 32 KiB projection.'),
        tail: number('Number of compact progress lines to include.'),
      }, ['id']),
      handler: async (client, args) => client.get(args.id, {
        wait: args.waitMs,
        full: args.full === true ? '1' : undefined,
        tail: args.tail,
      }),
    },
    {
      name: 'dsh_kill',
      description: 'Stop one live run and kill its child harness process tree.',
      inputSchema: objectSchema({
        id: string('Run id.'),
        reason: string('Reason recorded in the ledger.'),
      }, ['id']),
      handler: async (client, args) => client.kill(args.id, args.reason),
    },
    {
      name: 'dsh_learn',
      description: 'Append a durable learning note to the host ledger for later knowledge-base export.',
      inputSchema: objectSchema({
        title: string('Short title.'),
        body: string('Markdown or plain-text body.'),
        topic: string('Topic bucket, for example dsh-plugin-dev or plugin-market.'),
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (max 10).' },
        source: string('Run id, URL, or other provenance.'),
      }, ['title', 'body']),
      handler: async (client, args) => client.learn({
        title: args.title,
        body: args.body,
        topic: args.topic,
        tags: args.tags,
        source: args.source,
      }),
    },
    {
      name: 'dsh_learnings',
      description: 'Read learning notes from the host ledger.',
      inputSchema: objectSchema({
        topic: string('Optional topic filter.'),
        limit: number('Maximum records.'),
      }),
      handler: async (client, args) => client.learnings({ topic: args.topic, limit: args.limit }),
    },
    {
      name: 'dsh_export',
      description: 'Render the run and learning ledger as a Markdown digest for QMind or another knowledge base.',
      inputSchema: objectSchema({
        topic: string('Optional learning topic filter.'),
        results: boolean('Include full run results.'),
        limit: number('Maximum ledger records per section.'),
      }),
      handler: async (client, args) => client.exportMarkdown({
        topic: args.topic,
        results: args.results === true ? '1' : undefined,
        limit: args.limit,
      }),
    },
    {
      name: 'dsh_market_sources',
      description: 'List configured market indexes and whether the host pluginMarket service is mounted.',
      inputSchema: objectSchema({}),
      handler: client => client.marketSources(),
    },
    {
      name: 'dsh_market_search',
      description: 'Search a dsh plugin market index. Only configured sources are allowed unless the host explicitly enables ad-hoc indexes.',
      inputSchema: objectSchema({
        text: string('Fuzzy text search.'),
        category: string('Exact category filter.'),
        source: string('Configured source id, for example http:https://... or host:https://...'),
        offset: number('Matching entries to skip.'),
        limit: number('Page size (1-100).'),
        refresh: boolean('Bypass the host cache.'),
        full: boolean('Include the raw index record.'),
      }),
      handler: async (client, args) => client.marketSearch({
        text: args.text,
        category: args.category,
        source: args.source,
        offset: args.offset,
        limit: args.limit,
        refresh: args.refresh === true ? '1' : undefined,
        full: args.full === true ? '1' : undefined,
      }),
    },
    {
      name: 'dsh_market_entry',
      description: 'Read one plugin entry from a configured market index.',
      inputSchema: objectSchema({
        name: string('Plugin package name.'),
        source: string('Configured source id.'),
        full: boolean('Include the raw index record.'),
      }, ['name']),
      handler: async (client, args) => client.marketEntry({
        name: args.name,
        source: args.source,
        full: args.full === true ? '1' : undefined,
      }),
    },
    {
      name: 'dsh_lab_status',
      description: 'Read the plugin/skill lab policy: enabled, allowlisted profiles, current profile, and directories.',
      inputSchema: objectSchema({}),
      handler: client => client.labStatus(),
    },
    {
      name: 'dsh_lab_scaffold',
      description: 'Scaffold a dsh plugin or Qoder skill inside the lab directory. The lab must be enabled.',
      inputSchema: objectSchema({
        kind: { type: 'string', enum: ['plugin', 'skill'], description: 'What to generate.' },
        name: string('Package name for a plugin, or lowercase skill name.'),
        description: string('Short description.'),
        force: boolean('Overwrite an existing scaffold.'),
      }, ['kind', 'name']),
      handler: async (client, args) => client.labScaffold({
        kind: args.kind,
        name: args.name,
        description: args.description,
        force: args.force,
      }),
    },
    {
      name: 'dsh_lab_check',
      description: 'Statically check a scaffolded plugin or skill under the lab directory.',
      inputSchema: objectSchema({
        path: string('Absolute path inside the lab directory.'),
      }, ['path']),
      handler: async (client, args) => client.labCheck({ path: args.path }),
    },
    {
      name: 'dsh_lab_install',
      description: 'Install a checked lab plugin into an allowlisted dsh profile. The host takes a backup first; the current host profile is refused by default.',
      inputSchema: objectSchema({
        path: string('Absolute path to a plugin inside the lab directory.'),
        profile: string('Allowlisted target dsh profile.'),
        mode: { type: 'string', enum: ['file', 'link'], description: 'file copies, link symlinks.' },
      }, ['path', 'profile']),
      handler: async (client, args) => client.labInstall({ path: args.path, profile: args.profile, mode: args.mode }),
    },
    {
      name: 'dsh_lab_uninstall',
      description: 'Remove a plugin from an allowlisted dsh profile. The host takes a backup first.',
      inputSchema: objectSchema({
        name: string('Plugin package name.'),
        profile: string('Allowlisted target dsh profile.'),
      }, ['name', 'profile']),
      handler: async (client, args) => client.labUninstall({ name: args.name, profile: args.profile }),
    },
    {
      name: 'dsh_lab_verify',
      description: 'Run dsh dump-config for a lab profile, or boot a temporary host and probe it. Boot verification only works for profiles that include the web app.',
      inputSchema: objectSchema({
        profile: string('Allowlisted dsh profile.'),
        boot: boolean('Start a temporary host to verify the profile loads.'),
        name: string('Expected plugin id; defaults to the most recent installed lab plugin.'),
      }, ['profile']),
      handler: async (client, args) => client.labVerify({ profile: args.profile, boot: args.boot === true, name: args.name }),
    },
    {
      name: 'dsh_lab_restore',
      description: 'Restore profile files from a backup created by the lab. confirm must exactly equal backupId.',
      inputSchema: objectSchema({
        backupId: string('Backup id from a lab install/uninstall response.'),
        confirm: string('Must equal backupId.'),
      }, ['backupId', 'confirm']),
      handler: async (client, args) => client.labRestore({ backupId: args.backupId, confirm: args.confirm }),
    },
    {
      name: 'dsh_lab_ops',
      description: 'Read the lab operation journal.',
      inputSchema: objectSchema({
        limit: number('Maximum records.'),
      }),
      handler: async (client, args) => client.labOps({ limit: args.limit }),
    },
  ]
}

function toolResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return { content: [{ type: 'text', text }] }
}

// Validate the schema subset used by toolDefinitions before dispatching HTTP writes.
function argumentError(schema, value, path = 'arguments') {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (type !== schema.type || (type === 'number' && !Number.isFinite(value))) {
    return `${path} must be ${schema.type}`
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return `${path} must be one of: ${schema.enum.join(', ')}`
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) return `${path}.${key} is required`
    }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (schema.additionalProperties === false) return `unknown ${path} property: ${key}`
        continue
      }
      const failure = argumentError(schema.properties[key], item, `${path}.${key}`)
      if (failure !== undefined) return failure
    }
  } else if (type === 'array') {
    for (const [index, item] of value.entries()) {
      const failure = argumentError(schema.items, item, `${path}[${index}]`)
      if (failure !== undefined) return failure
    }
  }
  return undefined
}

export function createDispatcher(client) {
  const tools = new Map(toolDefinitions().map(tool => [tool.name, tool]))

  return async function dispatch(request) {
    if (request === null || typeof request !== 'object' || Array.isArray(request)
      || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
      || (request.id !== undefined && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid JSON-RPC request' } }
    }
    // Notifications never receive responses or invoke request-only tools.
    if (request.id === undefined) return undefined
    const id = request.id
    if (request.params !== undefined && (request.params === null || typeof request.params !== 'object' || Array.isArray(request.params))) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'params must be an object' } }
    }
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'qoder-dsh-connect', version: '0.1.0' },
        },
      }
    }
    if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return undefined
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        },
      }
    }
    if (request.method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } }
    if (request.method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      if (typeof name !== 'string') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tool name must be a string' } }
      }
      const tool = tools.get(name)
      if (tool === undefined) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } }
      }
      const args = request.params?.arguments === undefined ? {} : request.params.arguments
      const failure = argumentError(tool.inputSchema, args)
      if (failure !== undefined) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: failure } }
      }
      try {
        const value = await tool.handler(client, args)
        return { jsonrpc: '2.0', id, result: toolResult(value) }
      } catch (error) {
        const detail = error?.body !== undefined ? `\n${JSON.stringify(error.body, null, 2)}` : ''
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `${error instanceof Error ? error.message : String(error)}${detail}` }], isError: true },
        }
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${request.method}` } }
  }
}

export async function runStdioServer({ client, input = process.stdin, output = process.stdout, error = process.stderr }) {
  const dispatch = createDispatcher(client)
  let buffer = Buffer.alloc(0)
  const pending = new Set()

  const send = message => {
    if (message !== undefined) output.write(JSON.stringify(message) + '\n')
  }

  async function consume(text) {
    let request
    try {
      request = JSON.parse(text)
    } catch (parseError) {
      error.write(`invalid JSON-RPC message: ${parseError.message}\n`)
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    send(await dispatch(request))
  }

  function enqueue(body) {
    // Long-running tools must not block ping, status, or explicit run cancellation.
    const job = consume(body).catch(consumeError => error.write(`${consumeError.message}\n`))
    pending.add(job)
    void job.then(() => pending.delete(job), () => pending.delete(job))
  }

  function rejectInput(message) {
    buffer = Buffer.alloc(0)
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message } })
    input.destroy()
  }

  function drain(final = false) {
    while (buffer.length > 0) {
      if (buffer.subarray(0, 15).toString('ascii') === 'Content-Length:') {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) {
          if (buffer.length > MAX_HEADER_BYTES) rejectInput('MCP header exceeds 8192 bytes')
          return
        }
        if (headerEnd > MAX_HEADER_BYTES) {
          rejectInput('MCP header exceeds 8192 bytes')
          return
        }
        const firstHeader = buffer.subarray(0, headerEnd).toString('ascii').split(/\r\n/, 1)[0]
        const rawLength = firstHeader.slice('Content-Length:'.length).trim()
        const length = Number(rawLength)
        if (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(length)) {
          buffer = buffer.subarray(headerEnd + 4)
          send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'invalid Content-Length' } })
          continue
        }
        if (length > MAX_MESSAGE_BYTES) {
          rejectInput('MCP message exceeds 1 MiB')
          return
        }
        if (buffer.length < headerEnd + 4 + length) return
        const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
        buffer = buffer.subarray(headerEnd + 4 + length)
        enqueue(body)
        continue
      }
      const newline = buffer.indexOf('\n')
      if ((newline < 0 ? buffer.length : newline) > MAX_MESSAGE_BYTES) {
        rejectInput('MCP message exceeds 1 MiB')
        return
      }
      if (newline < 0 && !final) return
      const end = newline < 0 ? buffer.length : newline
      const line = buffer.subarray(0, end).toString('utf8').trim()
      buffer = buffer.subarray(newline < 0 ? end : end + 1)
      if (line.length > 0) enqueue(line)
    }
  }

  await new Promise((resolve, reject) => {
    let finishing = false
    const finish = () => {
      if (finishing) return
      finishing = true
      drain(true)
      if (buffer.length > 0) {
        buffer = Buffer.alloc(0)
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'incomplete Content-Length frame' } })
      }
      void Promise.all([...pending]).then(() => {
        output.end()
        resolve()
      }).catch(reject)
    }
    input.on('data', chunk => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      drain()
    })
    input.once('end', finish)
    input.once('close', finish)
    input.once('error', reject)
    error.write('qoder-dsh-connect MCP server ready on stdio\n')
  })
}

export { PROTOCOL_VERSION }
