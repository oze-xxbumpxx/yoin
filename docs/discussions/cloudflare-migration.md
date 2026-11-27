# 論点の記録: インフラとDBをCloudflareに移すか

- 機能名: cloudflare-migration
- 確認のページ: https://claude.ai/artifact/2TpDyanYg466ZU2XY84T6b
- 進み具合: docs/discussions/cloudflare-migration.progress.json

## 背景

2026-11-27に大関さんから「インフラ費用を多少かけたとしても、今回作るプロダクトは0円。であれば、Cloudflareでインフラ・DBを管理する形に移したい」と相談があった。いまの設計はAWS（Lambda、API Gateway、EventBridge Scheduler、Cognito、SES、S3、CloudFront、SQS、SSM）とNeonで、工程1〜6は確定している（`docs/architecture.md`、ADR-0002、ADR-0004、ADR-0006、ADR-0007）。基盤を替えるのはADR級の決定なので、候補を比べて大関さんに選んでもらう。

2026-11-27の1回目の答えで、大関さんは「DBもD1に移す形でよい。あくまで個人開発で世には出さない。そこまで高品質なものを期待していない。定義とデプロイはCloudflare用のCLIを使い、Honoも入れたい。アーキテクチャ設計からやり直してよい」と決めた。続けて「cf CLIはどうか。比べてほしい。バックエンドはVoidを使う案はどうか。Cloudflareと相性が良いと思う」と聞かれた。2回目は、定義とデプロイの道具を選び直す問いと、Voidを使うかの問い、D1で書き込みの決まりをどう守るかと、やり直す範囲を足して出す。

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
- cf（Cloudflareの新しいCLI）は、Cloudflare全体のAPIとWorkersの開発・配置を1つにまとめた道具。2026-09-28に公開のβ、npmの版は1.0.0-rc.6（2026-11-27に確かめた）。設定は`cloudflare.config.ts`で、`wrangler.jsonc`は読まない（`cf migrate`で変換する）。CIは`CLOUDFLARE_API_TOKEN`で動く。正式版のあと、wranglerは最後の版から18か月保守される。2026-11時点の記事では、Durable Objectsの移行はまだ`cf migrate`で扱えない。
- Void（VoidZeroが作り、2026-10-15にMITライセンスで公開）は、Viteの上に作ったCloudflare向けのフレームワークと配置の道具。npmの版は1.12.2（2026-11-27）。中でHonoを使い、APIの処理はHonoのcontextで書く。D1とDrizzle（`db.batch()`を含む）、Better Authのログイン、Durable Objects（アラームつき）、Cron、Queues、R2、KV、メールの送受信（手元の受信箱で試せる）を持つ。画面は「SPA＋API」の形に対応する。型つきの呼び出しは`hono/client`でなくVoidの`void/client`。`void deploy`はビルド、資源の作成、マイグレーション、配置をまとめて行い、中でcfを使う。エージェント向けの`AGENTS_TEMPLATE.md`とスキルが付いている。無料プランの範囲でも動くと書いている。2026-11-27にnpmのパッケージの文書を読んだだけで、動かしてはいない。
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
    - 欠点: メールは登録した宛先にしか送れない。メンバーのアドレスを1人ずつCloudflareに登録し、本人が確認のメールを押すか、ほかのサービス（Resendなど）で送る。CPUは1回10ミリ秒まで、D1は1つ500MBまで、戻せる期間は7日。上限を超えるとその日のUTCの0時まで失敗する
- 推奨: A（ログインのメールの手間が無く、上限を気にせず使える。世に出さない個人の利用なら、メンバーのアドレスを登録するBも成り立つ）

### どこまでCloudflareに移し、DBをどうするか

<!-- id: cf-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 決定
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
- 決定: B
- 推奨と同じか: 違う
- 理由: 個人開発で世には出さず、そこまで高品質なものを期待していない。管理をCloudflareにまとめたい。アーキテクチャ設計からやり直してよい（大関さん、2026-11-27）
- 選ばなかった理由: A（NeonとCloudflareの2つを管理することになる）、C（管理するものが3つに増える）、D（Cloudflareにまとめたい）
- 反映先: ADR-0008、docs/architecture.md、docs/data-model.md（D1で変わるところ）
- 決めた日: 2026-11-27

### ログインを何で作るか

