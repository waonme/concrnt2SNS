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
        
        // プロフィール情報をデバッグ出力
        console.log('\n=== Message Debug Info ===')
        console.log('Full message structure:', JSON.stringify(message, null, 2).substring(0, 500))
        console.log('Document:', JSON.stringify(document, null, 2).substring(0, 500))
        console.log('========================\n')
        
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
                let clients = accountManager.getClientsForTimeline(messageTimeline)
                
                // ハッシュタグベースの転送チェック
                const envKeys = Object.keys(process.env)
                const hashtagKeys = envKeys.filter(key => key.match(/^HASHTAG_(\d+)_TRIGGER$/))
                const detectedHashtags = []
                
                for (const keyMatch of hashtagKeys) {
                    const num = keyMatch.match(/HASHTAG_(\d+)_TRIGGER/)[1]
                    const hashtagTrigger = process.env[`HASHTAG_${num}_TRIGGER`]
                    const hashtagTargets = process.env[`HASHTAG_${num}_TARGETS`]
                    
                    if (hashtagTrigger && hashtagTargets && text.includes(hashtagTrigger)) {
                        console.log(`ハッシュタグ ${hashtagTrigger} を検出、指定されたアカウントに転送します`)
                        detectedHashtags.push(hashtagTrigger)
                        
                        // ハッシュタグベースのクライアントを追加
                        const targetList = hashtagTargets.split(',')
                        for (const target of targetList) {
                            const [platform, accountName] = target.split(':')
                            const account = accountManager.accounts[platform]?.[accountName || 'default']
                            if (account) {
                                if (!clients[platform]) clients[platform] = []
                                if (Array.isArray(clients[platform])) {
                                    // 重複チェック
                                    if (!clients[platform].includes(account)) {
                                        clients[platform].push(account)
                                    }
                                } else {
                                    // 単一クライアントの場合は配列に変換
                                    clients[platform] = [clients[platform], account]
                                }
                            }
                        }
                    }
                }
                
                // ハッシュタグを削除したテキストを準備
                let cleanText = text
                for (const hashtag of detectedHashtags) {
                    cleanText = cleanText.replace(hashtag, '').trim()
                }
                
                if (DRY_RUN) {
                    // ドライランモード
                    console.log('\n=== DRY RUN MODE ===')
                    console.log('Original Text:', text)
                    console.log('Clean Text:', cleanText)
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
                                client.tweet(cleanText, filesBuffer)
                            }
                        } else {
                            clients.twitter.tweet(cleanText, filesBuffer)
                        }
                    }
                    
                    // Bluesky
                    if (clients.bluesky) {
                        if (Array.isArray(clients.bluesky)) {
                            for (const client of clients.bluesky) {
                                client.post(cleanText, urls, filesBuffer, ccClient)
                            }
                        } else {
                            clients.bluesky.post(cleanText, urls, filesBuffer, ccClient)
                        }
                    }
                    
                    // Threads
                    if (clients.threads) {
                        if (Array.isArray(clients.threads)) {
                            for (const client of clients.threads) {
                                client.post(cleanText, filesBuffer)
                            }
                        } else {
                            clients.threads.post(cleanText, filesBuffer)
                        }
                    }
                    
                    // Nostr
                    if (clients.nostr) {
                        if (Array.isArray(clients.nostr)) {
                            for (const client of clients.nostr) {
                                client.publish(cleanText, filesBuffer)
                            }
                        } else {
                            clients.nostr.publish(cleanText, filesBuffer)
                        }
                    }
                }
            })
        }
    }
}

start()
