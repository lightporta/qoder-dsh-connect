import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { detached, terminateTree } from '../lib/process-tree.js'

test('tree termination kills descendants even when the leader exits first', { timeout: 20000 }, async () => {
  const grandchildSource = `
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    console.log(process.pid);
  `
  const leaderSource = `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => process.exit(0));
    spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: ['ignore', 'inherit', 'inherit'] });
    setInterval(() => {}, 1000);
  `
  const child = spawn(process.execPath, ['-e', leaderSource], { detached, stdio: ['ignore', 'pipe', 'pipe'] })
  let timer
  let grandchildPid
  try {
    const ready = once(child.stdout, 'data')
    const closed = once(child, 'close')
    const [data] = await ready
    grandchildPid = Number(data.toString().trim())
    terminateTree(child, 100)
    const result = await Promise.race([
      closed.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500) }),
    ])
    assert.equal(result, true, 'a surviving descendant kept the stdout pipe and run open')
  } finally {
    clearTimeout(timer)
    if (process.platform === 'win32') {
      for (const pid of [grandchildPid, child.pid]) {
        if (Number.isInteger(pid)) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
      }
    }
    else {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
  }
})
