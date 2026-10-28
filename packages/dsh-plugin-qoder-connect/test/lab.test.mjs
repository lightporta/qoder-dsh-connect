import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLab } from '../lib/lab.js'

const FAKE_DSH = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url))

async function makeLab(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qdc-lab-'))
  const dshHome = join(root, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'lab')
  await mkdir(profileDir, { recursive: true })
  const packageJson = { name: 'dsh-profile-lab', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
  await writeFile(join(profileDir, 'cordis.patch.yml'), '# lab profile\n')
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  const labDir = join(root, 'lab')
  const config = {
    enabled: true,
    dir: labDir,
    dshHome,
    profiles: ['lab'],
    allowCurrentProfile: false,
    timeoutMs: 15000,
    ...overrides,
  }
  const lab = createLab({ config, warn: () => {}, dshBin: FAKE_DSH, currentProfile: overrides.currentProfile ?? 'web' })
  return { root, dshHome, profileDir, labDir, lab, config, packageJson }
}

async function cleanup(context) {
  await rm(context.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

test('lab scaffolds and statically checks a plugin and a skill', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'demo-plugin', description: 'A demo plugin' })
    assert.equal(plugin.check.ok, true)
    assert.ok(plugin.files.includes('package.json'))
    const pluginReport = await context.lab.check({ path: plugin.path })
    assert.equal(pluginReport.ok, true)
    assert.equal(pluginReport.name, 'demo-plugin')
    assert.deepEqual(pluginReport.errors, [])

    const skill = await context.lab.scaffold({ kind: 'skill', name: 'demo-skill', description: 'A demo skill for tests' })
    assert.equal(skill.check.ok, true)
    const skillReport = await context.lab.check({ path: skill.path })
    assert.equal(skillReport.ok, true)
    assert.equal(skillReport.kind, 'skill')

    const disabled = createLab({
      config: { ...context.config, enabled: false },
      warn: () => {},
      dshBin: FAKE_DSH,
      currentProfile: 'web',
    })
    await assert.rejects(() => disabled.scaffold({ kind: 'plugin', name: 'blocked-plugin' }), error => error.status === 403)
    await assert.rejects(() => disabled.check({ path: plugin.path }), error => error.status === 403)
  } finally {
    await cleanup(context)
  }
})

test('lab install, verify, uninstall, and restore take backups and stay inside the lab', async () => {
  const context = await makeLab()
  const fakeLog = join(context.root, 'fake-dsh.log')
  process.env.FAKE_DSH_LOG = fakeLog
  process.env.FAKE_DSH_DUMP = '- id: demo-plugin\n  name: demo-plugin\n- id: candidate-lab\n  name: candidate-lab\n'
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'demo-plugin', description: 'A demo plugin' })
    const before = await readFile(join(context.profileDir, 'package.json'), 'utf8')

    const installed = await context.lab.install({ path: plugin.path, profile: 'lab' })
    assert.equal(installed.ok, true)
    assert.equal(installed.profile, 'lab')
    assert.equal(installed.mode, 'file')
    assert.ok(installed.backup.id)
    assert.ok(installed.backup.files.includes('package.json'))
    const journal = await context.lab.ops(50)
    assert.ok(journal.some(entry => entry.op === 'install' && entry.ok === true))

    const calls = (await readFile(fakeLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.ok(calls.some(call => call.args[0] === 'plugin' && call.args.includes('add') && call.args.some(arg => arg.startsWith('file:'))))

    const configReport = await context.lab.verify({ profile: 'lab' })
    assert.equal(configReport.ok, true)
    assert.equal(configReport.expected, 'demo-plugin')
    assert.equal(configReport.verificationScope, 'plugin-configuration')
    assert.ok(configReport.configured.includes('candidate-lab'))
    assert.equal(configReport.stdout, undefined)

    const bootReport = await context.lab.verify({ profile: 'lab', boot: true })
    assert.equal(bootReport.ok, true)
    assert.match(bootReport.url, /^http:\/\/127\.0\.0\.1:\d+\//)
    assert.match(bootReport.url, /token=<redacted>/)
    assert.equal(bootReport.url.includes('token=fake'), false)
    assert.equal(bootReport.reachable, true)

    const removed = await context.lab.uninstall({ name: 'demo-plugin', profile: 'lab' })
    assert.equal(removed.ok, true)
    assert.ok(removed.backup.id)

    await writeFile(join(context.profileDir, 'package.json'), '{"name":"mutated"}\n')
    await writeFile(join(context.profileDir, 'pnpm-workspace.yaml'), 'packages: []\n')
    const restored = await context.lab.restore({ backupId: installed.backup.id, confirm: installed.backup.id })
    assert.equal(restored.ok, true)
    assert.ok(restored.restored.includes('package.json'))
    assert.equal(await readFile(join(context.profileDir, 'package.json'), 'utf8'), before)
    assert.ok(restored.preRestoreBackup.id)
    assert.deepEqual(restored.removed, ['pnpm-workspace.yaml'])
    await assert.rejects(readFile(join(context.profileDir, 'pnpm-workspace.yaml')), { code: 'ENOENT' })

    const outside = join(context.root, 'outside')
    await mkdir(outside)
    await assert.rejects(() => context.lab.check({ path: outside }), error => error.status === 403)
    await assert.rejects(() => context.lab.restore({ backupId: installed.backup.id, confirm: 'wrong' }), error => error.status === 400)
  } finally {
    delete process.env.FAKE_DSH_LOG
    delete process.env.FAKE_DSH_DUMP
    await cleanup(context)
  }
})

