import { Client, semantics } from '@concrnt/worldlib'
import { InMemoryAuthProvider, InMemoryKVS, LoadSubKey, NotFoundError } from '@concrnt/client'
import Media from './Utils/Media.js'
import Twitter from './Clients/Twitter.js'
import AtProtocol from './Clients/AtProtocol.js'
import Threads from './Clients/Threads.js'
import Nostr from './Clients/Nostr.js'
import CCMsgAnalysis from './Utils/ConcrntMessageAnalysis.js'
import Logger from './Utils/Logger.js'
import { configuredRelayPlan, selectRelayAccounts, validateRelayMedia } from './Utils/relay-plan.mjs'
import { connectRelayAccounts, connectedRelayIdentity } from './Utils/relay-accounts.mjs'
import { createRelayOutbox, sourceFingerprint } from './Utils/RelayOutbox.js'
import { createBufferFetch } from './Utils/buffer-api.mjs'
import { startRecipientCatalog } from './Utils/RecipientCatalog.js'

Logger.overrideConsole({ level: 'info', label: 'concrnt2SNS' })

const CC_SUBKEY = process.env.CC_SUBKEY

const BUFFER_ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN
if (!['true', 'false'].includes(process.env.C2SNS_DRY_RUN)) throw new Error('Missing operating mode')

const THREADS_ENABLE = process.env.THREADS_ENABLE == "true"
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN
const THREADS_LISTEN_TIMELINE = process.env.THREADS_LISTEN_TIMELINE

const NOSTR_ENABLE = process.env.NOSTR_ENABLE == "true"
const NOSTR_PRIVATE_KEY = process.env.NOSTR_PRIVATE_KEY
const NOSTR_RELAYS = process.env.NOSTR_RELAYS
const NOSTR_LISTEN_TIMELINE = process.env.NOSTR_LISTEN_TIMELINE

const LISTEN_TIMELINE = process.env.LISTEN_TIMELINE
const EXTRA_X_ACCOUNTS = JSON.parse(process.env.EXTRA_X_ACCOUNTS || "[]")
const relayPlan = configuredRelayPlan({ ...process.env, EXTRA_X_ACCOUNTS, RELAY: JSON.parse(process.env.RELAY || 'null') })

const media = new Media()

// v2
const parsed = LoadSubKey(CC_SUBKEY)
if (!parsed) {
    console.error('Invalid CC_SUBKEY')
    process.exit(1)
}
const auth = new InMemoryAuthProvider(undefined, CC_SUBKEY)
const ccClient = await Client.create(parsed.domain, auth, new InMemoryKVS())

// v1
/*
const ccClient = await Client.createFromSubkey(CC_SUBKEY)
if (!ccClient) {
    console.error("Failed to create Concrnt client.")
    process.exit(1)
}*/
let recipientCatalog
const bufferFetch = createBufferFetch({ token: BUFFER_ACCESS_TOKEN, statePath: process.env.BUFFER_BACKOFF_PATH, onRateLimit: () => { void recipientCatalog?.refresh() } })
const relayConnections = await connectRelayAccounts(relayPlan, {
    secrets: { ...process.env, RELAY_CREDENTIALS: JSON.parse(process.env.RELAY_CREDENTIALS || '{}') },
    bufferBindings: JSON.parse(process.env.BUFFER_CHANNEL_BINDINGS || '[]'), fetchImpl: bufferFetch,
    buildBluesky: (service, identifier, password) => AtProtocol.build(service, identifier, password),
    buildX: (channelId, account) => new Twitter(undefined, undefined, undefined, undefined, undefined, undefined, BUFFER_ACCESS_TOKEN, channelId, account.sensitiveMediaPolicy, bufferFetch),
})
const outbox = process.env.RELAY_OUTBOX_PATH ? await createRelayOutbox({
    directory: process.env.RELAY_OUTBOX_PATH, connections: relayConnections, blockedUntil: bufferFetch.blockedUntil,
    verify: running => connectedRelayIdentity(running.account, running),
    send: (running, job) => running.client.tweet(job.text, job.files),
    validateSource: async job => {
        let document
        try { document = await ccClient.api.getDocument(job.sourceURI, undefined, { cache: 'no-cache' }) }
        catch (error) {
            const missingAfterGracePeriod = error instanceof NotFoundError
                && Date.now() - (job.createdAt ?? job.updatedAt) > 120000
            if (missingAfterGracePeriod) return 'changed'
            throw error
        }
        if (document.author !== ccClient.ccid || sourceFingerprint({ ...document.value, timelines: document.distributes ?? document.value?.timelines ?? document.value?.distributes ?? [] }) !== job.sourceHash) return 'changed'
        return 'current'
    },
    publishStatus: status => ccClient.api.commit({ kind: 'record', key: `cckv://${ccClient.ccid}/concrnt.post/deliveries/${status.id}`,
        author: ccClient.ccid, schema: 'https://concrnt-post.waonme.chatgpt.site/schemas/relay-delivery-v1.json',
        value: status, createdAt: new Date(), onUpdate: 'forget',
        policy: { entries: [{ url: 'https://policy.concrnt.world/private.json', defaults: { 'record:read': 'no' } }] } }),
}) : null
const threadsClient = THREADS_ENABLE && await Threads.create(THREADS_ACCESS_TOKEN)
const nosterClient = NOSTR_ENABLE && new Nostr(NOSTR_RELAYS, NOSTR_PRIVATE_KEY)
const ccMsgAnalysis = new CCMsgAnalysis()

