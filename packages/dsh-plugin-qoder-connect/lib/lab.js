import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { detached, terminateTree } from './process-tree.js'
import { redactSecrets } from './redact.js'
import { readNdjson } from './store.js'

const OUTPUT_CAP = 2 * 1024 * 1024
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const BACKUP_RE = /^\d{8}-\d{6}-qoder-connect-[A-Za-z0-9._-]+-[a-f0-9]{6}$/

class LabError extends Error {
  constructor(status, message, details) {
    super(message)
    this.name = 'LabError'
    this.status = status
    this.details = details
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

function tail(value, max = 4000) {
  const text = redactSecrets(value)
  return text.length > max ? text.slice(-max) : text
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function walkFiles(dir, depth = 0) {
  if (depth > 2) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(path, depth + 1))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function scaffoldPlugin(name, description) {
  const packageJson = {
    name,
    version: '0.1.0',
    description,
    type: 'module',
    license: 'MIT',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    files: ['lib', 'cordis.patch.yml', 'README.md'],
    scripts: { test: 'node test/smoke.mjs' },
  }
  const patch = `- insert:\n    - id: '${name}'\n      name: '${name}'\n`
  const entry = `export const name = ${JSON.stringify(name)}
export const inject = ['webServer']

const API_ROOT = ${JSON.stringify(`/api/${name}`)}

function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  const local = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  const host = request.headers.host ?? ''
  let hostOk = false
  try {
    const parsed = new URL('http://' + host)
    hostOk = parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127\\./.test(parsed.hostname)
  } catch {}
  return local && hostOk && request.headers['sec-fetch-site'] !== 'cross-site'
}

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: API_ROOT,
      handler: async (req, res) => {
        if (!isLoopback(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'forbidden: loopback-only' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ plugin: name, ok: true, at: Date.now() }))
      },
    })
    ctx.logger?.info?.(name + ': routes on ' + API_ROOT)
    return () => dispose()
  }, name + ': routes')
}
`
  const smoke = `import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

assert.equal(plugin.name, ${JSON.stringify(name)})
assert.deepEqual(plugin.inject, ['webServer'])
assert.equal(typeof plugin.apply, 'function')
console.log('smoke ok: ' + plugin.name)
`
  const readme = `# ${name}

${description}

## Install

\`\`\`bash
dsh plugin --profile <profile> add "file:${'<absolute-path>'}"
dsh --profile <profile> --dump-config
\`\`\`

## Verify

\`\`\`bash
node test/smoke.mjs
\`\`\`
`
  return {
    'package.json': JSON.stringify(packageJson, null, 2) + '\n',
    'cordis.patch.yml': patch,
    'lib/index.js': entry,
    'test/smoke.mjs': smoke,
    'README.md': readme,
  }
}

function scaffoldSkill(name, description) {
  const skill = `---
name: ${name}
description: ${description.replace(/\s+/g, ' ').trim()}
---

# ${name}

Use this skill when the task clearly matches its description. Keep the body
short and put detailed references under \`references/\`.

## Workflow

1. Confirm the inputs and the expected output.
2. Do the smallest useful step.
3. Verify the result before reporting it.

## Safety

- Stay inside the caller's requested scope.
- Ask before destructive or shared-state changes.
`
  const notes = `# Notes\n\n- Replace this file with the skill's reference material.\n`
  return {
    'SKILL.md': skill,
    'references/notes.md': notes,
  }
}

export function createLab({ config, warn = () => {}, dshBin, currentProfile }) {
  const labDir = resolve(config.dir)
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const profilesDir = join(dshHome, 'profiles')
  const backupsRoot = join(dshHome, 'backups')
  const journalPath = join(labDir, 'ops.ndjson')

  async function ensureLab() {
    await mkdir(labDir, { recursive: true })
  }

  function assertEnabled() {
    if (config.enabled !== true) {
      throw new LabError(403, 'the lab is disabled: set lab.enabled=true in the plugin config to enable profile writes')
    }
  }

  function assertProfile(profile) {
    if (typeof profile !== 'string' || !PROFILE_RE.test(profile)) {
      throw new LabError(400, 'profile must be a simple profile name')
    }
    if (!Array.isArray(config.profiles) || !config.profiles.includes(profile)) {
      throw new LabError(403, `profile ${profile} is not in lab.profiles`)
    }
    if (profile === currentProfile && config.allowCurrentProfile !== true) {
      throw new LabError(403, `refusing to modify the current host profile (${currentProfile}); set lab.allowCurrentProfile=true only if you accept a restart`)
    }
    return profile
  }

  async function assertContained(path) {
    if (typeof path !== 'string' || path.length === 0) throw new LabError(400, 'path is required')
    await ensureLab()
    const root = resolve(labDir)
    const target = resolve(path)
    const rel = relative(root, target)
    if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
      throw new LabError(403, 'path must stay inside the lab directory')
    }
    if (!await exists(target)) throw new LabError(404, 'path does not exist')
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
    const realRel = relative(realRoot, realTarget)
    if (realRel.startsWith('..' + sep) || realRel === '..' || isAbsolute(realRel)) {
      throw new LabError(403, 'path resolves outside the lab directory')
    }
    return realTarget
  }

  async function appendJournal(entry) {
    await ensureLab()
    await appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf8')
  }

  async function runTool(args, timeoutMs) {
    if (typeof dshBin !== 'string' || !/\.(?:mjs|cjs|js)$/i.test(dshBin)) {
      throw new LabError(503, 'lab.dshBin must be the dsh bin.js entry (not a .cmd shim)')
    }
    return await new Promise(resolvePromise => {
      const child = spawn(process.execPath, [dshBin, ...args], {
        cwd: labDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        detached,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const append = (current, chunk) => current.length >= OUTPUT_CAP ? current : (current + chunk).slice(0, OUTPUT_CAP)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
      const timer = setTimeout(() => {
        timedOut = true
        terminateTree(child)
      }, timeoutMs)
      child.on('error', error => {
        clearTimeout(timer)
        resolvePromise({ code: null, signal: null, stdout, stderr: stderr + `\n${error.message}`, timedOut })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolvePromise({ code, signal, stdout, stderr, timedOut })
      })
    })
  }

  async function createBackup(profile, reason) {
    const id = `${stamp()}-qoder-connect-${profile}-${randomBytes(3).toString('hex')}`
    const dir = join(backupsRoot, id)
    await mkdir(dir, { recursive: true })
    const profileDir = join(profilesDir, profile)
    if (!await exists(profileDir)) throw new LabError(404, `profile ${profile} does not exist`)
    const files = []
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
      const source = join(profileDir, name)
      if (await exists(source)) {
        await copyFile(source, join(dir, name))
        files.push(name)
      }
    }
    const meta = { id, profile, reason, createdAt: Date.now(), files, dshHome }
    await writeFile(join(dir, 'backup.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
    return { id, dir, profile, files }
  }

  async function checkPlugin(path) {
    const errors = []
    const warnings = []
    const packagePath = join(path, 'package.json')
    let pkg
    try {
      pkg = await readJson(packagePath)
    } catch (error) {
      return { ok: false, kind: 'plugin', path, name: undefined, errors: [`package.json is missing or unreadable: ${error.message}`], warnings }
    }
    const name = typeof pkg.name === 'string' ? pkg.name : undefined
    if (name === undefined || !NAME_RE.test(name) || name.length > 214) errors.push('package.json name is not a valid npm package name')
    if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(pkg.version)) warnings.push('version is not a plain semantic version')
    if (pkg.type !== 'module') errors.push('package.json must set "type": "module"')
    if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') errors.push('package.json must declare dsh.bundle.patch = ./cordis.patch.yml')
    if (typeof pkg.main !== 'string' || pkg.main.length === 0) errors.push('package.json main is missing')
    if (pkg.exports?.['.'] === undefined) errors.push('package.json exports["."] is missing')
    if (!Array.isArray(pkg.files) || !pkg.files.includes('lib') || !pkg.files.includes('cordis.patch.yml')) {
      warnings.push('files should include "lib" and "cordis.patch.yml" for copy installs')
    }
    if (pkg.private === true) warnings.push('private: true prevents npm publication')
    if (pkg.license === undefined) warnings.push('license is missing')

    const patchPath = join(path, 'cordis.patch.yml')
    let patch = ''
    try {
      patch = await readFile(patchPath, 'utf8')
    } catch {
      errors.push('cordis.patch.yml is missing')
    }
    if (name !== undefined && patch.length > 0) {
      const escaped = escapeRegExp(name)
      if (!new RegExp(`^\\s*-\\s*id:\\s*['"]?${escaped}['"]?\\s*$`, 'm').test(patch)) errors.push(`cordis.patch.yml has no insert row with id: ${name}`)
      if (!new RegExp(`^\\s*name:\\s*['"]?${escaped}['"]?\\s*$`, 'm').test(patch)) errors.push(`cordis.patch.yml has no insert row with name: ${name}`)
    }

    const entry = typeof pkg.main === 'string' ? join(path, pkg.main) : undefined
    let entryText = ''
    if (entry === undefined || !await exists(entry)) {
      errors.push('main entry file does not exist')
    } else {
      entryText = await readFile(entry, 'utf8')
      if (!/export\s+(?:const|let|var)\s+name\s*=|export\s*\{[^}]*\bname\b/.test(entryText)) errors.push('entry does not export name')
      if (!/export\s+(?:async\s+)?function\s+apply\s*\(|export\s*\{[^}]*\bapply\b/.test(entryText)) errors.push('entry does not export apply(ctx)')
    }

    const libDir = join(path, 'lib')
    const libFiles = await walkFiles(libDir)
    const source = [entryText, ...await Promise.all(libFiles.filter(file => file !== entry).map(file => readFile(file, 'utf8')))].join('\n')
    if (/shell:\s*true/.test(source)) warnings.push('source enables a shell; prefer an argv array')
    if (/0\.0\.0\.0/.test(source)) warnings.push('source binds 0.0.0.0; host routes should follow the host binding')
    if (!await exists(join(path, 'test'))) warnings.push('no test/ directory')

    return { ok: errors.length === 0, kind: 'plugin', path, name, errors, warnings }
  }

  async function checkSkill(path) {
    const errors = []
    const warnings = []
    const skillPath = join(path, 'SKILL.md')
    let content = ''
    try {
      content = await readFile(skillPath, 'utf8')
    } catch {
      return { ok: false, kind: 'skill', path, name: undefined, errors: ['SKILL.md is missing'], warnings }
    }
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    if (match === null) {
      return { ok: false, kind: 'skill', path, name: undefined, errors: ['SKILL.md must start with YAML frontmatter'], warnings }
    }
    const fields = {}
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (field !== null) fields[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '')
    }
    const name = fields.name
    if (name === undefined || !SKILL_NAME_RE.test(name)) errors.push('frontmatter name is missing or invalid')
    if (fields.description === undefined || fields.description.length < 8) errors.push('frontmatter description is missing or too short')
    if (match[2].trim().length === 0) errors.push('SKILL.md body is empty')
    if (!match[2].includes('##')) warnings.push('SKILL.md body has no section headings')
    const folder = path.split(/[\\/]/).pop()
    if (name !== undefined && folder !== name) warnings.push(`skill name (${name}) differs from folder name (${folder})`)
    return { ok: errors.length === 0, kind: 'skill', path, name, errors, warnings }
  }

  async function check({ path }) {
    assertEnabled()
    const target = await assertContained(path)
    if (await exists(join(target, 'package.json'))) return await checkPlugin(target)
    if (await exists(join(target, 'SKILL.md'))) return await checkSkill(target)
    throw new LabError(400, 'path is neither a dsh plugin (package.json) nor a skill (SKILL.md)')
  }

  async function scaffold({ kind, name, description, force }) {
    assertEnabled()
    await ensureLab()
    if (kind !== 'plugin' && kind !== 'skill') throw new LabError(400, 'kind must be plugin or skill')
    if (typeof name !== 'string' || (kind === 'plugin' ? !NAME_RE.test(name) : !SKILL_NAME_RE.test(name))) {
      throw new LabError(400, kind === 'plugin' ? 'name must be a valid npm package name' : 'skill name must use lowercase letters, digits, and hyphens')
    }
    const target = join(labDir, kind === 'plugin' ? 'plugins' : 'skills', name)
    if (await exists(target) && force !== true) throw new LabError(409, `${target} already exists; pass force=true to overwrite`)
    const title = typeof description === 'string' && description.trim().length > 0
      ? description.trim().slice(0, 500)
      : `${name} generated by qoder-dsh-connect`
    const files = kind === 'plugin' ? scaffoldPlugin(name, title) : scaffoldSkill(name, title)
    for (const [relativePath, content] of Object.entries(files)) {
      const file = join(target, relativePath)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content, 'utf8')
    }
    const result = await (kind === 'plugin' ? checkPlugin(target) : checkSkill(target))
    await appendJournal({ op: 'scaffold', at: Date.now(), kind, name, path: target, ok: result.ok })
    return { kind, name, path: target, files: Object.keys(files), check: result }
  }

  async function install({ path, profile, mode }) {
    assertEnabled()
    await ensureLab()
    const target = await assertContained(path)
    assertProfile(profile)
    const report = await checkPlugin(target)
    if (!report.ok) throw new LabError(400, 'plugin check failed', report)
    const backup = await createBackup(profile, 'pre-install')
    const protocol = mode === 'link' ? 'link' : 'file'
    const spec = `${protocol}:${target.replace(/\\/g, '/')}`
    const args = ['plugin', '--profile', profile, 'add', spec]
    const output = await runTool(args, config.timeoutMs)
    const ok = output.code === 0 && output.timedOut !== true
    await appendJournal({
      op: 'install',
      at: Date.now(),
      profile,
      name: report.name,
      path: target,
      mode: protocol,
      ok,
      code: output.code,
      backupId: backup.id,
      backupDir: backup.dir,
      stdout: tail(output.stdout),
      stderr: tail(output.stderr),
    })
    return {
      ok,
      profile,
      name: report.name,
      path: target,
      mode: protocol,
      command: ['dsh', ...args],
      code: output.code,
      timedOut: output.timedOut,
      backup,
      stdout: tail(output.stdout),
      stderr: tail(output.stderr),
      check: report,
    }
  }

  async function uninstall({ name, profile }) {
    assertEnabled()
    await ensureLab()
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new LabError(400, 'name must be a valid npm package name')
    assertProfile(profile)
    const backup = await createBackup(profile, 'pre-uninstall')
    const args = ['plugin', '--profile', profile, 'remove', name]
    const output = await runTool(args, config.timeoutMs)
    const ok = output.code === 0 && output.timedOut !== true
    await appendJournal({
      op: 'uninstall',
      at: Date.now(),
      profile,
      name,
      ok,
      code: output.code,
      backupId: backup.id,
      backupDir: backup.dir,
      stdout: tail(output.stdout),
      stderr: tail(output.stderr),
    })
    return {
      ok,
      profile,
      name,
      command: ['dsh', ...args],
      code: output.code,
      timedOut: output.timedOut,
      backup,
      stdout: tail(output.stdout),
      stderr: tail(output.stderr),
    }
  }

  async function restore({ backupId, confirm }) {
    assertEnabled()
    if (typeof backupId !== 'string' || !BACKUP_RE.test(backupId)) throw new LabError(400, 'backupId is invalid')
    if (confirm !== backupId) throw new LabError(400, 'send confirm with the same backupId to restore')
    const dir = join(backupsRoot, backupId)
    let meta
    try {
      meta = await readJson(join(dir, 'backup.json'))
    } catch {
      throw new LabError(404, `backup ${backupId} was not found`)
    }
    assertProfile(meta.profile)
    const preRestore = await createBackup(meta.profile, 'pre-restore')
    const allowed = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml'])
    const restored = []
    for (const name of Array.isArray(meta.files) ? meta.files : []) {
      if (!allowed.has(name)) continue
      const source = join(dir, name)
      if (!await exists(source)) continue
      await copyFile(source, join(profilesDir, meta.profile, name))
      restored.push(name)
    }
    await appendJournal({ op: 'restore', at: Date.now(), profile: meta.profile, backupId, restoreFrom: backupId, preRestoreBackupId: preRestore.id, ok: true, files: restored })
    return { ok: true, profile: meta.profile, backupId, preRestoreBackup: preRestore, restored }
  }

  async function bootVerify(profile, timeoutMs) {
    if (typeof dshBin !== 'string' || !/\.(?:mjs|cjs|js)$/i.test(dshBin)) {
      throw new LabError(503, 'lab.dshBin must be the dsh bin.js entry')
    }
    return await new Promise(resolvePromise => {
      const args = ['--profile', profile, '--no-open', '--port', '0']
      const child = spawn(process.execPath, [dshBin, ...args], {
        cwd: labDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        detached,
      })
      let output = ''
      let url
      let settled = false
      let timer
      const append = chunk => {
        if (output.length >= OUTPUT_CAP) return
        output = (output + chunk).slice(0, OUTPUT_CAP)
        if (url === undefined) {
          const match = output.match(/dsh web:\s*(https?:\/\/\S+)/)
          if (match !== null) url = match[1]
        }
      }
      const finish = async () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const warnings = redactSecrets(output).split(/\r?\n/).filter(line => /did not activate|patch: entry|startup failed/i.test(line)).slice(0, 20)
        let reachable
        if (url !== undefined) {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
            reachable = response.status < 500
          } catch {
            reachable = false
          }
        }
        terminateTree(child)
        resolvePromise({ ok: url !== undefined && reachable === true, profile, url: url === undefined ? undefined : redactSecrets(url), reachable, warnings, output: tail(output, 6000) })
      }
      timer = setTimeout(async () => { await finish() }, timeoutMs)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        append(chunk)
        if (url !== undefined) setTimeout(() => { void finish() }, 800)
      })
      child.stderr.on('data', append)
      child.on('error', async error => {
        append(`\n${error.message}`)
        await finish()
      })
      child.on('close', async () => { await finish() })
    })
  }

  async function verify({ profile, boot }) {
    assertEnabled()
    await ensureLab()
    assertProfile(profile)
    if (boot === true) return await bootVerify(profile, config.timeoutMs)
    const output = await runTool(['--profile', profile, '--dump-config'], config.timeoutMs)
    const warnings = redactSecrets(output.stderr).split(/\r?\n/).filter(line => line.trim().length > 0).slice(0, 20)
    const configured = [...output.stdout.matchAll(/^\s*-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map(match => match[1])
    return {
      ok: output.code === 0 && output.timedOut !== true && !warnings.some(line => /patch: entry|did not activate/i.test(line)),
      mode: 'config',
      profile,
      code: output.code,
      timedOut: output.timedOut,
      configured,
      warnings,
      stderr: tail(output.stderr),
    }
  }

  async function ops(limit = 50) {
    assertEnabled()
    const records = await readNdjson(journalPath, Math.min(Math.max(limit, 1), 500))
    return records.slice().reverse()
  }

  return {
    status() {
      return {
        enabled: config.enabled === true,
        dir: labDir,
        dshHome,
        currentProfile,
        profiles: config.profiles,
        allowCurrentProfile: config.allowCurrentProfile === true,
        bin: dshBin,
      }
    },
    scaffold,
    check,
    install,
    uninstall,
    restore,
    verify,
    ops,
  }
}

export { LabError }
