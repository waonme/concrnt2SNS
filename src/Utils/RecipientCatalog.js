import { createHash } from 'node:crypto'
import { validTimeline } from './relay-plan.mjs'
import { connectedRelayIdentity } from './relay-accounts.mjs'

const schema = 'https://concrnt-post.waonme.chatgpt.site/schemas/recipients-v2.json'
const validURI = validTimeline
const alias = value => value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_-]/gu, '-').slice(0, 100)
const ensure = condition => { if (!condition) throw new Error('recipient_catalog_unavailable') }

/** Advertises the running relay configuration. Provider health is a separate hint. */
export async function observeRecipients({ client, plan, connections, config, bufferBlockedUntil = () => 0, now = Date.now }) {
    ensure(['true', 'false'].includes(config.C2SNS_DRY_RUN))
    const domain = config.domain, ccid = client.ccid
    const home = `cckv://${ccid}/concrnt.world/profiles/main/home-timeline`
    const apInbox = `cckv://${ccid}/activitypub.concrnt.world/inbox`
    const [observed, ap, settings] = await Promise.all([
        plan.accounts.map(account => ({ account, ...connectedRelayIdentity(account, connections.get(account.id)) })),
        client.api.fetchWithCredential(domain, '/ap/api/settings'),
        client.api.getDocument(`cckv://${ccid}/activitypub.concrnt.world/settings`, undefined, { cache: 'no-cache' }),
    ])
    ensure(new Set(observed.map(item => item.account.provider + ':' + item.subject)).size === observed.length)
    ensure(ap.ccid === ccid && typeof ap.id === 'string' && typeof ap.enabled === 'boolean')
    ensure(settings.author === ccid && settings.schema === 'https://schema.concrnt.world/ap/settings.json'
        && Array.isArray(settings.value?.listenTimelines) && settings.value.listenTimelines.every(validURI))
    const prefixes = ap.enabled ? (settings.value.listenTimelines.length ? settings.value.listenTimelines : [home]) : []
    const accounts = [], effects = []
    const live = config.C2SNS_DRY_RUN === 'false'
    const add = (provider, subject, label, handle, timelineUri, profileUrl, aliases, visibility = '公開') => {
        const accountId = `${provider}:${subject}`
        accounts.push({ provider, accountId, label, handle, timelineUri, profileUrl, aliases: aliases.map(alias), visibility })
        return accountId
    }
    if (live) {
        const identities = new Map()
        for (const { account, subject, handle } of observed) {
            const isBluesky = account.provider === 'bsky'
            const profile = isBluesky ? 'https://bsky.app/profile/' + encodeURIComponent(subject)
                : 'https://x.com/i/user/' + encodeURIComponent(subject)
            const defaultAlias = account.provider + '-' + handle.replace(/^@/, '').replaceAll('.', '-')
            const id = add(account.provider, subject, account.label, handle, account.timeline, profile,
                [...account.aliases, defaultAlias, account.provider + '-' + subject],
                isBluesky ? '公開' : 'X のアカウント設定に従う')
            identities.set(account.id, id)
        }
        for (const route of plan.routes) {
            ensure(validURI(route.timeline) && route.accountIds.every(id => identities.has(id)))
            effects.push({ uri: route.timeline, accountIds: route.accountIds.map(id => identities.get(id)), prefix: false })
        }
    }
    if (prefixes.length) {
        const profile = `https://${domain}/ap/users/${encodeURIComponent(ap.id)}`
        // An AP convenience recipient needs a route that the actual AP listener covers.
        const route = prefixes.some(p => apInbox.startsWith(p)) ? apInbox : prefixes[0]
        const apID = add('ap', profile, 'ActivityPub', `@${ap.id}@${domain}`, route, profile, ['ap-' + ap.id])
        effects.push(...prefixes.map(uri => ({ uri, accountIds: [apID], prefix: true })))
    }
    ensure(accounts.length <= 100 && effects.length <= 300 && new Set(accounts.map(a => a.accountId)).size === accounts.length)
    for (const account of accounts) {
        ensure(validURI(account.timelineUri) && account.handle.length > 0 && account.handle.length <= 200 && account.label.length <= 100
            && account.aliases.length <= 20 && account.aliases.every(a => /^[\p{L}\p{M}\p{N}_-]{1,100}$/u.test(a)))
    }
    const mediaRules = live ? plan.routes.filter(route => route.requiresMediaWarning)
        .map(route => ({ uri: route.timeline, requiresWarning: true })) : []
    const version = createHash('sha256').update(JSON.stringify({ accounts, effects, mediaRules })).digest('hex')
    const verifiedAt = now()
    const unavailableUntil = bufferBlockedUntil()
    if (unavailableUntil > verifiedAt) {
        for (const account of accounts.filter(account => account.provider === 'x')) account.unavailableUntil = unavailableUntil
    }
    return { version, verifiedAt, expiresAt: verifiedAt + 90000, accounts, effects, ...(mediaRules.length ? { mediaRules } : {}) }
}

/** Publish configuration on startup and explicit changes, not a health-check timer.
 * Failed writes retry; an unchanged successful configuration never expires.
 */
export function startRecipientCatalog(options, { schedule = setTimeout, onError = () => console.error('C2SNS_CATALOG_UNAVAILABLE') } = {}) {
    let stopped = false, timer, running = false, requested = false, failures = 0
    async function refresh() {
        if (stopped) return
        if (running) { requested = true; return }
        running = true
        if (timer) { clearTimeout(timer); timer = undefined }
        try {
            const value = await observeRecipients(options)
            if (!stopped) await options.client.api.commit({ kind: 'record', key: `cckv://${options.client.ccid}/concrnt.post/recipients`,
                author: options.client.ccid, schema, value, createdAt: new Date(), onUpdate: 'forget',
                policy: { entries: [{ url: 'https://policy.concrnt.world/private.json', defaults: { 'record:read': 'no' } }] } })
            failures = 0
        } catch {
            onError()
            if (!stopped) { timer = schedule(refresh, Math.min(300000, 30000 * 2 ** Math.min(failures++, 4))); timer?.unref?.() }
        } finally {
            running = false
            if (requested && !stopped) { requested = false; void refresh() }
        }
    }
    void refresh()
    const stop = () => { stopped = true; if (timer) clearTimeout(timer) }
    stop.refresh = refresh
    return stop
}
