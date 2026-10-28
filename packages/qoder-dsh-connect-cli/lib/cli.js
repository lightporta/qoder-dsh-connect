import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, ConnectError } from './client.js'
import { runStdioServer } from './mcp.js'

const HELP = `qoder-dsh-connect — control a local DeepSeek Harness host from Qoder.

Usage:
  qoder-dsh-connect <command> [options]

Connection:
  --url <url>            Host URL (env QODER_DSH_CONNECT_URL, default http://127.0.0.1:3080)
  --token <token>        Optional shared token (env QODER_DSH_CONNECT_TOKEN)
  --config <path>        Client config JSON (default ~/.qoder-dsh-connect/client.json)

Commands:
  status                                  Host status
  run <task> [--cwd <dir>] [--session <id>] [--timeout-ms <ms>] [--label <text>] [--wait <ms>]
                                          Delegate one task; use "-" to read the task from stdin
  runs [--limit <n>] [--live]             List runs
  get <id> [--wait <ms>] [--full] [--tail <n>] [--raw]
                                          Read one run
  kill <id> [--reason <text>]             Stop one live run
  learn --title <t> --body <b> [--topic <t>] [--tags a,b] [--source <s>]
                                          Append a learning note
  learnings [--topic <t>] [--limit <n>]   List learning notes
  export [--topic <t>] [--results] [--limit <n>]
                                          Print the Markdown ledger digest
  market sources                          List market sources
  market search [--text <q>] [--category <c>] [--source <id>] [--index-url <u>] [--offset <n>] [--limit <n>] [--refresh] [--full]
  market entry <name> [--source <id>] [--index-url <u>] [--full]
  lab status                              Lab policy and directories
  lab ops [--limit <n>]                   Lab operation journal
  lab scaffold --kind <plugin|skill> --name <name> [--description <text>] [--force]
  lab check <path>                        Static check a lab plugin or skill
  lab install <path> --profile <p> [--mode file|link]
  lab uninstall <name> --profile <p>
  lab verify --profile <p> [--name <plugin>] [--boot]
  lab restore <backupId> [--confirm <id>]
  skill install [--dest <dir>] [--force]  Copy the bundled Qoder skill
  mcp                                     Run the stdio MCP server

All commands print JSON except export (Markdown) and mcp (JSON-RPC on stdio).
`

function parseArgv(argv) {
  const positionals = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (arg === '-h' || arg === '--help') {
      options.help = true
      continue
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=')
      let key
      let value
      if (equals >= 0) {
        key = arg.slice(2, equals)
        value = arg.slice(equals + 1)
      } else {
        key = arg.slice(2)
        const next = argv[index + 1]
        if (next !== undefined && !next.startsWith('--')) {
          value = next
          index += 1
        } else {
          value = true
        }
      }
      options[key] = value
      continue
    }
    positionals.push(arg)
  }
  return { positionals, options }
}

