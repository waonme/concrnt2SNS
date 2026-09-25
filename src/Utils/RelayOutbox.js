import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, open, rename } from 'node:fs/promises'

const digest = value => createHash('sha256').update(value).digest('hex')
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value
}
export const sourceFingerprint = document => digest(JSON.stringify(canonical({ body: document.body ?? null,
    medias: document.medias ?? [], timelines: [...(document.timelines ?? [])].sort() })))
const binding = account => ({ id: account.id, provider: account.provider, subject: account.subject,
    channelId: account.channelId, sensitiveMediaPolicy: account.sensitiveMediaPolicy ?? null })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Durable Buffer-only outbox. Only a proven pre-send pause/429 may be retried.
 * A crash or lost reply after the write-ahead sending marker is always unknown.
 */
export async function createRelayOutbox({ directory, connections, verify, send, validateSource,
    publishStatus, blockedUntil = () => 0, now = Date.now }) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const jobs = new Map(), quarantined = new Set()
    let writing = Promise.resolve(), notifying = Promise.resolve(), pumping = false
    async function persistNow(job) {
        const temporary = `${directory}/${job.id}.${randomUUID()}.tmp`
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(job)); await file.sync() } finally { await file.close() }
        await rename(temporary, `${directory}/${job.id}.json`)
        const folder = await open(directory, 'r')
        try { await folder.sync() } finally { await folder.close() }
        jobs.set(job.id, job)
    }
    function serialize(operation) {
        const task = writing.then(operation)
        writing = task.catch(() => {})
        return task
    }
    function persist(job) { return serialize(() => persistNow(job)) }
    async function update(job, fields) {
        const next = { ...job, ...fields, updatedAt: now(), statusDirty: true }
        if (['queued', 'unknown', 'failed', 'cancelled'].includes(next.state)) { delete next.text; delete next.files }
        await persist(next)
        return next
    }
    function notify(requested) {
        const task = notifying.then(async () => {
            const job = jobs.get(requested.id)
            if (!job?.statusDirty) return
            try {
                await publishStatus({ id: job.id, sourceURI: job.sourceURI, accountId: 'x:' + job.account.subject,
                    state: job.state, retryAt: job.retryAt, updatedAt: job.updatedAt })
                await serialize(async () => {
                    if (same(jobs.get(job.id), job)) await persistNow({ ...job, statusDirty: false })
                })
            } catch { console.error('C2SNS_OUTBOX_STATUS_UNAVAILABLE') }
        })
        notifying = task.catch(() => {})
        return task
    }
    for (const name of await readdir(directory)) {
        if (/^[0-9a-f]{64}\.json\.quarantine$/.test(name)) { quarantined.add(name.slice(0, 64)); continue }
        if (!/^[0-9a-f]{64}\.json$/.test(name)) continue
        let job
        try {
            job = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'))
            if (job.version !== 1 || name !== job.id + '.json' || job.id !== digest(job.sourceURI + '|x:' + job.account.subject)
                || !['waiting', 'sending', 'queued', 'unknown', 'failed', 'cancelled'].includes(job.state)) throw new Error('Invalid relay outbox')
        } catch {
            await rename(`${directory}/${name}`, `${directory}/${name}.quarantine`)
            quarantined.add(name.slice(0, 64))
            console.error('C2SNS_OUTBOX_RECORD_QUARANTINED')
            continue
        }
        jobs.set(job.id, job)
        if (job.state === 'sending') await update(job, { state: 'unknown' })
    }
    async function pump() {
        if (pumping) return
        pumping = true
        try {
            for (let job of [...jobs.values()]) {
                await notify(job)
                if (job.state !== 'waiting' || (job.retryAt ?? 0) > now() || blockedUntil() > now()) continue
                const running = connections.get(job.account.id)
                if (!running || !same(binding(running.account), job.account)) {
                    await notify(await update(job, { state: 'failed' })); continue
                }
                try {
                    const source = await validateSource(job)
                    if (source === 'changed') { await notify(await update(job, { state: 'cancelled' })); continue }
                } catch {
                    // This is a read failure, before any provider write. Keep the
                    // payload and retry later instead of losing a queued post.
                    await notify(await update(job, { state: 'waiting', retryAt: now() + 60000 })); continue
                }
                try { await verify(running) }
                catch { await notify(await update(job, { state: 'failed' })); continue }
                job = await update(job, { state: 'sending', retryAt: null })
                try {
                    const result = await send(running, job)
                    if (!result?.providerPostID) throw new Error('Missing provider receipt')
                    job = await update(job, { state: 'queued', providerPostID: result.providerPostID })
                } catch (error) {
                    // The transport throws this only before HTTP or on an explicit
                    // provider rejection, never for a lost or ambiguous reply.
                    job = await update(job, error.code === 'BUFFER_RATE_LIMITED'
                        ? { state: 'waiting', retryAt: error.until } : { state: error.code === 'BUFFER_UNSUPPORTED' ? 'failed' : 'unknown' })
                }
                await notify(job)
            }
        } finally { pumping = false }
    }
    function enqueue({ sourceURI, sourceHash, account, text, files }) {
        const task = serialize(async () => {
            if (account.provider !== 'x' || !account.subject || !account.channelId) throw new Error('Invalid outbox account')
            const id = digest(sourceURI + '|x:' + account.subject)
            const contentHash = digest(JSON.stringify({ sourceHash, account: binding(account), text, files }))
            if (quarantined.has(id)) throw new Error('Outbox result unknown; record quarantined')
            const existing = jobs.get(id)
            if (existing) {
                if (existing.contentHash !== contentHash) throw new Error('Outbox payload changed')
                return existing
            }
            const job = { version: 1, id, sourceURI, sourceHash, contentHash, account: binding(account), text, files,
                state: 'waiting', retryAt: blockedUntil() || null, createdAt: now(), updatedAt: now(), statusDirty: true }
            await persistNow(job)
            return job
        })
        return task.then(async job => { await notify(job); return job })
    }
    return { enqueue, pump, snapshot: () => [...jobs.values()].map(job => structuredClone(job)) }
}
