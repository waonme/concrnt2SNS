#!/usr/bin/env node
import { Client } from '@concrnt/client'
import { getConcrntTheme, getMessageFromCCID } from './Utils/ConcrntAPI.js'
import { AccountManager } from './Utils/AccountManager.js'
import { sendMessage, handleMessage } from './concrnt2SNS.js'
import 'dotenv/config'

// コマンドライン引数からCCIDまたはメッセージURLを取得
const messageIdOrUrl = process.argv[2]
if (!messageIdOrUrl) {
    console.error('Usage: node manual-forward.js <CCID or Message URL>')
    console.error('Example: node manual-forward.js con1cccmm...')
    console.error('Example: node manual-forward.js https://hub.concurrent.world/...')
    process.exit(1)
}

// URLからCCIDを抽出するヘルパー関数
function extractCCIDFromURL(url) {
    const match = url.match(/\/([a-z0-9]+\d[a-z0-9]+)(?:\?|#|$)/)
    return match ? match[1] : null
}

// CCIDを決定
let ccid = messageIdOrUrl
if (messageIdOrUrl.startsWith('http')) {
    ccid = extractCCIDFromURL(messageIdOrUrl)
    if (!ccid) {
        console.error('Failed to extract CCID from URL')
        process.exit(1)
    }
}

async function manualForward() {
    try {
        // Concrntクライアントの初期化
        const subkey = process.env.CC_SUBKEY
        const cctheme = await getConcrntTheme(process.env.CC_SUBKEY)
        const client = new Client(subkey, { theme: cctheme })

        // アカウントマネージャーの初期化
        const accountManager = new AccountManager()
        await accountManager.initialize()

        // メッセージを取得
        console.log(`Fetching message: ${ccid}`)
        const message = await getMessageFromCCID(ccid)
        if (!message) {
            console.error('Message not found')
            process.exit(1)
        }

        console.log(`Found message from ${message.author?.username || 'Unknown'}`)
        console.log(`Content: ${message.payload?.body?.body?.substring(0, 100)}...`)

        // 転送先の設定（環境変数またはコマンドライン引数で指定可能）
        const targetPlatform = process.argv[3] || 'twitter:account1'
        console.log(`Forwarding to: ${targetPlatform}`)

        // 手動で指定されたターゲットに転送
        const [platform, accountName] = targetPlatform.split(':')
        const account = accountManager.accounts[platform]?.[accountName || 'default']
        
        if (!account) {
            console.error(`Account not found: ${targetPlatform}`)
            console.error('Available accounts:', Object.keys(accountManager.accounts))
            process.exit(1)
        }

        // メッセージを送信
        const result = await sendMessage(message.payload, account, platform)
        
        if (result.success) {
            console.log(`Successfully forwarded to ${platform}`)
            if (result.url) console.log(`URL: ${result.url}`)
        } else {
            console.error(`Failed to forward: ${result.error || 'Unknown error'}`)
        }

        process.exit(0)
    } catch (error) {
        console.error('Error:', error)
        process.exit(1)
    }
}

manualForward()