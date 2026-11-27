# 論点の記録: インフラとDBをCloudflareに移すか

- 機能名: cloudflare-migration
- 確認のページ: https://claude.ai/artifact/2TpDyanYg466ZU2XY84T6b
- 進み具合: docs/discussions/cloudflare-migration.progress.json

## 背景

2026-11-27に大関さんから「インフラ費用を多少かけたとしても、今回作るプロダクトは0円。であれば、Cloudflareでインフラ・DBを管理する形に移したい」と相談があった。いまの設計はAWS（Lambda、API Gateway、EventBridge Scheduler、Cognito、SES、S3、CloudFront、SQS、SSM）とNeonで、工程1〜6は確定している（`docs/architecture.md`、ADR-0002、ADR-0004、ADR-0006、ADR-0007）。基盤を替えるのはADR級の決定なので、候補を比べて大関さんに選んでもらう。

## 前提

- 実装はもう始まっている。`main`にはAWSの初回準備（Terraformの状態バケット、GitHub ActionsのOIDC、SSMの登録スクリプト）とCIが入った。開いているPRは、AWSの環境と監視（#91）、DB変更の仕組み（#92）、画面の共通部分（#93）。土台と製品のIssueは#48〜#73、AWS Emulatorを計画に入れるIssueは#79。
- 書き込みは1つのトランザクションの中で、最初にグループの行を`FOR SHARE`でロックしてから行う（ADR-0002の決定3、データモデル）。途中で判断を挟めるトランザクションが要る。
- 招待リンクを通らないログインだけでユーザーを作らない（AGENTS.md「認可」）。いまはCognitoの登録前Lambdaで断っている。
- ClaudeとDevinはAWS・Neonにつながない（`docs/agents/command-scope.md`）。移すなら、Cloudflareの本番と結合検証にもつながない決まりを足す。
- 金額は1ドル150〜160円で計算した。

## 調べた事実

2026-11-27にCloudflareの公式の文書を読んだ。出典は各論点の根拠にある。

- 有料のWorkers Paidは1アカウント月5ドル（約750〜800円）。Workers、Durable Objects、Hyperdrive、KVの使用量がこの中に入り、yoinの規模なら追加はかからない見込み。無料プランは1日10万リクエスト、1回の実行のCPUが10ミリ秒まで。
- D1（CloudflareのSQLiteのDB）は、Workersから`BEGIN`・`COMMIT`で途中で判断を挟むトランザクションを書けない。複数の文をまとめて流す`batch()`は全部か何もしないかになる。1つのDBは1度に1つの問い合わせしか処理しない。過去の時点に戻せるのは無料7日、有料30日。
- Hyperdrive（WorkersからPostgresへの接続をまとめる仕組み）はNeonに対応し、`BEGIN`・`COMMIT`のトランザクションが使える。ドライバーはnode-postgres（`pg`）かPostgres.jsで、Neonのサーバーレスドライバーは使わない。無料は1日10万問い合わせ。
- Hyperdriveは接続をためておく。ためた接続がNeonを眠らせず計算時間を使い続けるかは、確かめていない。
- Durable Objectのアラームは、1つのオブジェクトに1つの起動時刻を置ける。最低1回は起動し、失敗すると2秒から6回まで再試行する。オブジェクトの数に上限は無い。
- Queuesは失敗キュー（dead letter queue）に対応する。送る時刻を遅らせられるのは24時間まで。
- R2（Cloudflareの画像などの置き場）は署名付きURLに対応し、期限は1秒〜7日。ライフサイクルで日数が過ぎたものを消せる。外への転送は無料。
- CloudflareのEmail Serviceのメール送信はβ版。登録していない宛先へ送れるのはWorkers Paidだけで、月3,000通まで含まれる。
- Web Pushの暗号はWeb Cryptoで書いたライブラリ（pushforgeなど）がWorkersで動くと書いている。iPhoneへ届くかは試していない。
- WorkersのデプロイはTerraformのCloudflareプロバイダーでも、Cloudflareの道具wrangler（設定ファイルと`wrangler deploy`）でもできる。wranglerは手元でD1・R2・Durable Objects・Queuesをまねて動かせる。

## 論点

### 費用は、月5ドルの有料プランまで払ってよいか

