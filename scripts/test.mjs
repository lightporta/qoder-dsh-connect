import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const which = process.argv[2]
const roots = which === 'host'
  ? ['packages/dsh-plugin-qoder-connect/test']
  : which === 'cli'
    ? ['packages/qoder-dsh-connect-cli/test']
    : ['packages/dsh-plugin-qoder-connect/test', 'packages/qoder-dsh-connect-cli/test']

const files = []
for (const dir of roots) {
  const entries = await readdir(join(root, dir))
  for (const entry of entries) {
    if (entry.endsWith('.test.mjs')) files.push(join(dir, entry))
  }
}
if (files.length === 0) {
  console.error('no test files found')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['--test', ...files.sort()], { cwd: root, stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