test('lab verify creates its working directory when it does not exist yet', async () => {
  const context = await makeLab()
  try {
    await rm(context.labDir, { recursive: true, force: true })
    const report = await context.lab.verify({ profile: 'lab' })
    assert.equal(report.ok, true)
    assert.ok(report.configured.includes('candidate-lab'))
  } finally {
    await cleanup(context)
  }
})

test('lab refuses non-allowlisted profiles and the current host profile', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'guarded-plugin' })
    await assert.rejects(() => context.lab.install({ path: plugin.path, profile: 'other' }), error => error.status === 403)

    context.config.profiles.push('web')
    await assert.rejects(
      () => context.lab.install({ path: plugin.path, profile: 'web' }),
      error => error.status === 403 && /current/.test(error.message),
    )
  } finally {
    await cleanup(context)
  }
})

test('lab scaffold refuses directory symlinks that escape its root', async () => {
  const context = await makeLab()
  try {
    const outside = join(context.root, 'outside')
    await mkdir(outside)
    await mkdir(context.labDir)
    await symlink(outside, join(context.labDir, 'plugins'), 'junction')
    await assert.rejects(
      context.lab.scaffold({ kind: 'plugin', name: 'escaped-plugin', force: true }),
      error => error.status === 403,
    )
    await assert.rejects(readFile(join(outside, 'escaped-plugin', 'package.json')), { code: 'ENOENT' })
  } finally {
    await cleanup(context)
  }
})

test('lab scaffold preflights every existing file before force writes', { skip: process.platform === 'win32' }, async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'guarded-plugin', description: 'Original description' })
    const before = await readFile(join(plugin.path, 'package.json'), 'utf8')
    const outside = join(context.root, 'outside.md')
    await writeFile(outside, 'original outside content')
    await rm(join(plugin.path, 'README.md'))
    await symlink(outside, join(plugin.path, 'README.md'))
    await assert.rejects(
      context.lab.scaffold({ kind: 'plugin', name: 'guarded-plugin', description: 'New description', force: true }),
      error => error.status === 403,
    )
    assert.equal(await readFile(outside, 'utf8'), 'original outside content')
    assert.equal(await readFile(join(plugin.path, 'package.json'), 'utf8'), before)
  } finally {
    await cleanup(context)
  }
})

test('lab check refuses main entries outside the plugin', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'guarded-plugin' })
    await writeFile(join(context.root, 'outside.js'), 'export const name = "outside"; export function apply() {}\n')
    const packagePath = join(plugin.path, 'package.json')
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
    pkg.main = '../../../outside.js'
    await writeFile(packagePath, JSON.stringify(pkg))
    const report = await context.lab.check({ path: plugin.path })
    assert.equal(report.ok, false)
    assert.ok(report.errors.some(error => /main entry.*authorized directory/.test(error)))
  } finally {
    await cleanup(context)
  }
})

