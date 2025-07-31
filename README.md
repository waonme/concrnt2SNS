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
BS_IDENTIFIER="BlueskyのIDENTIFIER"
BS_APP_PASSWORD="BlueskyのAPP_PASSWORD"
BS_SERVICE="BlueskyのサーバーURL https://bsky.social　とか"
THREADS_ENABLE="true" or "false"
THREADS_ACCESS_TOKEN="Threads User Access Tokens"
NOSTR_ENABLE="true" or "false"
NOSTR_PRIVATE_KEY="Nostrのプライベートキー"
NOSTR_RELAYS="wss://から始まるリレーサーバーのURL、複数指定する場合はカンマで区切る 例:wss://relay1.com,wss://relay2.com,wss://relay3.com"
CC_SUBKEY="コンカレのサブキー"
LISTEN_TIMELINE="ホーム以外のタイムラインを指定したい場合はID@host形式で1つ指定"

// Option（使わない場合は入れないこと）
LISTEN_TIMELINE_TW="Twitter専用のタイムライン。TW_ENABLEの設定に関わらずTwitterのみに投稿される（ID@host形式）"
TW_WEBHOOK_URL="メディアなしのTweetをIFTTT経由で行う場合のWebHookURL"
TW_WEBHOOK_IMAGE_URL="1枚だけ画像ありのTweetをIFTTT経由で行う場合のWebHookURL"

// 複数アカウント設定（例）
TWITTER_ACCOUNT1_API_KEY="別のTwitterアカウントのAPI_KEY"
TWITTER_ACCOUNT1_API_KEY_SECRET="別のTwitterアカウントのAPI_KEY_SECRET"
TWITTER_ACCOUNT1_ACCESS_TOKEN="別のTwitterアカウントのACCESS_TOKEN"
TWITTER_ACCOUNT1_ACCESS_TOKEN_SECRET="別のTwitterアカウントのACCESS_TOKEN_SECRET"

BLUESKY_ACCOUNT1_IDENTIFIER="別のBlueskyアカウントのIDENTIFIER"
BLUESKY_ACCOUNT1_APP_PASSWORD="別のBlueskyアカウントのAPP_PASSWORD"
BLUESKY_ACCOUNT1_SERVICE="https://bsky.social"

// タイムライン別投稿設定（例）
TIMELINE_1_ID="tjr6xhdgy2n2m2cm30687w9zw2c@arakoshi.com"
TIMELINE_1_TARGETS="twitter:account1,bluesky:account1"

TIMELINE_2_ID="another-timeline-id@host.com"
TIMELINE_2_TARGETS="twitter:default,bluesky:default,threads:default"
```

4. `npm start`で多分動く！！

## フラグ付きメディアについて

メディア投稿時にフラグを設定していると下記のような動作になります。  
markdown投稿でdetailsタグを使ったメディアも同様です。

### Twitter

一つでもフラグ付きのメディアがある場合は、メディアがすべて警告付きボカシ表示になります。  
ただし動画のみの場合はAPIの仕様によりフラグ設定が出来ないため、そのまま表示されます。

### Bluesky

一つでもフラグ付きのメディアがある場合は、メディアがすべて警告表示になります。  

### Nostr

一つでもフラグ付きのメディアがある場合は、投稿そのものが警告表示になります。  

### Threads

フラグ設定が出来ないため、そのまま表示されます。

## Threads User Access Tokensについて

> 【超簡単】PythonでThreads APIを使って遊んでみた #初心者 - Qiita
> [https://qiita.com/Naoya_pro/items/c8f06bdfcb4be3817036](https://qiita.com/Naoya_pro/items/c8f06bdfcb4be3817036)

こちらを参考に`Threads User Access Tokens`を発行してください。  
`Threads User Access Tokens`は公開アカウントじゃないと作成できないので、非公開の場合は一旦公開にしてください。  
発行後に非公開にしても問題ありません。  

## その他

pm2とかでデーモン化するといいかも  
https://pm2.keymetrics.io/  

## `TW_WEBHOOK_URL`や`TW_WEBHOOK_IMAGE_URL`について

Twitterの無料APIの制限がキツイので、メディアなしのTweetをIFTTT経由で行えるようにしました。  
IFTTTでこいういうAppletを作ってWebHookのURLを`TW_WEBHOOK_URL`と`TW_WEBHOOK_IMAGE_URL`にセットしてください。  
※IFTTT Pro以上必須です。

### メディアなしのTweet用 (TW_WEBHOOK_URL)

![image](https://github.com/user-attachments/assets/6350bd08-b941-4108-8b13-fda947bdd655)
![image](https://github.com/user-attachments/assets/3c4b34ca-4412-458a-9342-d0b537f7cc6e)

### 1枚だけ画像ありのTweet用 (TW_WEBHOOK_IMAGE_URL)

![image](https://github.com/user-attachments/assets/6271c892-2db6-4bf5-8c17-f7f7bb56e33c)
![image](https://github.com/user-attachments/assets/27ed9a51-d20b-4786-b3ac-5354b4aa76c7)

## AIコーディングエージェントを使用する開発者の方へ

このリポジトリでは、ClaudeやGeminiのようなAIエージェントが、プロジェクトの概要や構造を理解しやすくするためのエージェント向け文書（プロンプト）を用意しています。

これらを使用するためには、プロジェクトのルートディレクトリに各エージェント向けの設定ファイルを作成し、明示的に読み込む必要があります。

### セットアップ手順:

1. プロジェクトのルートに `CLAUDE.md` や `GEMINI.md` ファイルを作成します。

2. `CLAUDE.md` に以下の行を追加して、リポジトリが推奨するプロンプトをインポートします：

```
@./.ai/claude.prompt.md
```

3. Geminiの場合は `GEMINI.md` に以下を追加します：

```
@./.ai/gemini.prompt.md
```

4. インポートした行の後に、必要な指示を適宜追加してください（例：`Always respond in Japanese.`）。

### プロンプトファイルの構造

`.ai/` ディレクトリには以下のファイルが含まれています：
- `claude.prompt.md` / `gemini.prompt.md`: 各AIエージェント用のエントリーポイント
- `context/overview.md`: プロジェクトの詳細な概要と開発ガイド

このアプローチにより、共有されたプロジェクトのコンテキストを活用しつつ、エージェントに与える指示を各ユーザーが自由に制御できます。`CLAUDE.md` と `GEMINI.md` はすでに `.gitignore` に記載されているため、リポジトリにコミットされることはありません。
