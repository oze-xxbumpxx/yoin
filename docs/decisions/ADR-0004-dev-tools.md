# ADR-0004開発の道具

- 状態：提案（2026-11-17）。道具は2026-11-17に大関が問いのページで選んだ。承認はこのPRのマージで残す
- 決めた人：大関
- 関連：[ADR-0002](ADR-0002-schema-and-functions.md)、[ADR-0003](ADR-0003-layers-in-contexts.md)、[AWS構成](../architecture.md)、[論点の記録](../discussions/dev-tools.md)

## 背景

工程3でデータモデルとLambdaの分け方を、ADR-0003で文脈の中の層の分け方を決めた。実装は最初から、土台（IaC・CI・デプロイ・Cognito・Web Push）も含めてDevinに委譲する。そのため、使う道具を委譲の前に決め切る（`AGENTS.md`「進め方の決まり」）。

道具を選ぶときの条件は次のとおり。

- Lambdaは3つで、どれも呼ばれたときだけ動き、Neonにはその都度つなぐ（ADR-0002の決定5、AWS構成のA-1）。
- 書き込みは1つのトランザクションで、最初に`FOR SHARE`でロックし、結果を見て続きを決める（ADR-0002の決定3）。
- スキーマは文脈ごとに6つで、複合外部キーと部分一意インデックスを使う（データモデル）。
- 画面はCloudFrontとS3に置く静的なPWAで、iPhoneのホーム画面でWeb Pushを受ける（AWS構成のB-1）。
- migrationはデプロイの流れに入れ、手で流す手順は作らない（`AGENTS.md`）。

## 決定

使う技術の全体は次の図のとおり。

![yoinで使う技術](../images/tech-stack.svg)

### 1.言語は、LambdaもPWAもTypeScriptにする

LambdaはNode.jsで動かす。Node.jsの版は、Lambdaで使えるLTSのうち最新のものにし、最初の委譲の前にAWSのランタイムの一覧で確かめる。APIの入力と出力の型は、画面とLambdaで共有する。

### 2. DBの読み書きはDrizzle ORMにする

- テーブルは文脈ごとに`pgSchema`で定義し、定義のファイルはその文脈の`infrastructure/`に置く（ADR-0003）。
- ロックは`select().for('share')`のように型つきで書く。SQLの文字列を直接書くのは、Drizzleで表せないときだけにし、PRの説明に理由を書く。
- マイグレーションはdrizzle-kitでSQLのファイルを作り、リポジトリに入れる。作ったSQLは、PRのレビューで中身を読む（`AGENTS.md`の「必ず見る」の「DBの表とmigration」）。
- 同じ文脈の中の外部キーは、Drizzleのテーブル定義に書く。文脈をまたぐ外部キー（ADR-0002の決定2。例：`attendance.attendances.concert_id`から`catalog.concerts.id`へのRESTRICT）は、テーブル定義に書かず、drizzle-kitの手書きのマイグレーション（`drizzle-kit generate --custom`）にSQLで書く。Drizzleで外部キーを書くには参照先のテーブル定義をimportする必要があり、それは決定6の検査が止める依存だからである。
- drizzle-kitの設定は、各文脈の`infrastructure/`のテーブル定義をファイルの場所で集める。設定とマイグレーションのファイルは`src/contexts/`の外に置き、実行時のコードからはimportしない。

### 3.マイグレーションは、GitHub Actionsのデプロイで先に流す

`main`へのマージで動くデプロイの仕事を、次の順にする。どこかで失敗したら、そこで止まる。

1. 試験とビルド（Lambdaのコードをまとめ、PWAを静的なファイルにする）
2. マイグレーション（Neonの直接の接続で`drizzle-kit migrate`）
3. Terraformで資源とLambdaを更新する
4. PWAのファイルをS3に置き、CloudFrontのキャッシュを消す

- GitHub ActionsからAWSへは、GitHubのOIDCで一時的な権限を受けて入る。長期の鍵はGitHubに置かない。
- Neonの接続文字列は、SSM Parameter Storeから読む（AWS構成のC-1）。GitHubのSecretsには置かない。直接の接続（マイグレーション用）とプールを通す接続（Lambda用）の2つをSSMに置く。
- マイグレーションを先に流すので、マイグレーションは前の版のLambdaでも動く形にする。列や表を消すときは、使わなくするデプロイと消すデプロイを分ける。
- デプロイの仕事は、環境ごとに1本ずつ動かす（GitHub Actionsの`concurrency`。`cancel-in-progress`はfalse）。2つのマージが続いても、先のデプロイが手順4まで終わってから次の手順2が始まる。動いている途中のデプロイは取り消さない。待っている古い実行は新しい実行に置き換わり、新しい実行は`main`の先頭を使うので、古い版が後から出ることはない。

