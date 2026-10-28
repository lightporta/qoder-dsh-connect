import { timingSafeEqual } from 'node:crypto'

function isIPv4Loopback(value) {
  const parts = value.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (isIPv4Loopback(mapped)) return true
    const hex = mapped.match(/^([0-9a-f]{1,4}):[0-9a-f]{1,4}$/)
    return hex !== null && (Number.parseInt(hex[1], 16) >>> 8) === 127
  }
  return isIPv4Loopback(normalized)
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost') return true
  if (hostname.startsWith('[') && hostname.endsWith(']')) return isLoopbackAddress(hostname.slice(1, -1))
  return isIPv4Loopback(hostname)
}

/**
 * The fence limits who can reach the routes; it is not a privilege boundary
 * between local users. The socket address is authoritative, never X-Forwarded-For.
 */
export function isLoopbackRequest(request) {
  if (request === undefined || request === null) return false
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const expectedProtocol = request.socket?.encrypted ? 'https:' : 'http:'
    return new URL(origin).origin === `${expectedProtocol}//${hostUrl.host}`
  } catch {
    return false
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}

export function isAuthorized(request, token) {
  if (typeof token !== 'string' || token.length === 0) return true
  const header = request.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    if (safeEqual(header.slice('Bearer '.length), token)) return true
  }
  const shared = request.headers['x-qoder-token']
  if (typeof shared === 'string' && safeEqual(shared, token)) return true
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const queryToken = url.searchParams.get('token')
    if (queryToken !== null && safeEqual(queryToken, token)) return true
  } catch {
    return false
  }
  return false
}