<!-- id: cf-auth -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 認証は人がじっくり見る範囲で、招待リンクを通らない登録を断る仕組みをどこに置くかが変わる。
- 根拠: ADR-0007、AGENTS.md「認可」、https://developers.cloudflare.com/email-service/index.md 、https://www.better-auth.com/docs/plugins/email-otp
- 選択肢:
  - A) Better Auth（TypeScriptの認証ライブラリ）をWorkersで動かし、メールのコードでログインする。メールはCloudflareのEmail Serviceで送る。Voidを使うなら、Voidに入っているBetter Authにメールのコードの機能を足す
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
- なぜ今: いまはリマインド1件ごとにSchedulerの1回限りの予約を作る。DBをD1にしたので、1回目と推奨を変えた（1回目はA）。同じ形をCloudflareで何に置き換えるかで、予約・取り消し・再送の作りが変わる。
- 根拠: https://developers.cloudflare.com/durable-objects/api/alarms 、https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/ 、https://developers.cloudflare.com/queues/configuration/batching-retries/ 、データモデル「リマインドの送り方」、AWS構成のC-4
- 選択肢:
  - A) リマインド1件ごとにDurable Objectを1つ作り、送信時刻にアラームを置く
    - 利点: いまの「1件ごとに1回限りの予約」と同じ形。取り消しはアラームを消すだけ。2回起動してもNeonの行の引き受けで1回にする決まりはそのまま使える
    - 欠点: 再試行を使い切ったときの失敗キューへの送り込みを自分で書く
  - B) リマインド1件ごとにWorkflowsを起動し、送信時刻まで眠らせる
    - 利点: 再試行の回数と間隔を手順ごとに決められる
    - 欠点: 眠らせられる長さの上限を確かめていない。取り消しは実行中の手順を止める形になる
  - C) Cronで1分ごとにD1を見て、送信時刻の来たリマインドを送る
    - 利点: 作りがいちばん単純。予約も取り消しもD1の行を書くだけになる。送れなかったものは次の1分で拾い直せる。D1は眠らないので、Neonのときの「毎分起こして計算時間を使い切る」問題が無い
    - 欠点: 送信が最大1分遅れる。無料プランではCronの1回のCPUが10ミリ秒までなので、一度に送る端末が多いと足りないおそれがある（試していない）
- 推奨: C（DBをD1にしたので、毎分見ても費用がかからない。1件ごとの予約を作る・消す・世代を切り替える処理が要らなくなる）

### バックエンドをVoidで組むか

<!-- id: cf-backend -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 大関さんからVoidを使う案が出た。Voidを使うと、ログイン、DBのマイグレーション、Cron、配置をVoidの決まりに沿って作ることになり、ほかの問いの答えも変わる。
- 根拠: https://blog.cloudflare.com/deploy-with-void/ 、https://flaviocopes.com/void/ 、https://github.com/voidzero-dev/void 、npmの`void@1.12.2`に入っている文書（app-types、auth、durable-state、jobs、email、database）、ADR-0004の決定2・決定7
- 選択肢:
  - A) Voidで組む。APIはVoidの`routes/`にHonoの書き方で置き、画面はいまのReact＋Viteを「SPA＋API」の形で載せる。D1とDrizzle、ログイン（Better Auth）、Cron、R2、メール、配置はVoidのものを使う
    - 利点: 土台（DBのマイグレーション、ログイン、資源の作成、配置、CIの手順）をVoidが持つので、作る量がいちばん少ない。メールを手元の受信箱で受けられるので、ログインのE2Eを試しやすい。Honoの書き方とDrizzleはADR-0004のまま使える
    - 欠点: 公開から6週間で、利用の記録が少ない。型つきの呼び出しが`hono/client`からVoidの`void/client`に替わる（ADR-0004の決定7）。`routes/`・`crons/`などVoidの置き場所と、ADR-0003の文脈ごとの層（`src/contexts/`）を合わせる決まりを作る。Devinが知らない道具なので、Voidに付いているエージェント向けの文書を読ませる
  - B) Hono単体で組み、D1・ログイン・Cron・配置は自分たちで組み合わせる
    - 利点: ADR-0004の形（Hono＋Zod、`hono/client`）のまま。道具が新しすぎる危うさが無い
    - 欠点: Better Authのつなぎ込み、D1のマイグレーション、Cron、配置の手順を自分たちで作るので、土台のタスクが増える
- 推奨: A（個人開発で高い品質を求めないなら、土台をVoidに任せて画面とアプリの決まりに時間を使える。中身はHonoとDrizzleとBetter Authなので、Voidをやめるときも書いたコードの多くは残る）

### 定義とデプロイを、どのCLIでするか

<!-- id: cf-iac -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 回答待ち
- なぜ今: 1回目はwranglerに決めたが、大関さんがcf CLIとの比べを求めた。ADR-0004の決定5（Terraform）と、マージ済みの初回準備の作り直し方が変わる。
- 根拠: https://blog.cloudflare.com/cloudflare-cf-cli-launch/ 、https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/ 、https://flaviocopes.com/cloudflare-cf/ 、https://blog.cloudflare.com/deploy-with-void/ 、https://developers.cloudflare.com/workers/platform/infrastructure-as-code/ 、ADR-0004の決定3・決定5
- 前の決定: 2026-11-27の1回目でA（wrangler）。大関さんがcf CLIとの比べを求めたので出し直す
- 選択肢:
  - A) Voidの`void deploy`に任せる（中でcfを使う）。Voidを使うときだけ選べる
    - 利点: D1・R2・Cronなどの資源をコードから読み取って作り、マイグレーションと配置を1回で行う。設定ファイルをほとんど書かない
    - 欠点: 資源の定義がVoidの決まりに沿う。Voidをやめるときは、cfかwranglerの設定に書き直す
  - B) cf（1.0.0-rc.6）と`cloudflare.config.ts`で書く
    - 利点: Cloudflareがこれから標準にする道具。設定をTypeScriptで書ける。画面のVite（React）のビルドと同じ流れで動く
    - 欠点: まだ正式版の前で、設定や命令が変わることがある。Durable Objectsの移行はまだ扱えない（記事による）
  - C) wranglerと`wrangler.jsonc`で書く
    - 利点: いちばん長く使われていて、Durable Objects・D1のマイグレーションまで全部扱える。文書と例が多く、Devinも知っている
    - 欠点: cfの正式版のあと、18か月で保守が終わる
