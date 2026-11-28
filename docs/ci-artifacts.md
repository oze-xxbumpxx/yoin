# CIが確かめること

GitHubの必須チェックは`Quality`です。PRではmainと合わせたコミットを、mainへのpushではそのコミットを検査します。どちらも、チェックアウトしたSHAがGitHubの指定と一致することを確かめます。

## すべてのPRで動く検査

- `pnpm install --frozen-lockfile`で、ロックファイルどおりに依存を入れます。
- 品質確認に必要なスクリプトがあることを確かめます。ハーネス、lint、型チェック、Vitestを実行します。Vitestには、文脈の境界と、試験用のコードや値を製品に入れないための試験も含みます。
- `apps/web/index.html`があるので、PWAをビルドして`dist/pwa`を検査します。試験用のファイルや値、`.env`、鍵のファイルが製品出力に入っていないことを確かめます。試験用の値は、`tests/support/production-markers.json`に秘密ではない目印として列挙します。PWA以外も同じ一覧を使い、一覧がないか空なら検査は失敗します。

Viteは開発時もビルド時も`.env`や`VITE_*`の値を取り込みません。画面のビルドで`import.meta.env`から直接読めるのは、Viteが用意する`MODE`、`DEV`、`PROD`、`BASE_URL`、`SSR`だけです。

## 対象ができてから動く検査

マイグレーション検査（`check:migrations`）、結合試験（`test:integration`）、Playwrightは、対応するコマンドか設定があるときだけ動きます。対象がなければ、成功ではなく「未実行」と記録します。

PWA以外では、`.cloudflare/output/v1/workers/*/`、`dist/ssr/`、`dist/client/`を検査します。まだ出力がない場所は飛ばします。出力がある場所で試験用のファイルや値などが見つかれば、検査は失敗します。