### 4. LambdaからNeonへは、サーバーレスドライバーのPoolでつなぐ

`@neondatabase/serverless`の`Pool`をWebSocketでつなぎ、Drizzleの`neon-serverless`のつなぎ方で使う。接続はプールを通す接続文字列にし、要求ごとにつないで、終わったら切る（AWS構成のA-1）。HTTPで1回ずつ送る`neon()`は、途中で判断を挟めないので使わない。

### 5. IaCはTerraformにする

- AWSの資源（Lambda、API Gateway、Cognito、EventBridge Scheduler、S3、CloudFront、IAM、SSMのパラメーターの枠）をTerraformで書く。
- 状態ファイルは、東京リージョンのS3のバケットに置き、同じバケットのロックファイルで同時の実行を防ぐ。このバケットとGitHubのOIDCの設定は、最初に1回だけ作る小さなTerraformの構成で作る。
- Lambdaのコードは、手順1でまとめたファイルをTerraformが受け取って更新する。
- Neonのプロジェクトと、SSMに入れる秘密の値は、Terraformでは作らない。Neonのプロジェクトは数が少なく変えることもまれなので、手で作る。秘密の値を状態ファイルに残さないため、値はTerraformの外で入れる。

### 6.文脈の境目は、ESLintのプラグインで検査する

eslint-plugin-boundariesで、ADR-0003の決定5の2つを書く。lintはCIとエディタの両方で動く。Drizzleのテーブル定義はTypeScriptの値なので、ほかの文脈の`infrastructure/`をimportした時点でこの検査が止める。文脈をまたぐ外部キーはSQLのマイグレーションに書くので（決定2）、この検査の例外は作らない。SQLの文字列でほかの文脈の表を読むことは検査で止められないので、レビューで見る。

### 7. PWAはReactとViteで作る

静的なファイルを出してS3に置く。Service Workerはvite-plugin-pwaで作り、Web Pushを受ける部分は自分で書く。画面の移り方やデータの取り方の道具は、最初の1本の設計で決める。

### 8.そのほかの道具

| 用途 | 道具 |
|---|---|
| パッケージの管理 | pnpm（workspace） |
| 単体と結合の試験 | Vitest |
| E2E | Playwright。2人をブラウザのcontext 2つで動かす |
| lintと整形 | ESLintとPrettier |
| CIとデプロイ | GitHub Actions |

## 検討した案

選んだ理由と選ばなかった理由は、問いごとに[論点の記録](../discussions/dev-tools.md)に残した。ここには、決定どうしのつながりで決まったことだけを書く。

### IaCをAWS CDKにする

アプリと同じTypeScriptで書け、Lambdaのビルドも任せられる。推奨はこの案だったが、大関がTerraformを選んだ。Terraformでは、Lambdaのビルドをデプロイの手順1で別に行い、状態ファイルの置き場所を最初に作る。

### Neonの接続文字列をGitHubのSecretsに置く

マイグレーションの手順は短くなる。しかし、秘密の値の置き場所が2つになり、Neonのパスワードを変えたときに両方を直す必要がある。OIDCでAWSに入れば、SSMから読める。

## 結果

### よくなること

- 言語がTypeScriptの1つにそろい、APIの型を画面と共有できる。
- 文脈ごとのスキーマ、ロック、境目の検査が、Drizzleのテーブル定義を中心につながる。
- デプロイの順番が1本の仕事で読め、マイグレーションが失敗したら新しいLambdaを出さない。
- 秘密の値はSSMの1か所に置き、GitHubにもTerraformの状態ファイルにも残さない。

### 引き受けること

- Terraformの状態ファイルのバケットと、GitHubのOIDCの設定を、最初に1回作る必要がある。
- Lambdaのビルドを、Terraformの外の手順で用意する必要がある。
- サーバーレスドライバーはNeon専用なので、ほかのPostgresへ移るときは接続の部分を差し替える。
- drizzle-kitが作るマイグレーションのSQLを、毎回読む必要がある。
- マイグレーションを先に流すので、表を壊す変更は2回のデプロイに分ける。

## この決定では決めないこと

- 画面の移り方やデータの取り方の道具（最初の1本の設計で決める）
- 監視とアラートの範囲（工程6）
- Neonのリージョンと、無料枠に収まるか（工程6）
- Neonのブランチを試験に使うか（工程5以降）
