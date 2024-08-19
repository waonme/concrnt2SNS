require('dotenv').config();  // .env ファイルから環境変数を読み込む

const cc = require('@concurrent-world/client');
const ImageResize = require('./Image.js');
const Twitter = require('./Twitter.js');
const AtProtocol = require('./AtProtocol.js');
const CCMsgAnalysis = require('./ConcrntMessageAnalysis.js');

const CC_SUBKEY = process.env.CC_SUBKEY;

const TW_ENABLE = process.env.TW_ENABLE == "true";
const TW_API_KEY = process.env.TW_API_KEY;
const TW_API_KEY_SECRET = process.env.TW_API_KEY_SECRET;

const TW_ACCESS_TOKEN = process.env.TW_ACCESS_TOKEN;
const TW_ACCESS_TOKEN_SECRET = process.env.TW_ACCESS_TOKEN_SECRET;

const BS_ENABLE = process.env.BS_ENABLE == "true";
const BS_SERVICE = process.env.BS_SERVICE;

const LISTEN_TIMELINE = process.env.LISTEN_TIMELINE;

const image = new ImageResize();
const twitterClient = TW_ENABLE && new Twitter(TW_API_KEY, TW_API_KEY_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_TOKEN_SECRET);
const ccMsgAnalysis = new CCMsgAnalysis();

// 環境変数の検証
if (!process.env.BS_SERVICE) {
    console.error('BS_SERVICE is not defined in .env');
    process.exit(1);
}

const isDevelopment = process.env.NODE_ENV === 'development';
const bskyClients = {};

if (isDevelopment) {
    if (!process.env.BS_IDENTIFIER_DEV || !process.env.BS_APP_PASSWORD_DEV) {
        console.error('Development Bluesky account is not properly configured');
        process.exit(1);
    }
    bskyClients['DEV'] = new AtProtocol(BS_SERVICE, process.env.BS_IDENTIFIER_DEV, process.env.BS_APP_PASSWORD_DEV);
} else {
    const bsAccountCount = parseInt(process.env.BS_ACCOUNT_COUNT, 10) || 0;
    for (let i = 0; i < bsAccountCount; i++) {
        const identifier = process.env[`BS_IDENTIFIER_${i}`];
        const password = process.env[`BS_APP_PASSWORD_${i}`];
        if (identifier && password) {
            bskyClients[i] = new AtProtocol(BS_SERVICE, identifier, password);
        } else {
            console.error(`Bluesky account ${i} is not properly configured`);
            process.exit(1);
        }
    }
}

// ストリームとBlueskyアカウントの紐付けを環境ごとに設定
const streamClientMapping = {};
const streamPrefix = isDevelopment ? 'STREAM_DEV_' : 'STREAM_';
const bsAccountPrefix = isDevelopment ? 'BS_ACCOUNT_DEV_' : 'BS_ACCOUNT_';
const overrideTextPrefix = isDevelopment ? 'OVERRIDE_TEXT_DEV_' : 'OVERRIDE_TEXT_';
const moderationLabelPrefix = isDevelopment ? 'MODERATION_LABEL_DEV_' : 'MODERATION_LABEL_';

const mappingCount = isDevelopment ? Object.keys(process.env).filter(key => key.startsWith('STREAM_DEV_')).length : bsAccountCount;

for (let i = 0; i < mappingCount; i++) {
    const stream = process.env[`${streamPrefix}${i}`];
    const accountKey = process.env[`${bsAccountPrefix}${i}`];
    const overrideText = process.env[`${overrideTextPrefix}${i}`];
    const moderationLabel = process.env[`${moderationLabelPrefix}${i}`];

    if (stream && accountKey && bskyClients[accountKey]) {
        streamClientMapping[stream] = {
            client: bskyClients[accountKey],
            overrideText: overrideText || undefined,
            moderationLabel: moderationLabel ? moderationLabel.split(',') : undefined  // 複数のラベル対応
        };
    } else {
        console.warn(`Stream ${stream} or associated account ${accountKey} is not properly configured`);
    }
}

async function start() {
    const client = await cc.Client.createFromSubkey(CC_SUBKEY);

    const subscription = await client.newSubscription();
    const listenTimeline = LISTEN_TIMELINE || client.user.homeTimeline;

    subscription.on('MessageCreated', (message) => {
        if (message.document.signer != client.ccid) {
            return;
        }
        receivedPost(message);
    });

    subscription.listen([listenTimeline]);
}

function receivedPost(data) {
    // 開発モードの時のみログ出力
    if (isDevelopment) {
        console.log("Received data from Concrnt:", JSON.stringify(data, null, 2));
    }

    if (data.document.schema == "https://schema.concrnt.world/m/markdown.json" || data.document.schema == "https://schema.concrnt.world/m/media.json") {
        const body = data.document.body.body;
        let text = ccMsgAnalysis.getPlaneText(body);
        const files = ccMsgAnalysis.getMediaFiles(body);

        data.document.body.medias?.forEach(media => {
            files.push({
                url: media.mediaURL,
                type: media.mediaType.split("/")[0]
            });
        });

        const relatedTimelines = data.document.timelines || [];
        let selectedClient = isDevelopment ? bskyClients['DEV'] : null;
        let selectedText = text;
        let moderationLabel = undefined;

        // <summary>タグの内容を正規表現で検出してラベルを設定
        const summaryMatch = body.match(/<summary>(.*?)<\/summary>/i);
        if (summaryMatch) {
            const summaryContent = summaryMatch[1].toLowerCase();  // 小文字に変換して統一

            if (summaryContent.includes('porn')) {
                moderationLabel = 'porn';
            } else if (summaryContent.includes('sexual') || summaryContent.includes('suggestive')) {
                moderationLabel = 'sexual';
            } else if (summaryContent.includes('nudity')) {
                moderationLabel = 'nudity';
            } else if (summaryContent.includes('nsfl')) {
                moderationLabel = 'nsfl';
            } else if (summaryContent.includes('gore')) {
                moderationLabel = 'gore';
            }
        }

        // ストリームに基づくチェック（summaryタグによるラベルが未設定の場合のみ）
        if (!moderationLabel) {  // 既にsummaryで設定されたラベルがある場合は上書きしない
            relatedTimelines.forEach(timeline => {
                if (streamClientMapping[timeline]) {
                    selectedClient = streamClientMapping[timeline].client;
                    if (streamClientMapping[timeline].overrideText !== undefined) {
                        selectedText = streamClientMapping[timeline].overrideText;
                    }
                    if (streamClientMapping[timeline].moderationLabel) {
                        moderationLabel = streamClientMapping[timeline].moderationLabel;
                    }
                }
            });
        }

        if (selectedClient && (selectedText.length > 0 || files.length > 0)) {
            image.downloader(files).then(filesBuffer => {
                if (TW_ENABLE) twitterClient.tweet(selectedText, filesBuffer);

                if (BS_ENABLE && selectedClient) {
                    selectedClient.post(selectedText, filesBuffer, moderationLabel);  // ラベルを指定して投稿
                }
            });
        }
    }
}

start()
