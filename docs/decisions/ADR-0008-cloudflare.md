# ADR-0008 インフラとDBをCloudflareに移し、Voidで組む

- 状態：提案（2026-11-27、大関が論点の記録の9つの論点をすべて推奨どおりに選んだ。このPRのマージで承認）
- 決めた人：大関
- 関連：[アーキテクチャ](../architecture.md)、[論点の記録](../discussions/cloudflare-migration.md)、[ADR-0002](ADR-0002-schema-and-functions.md)、[ADR-0004](ADR-0004-dev-tools.md)、[ADR-0006](ADR-0006-region-and-cost.md)、[ADR-0007](ADR-0007-cognito-email.md)
- 置き換えるもの：ADR-0002の決定1・決定3・決定5、ADR-0004の決定3・決定4・決定5・決定7・決定8の一部と2026-11-21・2026-11-25の追記の一部、ADR-0006の決定1〜7、ADR-0007の全部。置き換えた決定は、各ADRの末尾の追記に書いた

## 背景

2026-11-27に大関から、インフラとDBをCloudflareでまとめて管理したいと相談があった。いまの設計はAWS（Lambda、API Gateway、EventBridge Scheduler、Cognito、SES、S3、CloudFront、SQS、SSM）とNeonで、費用の見込みは月約4.50円だった。大関の判断の前提は次のとおり。

- 売上は0円のプロダクトなので、インフラの費用は多少かけてよい。
- 個人開発で世には出さない。そこまで高い品質は求めない。
- アーキテクチャの設計からやり直してよい。

実装はもう始まっていた。`main`にはAWSの初回準備（Terraformの状態バケット、GitHub ActionsのOIDC、SSMの登録スクリプト）とCIが入り、AWSの環境（PR #91）とPostgres向けのDB変更の仕組み（PR #92）が開いていた。

## 決定

### 1. 画面・API・DB・画像・リマインド・ログインを、すべてCloudflareに置く

AWSとNeonは使わない。部品は次のように置き換える。

| いままで | これから |
| --- | --- |
| API Gateway＋Lambda `api` | Workers（VoidのAPIの置き場所`routes/`） |
| CloudFront＋S3（画面） | Workersの静的ファイル（VoidのSPA＋APIの形） |
| Neon（Postgres） | D1（SQLite） |
| S3（グッズの画像） | R2。署名付きURL、取得の期限5分、`uploads/`に置いて確定のときにコピー、確定しなかったものはライフサイクルで1日後に消す、をそのまま移す |
| EventBridge Schedulerと`notification-sender` | 1分ごとのCron（決定4） |
| Lambda `erasure-worker` | Queuesの受け手。止まったジョブは1分ごとのCronが拾い直す |
| SQSの失敗キュー | Queuesの失敗キュー（dead letter queue） |
| Cognito＋SES | Better Auth＋CloudflareのEmail Service（決定5） |
| SSM Parameter Store | Workersのsecret（`void secret put`） |
| CloudWatch Logs | Workersのログ。保存は有料プランの7日（AWS構成のC-3と同じ日数） |

D1はアジアに寄せて置く（location hint）。結合検証と本番は、Workers・D1・R2を2組作って分ける（最初の1本の要件F-01）。Voidでの分け方は、最初の1本の設計書を直すときに確かめる。

### 2. 費用はWorkers Paidの月5ドルにする

Workers Paid（1アカウント月5ドル、1ドル150〜160円で約750〜800円）を最初から使う。WorkersとDurable Objectsの使用量はこの中に入り、D1・R2・Queues・Email Serviceもyoinの規模なら含まれる量で収まる見込みである。無料プランにしないのは、Email Serviceが登録していない宛先へメールを送れず、ログインのコードをメンバーに送れないためである。

### 3. バックエンドはVoidで組み、配置は`void deploy`にする

Void（VoidZeroが作り、2026-10-15にMITライセンスで公開。2026-11-27時点のnpmの版は1.12.2）を使う。VoidはViteの上に作ったCloudflare向けのフレームワークと配置の道具で、中でHonoを使う。

