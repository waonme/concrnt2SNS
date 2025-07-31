import Twitter from '../Clients/Twitter.js'
import AtProtocol from '../Clients/AtProtocol.js'
import Threads from '../Clients/Threads.js'
import Nostr from '../Clients/Nostr.js'

export default class AccountManager {
    constructor() {
        this.accounts = {
            twitter: {},
            bluesky: {},
            threads: {},
            nostr: {}
        }
        this.timelineRules = []
        this.defaultClients = {}
    }

    async initialize() {
        // デフォルトアカウントの設定（既存の環境変数から）
        await this.setupDefaultAccounts()
        
        // 複数アカウントの設定
        this.setupMultipleAccounts()
        
        // タイムラインルールの設定
        this.setupTimelineRules()
    }

    async setupDefaultAccounts() {
        // Twitter
        if (process.env.TW_ENABLE === "true" || process.env.LISTEN_TIMELINE_TW) {
            const client = new Twitter(
                process.env.TW_API_KEY,
                process.env.TW_API_KEY_SECRET,
                process.env.TW_ACCESS_TOKEN,
                process.env.TW_ACCESS_TOKEN_SECRET,
                process.env.TW_WEBHOOK_URL,
                process.env.TW_WEBHOOK_IMAGE_URL
            )
            this.accounts.twitter.default = client
            if (process.env.TW_ENABLE === "true") {
                this.defaultClients.twitter = client
            }
        }

        // Bluesky
        if (process.env.BS_ENABLE === "true") {
            const client = await AtProtocol.build(
                process.env.BS_SERVICE,
                process.env.BS_IDENTIFIER,
                process.env.BS_APP_PASSWORD
            )
            this.accounts.bluesky.default = client
            this.defaultClients.bluesky = client
        }

        // Threads
        if (process.env.THREADS_ENABLE === "true") {
            const client = await Threads.create(process.env.THREADS_ACCESS_TOKEN)
            this.accounts.threads.default = client
            this.defaultClients.threads = client
        }

        // Nostr
        if (process.env.NOSTR_ENABLE === "true") {
            const client = new Nostr(process.env.NOSTR_RELAYS, process.env.NOSTR_PRIVATE_KEY)
            this.accounts.nostr.default = client
            this.defaultClients.nostr = client
        }
    }

    setupMultipleAccounts() {
        // 環境変数から複数アカウントを読み込む
        // TWITTER_ACCOUNT1_API_KEY のようなパターンを探す
        const envKeys = Object.keys(process.env)
        
        // Twitter accounts
        const twitterAccounts = envKeys.filter(key => key.match(/^TWITTER_ACCOUNT(\d+)_API_KEY$/))
        for (const keyMatch of twitterAccounts) {
            const accountNum = keyMatch.match(/ACCOUNT(\d+)/)[1]
            const prefix = `TWITTER_ACCOUNT${accountNum}_`
            
            if (process.env[prefix + 'API_KEY'] && 
                process.env[prefix + 'API_KEY_SECRET'] &&
                process.env[prefix + 'ACCESS_TOKEN'] &&
                process.env[prefix + 'ACCESS_TOKEN_SECRET']) {
                
                const client = new Twitter(
                    process.env[prefix + 'API_KEY'],
                    process.env[prefix + 'API_KEY_SECRET'],
                    process.env[prefix + 'ACCESS_TOKEN'],
                    process.env[prefix + 'ACCESS_TOKEN_SECRET'],
                    process.env[prefix + 'WEBHOOK_URL'],
                    process.env[prefix + 'WEBHOOK_IMAGE_URL']
                )
                this.accounts.twitter[`account${accountNum}`] = client
            }
        }

        // Bluesky accounts
        const blueskyAccounts = envKeys.filter(key => key.match(/^BLUESKY_ACCOUNT(\d+)_IDENTIFIER$/))
        for (const keyMatch of blueskyAccounts) {
            const accountNum = keyMatch.match(/ACCOUNT(\d+)/)[1]
            const prefix = `BLUESKY_ACCOUNT${accountNum}_`
            
            if (process.env[prefix + 'IDENTIFIER'] && 
                process.env[prefix + 'APP_PASSWORD']) {
                
                const service = process.env[prefix + 'SERVICE'] || 'https://bsky.social'
                AtProtocol.build(
                    service,
                    process.env[prefix + 'IDENTIFIER'],
                    process.env[prefix + 'APP_PASSWORD']
                ).then(client => {
                    this.accounts.bluesky[`account${accountNum}`] = client
                })
            }
        }

        // 同様にThreadsとNostrも追加可能
    }

    setupTimelineRules() {
        // TIMELINE_1_ID, TIMELINE_1_TARGETS のようなパターンを探す
        const envKeys = Object.keys(process.env)
        const timelineKeys = envKeys.filter(key => key.match(/^TIMELINE_(\d+)_ID$/))
        
        for (const keyMatch of timelineKeys) {
            const num = keyMatch.match(/TIMELINE_(\d+)_ID/)[1]
            const timelineId = process.env[`TIMELINE_${num}_ID`]
            const targets = process.env[`TIMELINE_${num}_TARGETS`]
            
            if (timelineId && targets) {
                const rule = {
                    timeline: timelineId,
                    targets: []
                }
                
                // targets をパース（例: "twitter:account1,bluesky:account1"）
                const targetList = targets.split(',')
                for (const target of targetList) {
                    const [platform, accountName] = target.split(':')
                    rule.targets.push({ platform, accountName })
                }
                
                this.timelineRules.push(rule)
            }
        }

        // LISTEN_TIMELINE_TW の互換性維持
        if (process.env.LISTEN_TIMELINE_TW) {
            this.timelineRules.push({
                timeline: process.env.LISTEN_TIMELINE_TW,
                targets: [{ platform: 'twitter', accountName: 'default' }]
            })
        }
    }

    getClientsForTimeline(timeline) {
        // 特定のタイムライン用の設定を探す
        const rule = this.timelineRules.find(r => r.timeline === timeline)
        
        if (rule) {
            // 特定のルールがある場合
            const clients = {}
            for (const target of rule.targets) {
                const { platform, accountName } = target
                const client = this.accounts[platform]?.[accountName]
                if (client) {
                    if (!clients[platform]) clients[platform] = []
                    clients[platform].push(client)
                }
            }
            return clients
        } else {
            // デフォルトの動作
            return this.defaultClients
        }
    }

    getAllTimelinesToListen() {
        const timelines = new Set()
        
        // デフォルトのタイムライン
        if (process.env.LISTEN_TIMELINE) {
            timelines.add(process.env.LISTEN_TIMELINE)
        }
        
        // ルールに設定されたタイムライン
        for (const rule of this.timelineRules) {
            timelines.add(rule.timeline)
        }
        
        return Array.from(timelines)
    }
}