<!-- id: cf-cost -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 「0円」の読み方で、選べる構成が変わる。無料プランでは、メンバーにログインのコードをメールで送れない。
- 根拠: https://developers.cloudflare.com/workers/platform/pricing/ 、https://developers.cloudflare.com/email-service/platform/pricing/ 、ADR-0006の費用の試算
- 選択肢:
  - A) Workers Paid（月5ドル、約750〜800円）を払う
    - 利点: ログインのコードのメールをCloudflareから送れる。CPUの上限が1回5分になり、DBを戻せる期間も30日になる
    - 欠点: いまのAWSの見込み（月約4.50円）より約170倍高い
  - B) 0円で動かす（Cloudflareの無料プラン）
    - 利点: 費用がかからない
    - 欠点: メールは登録した宛先にしか送れないので、ログインのメールはほかで送る（Cognito、Resendなど）。CPUは1回10ミリ秒まで。上限を超えるとその日のUTCの0時まで失敗する
- 推奨: A（ログインのメールまでCloudflareにまとめられる。Bだと結局ほかのサービスが残る）

### どこまでCloudflareに移し、DBをどうするか

<!-- id: cf-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: DBの選び方で、データモデルとADR-0002を作り直すかが決まる。AWS向けのPR #91が進んでいる。
- 根拠: https://developers.cloudflare.com/d1/worker-api/d1-database/ 、https://developers.cloudflare.com/d1/platform/limits 、https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/ 、https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/ 、ADR-0002の決定3、`docs/data-model.md`
- 選択肢:
  - A) AWSをやめて画面・API・認証・リマインド・画像をCloudflareに移す。DBはNeonのまま、Hyperdriveでつなぐ
    - 利点: データモデルとADR-0002の決まり（`FOR SHARE`のロック、途中で判断を挟むトランザクション）、Drizzle、CIのPostgresのコンテナをそのまま使える。AWSのアカウント、Terraformの状態バケット、SSMが要らなくなる
    - 欠点: 管理画面がCloudflareとNeonの2つ残る。Neonへのドライバーを替える。Hyperdriveの接続がNeonを眠らせないかを確かめる
  - B) DBもD1に替えて、全部Cloudflareにする
    - 利点: 管理するのがCloudflareだけになる。DBを戻せる期間が30日になる
    - 欠点: 途中で判断を挟むトランザクションが書けず、グループの行のロックも無いので、データモデルとADR-0002の書き込みの決まりを作り直す。SQLiteに替わるので、CIのPostgresのコンテナとDrizzleの設定も替える
  - C) 画面とAPIだけCloudflareに移し、認証（Cognito）とリマインド（Scheduler）はAWSに残す
    - 利点: 認証とリマインドの設計を変えずに済む
    - 欠点: AWSとCloudflareとNeonの3つを管理することになり、いまより増える
  - D) 移さない。いまのAWSとNeonのまま進める
    - 利点: 設計も実装中のPRもそのまま。費用は月約4.50円
    - 欠点: 大関さんが望んだCloudflareへのまとめはしない
- 推奨: A（決めた書き込みの決まりを守ったまま、AWSを丸ごと外せる。Bは管理は1つになるが、データモデルの工程からやり直しになる）

### ログインを何で作るか

<!-- id: cf-auth -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 認証は人がじっくり見る範囲で、招待リンクを通らない登録を断る仕組みをどこに置くかが変わる。
- 根拠: ADR-0007、AGENTS.md「認可」、https://developers.cloudflare.com/email-service/index.md 、https://www.better-auth.com/docs/plugins/email-otp
- 選択肢:
  - A) Better Auth（TypeScriptの認証ライブラリ）をWorkersで動かし、メールのコードでログインする。メールはCloudflareのEmail Serviceで送る
    - 利点: Cloudflareにまとまる。招待の確認を、ユーザーを作る処理の前に自分のコードで入れられる。ログインの状態はNeonの表に置く
    - 欠点: セッションの管理を自分たちのコードで持つので、人が見る差分が増える。Email Serviceはβ版
  - B) CognitoとSESだけAWSに残し、WorkersでCognitoのJWTを確かめる
    - 利点: ADR-0007と登録前Lambdaの設計をそのまま使える
    - 欠点: AWSのアカウントと、登録前Lambda・SESの管理が残る
  - C) 外のログインのサービス（ClerkやAuth0など）を使う
    - 利点: セッションの管理を任せられる
    - 欠点: 管理画面がもう1つ増える。招待の確認をそのサービスの仕組みに合わせて作る
- 推奨: A（AWSを外すなら、Cognitoだけ残すと費用の見張りもアカウントも残る。Better Authはメールのコードと、ユーザーを作る前に断るつなぎ目を持っている）

### リマインドを、何で時刻に起動するか