- APIは`routes/`に置き、Honoの書き方（Honoのcontext）で書く。入力の検査はZodのまま。
- 画面はいまのReact＋Viteを「SPA＋API」の形で載せる。PWAとService Workerはそのまま。
- DBはD1とDrizzle（Voidに入っている`void/db`）。マイグレーションは`void db generate`で作り、`void deploy`のときに流す。手でSQLを流す手順は作らない。
- 画面からAPIを呼ぶ型つきのクライアントは、`hono/client`からVoidの`void/client`に替える。
- 配置は`void deploy`にする。資源（D1、R2、Queues、Cron）の作成、マイグレーション、配置を1回で行い、中でCloudflareのcf CLIを使う。CIは`CLOUDFLARE_API_TOKEN`で動かし、トークンはGitHubのSecretsに置く。
- 文脈ごとの層（ADR-0003）は`src/contexts/`に置いたまま、`routes/`・`crons/`などVoidの置き場所からは文脈の公開関数だけを呼ぶ。境目はeslint-plugin-boundariesで今どおり検査する。
- Devinには、Voidに付いているエージェント向けの文書（`AGENTS_TEMPLATE.md`とスキル）を読ませる。

### 4. リマインドは、1分ごとのCronでD1を見て送る

リマインド1件ごとの予約は作らない。リマインドの行に送信時刻を持ち、1分ごとのCronが送信時刻の来た行を引き受けて、Web Pushで送る。取り消しは行を書き換えるだけになる。

送信の決まりはデータモデルのまま守る。同じ行を2回見ても、引き受けに成功した実行だけが送る。`sending`のまま止まった行は10分後に引き受け直す。送り直しは、送れていない端末だけにする。D1は使わないあいだも眠らないので、毎分見ても費用は増えない。送信は最大1分遅れる。

Web Pushの暗号は、Web Cryptoで書いたライブラリ（pushforgeなど）で行う。iPhoneへ届くかは結合検証で確かめる。

### 5. ログインはVoidのBetter Authで、メールのコードにする

Voidに入っているBetter Authに、メールのコードでログインする機能を足す。パスワードもパスキーも使わない（2026-11-21の判断のまま）。メールはCloudflareのEmail Service（2026-11時点でβ版）で送る。

招待リンクを通らないログインだけでユーザーを作らない決まりは変えない。Better Authがユーザーを作る前に呼ぶつなぎ目で、有効な招待のトークンを確かめ、無ければ断る。ログインの状態はD1の表に置く。グループの操作は、読み取りも書き込みもメンバーであることを確かめてから行う。

### 6. D1の書き込みは、先に読んでから、条件を付けた`batch()`でまとめて流す

D1はWorkersから`BEGIN`・`COMMIT`のトランザクションを書けないので、ADR-0002の決定3（最初にグループの行を`FOR SHARE`でロックし、1つのトランザクションで書く）は次の形に置き換える。

1. グループと対象の行を読み、書いてよいかを判断する。
2. 書き込みは`db.batch()`でまとめて流す。どの文にも、同じ条件（「グループが有効」「申込がまだ前の状態」など）を`WHERE`で付ける。
3. 前の文の結果で条件が変わってしまい、同じ条件を付けられない書き込みは、条件が外れたら失敗する確かめの文を`batch()`の先頭に置く。確かめの文は、条件が外れたときに制約（`CHECK`など）に反する行を書く形にする。
4. 流したあと、各文が変えた件数を見て、条件が外れていたら利用者に、もう一度試すよう出す。

D1の`batch()`は、どれかの文が失敗（エラー）すると全部を取り消す。条件が外れて0件しか変えなかった文は失敗ではないので、それだけでは取り消されない。そこで、手順2ではすべての文に同じ条件を付けて、条件が外れればどの文も何も変えないようにする。手順3では、確かめの文をわざと失敗させて全部を取り消す。D1は1つのDBで1度に1つの処理しかしないので、`batch()`の途中にほかの書き込み（解散など）は割り込まない。書き込みごとの条件と、どれに確かめの文を使うかは、データモデルを直すときに表ごとに書く。

## 選ばなかった案

詳しくは[論点の記録](../discussions/cloudflare-migration.md)にある。