test('lab refuses profile symlinks outside profiles and aliases of the current profile', async () => {
  const context = await makeLab({ profiles: ['escape', 'alias'] })
  try {
    const outside = join(context.root, 'outside-profile')
    await mkdir(outside)
    await symlink(outside, join(context.dshHome, 'profiles', 'escape'), 'junction')
    await assert.rejects(context.lab.verify({ profile: 'escape' }), error => error.status === 403)

    const web = join(context.dshHome, 'profiles', 'web')
    await mkdir(web)
    await symlink(web, join(context.dshHome, 'profiles', 'alias'), 'junction')
    await assert.rejects(context.lab.verify({ profile: 'alias' }), error => error.status === 403)
  } finally {
    await cleanup(context)
  }
})

test('lab restore rejects an incomplete backup before changing the profile', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'backup-plugin' })
    const installed = await context.lab.install({ path: plugin.path, profile: 'lab' })
    await rm(join(installed.backup.dir, 'cordis.patch.yml'))
    const changed = '{"name":"changed"}\n'
    await writeFile(join(context.profileDir, 'package.json'), changed)
    await assert.rejects(
      context.lab.restore({ backupId: installed.backup.id, confirm: installed.backup.id }),
      error => error.status === 404,
    )
    assert.equal(await readFile(join(context.profileDir, 'package.json'), 'utf8'), changed)
  } finally {
    await cleanup(context)
  }
})

test('lab verify detects a missing installed plugin and ignores nested or disabled IDs', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'missing-plugin' })
    await context.lab.install({ path: plugin.path, profile: 'lab' })
    const inferred = await context.lab.verify({ profile: 'lab' })
    assert.equal(inferred.ok, false)
    assert.equal(inferred.expected, 'missing-plugin')
    assert.deepEqual(inferred.missing, ['missing-plugin'])

    const bin = join(context.root, 'dump.mjs')
    const dump = '- id: parent\n  config:\n    - id: nested-plugin\n- id: disabled-plugin\n  disabled: true\n- name: active\n  id: active-plugin\n'
    await writeFile(bin, `process.stdout.write(${JSON.stringify(dump)})\n`)
    const lab = createLab({ config: context.config, dshBin: bin, currentProfile: 'web' })
    for (const name of ['nested-plugin', 'disabled-plugin']) {
      const report = await lab.verify({ profile: 'lab', name })
      assert.equal(report.ok, false)
      assert.deepEqual(report.missing, [name])
      assert.deepEqual(report.configured, ['parent', 'active-plugin'])
    }
    const active = await lab.verify({ profile: 'lab', name: 'active-plugin' })
    assert.equal(active.ok, true)
    assert.equal(active.verificationScope, 'plugin-configuration')
  } finally {
    await cleanup(context)
  }
})

test('lab backup refuses symbolic links in the four profile files', { skip: process.platform === 'win32' }, async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'guarded-plugin' })
    const outside = join(context.root, 'credentials.yaml')
    await writeFile(outside, 'private: fixture\n')
    await rm(join(context.profileDir, 'pnpm-lock.yaml'))
    await symlink(outside, join(context.profileDir, 'pnpm-lock.yaml'))
    await assert.rejects(
      context.lab.install({ path: plugin.path, profile: 'lab' }),
      error => error.status === 403 && /regular file/.test(error.message),
    )
    assert.equal(await readFile(outside, 'utf8'), 'private: fixture\n')
  } finally {
    await cleanup(context)
  }
})

test('lab serializes concurrent profile changes until each tool exits', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'queued-plugin' })
    const log = join(context.root, 'tool.log')
    const bin = join(context.root, 'slow-tool.mjs')
    await writeFile(bin, `import { appendFileSync } from 'node:fs'
const log = ${JSON.stringify(log)}
appendFileSync(log, 'start\\n')
setTimeout(() => { appendFileSync(log, 'end\\n'); process.exit(0) }, 80)
`)
    const lab = createLab({ config: context.config, dshBin: bin, currentProfile: 'web' })
    const results = await Promise.all([
      lab.install({ path: plugin.path, profile: 'lab' }),
      lab.uninstall({ name: 'queued-plugin', profile: 'lab' }),
    ])
    assert.ok(results.every(result => result.ok))
    assert.equal(await readFile(log, 'utf8'), 'start\nend\nstart\nend\n')
  } finally {
    await cleanup(context)
  }
})