<!-- id: cf-reminder -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: いまはリマインド1件ごとにSchedulerの1回限りの予約を作る。同じ形をCloudflareで何に置き換えるかで、予約・取り消し・再送の作りが変わる。
- 根拠: https://developers.cloudflare.com/durable-objects/api/alarms 、https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/ 、https://developers.cloudflare.com/queues/configuration/batching-retries/ 、データモデル「リマインドの送り方」、AWS構成のC-4
- 選択肢:
  - A) リマインド1件ごとにDurable Objectを1つ作り、送信時刻にアラームを置く
    - 利点: いまの「1件ごとに1回限りの予約」と同じ形。取り消しはアラームを消すだけ。2回起動してもNeonの行の引き受けで1回にする決まりはそのまま使える
    - 欠点: 再試行を使い切ったときの失敗キューへの送り込みを自分で書く
  - B) リマインド1件ごとにWorkflowsを起動し、送信時刻まで眠らせる
    - 利点: 再試行の回数と間隔を手順ごとに決められる
    - 欠点: 眠らせられる長さの上限を確かめていない。取り消しは実行中の手順を止める形になる
  - C) Cronで1分ごとにNeonを見て、時刻の来たリマインドを送る
    - 利点: 作りがいちばん単純
    - 欠点: Neonが1分ごとに起き、無料の計算時間を使い切る（AWS構成のA-1で避けた形）
- 推奨: A（いまの予約の決まりをそのまま写せて、Neonは送るときだけ起きる）

### 環境の定義とデプロイを、何で書くか

<!-- id: cf-iac -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 回答待ち
- なぜ今: ADR-0004の決定5（Terraform）と、マージ済みの初回準備の作り直し方が変わる。
- 根拠: https://developers.cloudflare.com/workers/platform/infrastructure-as-code/ 、ADR-0004の決定3・決定5
- 選択肢:
  - A) wranglerの設定ファイルと`wrangler deploy`で書く
    - 利点: Cloudflareの標準の形で、手元でD1・R2・Durable Objectsをまねる道具も同じ設定を読む。状態ファイルとそのバケットが要らない
    - 欠点: Terraformの検査（`terraform test`）の代わりを考える。DNSなどWorkersの外の設定は別に持つ
  - B) TerraformのCloudflareプロバイダーで書く
    - 利点: ADR-0004の決定5の道具を続けられる
    - 欠点: 状態ファイルの置き場所をまた作る。Workersのコードの配置は結局wranglerかビルドの手順と組み合わせる
- 推奨: A（Workersの配置とDurable Objectsの定義が1つの設定にまとまり、状態ファイルを守る仕組みが要らなくなる）

### 決めるまで、進んでいる実装をどうするか

<!-- id: cf-inflight -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 仮決定
- なぜ今: 移すと決まれば無駄になる作業を、Devinに続けさせないため。
- 根拠: PR #91・#92・#93、Issue #48・#73・#79
- 選択肢:
  - A) AWSにしか関わらないPR #91とIssue #48・#73・#79は止める。DB変更の仕組み（#92）と画面の共通部分（#93）は、どの案でも使うので続ける
    - 利点: 無駄になる作業を止めつつ、残る作業は進められる
    - 欠点: Bを選ぶと#92も作り直しになる
  - B) 決まるまで全部止める
    - 利点: 作り直しが出ない
    - 欠点: 画面の作業まで止まる
- 推奨: A（#92はNeonを使い続けるAとCでは無駄にならず、#93は基盤に関わらない）

### 決めたことを、どこに書くか

<!-- id: cf-record -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: 確定した工程の文書を書き換えるので、範囲と分担を先に決めておく。
- 根拠: AGENTS.md「進め方の決まり」、`docs/agents/command-scope.md`
- 選択肢:
  - A) ClaudeがADR-0008を新しく書き、ADR-0004・0006・0007と`docs/architecture.md`に「ADR-0008で置き換えた」と追記するPRを出す。AGENTS.mdと「コマンドの範囲」に、Cloudflareの本番と結合検証につながない決まりを足すのは別のPRにする。要件定義書と設計書の直しはClaude、実装計画・試験計画の直しはDevinへのIssueにする
    - 利点: 分担の決まりと、検査そのものを別のPRにする決まりのとおり
    - 欠点: PRが3本以上になる
  - B) ADRと設計書を1本のPRでまとめて直す
    - 利点: 早い
    - 欠点: 差分が大きく、人が見る範囲が混ざる
- 推奨: A（分担と、検査を別のPRにする決まりのとおり）