- DBはNeonのまま、Hyperdriveでつなぐ。ADR-0002の書き込みの決まりをそのまま使えるが、管理するものがCloudflareとNeonの2つ残る。大関はCloudflareにまとめるほうを選んだ。
- 画面とAPIだけCloudflareに移し、認証とリマインドはAWSに残す。管理するものがAWS・Cloudflare・Neonの3つに増える。
- 移さない。費用は月約4.50円のままだが、Cloudflareにまとめない。
- 無料プランで動かす。ログインのメールはメンバーのアドレスを1人ずつ登録しないと送れず、CPUは1回10ミリ秒、D1は1つ500MBまでになる。
- ログインにCognitoだけ残す。AWSのアカウントとSESの管理が残る。ClerkやAuth0などの外のサービスは、管理画面がもう1つ増える。
- リマインドを1件ごとのDurable Objectのアラームや、Workflowsで起動する。いまの予約の形に近いが、DBがD1なら毎分見るほうが作りが単純になる。
- バックエンドをHono単体で組む。ADR-0004の形のままだが、ログイン・マイグレーション・Cron・配置のつなぎ込みを自分たちで作る。
- 配置をcf CLI（1.0.0-rc.6）かwranglerで書く。Voidを使うので、Voidに任せる。
- グループごとにDurable Objectを置いて書き込みを1本にする。通り道とDBが2つに分かれる。条件を付けずに取りこぼしを許す案は、解散したグループに行が残り、データの消失の決まりに当たる。

## 結果

### 良くなること

- 管理するのがCloudflareのアカウント1つになる。AWSのアカウント、Terraformの状態バケット、SSM、Neonが要らなくなる。
- DBを過去の時点に戻せる期間が、Neonの無料プランの6時間から、D1の有料プランの30日に延びる。
- 土台（マイグレーション、ログイン、資源の作成、配置）をVoidが持つので、Devinに渡す土台のタスクが減る。
- リマインドの予約を作る・消す・世代を切り替える処理が要らなくなる。
- 手元でD1・R2・Cron・メールをまねて動かせるので、AWS Emulator（ADR-0004の2026-11-25の追記）は要らなくなる。

### 悪くなること・残るリスク

- 費用が月約4.50円から月5ドルに上がる。
- Voidは公開から6週間で、利用の記録が少ない。確かめたのはnpmのパッケージの文書だけで、実際には動かしていない。
- Email Serviceの送信はβ版である。使えなくなったら、Resendなど別のメール送信に替える。
- D1は途中で判断を挟むトランザクションが無いので、書き込みの条件を付け忘れると決まりが崩れる。データモデルを直すときに条件を表ごとに書き、試験で確かめる。
- CIからの配置は、期限の長いAPIトークンになる。GitHubのOIDCで短い認証にできるかは確かめていない。トークンの権限は配置に要るものだけにする。
- マージ済みのAWSの初回準備（`infra/terraform/bootstrap/`、`scripts/bootstrap-ssm.ts`）と、CIの成果物の作り（Lambdaの束ね方）は作り直しになる。

## 移行・戻し方

本番のデータはまだ無いので、データの移し替えは要らない。次の順で直す。

1. このPR：論点の記録、ADR-0008、置き換えたADRへの追記、`docs/architecture.md`の書き直し。
2. データモデル（`docs/data-model.md`）のうちD1で変わるところ。型、書き込みの条件（決定6）、リマインドの送り方（決定4）、スキーマの分け方。SQLiteにはスキーマが無いので、表の名前の頭に文脈の名前を付ける。
3. 検査そのものの変更（別のPR）：AGENTS.md、`docs/agents/current-state.md`、`docs/agents/command-scope.md`、REVIEW.md。Cloudflareの本番と結合検証につながないこと、cfとVoidの利用状況の送信を止めること、秘密の値の置き場所をWorkersのsecretにすることを書く。
4. 最初の1本の要件定義書と設計書の直し（Claude）。
5. 実装計画と試験計画の直し（ClaudeがIssueにしてDevinに渡す）。止めたPR #91・#92とIssue #48・#50・#73・#79は、このときに閉じるか直すかを決める。

戻すときは、このADRを取り下げ、置き換えたADRの追記を消す。AWSの初回準備は`main`に残っているので、そこから続けられる。

## この決定では決めないこと

- 費用の見張り方。AWS Budgetsの代わりに、Cloudflareの請求の通知で何を見るか（ADR-0006の決定5の代わり）。
- 流量の上限と、要求が急に増えたときの知らせ方（ADR-0006の決定6・決定7の代わり）。
- 失敗キューに入ったときの知らせ方（AWS構成のC-4の代わり）。
- 結合検証と本番を、Voidでどう分けるか。
- メールの送信元のアドレスとドメイン。
