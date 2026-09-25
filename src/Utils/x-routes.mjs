// Only operator-declared channels. A second Buffer channel is never auto-enrolled.
export function configuredXRoutes(config) {
    const extras = config.EXTRA_X_ACCOUNTS ?? []
    if (!Array.isArray(extras) || extras.length > 10) throw new Error('Invalid extra X accounts')
    const channels = new Set([config.BUFFER_TWITTER_CHANNEL_ID])
    const timelines = new Set([config.LISTEN_TIMELINE, config.BS_LISTEN_TIMELINE, config.TW_LISTEN_TIMELINE])
    const result = [{ channelId: config.BUFFER_TWITTER_CHANNEL_ID, timeline: config.TW_LISTEN_TIMELINE, common: true }]
    for (const account of extras) {
        if (!account || typeof account.channelId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.channelId)
            || typeof account.timeline !== 'string' || account.timeline.length > 2048
            || !/^cckv:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._/-]+$/.test(account.timeline)
            || account.timeline.endsWith('/') || account.timeline.split('/').some(p => p === '..' || p === '.')
            || channels.has(account.channelId) || timelines.has(account.timeline)) throw new Error('Ambiguous extra X route')
        channels.add(account.channelId); timelines.add(account.timeline)
        result.push({ channelId: account.channelId, timeline: account.timeline, common: false })
    }
    return result
}
