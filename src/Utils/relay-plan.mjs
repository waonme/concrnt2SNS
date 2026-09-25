import { configuredXRoutes } from './x-routes.mjs'

const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
const aliasPattern = /^[\p{L}\p{M}\p{N}_-]{1,100}$/u
const requireConfig = condition => { if (!condition) throw new Error('Invalid relay configuration') }
export const validTimeline = value => typeof value === 'string' && value.length <= 2048
  && /^cckv:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._/-]+$/.test(value)
  && !value.endsWith('/') && !value.split('/').some(part => part === '..' || part === '.')

function validService(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
  } catch { return false }
}

/** Legacy routes remain authoritative; new accounts never join them implicitly. */
export function configuredRelayPlan(config) {
  requireConfig([undefined, 'true', 'false'].includes(config.TW_ENABLE)
    && [undefined, 'true', 'false'].includes(config.BS_ENABLE))
  const accounts = [], routes = []
  const addRoute = (timeline, accountIds, requiresMediaWarning = false) => {
    requireConfig(validTimeline(timeline) && !routes.some(route => route.timeline === timeline))
    routes.push({ timeline, accountIds, ...(requiresMediaWarning ? { requiresMediaWarning: true } : {}) })
  }
  const xEnabled = config.TW_ENABLE !== 'false', bskyEnabled = config.BS_ENABLE !== 'false'
  const xRoutes = configuredXRoutes(config)
  if (xEnabled) {
    for (const route of xRoutes) {
      accounts.push({ id: route.common ? 'x-primary' : 'legacy-x-' + route.channelId,
        provider: 'x', channelId: route.channelId, label: 'X', aliases: [], timeline: route.timeline })
    }
  }
  if (bskyEnabled) accounts.push({ id: 'bsky-primary', provider: 'bsky', service: config.BS_SERVICE,
    credentialRef: 'legacy', label: 'Bluesky', aliases: [], timeline: config.BS_LISTEN_TIMELINE })
  addRoute(config.LISTEN_TIMELINE, accounts.filter(account => ['x-primary', 'bsky-primary'].includes(account.id)).map(account => account.id))
  // Reserve both primary dedicated routes even when their provider is disabled.
  addRoute(config.TW_LISTEN_TIMELINE, xEnabled ? ['x-primary'] : [])
  addRoute(config.BS_LISTEN_TIMELINE, bskyEnabled ? ['bsky-primary'] : [])
  for (const route of xRoutes.filter(route => !route.common)) {
    addRoute(route.timeline, xEnabled ? ['legacy-x-' + route.channelId] : [])
  }

  const extension = config.RELAY ?? { version: 1, accounts: [], routes: [] }
  requireConfig(extension && extension.version === 1 && Array.isArray(extension.accounts)
    && extension.accounts.length <= 20 && Array.isArray(extension.routes) && extension.routes.length <= 80)
  const ids = new Set(['x-primary', 'bsky-primary', ...accounts.map(account => account.id)])
  const channels = new Set(xRoutes.map(route => route.channelId))
  const subjects = new Set(), credentialRefs = new Set()
  for (const entry of extension.accounts) {
    requireConfig(entry && typeof entry.id === 'string' && idPattern.test(entry.id) && !ids.has(entry.id)
      && ['x', 'bsky'].includes(entry.provider) && typeof entry.enabled === 'boolean')
    ids.add(entry.id)
    // Incomplete placeholders have no effect and require no secrets or network calls.
    if (!entry.enabled) continue
    const label = entry.label ?? (entry.provider === 'x' ? 'X' : 'Bluesky')
    const aliases = entry.aliases ?? []
    requireConfig(typeof label === 'string' && label.trim().length > 0 && label.length <= 100
      && Array.isArray(aliases) && aliases.length <= 18
      && aliases.every(value => typeof value === 'string' && aliasPattern.test(value))
      && typeof entry.subject === 'string' && !subjects.has(entry.provider + ':' + entry.subject))
    subjects.add(entry.provider + ':' + entry.subject)
    const account = { id: entry.id, provider: entry.provider, subject: entry.subject, label, aliases }
    if (entry.provider === 'x') {
      requireConfig(/^\d{1,30}$/.test(entry.subject) && typeof entry.channelId === 'string'
        && idPattern.test(entry.channelId) && !channels.has(entry.channelId) && xEnabled)
      channels.add(entry.channelId)
      account.channelId = entry.channelId
      requireConfig(entry.sensitiveMediaPolicy === undefined || entry.sensitiveMediaPolicy === 'account-sensitive')
      if (entry.sensitiveMediaPolicy) account.sensitiveMediaPolicy = entry.sensitiveMediaPolicy
    } else {
      requireConfig(/^did:(plc:[a-zA-Z0-9]+|web:[a-zA-Z0-9.:%_-]+)$/.test(entry.subject)
        && validService(entry.service) && typeof entry.credentialRef === 'string'
        && idPattern.test(entry.credentialRef) && entry.credentialRef !== 'legacy'
        && !credentialRefs.has(entry.credentialRef) && bskyEnabled)
      credentialRefs.add(entry.credentialRef)
      account.service = entry.service
      account.credentialRef = entry.credentialRef
    }
    accounts.push(account)
  }
  for (const route of extension.routes) {
    requireConfig(route && typeof route.enabled === 'boolean')
    if (!route.enabled) continue
    requireConfig(Array.isArray(route.accountIds) && route.accountIds.length > 0
      && new Set(route.accountIds).size === route.accountIds.length
      && route.accountIds.every(id => accounts.some(account => account.id === id)))
    requireConfig(route.requiresMediaWarning === undefined || typeof route.requiresMediaWarning === 'boolean')
    addRoute(route.timeline, [...route.accountIds], route.requiresMediaWarning)
  }
  for (const account of accounts) {
    if (account.timeline) continue
    // Every added account needs a route which can select it without selecting others.
    const dedicated = routes.find(route => route.accountIds.length === 1 && route.accountIds[0] === account.id)
    requireConfig(dedicated)
    account.timeline = dedicated.timeline
  }
  return { accounts, routes: routes.filter(route => route.accountIds.length > 0) }
}

export function blueskyCredentials(account, secrets) {
  const credentials = account.credentialRef === 'legacy'
    ? { identifier: secrets.BS_IDENTIFIER, password: secrets.BS_APP_PASSWORD }
    : secrets.RELAY_CREDENTIALS?.[account.credentialRef]
  requireConfig(credentials && typeof credentials.identifier === 'string' && credentials.identifier.trim()
    && typeof credentials.password === 'string' && credentials.password.trim())
  return { identifier: credentials.identifier, password: credentials.password }
}

export function validateRelayMedia(plan, timelines, files) {
  const requiresWarning = plan.routes.some(route => route.requiresMediaWarning && timelines.includes(route.timeline))
  if (!requiresWarning) return
  const knownFlags = new Set(['warn', 'nude', 'porn', 'hard'])
  for (const file of files) {
    if (!knownFlags.has(file.flag)) {
      throw new Error('Media warning required or unsupported')
    }
  }
}

export function selectRelayAccounts(plan, timelines) {
  const selected = new Set(plan.routes.filter(route => timelines.includes(route.timeline)).flatMap(route => route.accountIds))
  return plan.accounts.filter(account => selected.has(account.id))
}
