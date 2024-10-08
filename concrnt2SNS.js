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
if (!BS_SERVICE) {
    console.error('BS_SERVICE is not defined in .env');
    process.exit(1);
}

// Blueskyクライアントの動的生成
const bskyClients = {};
const bsAccountPrefix = 'BS_IDENTIFIER_';
const bsPasswordPrefix = 'BS_APP_PASSWORD_';
Object.keys(process.env).forEach(key => {
    if (key.startsWith(bsAccountPrefix)) {
        const index = key.replace(bsAccountPrefix, '');
        const identifier = process.env[`${bsAccountPrefix}${index}`];
        const appPassword = process.env[`${bsPasswordPrefix}${index}`];
        if (identifier && appPassword && BS_SERVICE) {
            try {
                bskyClients[index] = new AtProtocol(BS_SERVICE, identifier, appPassword);
                console.log(`Bluesky client created for account ${index} with identifier ${identifier}`);
            } catch (error) {
                console.error(`Failed to initialize Bluesky client for account ${index}:`, error);
                if (error.message.includes('fetch failed')) {
                    console.error('Network error: Unable to connect to the Bluesky API. Please check your network connection and the API endpoint.');
                }
            }            
        } else {
            console.warn(`Identifier or password missing for account ${index}`);
        }
    }
});



// ストリームとBlueskyアカウントの紐付けを環境ごとに設定
const timelineClientMapping = {};
const timelinePrefix = 'TIMELINE_';
const bsAccountMappingPrefix = 'BS_ACCOUNT_';
const overrideTextPrefix = 'OVERRIDE_TEXT_';
const moderationLabelPrefix = 'MODERATION_LABEL_';

Object.keys(process.env).forEach(key => {
    if (key.startsWith(timelinePrefix)) {
        const index = key.replace(timelinePrefix, '');
        const timeline = process.env[`${timelinePrefix}${index}`];
        const accountIndex = parseInt(process.env[`${bsAccountMappingPrefix}${index}`], 10);
        const overrideText = process.env[`${overrideTextPrefix}${index}`];
        const moderationLabel = process.env[`${moderationLabelPrefix}${index}`];

        if (timeline && !isNaN(accountIndex) && bskyClients[accountIndex]) {
            timelineClientMapping[timeline] = {
                client: bskyClients[accountIndex],
                overrideText: overrideText || undefined,
                moderationLabel: moderationLabel ? moderationLabel.split(',') : undefined
            };
            console.log(`Timeline ${timeline} is mapped to Bluesky account ${accountIndex}`);
        } else {
            console.warn(`Failed to map timeline ${timeline}. Timeline: ${timeline}, accountIndex: ${accountIndex}, valid client: ${!!bskyClients[accountIndex]}`);
        }
    }
});



async function start() {
    const client = await cc.Client.createFromSubkey(CC_SUBKEY);

    const subscription = await client.newSubscription();
    const listenTimeline = LISTEN_TIMELINE || client.user.homeTimeline;

    subscription.on('MessageCreated', (message) => {
        console.log('Message received:', message);  // メッセージ受信のログ
        if (message.document.signer != client.ccid) {
            return;
        }
        receivedPost(message);
    });
    

    subscription.listen([listenTimeline]);
}

function receivedPost(data) {
    if (data.document.schema == "https://schema.concrnt.world/m/markdown.json" || data.document.schema == "https://schema.concrnt.world/m/media.json") {
        const body = data.document.body.body;
        const text = ccMsgAnalysis.getPlaneText(body);
        console.log('Extracted text:', text);  // テキストが正しく抽出されているかを確認
        
        const files = ccMsgAnalysis.getMediaFiles(body);
        console.log('Extracted files:', files);  // メディアファイルが正しく抽出されているかを確認
        
        data.document.body.medias?.forEach(media => {
            files.push({
                url: media.mediaURL,
                type: media.mediaType.split("/")[0]
            });
        });

        const relatedTimelines = data.document.timelines || [];
        let selectedText = text;
        let moderationLabel;
        let selectedClient = bskyClients[0]; // デフォルトは BS_ACCOUNT_0

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

        // タイムラインごとにクライアントを選択
        relatedTimelines.forEach(timeline => {
            if (timelineClientMapping[timeline]) {
                selectedClient = timelineClientMapping[timeline].client; // 他のタイムラインがあれば、そのクライアントに切り替え
                console.log(`Selected client for timeline ${timeline}:`, selectedClient);
                if (timelineClientMapping[timeline].overrideText !== undefined) {
                    selectedText = timelineClientMapping[timeline].overrideText;
                }
                if (timelineClientMapping[timeline].moderationLabel) {
                    moderationLabel = timelineClientMapping[timeline].moderationLabel;
                }
            }
        });

        // moderationLabelが配列の場合、最初の要素を使用する
        if (Array.isArray(moderationLabel)) {
            moderationLabel = moderationLabel[0];
        }

        if (selectedClient && (selectedText.length > 0 || files.length > 0)) {
            image.downloader(files).then(filesBuffer => {
                if (TW_ENABLE) twitterClient.tweet(selectedText, filesBuffer);

                if (BS_ENABLE && selectedClient) {
                    try {
                        if (files.length > 0) {
                            console.log('Posting with media:', selectedText);  // メディアありの投稿ログ
                            selectedClient.post(selectedText, filesBuffer, moderationLabel);
                        } else {
                            console.log('Posting without media:', selectedText);  // メディアなしの投稿ログ
                            selectedClient.post(selectedText, null, null);
                        }
                        console.log('Post successfully made to Bluesky:', selectedText);  // 成功時のログ
                    } catch (error) {
                        console.error("Error during posting to Bluesky:", error);
                    }
                }
            }).catch(error => {
                console.error("Error during image downloading:", error);
            });
        } else {
            console.log('No selectedClient or content to post');  // クライアントが選択されていない、または投稿するコンテンツがない場合のログ
        }
    }
}

start()