const MAX_RECENT = 1000
const recentResourceIDs = new Map()
let homeTimeline = null

async function start() {
    const socket = await ccClient.newSocket()
    if (!LISTEN_TIMELINE) throw new Error('Explicit LISTEN_TIMELINE is required')
    homeTimeline = LISTEN_TIMELINE

    socket.listen(
        [...relayPlan.routes.map(route => route.timeline), THREADS_LISTEN_TIMELINE, NOSTR_LISTEN_TIMELINE].filter(Boolean),
        async (event) => {
            if (event.type !== 'created') return

            console.info('C2SNS_EVENT_RECEIVED')
            let docs = event.documents || {}
            // Public websocket events omit documents that require authentication.
            // Resolve the announced timeline entry using the configured subkey.
            if (!Object.keys(docs).length && typeof event.uri === 'string') {
                const timelines = relayPlan.routes.map(route => route.timeline)
                if (!timelines.some(t => event.uri.startsWith(t + '/'))) return
                try {
                    const sd = await ccClient.api.getResource(event.uri)
                    if (!sd?.document) return
                    docs = { [event.uri]: sd }
                } catch {
                    console.error('C2SNS_EVENT_RESOLVE_FAILED')
                    return
                }
            }
            for (const key of Object.keys(docs)) {

                const sd = docs[key]
                let parsedDoc
                try {
                    parsedDoc = JSON.parse(sd.document)
                } catch (err) {
                    console.error('Failed to parse signed document', err)
                    continue
                }

                if (!parsedDoc || typeof parsedDoc !== 'object') continue

                // unify shape: prefer parsedDoc.value (v2 record), fall back to parsedDoc itself
                const inner = parsedDoc.value ?? parsedDoc
                if (!inner || typeof inner !== 'object') continue

                // default resource id (may be overridden if we resolve an embedded reference)
                let resourceID = sd.ccfs ?? sd.cckv ?? key ?? event.uri

                // document will be filled either from inner or from an embedded reference
                let document = null

                // detect reference (reroute) documents
                const isReference = (parsedDoc.schema && String(parsedDoc.schema).includes('reference.json')) || (inner && typeof inner.href === 'string')
                if (isReference) {
                    const href = inner.href
                    const refs = sd.references ?? {}
                    let refKey = null
                    let refSD = null

                    if (href && refs[href]) {
                        refKey = href
                        refSD = refs[href]
                    } else if (href) {
                        for (const rk of Object.keys(refs)) {
                            if (rk === href || rk.endsWith(href)) {
                                refKey = rk
                                refSD = refs[rk]
                                break
                            }
                        }
                    }

                    // A distributed post may omit its embedded body on the public
                    // stream. Only resolve references to this account's own posts.
                    if (!refSD || !refSD.document) {
                        if (typeof href !== 'string' || !href.startsWith(`cckv://${ccClient.ccid}/concrnt.world/profiles/`)) continue
                        try {
                            refSD = await ccClient.api.getResource(href)
                            refKey = href
                        } catch {
                            console.error('C2SNS_EVENT_RESOLVE_FAILED')
                            continue
                        }
                        if (!refSD?.document) continue
                    }

                    try {
                        const refParsed = JSON.parse(refSD.document)
                        const refInner = refParsed.value ?? refParsed
                        if (!refInner || typeof refInner !== 'object') {
                            console.log('Embedded referenced document invalid — skipping')
                            continue
                        }
                        document = {
                            ...refInner,
                            key: refParsed.key,
                            author: refParsed.author ?? refInner.author ?? refInner.signer,
                            schema: refParsed.schema ?? refInner.schema,
                            timelines: refParsed.distributes ?? refInner.timelines ?? refInner.distributes ?? []
                        }
                        if (refKey) resourceID = refKey
                    } catch (err) {
                        console.error('Failed to parse referenced embedded document', err)
                        continue
                    }
                }

                // If not resolved from reference, use inner directly
                if (!document) {
                    document = {
                        ...inner,
                        key: parsedDoc.key,
                        author: parsedDoc.author ?? inner.author ?? inner.signer,
                        schema: parsedDoc.schema ?? inner.schema,
                        timelines: parsedDoc.distributes ?? inner.timelines ?? inner.distributes ?? []
                    }
                }

                if (!Array.isArray(document.timelines)) document.timelines = []

                // filter by message schemas
                if (
                    document.schema !== 'https://schema.concrnt.world/m/plaintext.json' &&
                    document.schema !== 'https://schema.concrnt.world/m/markdown.json' &&
                    document.schema !== 'https://schema.concrnt.world/m/media.json'
                ) {
                    continue
                }

                const author = document.author ?? document.signer ?? parsedDoc.author ?? null
                if (author !== ccClient.ccid) continue

                if (!resourceID) resourceID = document.key ?? null
                if (!resourceID) continue

                // LRU 重複排除
                if (recentResourceIDs.has(resourceID)) continue

                recentResourceIDs.set(resourceID, Date.now())
                if (recentResourceIDs.size > MAX_RECENT) {
                    const oldest = recentResourceIDs.keys().next().value
                    recentResourceIDs.delete(oldest)
                }

                receivedPost(document, document.key ?? resourceID)
            }
        }
    )
    if (outbox && process.env.C2SNS_DRY_RUN === 'false') {
        const pump = () => { void outbox.pump().catch(() => console.error('C2SNS_OUTBOX_FAILED')) }
        pump()
        setInterval(pump, 30000).unref()
    }
    console.info(process.env.C2SNS_DRY_RUN === 'true' ? 'C2SNS_READY_DRY_RUN' : 'C2SNS_READY_LIVE')
    if (process.env.C2SNS_RECIPIENT_CATALOG === 'true') {
        recipientCatalog = startRecipientCatalog({ client: ccClient, plan: relayPlan, connections: relayConnections, bufferBlockedUntil: bufferFetch.blockedUntil,
            config: { domain: parsed.domain, C2SNS_DRY_RUN: process.env.C2SNS_DRY_RUN } })
        socket.listen([`cckv://${ccClient.ccid}/activitypub.concrnt.world/settings`], () => { void recipientCatalog.refresh() })
    }
}


