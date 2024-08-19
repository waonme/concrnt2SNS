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

# テスト用のBlueskyアカウント設定
BS_IDENTIFIER_DEV=
BS_APP_PASSWORD_DEV=

# 通常のBlueskyアカウント設定
BS_IDENTIFIER_0=
BS_APP_PASSWORD_0=

BS_IDENTIFIER_1=
BS_APP_PASSWORD_1=

BS_IDENTIFIER_2=
BS_APP_PASSWORD_2=

# Blueskyアカウントの数
BS_ACCOUNT_COUNT=3

# ストリーム、Blueskyアカウント、テキストの紐付け
STREAM_0="LISTEN_TIMELINEに加えてここで指定したID@host形式のタイムラインが含まれる場合に投稿先やテキストを置き換えることが出来る"
BS_ACCOUNT_0=0
OVERRIDE_TEXT_0="Bluesky特有の定型文やハッシュタグで画像付き投稿のテキストを置き換える場合に指定"
MODERATION_LABEL_0="" # porn,sexual,nudity,nsfl,gore から、このアカウントの画像投稿に対するラベルを指定

STREAM_1=
BS_ACCOUNT_1=1

STREAM_DEV_0=
BS_ACCOUNT_DEV_0=DEV

STREAM_DEV_1=
BS_ACCOUNT_DEV_1=DEV

# 環境設定
NODE_ENV=production
```
4. `npm start`で多分動く！！

## その他
foreverとかでデーモン化するといいかも  
https://www.npmjs.com/package/forever
