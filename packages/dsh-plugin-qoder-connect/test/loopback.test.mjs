import test from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackRequest } from '../lib/loopback.js'

test('loopback fence accepts canonical IPv4-mapped IPv6 hosts and rejects public mapped hosts', () => {
  const request = host => ({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host } })
  assert.equal(isLoopbackRequest(request('[::ffff:127.0.0.1]:3080')), true)
  assert.equal(isLoopbackRequest(request('[::ffff:7f00:1]:3080')), true)
  assert.equal(isLoopbackRequest(request('[::ffff:192.168.1.1]:3080')), false)
  assert.equal(isLoopbackRequest(request('user@localhost:3080')), false)
  assert.equal(isLoopbackRequest(request('localhost:3080/path')), false)
})

test('loopback origin checks the protocol as well as the authority', () => {
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3080', origin: 'https://localhost:3080' } }
  assert.equal(isLoopbackRequest(request), false)
  request.socket.encrypted = true
  assert.equal(isLoopbackRequest(request), true)
  request.headers.origin = 'http://localhost:3080'
  assert.equal(isLoopbackRequest(request), false)
})
