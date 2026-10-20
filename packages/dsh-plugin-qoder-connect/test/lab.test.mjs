import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    const restored = await context.lab.restore({ backupId: installed.backup.id, confirm: installed.backup.id })
    assert.equal(restored.ok, true)
    assert.ok(restored.restored.includes('package.json'))
    assert.equal(await readFile(join(context.profileDir, 'package.json'), 'utf8'), before)
    assert.ok(restored.preRestoreBackup.id)

    const outside = join(context.root, 'outside')
    await mkdir(outside)
    await assert.rejects(() => context.lab.check({ path: outside }), error => error.status === 403)
    await assert.rejects(() => context.lab.restore({ backupId: installed.backup.id, confirm: 'wrong' }), error => error.status === 400)
  } finally {
    delete process.env.FAKE_DSH_LOG
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
