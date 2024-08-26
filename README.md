# concrnt2SNS
コンカレからTwitter(現X)とBlueskyにポストするスクリプト


## Setup
1. `npm i`
2. `.env`を作成する
3. .envの中身

```env
TW_ENABLE="true" or "false"
TW_API_KEY="TwitterのAPI_KEY"
TW_API_KEY_SECRET="TwitterのAPI_KEY_SECRET"
TW_ACCESS_TOKEN="TwitterのACCESS_TOKEN"
TW_ACCESS_TOKEN_SECRET="TwitterのACCESS_TOKEN_SECRET"
BS_ENABLE="true" or "false"
BS_SERVICE="BlueskyのサーバーURL https://bsky.social　とか"
CC_SUBKEY="コンカレのサブキー"
LISTEN_TIMELINE="ホーム以外のタイムラインを指定したい場合はID@host形式で1つ指定"

#Blueskyアカウント設定
BS_IDENTIFIER_0=
BS_APP_PASSWORD_0=

BS_IDENTIFIER_1=
BS_APP_PASSWORD_1=

BS_IDENTIFIER_2=
BS_APP_PASSWORD_2=

# タイムライン、Blueskyアカウント、内容を定型文で置き換え

# 転送元投稿の投稿先がLISTEN_TIMELINEに加えここで指定したタイムラインが含まれる場合に投稿先の切替やテキストの置き換えなどが出来る
TIMELINE_0="abc@example.com"
# どのBlueskyアカウントに転送するか
BS_ACCOUNT_0=0
# Bluesky特有の定型文やハッシュタグで画像付き投稿のテキストを置き換える場合に指定（オプション）
OVERRIDE_TEXT_0="ぶすかいごはん部"
# porn,sexual,nudity,nsfl,gore から、このアカウントの画像投稿に対するラベルを指定（オプション）
MODERATION_LABEL_0=""

TIMELINE_1=
BS_ACCOUNT_1=1
```
4. `npm start`で多分動く！！

## その他
foreverとかでデーモン化するといいかも  
https://www.npmjs.com/package/forever
