import { Client } from '@concrnt/worldlib'
import Media from './Utils/Media.js'
import AccountManager from './Utils/AccountManager.js'
import CCMsgAnalysis from './Utils/ConcrntMessageAnalysis.js'

const CC_SUBKEY = process.env.CC_SUBKEY
const LISTEN_TIMELINE = process.env.LISTEN_TIMELINE
const DRY_RUN = process.env.DRY_RUN === "true"

const media = new Media()
const ccClient = await Client.createFromSubkey(CC_SUBKEY)
const accountManager = new AccountManager()
await accountManager.initialize()
const ccMsgAnalysis = new CCMsgAnalysis()

// 重複投稿を防ぐためのセット（メッセージIDを最大100件保持）
const recentMessageIds = new Set()
const MAX_RECENT_MESSAGES = 100

async function start() {
    if (DRY_RUN) {
        console.log('🔍 DRY RUN MODE ENABLED - No actual posts will be made')
    }
    
    const subscription = await ccClient.newSocketListener()
    const listenTimeline = LISTEN_TIMELINE || ccClient.user.homeTimeline
    
    // 監視するタイムラインのリストを作成
    const timelinesToListen = accountManager.getAllTimelinesToListen()
    if (!timelinesToListen.includes(listenTimeline)) {
        timelinesToListen.push(listenTimeline)
    }
    
    console.log('Listening to timelines:', timelinesToListen)

    subscription.on('MessageCreated', (message) => {
        const document = message.parsedDoc
        if (document.signer != ccClient.ccid) {
            return
        }
        
        // メッセージIDを取得
        const messageId = message.resource?.id || message.item?.resourceID
        
        // どのタイムラインからのメッセージかを判別
        const messageTimeline = message.timeline
        
        if (DRY_RUN) {
            console.log(`\nMessage from timeline: ${messageTimeline}`)
            console.log(`Message ID: ${messageId}`)
        }
        
        receivedPost(document, messageTimeline, messageId)
    })

    subscription.listen(timelinesToListen)
}

function receivedPost(document, messageTimeline, messageId) {
    if (document.schema == "https://schema.concrnt.world/m/markdown.json" || document.schema == "https://schema.concrnt.world/m/media.json") {
        // 重複チェック
        if (!messageId) {
            console.log('Warning: Message ID is undefined')
            return
        }
        if (recentMessageIds.has(messageId)) {
            console.log(`重複メッセージをスキップ: ${messageId}`)
            return
        }
        
        // メッセージIDを記録
        recentMessageIds.add(messageId)
        // 古いIDを削除（メモリ管理）
        if (recentMessageIds.size > MAX_RECENT_MESSAGES) {
            const firstId = recentMessageIds.values().next().value
            recentMessageIds.delete(firstId)
        }
        
        const body = document.body.body
        const text = ccMsgAnalysis.getPlaneText(body)
        const urls = ccMsgAnalysis.getURLs(text)
        const files = ccMsgAnalysis.getMediaFiles(body)

        document.body.medias?.forEach(media => {
            files.push({
                url: media.mediaURL,
                type: media.mediaType.split("/")[0],
                flag: media.flag
            })
        })

        if (text.length > 0 || files.length > 0) {
            media.downloader(files).then(filesBuffer => {
                const clients = accountManager.getClientsForTimeline(messageTimeline)
                
                if (DRY_RUN) {
                    // ドライランモード
                    console.log('\n=== DRY RUN MODE ===')
                    console.log('Text:', text)
                    console.log('Files:', filesBuffer.length)
                    console.log('URLs:', urls)
                    console.log('Timeline:', messageTimeline)
                    console.log('Target platforms:')
                    
                    for (const [platform, platformClients] of Object.entries(clients)) {
                        if (Array.isArray(platformClients)) {
                            console.log(`  - ${platform}: ${platformClients.length} account(s)`)
                        } else if (platformClients) {
                            console.log(`  - ${platform}`)
                        }
                    }
                    console.log('===================\n')
                } else {
                    // 実際の投稿
                    console.log(`タイムライン ${messageTimeline} からの投稿: ${messageId}`)
                    
                    // Twitter
                    if (clients.twitter) {
                        if (Array.isArray(clients.twitter)) {
                            for (const client of clients.twitter) {
                                client.tweet(text, filesBuffer)
                            }
                        } else {
                            clients.twitter.tweet(text, filesBuffer)
                        }
                    }
                    
                    // Bluesky
                    if (clients.bluesky) {
                        if (Array.isArray(clients.bluesky)) {
                            for (const client of clients.bluesky) {
                                client.post(text, urls, filesBuffer, ccClient)
                            }
                        } else {
                            clients.bluesky.post(text, urls, filesBuffer, ccClient)
                        }
                    }
                    
                    // Threads
                    if (clients.threads) {
                        if (Array.isArray(clients.threads)) {
                            for (const client of clients.threads) {
                                client.post(text, filesBuffer)
                            }
                        } else {
                            clients.threads.post(text, filesBuffer)
                        }
                    }
                    
                    // Nostr
                    if (clients.nostr) {
                        if (Array.isArray(clients.nostr)) {
                            for (const client of clients.nostr) {
                                client.post(text, filesBuffer)
                            }
                        } else {
                            clients.nostr.post(text, filesBuffer)
                        }
                    }
                }
            })
        }
    }
}

start()