function numberOption(options, key, fallback) {
  const value = options[key]
  if (value === undefined || value === true) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textOption(options, key) {
  const value = options[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function flagOption(options, key) {
  const value = options[key]
  return value === true || value === '1' || value === 'true'
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value ?? null, null, 2) + '\n')
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function installSkill(options) {
  const source = fileURLToPath(new URL('../skill/qoder-dsh-connect', import.meta.url))
  const destination = options.dest === undefined || options.dest === true
    ? join(homedir(), '.qoder-cn', 'skills', 'qoder-dsh-connect')
    : String(options.dest)
  let exists = false
  try {
    exists = (await stat(destination)).isDirectory()
  } catch {
    exists = false
  }
  if (exists && !flagOption(options, 'force')) {
    throw new Error(`${destination} already exists; pass --force to overwrite`)
  }
  await mkdir(join(destination, '..'), { recursive: true })
  await cp(source, destination, { recursive: true, force: true })
  const cliPath = fileURLToPath(new URL('../bin/qoder-dsh-connect.mjs', import.meta.url))
  const repoPath = fileURLToPath(new URL('../../../', import.meta.url))
  const localPaths = [
    '# Local paths',
    '',
    `- CLI: \`${cliPath}\``,
    `- Repo (best effort): \`${repoPath}\``,
    '',
    'Use these paths where SKILL.md shows `<repo>`.',
    '',
  ].join('\n')
  await writeFile(join(destination, 'references', 'local-paths.md'), localPaths, 'utf8')
  return { installed: destination, source }
}

export async function main(argv) {
  const { positionals, options } = parseArgv(argv)
  if (positionals.length === 0 || options.help === true) {
    process.stdout.write(HELP)
    return
  }
  const command = positionals[0]
  if (command === 'version') {
    printJson({ name: 'qoder-dsh-connect-cli', version: '0.1.0' })
    return
  }
  if (command === 'skill') {
    if (positionals[1] !== 'install') throw new Error('usage: qoder-dsh-connect skill install [--dest <dir>] [--force]')
    printJson(await installSkill(options))
    return
  }

  const client = await createClient({
    url: textOption(options, 'url'),
    token: textOption(options, 'token'),
    config: textOption(options, 'config'),
    timeoutMs: numberOption(options, 'request-timeout-ms', undefined),
  })

  switch (command) {
    case 'status':
      printJson(await client.status())
      return

    case 'run': {
      let task = textOption(options, 'task')
      if (task === undefined) {
        const parts = positionals.slice(1)
        task = parts.length === 1 && parts[0] === '-' ? await readStdin() : parts.join(' ')
      }
      if (task === undefined || task.trim().length === 0) throw new Error('task is required (or pass - to read stdin)')
      printJson(await client.run({
        task,
        cwd: textOption(options, 'cwd'),
        sessionId: textOption(options, 'session'),
        timeoutMs: numberOption(options, 'timeout-ms', undefined),
        label: textOption(options, 'label'),
        wait: numberOption(options, 'wait', 120000),
      }))
      return
    }

    case 'runs':
      printJson(await client.runs({
        limit: numberOption(options, 'limit', 20),
        live: flagOption(options, 'live') ? '1' : undefined,
      }))
      return

    case 'get': {
      const id = positionals[1] ?? textOption(options, 'id')
      if (id === undefined) throw new Error('run id is required')
      printJson(await client.get(id, {
        wait: numberOption(options, 'wait', 0),
        full: flagOption(options, 'full') ? '1' : undefined,
        raw: flagOption(options, 'raw') ? '1' : undefined,
        tail: numberOption(options, 'tail', undefined),
      }))
      return
    }

    case 'kill': {
      const id = positionals[1] ?? textOption(options, 'id')
      if (id === undefined) throw new Error('run id is required')
      printJson(await client.kill(id, textOption(options, 'reason')))
      return
    }

    case 'learn': {
      const title = textOption(options, 'title')
      let body = textOption(options, 'body')
      if (body === '-') body = (await readStdin()).trim()
      if (title === undefined || body === undefined) throw new Error('--title and --body are required')
      const tags = textOption(options, 'tags')?.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
      printJson(await client.learn({ title, body, topic: textOption(options, 'topic'), tags, source: textOption(options, 'source') }))
      return
    }

    case 'learnings':
      printJson(await client.learnings({
        topic: textOption(options, 'topic'),
        limit: numberOption(options, 'limit', 50),
      }))
      return

    case 'export':
      process.stdout.write(await client.exportMarkdown({
        topic: textOption(options, 'topic'),
        results: flagOption(options, 'results') ? '1' : undefined,
        limit: numberOption(options, 'limit', 50),
      }))
      return

    case 'market': {
      const action = positionals[1]
      if (action === 'sources') {
        printJson(await client.marketSources())
        return
      }
      if (action === 'search') {
        printJson(await client.marketSearch({
          text: textOption(options, 'text'),
          category: textOption(options, 'category'),
          source: textOption(options, 'source'),
          url: textOption(options, 'index-url'),
          offset: numberOption(options, 'offset', 0),
          limit: numberOption(options, 'limit', 20),
          refresh: flagOption(options, 'refresh') ? '1' : undefined,
          full: flagOption(options, 'full') ? '1' : undefined,
        }))
        return
      }
      if (action === 'entry') {
        const name = positionals[2] ?? textOption(options, 'name')
        if (name === undefined) throw new Error('plugin name is required')
        printJson(await client.marketEntry({
          name,
          source: textOption(options, 'source'),
          url: textOption(options, 'index-url'),
          full: flagOption(options, 'full') ? '1' : undefined,
        }))
        return
      }
      throw new Error('usage: qoder-dsh-connect market <sources|search|entry>')
    }

    case 'lab': {
      const action = positionals[1]
      if (action === 'status') {
        printJson(await client.labStatus())
        return
      }
      if (action === 'ops') {
        printJson(await client.labOps({ limit: numberOption(options, 'limit', 50) }))
        return
      }
      if (action === 'scaffold') {
        printJson(await client.labScaffold({
          kind: textOption(options, 'kind'),
          name: textOption(options, 'name'),
          description: textOption(options, 'description'),
          force: flagOption(options, 'force'),
        }))
        return
      }
      if (action === 'check') {
        const path = positionals[2] ?? textOption(options, 'path')
        if (path === undefined) throw new Error('path is required')
        printJson(await client.labCheck({ path }))
        return
      }
      if (action === 'install') {
        const path = positionals[2] ?? textOption(options, 'path')
        const profile = textOption(options, 'profile')
        if (path === undefined || profile === undefined) throw new Error('path and --profile are required')
        printJson(await client.labInstall({ path, profile, mode: textOption(options, 'mode') }))
        return
      }
      if (action === 'uninstall') {
        const name = positionals[2] ?? textOption(options, 'name')
        const profile = textOption(options, 'profile')
        if (name === undefined || profile === undefined) throw new Error('name and --profile are required')
        printJson(await client.labUninstall({ name, profile }))
        return
      }
      if (action === 'verify') {
        const profile = textOption(options, 'profile')
        if (profile === undefined) throw new Error('--profile is required')
        printJson(await client.labVerify({ profile, boot: flagOption(options, 'boot'), name: textOption(options, 'name') }))
        return
      }
      if (action === 'restore') {
        const backupId = positionals[2] ?? textOption(options, 'backup-id')
        if (backupId === undefined) throw new Error('backupId is required')
        printJson(await client.labRestore({ backupId, confirm: textOption(options, 'confirm') ?? backupId }))
        return
      }
      throw new Error('usage: qoder-dsh-connect lab <status|ops|scaffold|check|install|uninstall|verify|restore>')
    }

    case 'mcp':
      await runStdioServer({ client })
      return

    default:
      throw new Error(`unknown command: ${command}`)
  }
}

export async function runCli(argv) {
  try {
    await main(argv)
  } catch (error) {
    const message = error instanceof ConnectError && error.status !== 0
      ? `${error.message} (HTTP ${error.status})`
      : error instanceof Error ? error.message : String(error)
    process.stderr.write(`qoder-dsh-connect: ${message}\n`)
    process.exitCode = 1
  }
}