test('lab boot verification waits for the temporary host to close', async () => {
  const context = await makeLab()
  try {
    const pidPath = join(context.root, 'host.pid')
    const bin = join(context.root, 'boot-tool.mjs')
    await writeFile(bin, `import { writeFileSync } from 'node:fs'
if (process.argv.includes('--dump-config')) {
  process.stdout.write('- id: boot-plugin\\n')
} else {
  writeFileSync(${JSON.stringify(pidPath)}, String(process.pid))
  process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 150) })
  process.stdout.write('dsh web: http://127.0.0.1:1/\\n')
  setInterval(() => {}, 1000)
}
`)
    const lab = createLab({ config: context.config, dshBin: bin, currentProfile: 'web' })
    const report = await lab.verify({ profile: 'lab', boot: true, name: 'boot-plugin' })
    assert.equal(report.ok, false)
    assert.equal(report.stopped, true)
    const pid = Number(await readFile(pidPath, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    await cleanup(context)
  }
})

test('lab check reports malformed package shapes and directory main entries', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'shape-plugin' })
    const path = join(plugin.path, 'package.json')
    const original = JSON.parse(await readFile(path, 'utf8'))
    for (const pkg of [null, [], 'string', 17, { ...original, main: 'lib' }, { ...original, name: {} }]) {
      await writeFile(path, JSON.stringify(pkg))
      const report = await context.lab.check({ path: plugin.path })
      assert.equal(report.ok, false)
      assert.ok(report.errors.length > 0)
    }
  } finally {
    await cleanup(context)
  }
})

test('lab uses its configured DSH_HOME for install, config, and boot tools', async () => {
  const context = await makeLab()
  try {
    const plugin = await context.lab.scaffold({ kind: 'plugin', name: 'home-plugin' })
    const log = join(context.root, 'homes.ndjson')
    const bin = join(context.root, 'home-tool.mjs')
    await writeFile(bin, `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), home: process.env.DSH_HOME }) + '\\n')
if (process.argv.includes('--dump-config')) process.stdout.write('- id: home-plugin\\n')
else if (process.argv.includes('--no-open')) {
  process.stdout.write('dsh web: http://127.0.0.1:1/\\n')
  setInterval(() => {}, 1000)
}
`)
    const lab = createLab({ config: context.config, dshBin: bin, currentProfile: 'web' })
    assert.equal((await lab.install({ path: plugin.path, profile: 'lab' })).ok, true)
    assert.equal((await lab.verify({ profile: 'lab', boot: true })).stopped, true)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.home === context.dshHome))
    assert.ok(calls.some(call => call.args.includes('add')))
    assert.ok(calls.some(call => call.args.includes('--dump-config')))
    assert.ok(calls.some(call => call.args.includes('--no-open')))
  } finally {
    await cleanup(context)
  }
})

test('lab detects activation warnings beyond the returned warning preview', async () => {
  const context = await makeLab()
  try {
    const bin = join(context.root, 'warnings.mjs')
    const stderr = 'startup notice\n'.repeat(25) + 'plugin did not activate\n'
    await writeFile(bin, `process.stderr.write(${JSON.stringify(stderr)}); process.stdout.write('- id: warning-plugin\\n')\n`)
    const lab = createLab({ config: context.config, dshBin: bin, currentProfile: 'web' })
    const result = await lab.verify({ profile: 'lab', name: 'warning-plugin' })
    assert.equal(result.ok, false)
    assert.equal(result.warnings.length, 20)
  } finally {
    await cleanup(context)
  }
})

test('lab serialization recovers after a rejected operation', async () => {
  const context = await makeLab()
  try {
    const results = await Promise.allSettled([
      context.lab.scaffold({ kind: 'invalid', name: 'first' }),
      context.lab.scaffold({ kind: 'plugin', name: 'after-failure' }),
    ])
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[0].reason.status, 400)
    assert.equal(results[1].status, 'fulfilled')
    assert.equal(results[1].value.check.ok, true)
  } finally {
    await cleanup(context)
  }
})

test('lab refuses to read an operations journal symlink', { skip: process.platform === 'win32' }, async () => {
  const context = await makeLab()
  try {
    await mkdir(context.labDir)
    const outside = join(context.root, 'outside.ndjson')
    await writeFile(outside, '{"private":"fixture"}\n')
    await symlink(outside, join(context.labDir, 'ops.ndjson'))
    await assert.rejects(context.lab.ops(), error => error.status === 403)
    await assert.rejects(context.lab.verify({ profile: 'lab' }), error => error.status === 403)
  } finally {
    await cleanup(context)
  }
})
