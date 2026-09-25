import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

export class BufferRateLimitError extends Error {
  constructor(until) { super('Buffer rate limited'); this.code = 'BUFFER_RATE_LIMITED'; this.until = until }
}

/** One quota gate for identity reads and publications. It never retries a request. */
export function createBufferFetch({ token, statePath, fetchImpl = fetch, now = Date.now, onRateLimit = () => {} }) {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  let blockedUntil = 0, pending = Promise.resolve(), stateUnavailable = false
  function readDeadline() {
    if (!statePath) return
    try {
      const saved = JSON.parse(readFileSync(statePath, 'utf8'))
      if (!Number.isSafeInteger(saved.blockedUntil) || saved.blockedUntil < 0 || typeof saved.tokenHash !== 'string') {
        throw new Error('Invalid Buffer quota state')
      }
      if (saved.tokenHash === tokenHash) blockedUntil = Math.max(blockedUntil, saved.blockedUntil)
      stateUnavailable = false
    } catch (error) {
      if (error.code === 'ENOENT') { stateUnavailable = false; return }
      if (!stateUnavailable) console.error('C2SNS_BUFFER_STATE_UNAVAILABLE')
      stateUnavailable = true
    }
  }
  readDeadline()
  async function recordDeadline(response) {
    const timestamp = now()
    let deadline = 0
    for (const policy of (response.headers?.get('ratelimit') ?? '').split(',')) {
      const remaining = policy.match(/;\s*r=(\d+)/), reset = policy.match(/;\s*t=(\d+)/)
      if (remaining && reset && Number(remaining[1]) === 0) deadline = Math.max(deadline, timestamp + Number(reset[1]) * 1000)
    }
    let rateLimited = response.status === 429, safeToRetry = rateLimited
    if (response.clone) {
      try {
        const body = await response.clone().json()
        const graphThrottle = body.errors?.some(error => error.extensions?.code === 'RATE_LIMIT_EXCEEDED') === true
        rateLimited ||= graphThrottle
        // A mixed GraphQL response may contain a successful mutation alongside
        // an error. Only a rejected field, never a partial receipt, is retryable.
        safeToRetry = rateLimited && !body.data?.createPost?.post?.id
            && (response.status === 429 || body.data?.createPost == null)
      } catch { safeToRetry = response.status === 429 }
    }
    if (rateLimited) {
      const retry = response.headers?.get('retry-after')
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry ?? '') - timestamp
      deadline = Math.max(deadline, timestamp + (Number.isFinite(delay) && delay > 0 ? delay : 3600000))
    }
    if (!Number.isSafeInteger(deadline) || deadline <= blockedUntil) return safeToRetry
    blockedUntil = deadline
    if (statePath) {
      const temporary = statePath + '.' + randomUUID() + '.tmp'
      try {
        writeFileSync(temporary, JSON.stringify({ tokenHash, blockedUntil }), { mode: 0o600 })
        renameSync(temporary, statePath)
      } catch { console.error('C2SNS_BUFFER_STATE_UNAVAILABLE') }
    }
    onRateLimit(blockedUntil)
    return safeToRetry
  }
  const guardedFetch = (url, init) => {
    const task = pending.then(async () => {
      readDeadline()
      if (stateUnavailable) throw new BufferRateLimitError(now() + 60000)
      if (blockedUntil > now()) throw new BufferRateLimitError(blockedUntil)
      if (url !== 'https://api.buffer.com') throw new Error('Unexpected Buffer endpoint')
      const response = await fetchImpl(url, init)
      if (await recordDeadline(response)) throw new BufferRateLimitError(blockedUntil)
      return response
    })
    pending = task.catch(() => {})
    return task
  }
  guardedFetch.blockedUntil = () => {
    readDeadline()
    return stateUnavailable ? now() + 60000 : blockedUntil > now() ? blockedUntil : 0
  }
  return guardedFetch
}
