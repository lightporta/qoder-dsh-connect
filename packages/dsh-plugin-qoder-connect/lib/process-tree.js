import { spawnSync } from 'node:child_process'

const GRACE_MS = 3000

export const detached = process.platform !== 'win32'

function signalTree(child, signal) {
  if (child === undefined || child.pid === undefined) return false
  try {
    process.kill(-child.pid, signal)
    return true
  } catch {
    try {
      child.kill(signal)
      return true
    } catch {
      return false
    }
  }
}

export function terminateTree(child, graceMs = GRACE_MS) {
  if (child === undefined || child.pid === undefined) return
  if (process.platform === 'win32') {
    // Killing the leader first prevents taskkill from discovering its descendants.
    try {
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', timeout: 5000,
      })
      if (result.status === 0) return
    } catch {
      // Fall back to stopping the direct child if taskkill is unavailable.
    }
    try { child.kill('SIGKILL') } catch {}
    return
  }
  if (!signalTree(child, 'SIGTERM')) return
  const escalate = setTimeout(() => {
    // The leader can exit while same-group descendants still hold its pipes.
    signalTree(child, 'SIGKILL')
  }, graceMs)
  escalate.unref()
}