- 推奨: A（Voidを使うなら配置まで任せるのがいちばん手間が少ない。Voidを使わないならB。個人開発で、これから標準になるcfに最初から合わせられる）

### 決めるまで、進んでいる実装をどうするか

<!-- id: cf-inflight -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 仮決定
- なぜ今: 移すと決まれば無駄になる作業を、Devinに続けさせないため。
- 根拠: PR #91・#92・#93、Issue #48・#73・#79
- 選択肢:
  - A) AWSかPostgresに関わるPR #91（環境と監視）・#92（DB変更の仕組み）と、Issue #48・#50・#73・#79は止める。画面の共通部分（#93）は基盤に関わらないので続ける
    - 利点: D1とwranglerで作り直す作業を止めつつ、画面は進められる
    - 欠点: #93のうち、ログインの状態の入れ物はログインの方式が決まってから直すことがある
  - B) 決まるまで全部止める
    - 利点: 作り直しが出ない
    - 欠点: 画面の作業まで止まる
- 推奨: A（#92はPostgres向けのdrizzle-kitの仕組みで、D1では作り直しになる。#93は基盤に関わらない）

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

### D1で、グループの書き込みの決まりをどう守るか

<!-- id: cf-write-rules -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: D1にすると、ADR-0002の決定3（最初にグループの行を`FOR SHARE`でロックし、1つのトランザクションで書く）がそのままでは書けない。データモデルの直し方がこれで決まる。
- 根拠: ADR-0002の決定3、`docs/data-model.md`の書き込みの順番、https://developers.cloudflare.com/d1/worker-api/d1-database/ 、https://developers.cloudflare.com/d1/platform/limits
- 選択肢:
  - A) 先に読んで判断し、書き込みは`batch()`でまとめて流す。各文に「グループが有効」「申込がまだその状態」などの条件を付け、条件が外れて1件も変わらなければ、まとめて取り消して断る
    - 利点: D1は1つのDBで1度に1つの処理しかしないので、`batch()`の中にほかの書き込みは割り込まない。解散と同時の書き込みも、条件で断れる。いまの決まりに近い形で書ける
    - 欠点: 読んでから書くまでのあいだに状態が変わると、条件で断ることになり、利用者には「もう一度」を出す。条件を付け忘れる誤りは試験で見つける
  - B) グループごとにDurable Objectを1つ置き、そのグループの書き込みはすべてそれを通して1本ずつ処理する
    - 利点: 途中で判断を挟む書き方を、Durable Objectの中でそのまま書ける
    - 欠点: 読み取りと書き込みの通り道が2つになり、作りが大きくなる。DBもD1とDurable Objectの中のSQLiteに分かれるおそれがある
  - C) 条件は付けず、解散や退会と同時に来た書き込みの取りこぼしは許す
    - 利点: 作りがいちばん単純
    - 欠点: 解散したグループに行が残るなど、データモデルの決まりが崩れる。AGENTS.mdの「データの消失」の決まりに当たる
- 推奨: A（D1の1度に1つの処理と`batch()`の全部か何もしないかで、ロックと同じ結果を得られる。作りは大きくならない）

### アーキテクチャ設計から、どこまでやり直すか

<!-- id: cf-redo-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 書き直す設計資料の範囲で、次のPRの大きさと、Devinに渡す実装計画の作り直しが決まる。
- 根拠: 工程1〜6の設計資料（`docs/`）、ADR-0001〜0007、最初の1本の要件定義書・設計書・実装計画
- 選択肢:
  - A) アーキテクチャ（`docs/architecture.md`）を書き直し、ADR-0008にまとめる。データモデルはD1で変わるところ（型、書き込みの順番、スキーマの分け方。SQLiteにはスキーマが無いので表の名前の頭に文脈の名前を付ける）だけ直す。PR/FAQ、用語集、文脈、ユーザーストーリー、API設計（Hono）はそのまま使う
    - 利点: 決めてある何ができるかと画面・APIは変えず、基盤だけ替えられる
    - 欠点: 最初の1本の設計書の直しと、実装計画の作り直しが要る
  - B) データモデルの工程（工程3）から作り直す
    - 利点: D1に合わせて、表の数や分け方から見直せる
    - 欠点: 決めた28の表の決まりを最初から見直すので、時間がかかる
  - C) 「世に出さない個人開発」に合わせて、PR/FAQの作る範囲から見直す
    - 利点: 作る量を減らせる
    - 欠点: いまの依頼の範囲を越える。決めたユーザーストーリーを選び直す
- 推奨: A（Honoを含めAPIの形は変わらず、変わるのは置き場所とDBの書き方なので、そこだけ直せば足りる）
