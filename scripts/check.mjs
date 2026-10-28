import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const errors = []
const warnings = []

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'test-output.log') continue
    // Local deployment simulations contain external runtimes, not project sources.
    if (dir === root && entry.name === 'sim') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = await walk(root)
for (const file of files.filter(path => /\.(?:mjs|js)$/.test(path))) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (checked.status !== 0) errors.push(`${relative(root, file)}: ${checked.stderr.trim()}`)
}

for (const file of files.filter(path => path.endsWith('package.json'))) {
  try {
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    if (pkg.type !== 'module' && !pkg.name?.endsWith('-workspace')) warnings.push(`${relative(root, file)}: package type is not module`)
    if (pkg.name === 'qoder-dsh-connect') {
      if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') errors.push('host package.json: dsh.bundle.patch must be ./cordis.patch.yml')
      if (!Array.isArray(pkg.files) || !pkg.files.includes('lib') || !pkg.files.includes('cordis.patch.yml')) errors.push('host package.json: files must include lib and cordis.patch.yml')
      const patch = await readFile(join(root, 'packages/dsh-plugin-qoder-connect/cordis.patch.yml'), 'utf8')
      if (!/-\s*id:\s*qoder-dsh-connect/.test(patch)) errors.push('cordis.patch.yml: missing id row')
      if (!/name:\s*['"]qoder-dsh-connect['"]/.test(patch)) errors.push('cordis.patch.yml: missing name row')
    }
  } catch (error) {
    errors.push(`${relative(root, file)}: invalid JSON (${error.message})`)
  }
}

const skillPath = join(root, 'packages/qoder-dsh-connect-cli/skill/qoder-dsh-connect/SKILL.md')
try {
  const skill = await readFile(skillPath, 'utf8')
  if (!/^---\r?\nname:\s*qoder-dsh-connect\r?\ndescription:\s*\S+/m.test(skill)) errors.push('skill frontmatter is missing name/description')
} catch {
  errors.push('packages/qoder-dsh-connect-cli/skill/qoder-dsh-connect/SKILL.md is missing')
}

for (const file of files.filter(path => /packages[\\/](?:dsh-plugin-qoder-connect|qoder-dsh-connect-cli)[\\/](?:lib|bin)[\\/].*\.(?:js|mjs)$/.test(path))) {
  const source = await readFile(file, 'utf8')
  if (/shell:\s*true/.test(source)) errors.push(`${relative(root, file)}: shell: true is forbidden`)
  if (/child_process['"]?\)?\.exec\s*\(/.test(source)) errors.push(`${relative(root, file)}: child_process.exec is forbidden; use spawn with an argv array`)
}

if (warnings.length > 0) {
  process.stdout.write(`warnings:\n${warnings.map(line => `- ${line}`).join('\n')}\n`)
}
if (errors.length > 0) {
  process.stderr.write(`check failed:\n${errors.map(line => `- ${line}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`check passed: ${files.length} files scanned\n`)
