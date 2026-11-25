# CIが確かめた版を配置へ渡す

PRはmainと合わせたコミットを検査します。mainへのpushでは、そのコミットを検査します。GitHubの必須チェックに設定する名前は`Quality`です。

## 製品の試験を追加するとき

- 単体試験は各workspaceの`tests/`に置きます。Vitestが`*.test.*`と`*.spec.*`を探し、CIの出力に実行したファイルを表示します。
- DB変更のタスクは`check:migrations`をルートの`package.json`に追加します。DBを使う試験は`tests/integration/`に置き、`test:integration`で実行します。Neonと同じメジャー版の使い捨てPostgreSQLをランナーで立ち上げ、localhostだけを接続先にします。
- 2人の試験は`playwright.config.ts`と`tests/e2e/`を追加します。CIはPlaywrightで試験を列挙してから実行します。代替のAPI・メール・Pushと使い捨てDBだけを使い、配置用のファイルは書き換えません。
- 試験用の認証コードは`tests/support/`に置きます。試験の経路、JWTの発行者、鍵を識別する**秘密ではない**文字列を`tests/support/production-markers.json`に配列で列挙します。CIは製品ファイルにその文字列がないか調べます。ルートの`test:production-auth`はビルド済みの`dist/pwa`と`dist/lambda/api`を使い、製品が試験の入口を公開せず、試験JWTを拒むことを確かめます。
- 画面が`apps/web/index.html`に加わると、Viteは環境の値を取り込まずに`dist/pwa`を作ります。各Lambdaは`src/functions/<名前>/index.ts`から`dist/lambda/<名前>/index.mjs`を作ります。LambdaとPWAのメインバンドルでは、依存するモジュールに`tests/`以下がないことを確かめます。ViteはWeb Workerを別にビルドするため、最初のWeb Workerを追加するときは、その依存モジュールも検査に含めます。

まだ用意していない製品の検査は、成功とせず実行結果の概要に「未実行」と書きます。製品のビルドと試験がそろうまでは、配置用の成果物を出しません。

## 配置側が受け取るもの

mainの`CI`が成功した実行から、対象の完全SHAと同じ`head_sha`を持つ実行IDを選びます。その実行の`yoin-<完全SHA>`だけを取得し、`SHA`が対象の完全SHAと一致することを確かめます。成果物を展開した場所で`bash /path/to/yoin/scripts/sha256.sh -c SHA256SUMS`を実行し、中身も照合します。失敗した実行や別のSHAは使いません。

成果物の中身は`pwa/`、`lambda/{api,pre-sign-up,notification-sender}.zip`、`SHA`、`SHA256SUMS`です。結合検証と本番では同じ`pwa/`を使います。`config.json`はビルドや成果物に入れず、配置するときに各環境に置きます。
