import { TwitterApi } from 'twitter-api-v2'
import axios from 'axios'

const MAX_MEDIA_UPLOAD_RETRYS = 3
// コンカレのラベルとTwitterのラベルの対応
// hardが何を指すのか不明・・・とりあえずgraphic_violenceにしておく
// warnはotherにしておく
const WARNING_LABEL = { 'porn': 'adult_content', 'hard': 'graphic_violence', 'nude': 'adult_content', 'warn': 'other' }

class Twitter {
    sleep = (time) => new Promise((resolve) => setTimeout(resolve, time))

    constructor(apiKey, apiKeySecret, token, tokenSecret, webhookURL, webhookURLImage) {
        // API認証情報がすべて揃っている場合のみTwitterApiインスタンスを作成
        if (apiKey && apiKeySecret && token && tokenSecret) {
            this.twitterClient = new TwitterApi({
                appKey: apiKey,
                appSecret: apiKeySecret,
                accessToken: token,
                accessSecret: tokenSecret,
            })
        } else {
            this.twitterClient = null
        }

        this.webhookURL = webhookURL
        this.tweetAtWebHookImage = webhookURLImage
    }

    async tweet(text, filesBuffer) {
        console.log('Twitter.tweet called with:', { text: text.substring(0, 50), filesCount: filesBuffer.length })
        
        // YoutubeMusicはwatchだけOGPが出ないのでYoutubeに置き換える
        text = text.replace(/https:\/\/music\.youtube\.com\/watch/g, 'https://youtube.com/watch')
        const payload = {
            text: text
        }
        const isMediaFlag = filesBuffer.some(item => item.flag !== undefined)
        console.log('isMediaFlag:', isMediaFlag, 'webhookURL:', this.webhookURL, 'tweetAtWebHookImage:', this.tweetAtWebHookImage)
        try {
            if (filesBuffer.length == 1 && filesBuffer[0].type == "image/jpeg" && this.tweetAtWebHookImage && !isMediaFlag) {
                await this.tweetAtWebHook(this.tweetAtWebHookImage, text, filesBuffer[0].url)
                return
            } else if (filesBuffer.length > 0 || isMediaFlag) {
                const mediaIds = await this.uploadMedia(filesBuffer)
                if (mediaIds.length > 0) payload.media = { media_ids: mediaIds }
            } else if (this.webhookURL != undefined) {
                console.log('Using webhook for text-only tweet')
                await this.tweetAtWebHook(this.webhookURL, text)
                return
            }
            
            if (this.twitterClient) {
                await this.twitterClient.v2.tweet(payload)
            } else {
                console.log('Twitter API credentials not configured. Cannot tweet without webhook.')
            }
        } catch (error) {
            console.error(error)
        }
    }

    async uploadMedia(filesBuffer) {
        if (!this.twitterClient) {
            console.log('Twitter API credentials not configured. Cannot upload media.')
            return []
        }
        const ids = await Promise.all(filesBuffer.map(async (file) => {
            let retryCount = 0

            const buffer = file.buffer
            const type = file.type
            const option = { mimeType: type }
            if (type == "video/mp4") {
                option.longVideo = true
            }

            while (retryCount < MAX_MEDIA_UPLOAD_RETRYS) {
                try {
                    const id = await this.twitterClient.v1.uploadMedia(buffer, option)
                    if (file.flag) {
                        await this.twitterClient.v1.createMediaMetadata(id, { sensitive_media_warning: [WARNING_LABEL[file.flag] ?? WARNING_LABEL["warn"]] })
                    }
                    return id
                } catch (error) {
                    retryCount++
                    console.error(`Retry uploadMedia. retryCount:${retryCount}`)
                    console.error(error)
                    await this.sleep(1000)
                }
            }

            return undefined
        }))

        return ids.filter(v => v)
    }

    async tweetAtWebHook(url, text, imageURL = undefined) {
        console.log('tweetAtWebHook called with:', { url, textLength: text.length, hasImage: !!imageURL })
        let data = {
            "value1": text,
            "value2": imageURL
        }
        let config = {
            method: 'post',
            url: url,
            headers: {
                'Content-Type': 'application/json'
            },
            data: data
        }

        try {
            const response = await axios(config)
            console.log('Webhook response:', response.status, response.statusText)
        } catch (error) {
            const responseStatus = error.response?.status
            console.error(`Failed to tweet on WebHook. code:${responseStatus}`)
            console.error('Error details:', error.message)
            throw error
        }
    }
}

export default Twitter