// v1
/*
async function start() {
    const subscription = await ccClient.newSocketListener()
    homeTimeline = LISTEN_TIMELINE || ccClient.user.homeTimeline

    subscription.on('MessageCreated', async (event) => {
        let document = event.parsedDoc
        let resourceID = event.item.resourceID
        if (!document) {
            try {
                let message = await ccClient.getMessage(resourceID, event.item.owner, event.item.timelineID.split('@')[1])
                if (!message || !message.document) {
                    console.error("Failed to fetch message or document for resourceID:", resourceID)
                    return
                }
                document = message.document
            } catch (err) {
                console.error("Error fetching message for resourceID:", resourceID, err)
                return
            }
        }
        if (document.signer !== ccClient.ccid) {
            return
        }
        if (lastMessageResourceID && lastMessageResourceID === resourceID) {
            return
        }
        lastMessageResourceID = resourceID
        receivedPost(document)
    })

    subscription.listen([homeTimeline, TW_LISTEN_TIMELINE, BS_LISTEN_TIMELINE, THREADS_LISTEN_TIMELINE, NOSTR_LISTEN_TIMELINE].filter(Boolean))
} 
*/

function receivedPost(document, sourceURI) {
    const body = document.body
    const text = ccMsgAnalysis.getPlaneText(body)
    const urls = ccMsgAnalysis.getURLs(text)
    const files = ccMsgAnalysis.getMediaFiles(body)

    const targets = selectRelayAccounts(relayPlan, document.timelines)
    const isPostTw = targets.some(account => account.provider === 'x')
    const isPostBs = targets.some(account => account.provider === 'bsky')
    const isPostThreads = (THREADS_LISTEN_TIMELINE && document.timelines.includes(THREADS_LISTEN_TIMELINE)) || document.timelines.includes(homeTimeline)
    const isPostNostr = (NOSTR_LISTEN_TIMELINE && document.timelines.includes(NOSTR_LISTEN_TIMELINE)) || document.timelines.includes(homeTimeline)

    if (!targets.length && !isPostThreads && !isPostNostr) return
    if (process.env.C2SNS_DRY_RUN === 'true') {
        if (isPostTw && isPostBs) console.info('C2SNS_DRY_RUN_BOTH')
        else if (isPostTw) console.info('C2SNS_DRY_RUN_X')
        else if (isPostBs) console.info('C2SNS_DRY_RUN_BLUESKY')
        return
    }

    document.medias?.forEach(media => {
        files.push({
            url: media.mediaURL,
            type: media.mediaType.split("/")[0],
            flag: media.flag? media.flag : undefined
        })
    })

    try { validateRelayMedia(relayPlan, document.timelines, files) }
    catch { console.error('C2SNS_MEDIA_WARNING_REQUIRED'); return }

    if (text.length > 0 || files.length > 0) {
        if (outbox) {
            for (const account of targets.filter(account => account.provider === 'x')) {
                const bufferFiles = files.map(file => ({ url: file.url, type: file.type.includes('image') ? 'image/jpeg' : 'video/mp4', ...(file.flag ? { flag: file.flag } : {}) }))
                void outbox.enqueue({ sourceURI, sourceHash: sourceFingerprint(document), account: relayConnections.get(account.id).account, text, files: bufferFiles })
                    .then(() => outbox.pump()).catch(() => console.error('C2SNS_OUTBOX_FAILED'))
            }
        }
        const immediateTargets = targets.filter(account => !outbox || account.provider !== 'x')
        if (!immediateTargets.length && !THREADS_ENABLE && !NOSTR_ENABLE) return
        media.downloader(files)
            .then(async filesBuffer => {
                const postTasks = immediateTargets.map(async account => {
                    const running = relayConnections.get(account.id)
                    connectedRelayIdentity(running.account, running)
                    const connection = running.client
                    if (account.provider === 'x') return connection.tweet(text, filesBuffer)
                    return connection.post(text, urls, filesBuffer, ccClient)
                })
                if (THREADS_ENABLE && isPostThreads && threadsClient) postTasks.push(threadsClient.post(text, filesBuffer))
                if (NOSTR_ENABLE && isPostNostr && nosterClient) postTasks.push(nosterClient.post(text, filesBuffer))

                const results = await Promise.allSettled(postTasks)
                results.forEach((result) => {
                    if (result.status === 'rejected') {
                        console.error('C2SNS_DELIVERY_FAILED')
                    } else {
                        console.info('C2SNS_DELIVERY_OK')
                    }
                })
            })
            .catch(err => {
                console.error('Media download failed', err)
            })
    }
}

start()
