# 実装計画: 招待からリマインドがiPhoneに届くまで

AWS向けの設定を片づけ、手元のVoidでパスキーとCronを確かめてから、招待から通知までを作る。本番はCloudflareの無料プランに1つだけ置く。

- 根拠: [設計書](../designs/first-slice.md)（[PR #100](https://github.com/oze-xxbumpxx/yoin/pull/100)で承認）、[要件定義](../requirements/first-slice.md)、[ADR-0008](../decisions/ADR-0008-cloudflare.md)
- 試験: [試験計画](../tests/first-slice.md)
- 変更レベル: L3。大関さんがこの計画をマージしてから、実装をタスクごとにDevinに渡す。

14画面、本体D1と送信記録用D1、Better Auth、1分ごとのCron、2人のE2Eを作る。R2、Queues、独自ドメイン、結合検証の環境は作らない。
グループの切替・退会・解散、ツアー、公演編集、分配、参戦、グッズはこの回に含めない。

## 渡す順番と担当ファイル

「先に要る」は、作業を始める前にmainへ入っているタスク。依存がなく、担当ファイルも重ならないものだけを別のクローンで並行して渡す。
以下の画面パスは既存の`apps/web/`を起点とする。Voidの雛形に合わせる必要があれば「Voidの試作」で置き場所を記録し、後続タスクのパスを揃えてから渡す。
委譲コマンドには、各見出しの横に示した小文字の名前を`first-slice:<タスク名>`の形で渡す。

| タスク | 主に触るファイル | 先に要る | SWE-2.1 effort | 受け持つ試験 | 人が必ず見る範囲 |
|---|---|---|---|---|---|
| AWSの片づけとCI | `.github/workflows/ci.yml`、`infra/terraform/`、`scripts/`と`scripts/tests/`のAWS向けファイル、`tests/ci/`の対応試験、`package.json`、`pnpm-lock.yaml`、`apps/web/vite.config.ts` | なし | medium | C01 | 削除範囲、残る検査、CIの権限 |
| CLIの通信を止める | `docs/agents/command-scope.md` | なし | medium | C02 | CLIの版、通信を止める根拠 |
| Voidの試作 | `docs/implementation-plans/first-slice.md`、`docs/reviews/first-slice-void-spike.md` | CLIの通信を止める | medium | C03 | 登録前の確認、Cookie、Cronの起動結果 |
| VoidとD1の準備 | `void.config.ts`、`void.lock.json`、`package.json`、`pnpm-lock.yaml`、`vitest.config.ts`、`apps/web/vite.config.ts`、Voidが生成するマイグレーションの置き場所 | AWSの片づけとCI、Voidの試作 | high | C04 | D1の分離、適用順、資源名とsecret名 |
| 画面の共通部分 | `apps/web/index.html`、`apps/web/public/`、`apps/web/src/{app,styles,components}/`、`apps/web/tests/app/` | VoidとD1の準備 | high | W01 | Cookieを使う通信、利用者交代、通知からの戻り先 |
| 登録と招待 | `routes/{auth,setup,invites,me,groups}/`、`src/contexts/group/`と対応試験、`apps/web/src/features/join/`、マイグレーション | 画面の共通部分 | high | A01–A04、W02、H01–H02、C06 | パスキー、札、認可、招待・オーナーの書き込み |
| アカウントを戻す | `routes/{auth,setup,recovery,groups}/`、`src/contexts/group/`と対応試験、`apps/web/src/features/recovery/`、マイグレーション | 登録と招待 | high | A05–A06、H09、C06 | 古い鍵・セッションの失効、2つのD1への書き込み順 |
| 公演を下書きから確定 | `routes/groups/`の公演・下書き・選択用一覧、`src/contexts/catalog/`と対応試験、`apps/web/src/features/concert/`、マイグレーション | アカウントを戻す | high | A07、W03、C06 | 下書きの所有者、別グループの資源、確定時のSQL |
| 申込とリマインド予約 | `routes/groups/`の申込、`src/contexts/{ticket,notification}/`と対応試験、`apps/web/src/features/{ticket,home}/`、マイグレーション | 公演を下書きから確定 | high | A08、W04–W05、N01–N03、H10–H11、C06 | 申込の認可、状態遷移、申込と予約を同時に書くSQL |
| 通知先とCron | `routes/me/`の購読、`crons/first-slice.ts`、`src/contexts/notification/`と対応試験、`apps/web/src/features/push/`、`apps/web/src/service-worker.ts`、マイグレーション | 申込とリマインド予約 | high | A09、W06、N04–N08、H03–H08、C06 | 送信先、個人情報、引き受けと再送、送れた記録、登録途中の片づけ |
| D1を戻したあとの突き合わせ | `crons/first-slice.ts`、`routes/groups/`の保留、`routes/auth/`と共通の認証処理、`src/contexts/{group,notification}/`と対応試験、`apps/web/src/features/held-reminders/`、マイグレーション | 通知先とCron | high | A10、D01–D04、C06 | 再開までの締め出し、鍵の失効、保留後の送信 |
| 2人のE2E | `playwright.config.ts`、`tests/e2e/first-slice/`、`tests/support/first-slice/`、`package.json`と`pnpm-lock.yaml` | D1を戻したあとの突き合わせ | high | X01–X02 | 試験専用の認証器とPushの受け手が製品に入らないこと |
| 変更を確かめる道具 | `.claude/skills/verify-first-slice/`、`.agents/skills/verify-first-slice` | 2人のE2E | medium | X03 | 実行先、使うデータ、結果の残し方 |
| PRの試験と本番配置 | `.github/workflows/{ci,deploy}.yml`、`tests/ci/`の配置試験 | 2人のE2E | high | C05 | PRとmainの権限差、デプロイ時のSQL、無料プラン |

機能ごとにマイグレーションを足す作業は直列にする。後続は最新のmainからブランチを切り、両方の手元のD1に必要なSQLを適用してから試験する。 製品のSQLを足す各タスクは、追加するSQLで試験（C06）を行う。
試験コードは各workspaceの`tests/`に置く。実装ファイルの構成に合わせ、Vitestの実行対象に入ったことを確かめる。

## 各タスクで作るものと終わりの条件

<!-- delegation-task:remove-aws-ci -->
### AWSの片づけとCI（`remove-aws-ci`）

- 主に触るファイル: `.github/workflows/ci.yml`、`infra/terraform/`、`scripts/`と`scripts/tests/`のAWS向けファイル、`tests/ci/`の対応試験、`package.json`、`pnpm-lock.yaml`、`apps/web/vite.config.ts`
- 受け持つ試験: C01

最初の片づけはアプリを変更しない検査専用のPRにする。`infra/terraform/`、AWS向けの構築・配置スクリプト、その専用試験と参照を消す。

| 対象 | 外すもの |
|---|---|
| `scripts/` | `bootstrap-ssm.ts`、`build-lambda.ts`、`package-release.sh`、旧成果物専用の`sha256.sh` |
| `scripts/tests/`、`tests/ci/` | `bootstrap-ssm.test.ts`、`release.test.ts`、旧構成を前提とする試験データ |
| `.github/workflows/ci.yml` | Lambda・旧認証と配置成果物の検査 |
| `package.json`、`pnpm-lock.yaml`、`apps/web/vite.config.ts` | AWS SDK、Lambdaのスクリプト、旧本番設定の参照 |

AWSに接続しない。残す検査を一覧にし、AWSを呼ぶ参照が無く、品質確認が通れば完了とする。
文脈の境界、品質スクリプト、試験用のコードや値が製品に入らないことを確かめる検査は残す。出力先に依存する検査は、Voidの出力先が決まってからつなぎ直す。
<!-- /delegation-task -->

<!-- delegation-task:disable-cli-telemetry -->
### CLIの通信を止める（`disable-cli-telemetry`）

- 主に触るファイル: `docs/agents/command-scope.md`
- 受け持つ試験: C02

Voidとcf CLIは起動せず、配布物と説明から利用状況の送信を止める方法を調べる。`docs/agents/command-scope.md`の変更は、CLIを初めて動かす作業より前に別のPRで承認を得る。
止め方がわからなければCLIを動かさず、わからない点を大関さんに渡す。
<!-- /delegation-task -->

<!-- delegation-task:void-spike -->
### Voidの試作（`void-spike`）

- 主に触るファイル: `docs/implementation-plans/first-slice.md`、`docs/reviews/first-slice-void-spike.md`
- 受け持つ試験: C03

最初にVoidを使う作業は、捨てられる手元の試作に限る。採用する版で次の3点を試し、版・操作・結果を残す。製品コードに試作は入れない。

| 確かめること | 終わりの条件 |
|---|---|
| セッションなしのパスキー登録 | 札のある人だけ登録でき、札が無い人はユーザーを作る前に断られる。設定でできなければ、設計の札付きセッション案を比べる |
| Cookieの`Domain` | 実際の`Set-Cookie`で`Domain`なしと`__Host-`の属性を確かめる。設定できなければ、設計にある同じアカウントに他のWorkerを置かない案を大関さんに渡す |
| Cronの置き場所 | `crons/`に置いた受け手が、手元でスケジュールイベントを受けてローカルD1に書ける |

画面とマイグレーションの置き場所を雛形から決め、この計画のパスを更新する。3点のうち満たせないものは結果と候補を示し、設計を変える場合は大関さんの判断を待つ。
パスキーの確かめとPushの暗号に使うCPU時間は、要件のとおり製品の実装前に大関さんが手元で計る。計測の条件と結果を残し、10ミリ秒に収まらなければ送る台数を見直す。それでも収まらなければ費用の方針を大関さんに聞く。
<!-- /delegation-task -->

<!-- delegation-task:void-d1-setup -->
### VoidとD1の準備（`void-d1-setup`）

- 主に触るファイル: `void.config.ts`、`void.lock.json`、`package.json`、`pnpm-lock.yaml`、`vitest.config.ts`、`apps/web/vite.config.ts`、Voidが生成するマイグレーションの置き場所
- 受け持つ試験: C04

Workerは`yoin`1つ。本体D1は`yoin`（`apac`）、送信記録用D1は`yoin-send-log`に分ける。設定にsecretの値を書かない。
試作で決めた場所にDBごとのSQLを置き、CIが使う手元の起動と移行のコマンドを用意する。表の定義は順に各文脈へ足す。
試験専用のSQLを、空の手元のD1に適用する。適用済みのD1では同じSQLを二重に流さないことを確かめる。
<!-- /delegation-task -->

<!-- delegation-task:web-foundation -->
### 画面の共通部分（`web-foundation`）

- 主に触るファイル: `apps/web/index.html`、`apps/web/public/`、`apps/web/src/{app,styles,components}/`、`apps/web/tests/app/`
- 受け持つ試験: W01

PWAの名前・アイコン、明暗、ルーターを揃える。画面の通信は`void/client`を使う。ログイン情報はBetter AuthのCookieで扱い、利用者が替わるときは旧通信とキャッシュを消す。
通知の戻り先は同じアプリの申込に限る。前の人の応答や下書きが次の人に出なければ完了とする。Bearer認証の実装は引き継がない。
<!-- /delegation-task -->

<!-- delegation-task:setup-and-invites -->
### 登録と招待（`setup-and-invites`）

- 主に触るファイル: `routes/{auth,setup,invites,me,groups}/`、`src/contexts/group/`と対応試験、`apps/web/src/features/join/`、マイグレーション
- 受け持つ試験: A01–A04、W02、H01–H02、C06

はじめの登録と招待にだけ、登録用の札を出す。札は10分だけ使え、ほかのAPIは呼べない。パスキーだけを登録してもアプリのユーザーは作らない。
合言葉の上限、招待の最後の1枠、はじめのオーナーの同時登録を確かめる。条件が外れたらD1の書き込みをまとめて戻し、その回で作った認証情報を片づける。
申込などで使うセッション・所属の確認もここで用意する。所属とグループの状態は、書き込みの`batch()`の先頭でも確かめる。
<!-- /delegation-task -->

<!-- delegation-task:account-recovery -->
### アカウントを戻す（`account-recovery`）

- 主に触るファイル: `routes/{auth,setup,recovery,groups}/`、`src/contexts/group/`と対応試験、`apps/web/src/features/recovery/`、マイグレーション
- 受け持つ試験: A05–A06、H09、C06

メンバーの戻すリンクと、合言葉を使うオーナー本人の戻し方を作る。どちらも元のユーザーに新しい鍵を足し、パスキーの登録要求の中で確定する。
古い鍵とセッションを無効にする記録は本体の外に残す。本体と記録用D1をまたぐ書き込みは1つの`batch()`だと扱わない。
失効記録を書いたあと本体で確定できずに止まった回を、戻したあとにどう扱うかは、実装の前に大関さんに確かめる。
確定の前で止まった鍵ではアプリを使えず、リンクの出し直しとCronで片づけられることを確かめる。Cronの呼び出しは「通知先とCron」でつなぐ。
<!-- /delegation-task -->

<!-- delegation-task:concerts -->
### 公演を下書きから確定（`concerts`）

- 主に触るファイル: `routes/groups/`の公演・下書き・選択用一覧、`src/contexts/catalog/`と対応試験、`apps/web/src/features/concert/`、マイグレーション
- 受け持つ試験: A07、W03、C06

単発の公演1件を下書きにして、会場とアーティストを選ぶか新しく入力し、公演として確定する。
一覧と詳細に出ること、別グループの資源を使えないこと、作った人だけが下書きを書き換えられることを確かめる。
<!-- /delegation-task -->

<!-- delegation-task:tickets-and-reminders -->
### 申込とリマインド予約（`tickets-and-reminders`）

- 主に触るファイル: `routes/groups/`の申込、`src/contexts/{ticket,notification}/`と対応試験、`apps/web/src/features/{ticket,home}/`、マイグレーション
- 受け持つ試験: A08、W04–W05、N01–N03、H10–H11、C06

申込の作成・編集・状態変更・削除の4本で、同じ関数を使って予約を合わせる。申込と予約は1つのD1の`batch()`で書く。
日付、申込の状態、次の期限、券の表示を作る。他人の申込を読むときは、本人だけに見せる結果を返さない。試験で4本すべての書き込みと競合を確かめる。
<!-- /delegation-task -->

<!-- delegation-task:push-and-cron -->
### 通知先とCron（`push-and-cron`）

- 主に触るファイル: `routes/me/`の購読、`crons/first-slice.ts`、`src/contexts/notification/`と対応試験、`apps/web/src/features/push/`、`apps/web/src/service-worker.ts`、マイグレーション
- 受け持つ試験: A09、W06、N04–N08、H03–H08、C06

購読とService Workerをつなぎ、Cronは期限前の予約を引き受けて送る。送れた記録は別のD1に先に書く。再送は送れていない端末だけにする。
登録途中の認証情報（N08）、使用済みのリンク、古い送信・失効記録も設計どおりに片づける。失敗は本人だけに示す。手元のPushの受け手で回数と中身を確かめる。
引き受け3件・端末5台は仮の上限である。試作の計測を踏まえ、送信の試験で上限に達した回の続きを確かめる。
<!-- /delegation-task -->

<!-- delegation-task:d1-reconciliation -->
### D1を戻したあとの突き合わせ（`d1-reconciliation`）

- 主に触るファイル: `crons/first-slice.ts`、`routes/groups/`の保留、`routes/auth/`と共通の認証処理、`src/contexts/{group,notification}/`と対応試験、`apps/web/src/features/held-reminders/`、マイグレーション
- 受け持つ試験: A10、D01–D04、C06

停止中はログイン・APIを503にし、Cronの送信も止める。再開後は失効記録を先に当て直し、次に送れた端末と保留する予約を分ける。
大関さんが本番で戻す手順と、手元のD1だけで試す手順を分ける。途中停止・2回目の戻し・オーナーの送信または取り消しを試し、再送対象が増えなければ完了とする。
<!-- /delegation-task -->

<!-- delegation-task:two-user-e2e -->
### 2人のE2E（`two-user-e2e`）

- 主に触るファイル: `playwright.config.ts`、`tests/e2e/first-slice/`、`tests/support/first-slice/`、`package.json`と`pnpm-lock.yaml`
- 受け持つ試験: X01–X02

手元のVoidサーバーでPlaywrightを動かす。Chromiumの2つのcontextで別々の仮の認証器を使う。オーナーの登録から、2人目の参加、公演、受取済みまでを通す。
ログアウトして別の人で入り直す試験と、Pushの送信先・中身・回数の試験も入れる。試験用の受け手は製品に含めない。
<!-- /delegation-task -->

<!-- delegation-task:verify-first-slice -->
### 変更を確かめる道具（`verify-first-slice`）

- 主に触るファイル: `.claude/skills/verify-first-slice/`、`.agents/skills/verify-first-slice`
- 受け持つ試験: X03

`verify-first-slice`に、手元のD1に試験データを用意し、Voidの開発サーバーで2人のE2Eを通す手順を書く。
起動・試験・後片づけのコマンド、観点ID、残す結果の場所を記す。ローカル以外を使わず、別の人が手順を読んで同じ結果を得られれば完了とする。
<!-- /delegation-task -->

<!-- delegation-task:ci-and-deploy -->
### PRの試験と本番配置（`ci-and-deploy`）

- 主に触るファイル: `.github/workflows/{ci,deploy}.yml`、`tests/ci/`の配置試験
- 受け持つ試験: C05

アプリと別のPRで、型チェック、lint、Vitest、fast-check、手元のD1への移行とPlaywrightをCIにつなぐ。PRの試験に本番の権限は渡さない。
`main`へのマージで、試験後に`void deploy`がSQLを適用して配置する。GitHubのSecretsには`CLOUDFLARE_API_TOKEN`、公開変数には`VAPID_PUBLIC_KEY`を使う。
手元の試験で失敗時に配置へ進まないことを確かめる。実際の配置は大関さんの準備と承認を待つ。
<!-- /delegation-task -->

## 本番に出す人と戻す人

大関さんがworkers.devの名前を決め、設計書の資源表に記録する。名前は初回配置後に変えない。大関さんがsecretを置き、配置を始めるPRのマージで承認する。
本番の試験も大関さんが行う。最初の登録とオーナーを戻したあとは、大関さんが合言葉を替える。

マージ前の不具合は、そのPRで直すか取り下げる。本番のSQLに誤りがあれば、大関さんが設計の手順で停止し、本体のD1だけを戻す。停止時刻が記録されたことを確かめてから戻す。
送信・失効記録用D1は戻さない。手でSQLを流さず、突き合わせが終わるまで再開しない。

## 設計の要件と担当

設計の要件表の各行を、実装タスクと試験に対応させる。個々の受け入れ条件と境界の試験は[試験計画](../tests/first-slice.md)に置く。

| 設計書の節 | 要件 | 担当タスク・試験 |
|---|---|---|
| 変更後構成・移行とリリース | F-01〜F-04、F-01a | VoidとD1の準備、登録と招待、PRの試験と本番配置（C04–C05、H01） |
| ログインとユーザーを作る入口 | F-03、F-05〜F-08、F-05a、F-05b、F-10、F-11、E-02、E-16、E-19〜E-21、B-13、B-14 | Voidの試作、登録と招待、アカウントを戻す、通知先とCron（C03、A01–A06、N08、W01–W02、H01–H02、H09） |
| API設計・DB設計 | F-07、F-09、F-13、F-14、F-19〜F-24、F-26〜F-33、F-36a、F-39〜F-41、E-01〜E-08、E-14、E-15、E-18、E-22、B-08、B-09、B-11、B-12 | 登録と招待からD1を戻したあとの突き合わせまで（A01–A10、N01–N03、D01–D04） |
| フロントエンド設計 | F-06、F-08、F-11〜F-18（F-17aを含む）、F-22〜F-28、F-30〜F-32、F-37b〜F-48、E-09、E-15〜E-17、B-05〜B-07、B-11 | 画面の共通部分、登録と招待、公演を下書きから確定、申込とリマインド予約、通知先とCron（W01–W06、H02、H07–H08、H10–H11） |
| リマインドの送り方 | F-27〜F-37（F-37aを含む）、E-05〜E-08、E-10〜E-13、B-01〜B-05、B-10 | 申込とリマインド予約、通知先とCron（A08、N01–N07、W04、H03–H06） |
| D1を過去の時点に戻したとき | F-36a、E-22 | D1を戻したあとの突き合わせ（A10、D01–D04） |
| エラー処理・ログと監視・性能 | F-04、F-36、E-10〜E-12、E-16、非機能要件 | VoidとD1の準備、通知先とCron、PRの試験と本番配置（C04–C05、A01、N04–N07、W02） |
| テスト方針 | F-49、F-50、AC-01〜AC-12 | 2人のE2E、変更を確かめる道具、PRの試験と本番配置、大関さんの本番試験（X01–X03、H01–H11。自動試験の内訳は試験計画を参照） |

## 前のIssueとPRの引き継ぎ先

以前のIssueを閉じるか、作り直すかは大関さんが決める。この計画では閉じない。

| 前のIssue・PR | 新しい担当 | 引き継ぐもの |
|---|---|---|
| [#51](https://github.com/oze-xxbumpxx/yoin/issues/51)、[PR #93](https://github.com/oze-xxbumpxx/yoin/pull/93) | 画面の共通部分 | 明暗、PWAの見た目、通信とキャッシュの分離、戻り先。認証はBetter AuthのCookieに替える |
| [#57](https://github.com/oze-xxbumpxx/yoin/issues/57) | 公演を下書きから確定 | 下書き、確定、一覧と詳細。書き込みはD1に替える |
| [#63](https://github.com/oze-xxbumpxx/yoin/issues/63) | 申込とリマインド予約 | 申込と状態変更。D1で予約も同時に合わせる |
| [#70](https://github.com/oze-xxbumpxx/yoin/issues/70) | 変更を確かめる道具 | 手元のVoidで登録と招待を確かめる |
| [#71](https://github.com/oze-xxbumpxx/yoin/issues/71) | 2人のE2E | 2人を別々のcontextで操作する。ログインは仮の認証器を使う |
| [#72](https://github.com/oze-xxbumpxx/yoin/issues/72) | 変更を確かめる道具 | 2人のE2Eを通す手順 |
