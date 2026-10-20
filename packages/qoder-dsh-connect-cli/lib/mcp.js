const PROTOCOL_VERSION = '2024-11-05'

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
      }, ['profile']),
      handler: async (client, args) => client.labVerify({ profile: args.profile, boot: args.boot === true }),
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
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text }] }
}

export function createDispatcher(client) {
  const tools = new Map(toolDefinitions().map(tool => [tool.name, tool]))

  return async function dispatch(request) {
    const id = request.id
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? PROTOCOL_VERSION,
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
      const tool = tools.get(name)
      if (tool === undefined) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } }
      }
      try {
        const value = await tool.handler(client, request.params?.arguments ?? {})
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
    if (request.id === undefined) return undefined
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${request.method}` } }
  }
}

export async function runStdioServer({ client, input = process.stdin, output = process.stdout, error = process.stderr }) {
  const dispatch = createDispatcher(client)
  let buffer = ''
  let queue = Promise.resolve()

  const send = message => {
    if (message === undefined) return
    output.write(JSON.stringify(message) + '\n')
  }

  async function consume(text) {
    let request
    try {
      request = JSON.parse(text)
    } catch (parseError) {
      error.write(`invalid JSON-RPC message: ${parseError.message}\n`)
      return
    }
    const response = await dispatch(request)
    send(response)
  }

  function drain() {
    while (buffer.length > 0) {
      if (buffer.startsWith('Content-Length:')) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const firstHeader = buffer.slice(0, headerEnd).split(/\r\n/, 1)[0]
        const length = Number(firstHeader.slice('Content-Length:'.length).trim())
        if (!Number.isFinite(length) || length < 0) {
          buffer = buffer.slice(headerEnd + 4)
          continue
        }
        if (buffer.length < headerEnd + 4 + length) return
        const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length)
        buffer = buffer.slice(headerEnd + 4 + length)
        queue = queue.then(() => consume(body)).catch(consumeError => error.write(`${consumeError.message}\n`))
        continue
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.length > 0) {
        queue = queue.then(() => consume(line)).catch(consumeError => error.write(`${consumeError.message}\n`))
      }
    }
  }

  input.setEncoding?.('utf8')
  input.on('data', chunk => {
    buffer += chunk
    drain()
  })
  input.on('end', () => {
    void queue.finally(() => output.end())
  })
  error.write('qoder-dsh-connect MCP server ready on stdio\n')
  await new Promise(resolve => input.on('close', resolve))
}

export { PROTOCOL_VERSION }
