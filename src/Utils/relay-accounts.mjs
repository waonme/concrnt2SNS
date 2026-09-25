import { blueskyCredentials } from './relay-plan.mjs'

const requireIdentity = condition => { if (!condition) throw new Error('Relay account identity unavailable') }

export async function bufferChannel(channelId, token, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.buffer.com', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query: 'query ChannelBinding($id: ChannelId!) { channel(input: {id: $id}) { id name service serviceId } }', variables: { id: channelId } }),
  })
  requireIdentity(response.ok)
  const result = await response.json(), channel = result.data?.channel
  requireIdentity(!result.errors && channel?.id === channelId && channel.service === 'twitter'
    && typeof channel.serviceId === 'string' && channel.serviceId && typeof channel.name === 'string' && channel.name)
  return channel
}

/** Checks the live provider identity before publication; never accepts a retargeted client. */
export async function observeRelayAccount(account, connection, token, fetchImpl = fetch) {
  let subject, handle
  if (account.provider === 'x') {
    const channel = await bufferChannel(account.channelId, token, fetchImpl)
    subject = channel.serviceId
    handle = '@' + channel.name.replace(/^@/, '')
  } else {
    const session = await connection.agent.com.atproto.server.getSession()
    requireIdentity(session.success && session.data.did === connection.agent.session?.did
      && typeof session.data.handle === 'string' && session.data.handle)
    subject = session.data.did
    handle = '@' + session.data.handle
  }
  requireIdentity(typeof subject === 'string' && subject && (!account.subject || subject === account.subject))
  return { subject, handle }
}

/** Authentication only. Factories do not publish; subscription starts after all identities match. */
export async function connectRelayAccounts(plan, { secrets, buildBluesky, buildX, fetchImpl = fetch, bufferBindings = [] }) {
  requireIdentity(Array.isArray(bufferBindings) && bufferBindings.length <= 100
    && new Set(bufferBindings.map(binding => binding.channelId)).size === bufferBindings.length)
  for (const binding of bufferBindings) {
    requireIdentity(typeof binding.channelId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(binding.channelId)
      && typeof binding.subject === 'string' && /^\d{1,30}$/.test(binding.subject)
      && typeof binding.handle === 'string' && /^@[a-zA-Z0-9_]{1,50}$/.test(binding.handle))
  }
  const connections = new Map(), subjects = new Set()
  for (const account of plan.accounts) {
    let connection
    if (account.provider === 'bsky') {
      const credential = blueskyCredentials(account, secrets)
      connection = await buildBluesky(account.service, credential.identifier, credential.password)
    }
    // Operator-installed bindings were verified at enrollment. They establish
    // intended routing, not provider health. Every send still verifies online.
    const registered = account.provider === 'x' ? bufferBindings.find(binding => binding.channelId === account.channelId) : undefined
    const observed = registered ?? await observeRelayAccount(account, connection, secrets.BUFFER_ACCESS_TOKEN, fetchImpl)
    requireIdentity(!account.subject || account.subject === observed.subject)
    const identity = account.provider + ':' + observed.subject
    requireIdentity(!subjects.has(identity))
    subjects.add(identity)
    if (account.provider === 'x') connection = buildX(account.channelId, account)
    // Also pin legacy accounts to their observed identity for subsequent catalog refreshes.
    connections.set(account.id, { account: { ...account, subject: observed.subject }, client: connection, handle: observed.handle })
  }
  return connections
}

/** Local running configuration only: no polling a third-party API for a heartbeat. */
export function connectedRelayIdentity(account, running) {
  const active = running?.account
  requireIdentity(active?.id === account.id && active.provider === account.provider
    && active.subject && (!account.subject || account.subject === active.subject)
    && typeof running.handle === 'string' && running.handle)
  if (account.provider === 'x') {
    requireIdentity(active.channelId === account.channelId
      && (!running.client || running.client.bufferChannelId === account.channelId))
  } else {
    requireIdentity(active.service === account.service && active.credentialRef === account.credentialRef
      && running.client.agent.session?.did === active.subject)
  }
  return { subject: active.subject, handle: running.handle }
}
