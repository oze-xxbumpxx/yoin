# 最初の1本: Voidとcf CLIの利用状況の送信

調べたcf CLIの版では、`CF_SEND_TELEMETRY=false`で利用状況の送信を止められる。Void自身の止め方は確認できなかったため、Voidは起動しない。

## 調べた版（C02）

2026-11-28にnpmの`dist-tags`と`versions`を調べた。指定した版の配布物を`npm pack --ignore-scripts`で取得し、展開したファイルと公開資料を読んだ。CLIもインストール時のスクリプトも動かしていない。

| 配布物 | 選んだ理由 |
|---|---|
| [`void@1.12.2`](https://registry.npmjs.org/void/-/void-1.12.2.tgz) | npmの`latest`で、プレリリースを除いた最新版。計画前に調べた版と同じ |
| [`cf@1.0.0-rc.6`](https://registry.npmjs.org/cf/-/cf-1.0.0-rc.6.tgz) | npmの`latest`。安定版ではなく、ADR-0008に挙がっていたリリース候補 |
| [`cf@0.15.0`](https://registry.npmjs.org/cf/-/cf-0.15.0.tgz) | プレリリースを除いた最新版。ただし配布物の`README.md:5`は技術プレビューと明記 |
| [`cf@1.0.0-rc.5`](https://registry.npmjs.org/cf/-/cf-1.0.0-rc.5.tgz) | Voidが使う版。Voidの配布物の`package.json:368`で固定 |

## cfは最初の起動より前に環境変数で止める

`cf@1.0.0-rc.6`の`dist/run-Ckj3YtjV.mjs:2`は、`CF_SEND_TELEMETRY`の文字列`false`を無効と判定する。同じ行の送信処理は、有効なときだけ`https://sparrow.cloudflare.com/api/v1/event`へPOSTする。コマンド開始・終了は同じ行、ヘルプ表示と引数の解釈に失敗したときは`dist/src-DbCHS1d1.mjs:130`から送信処理を呼ぶ。

[rc.6の利用状況の説明](https://github.com/cloudflare/cf/blob/60e23d356d6a0a4e1ede5bb9f60e5e761e51f443/packages/cli/telemetry.md#how-can-i-configure-cf-telemetry)にも、起動ごとの`CF_SEND_TELEMETRY=false`が載っている。この版では`DO_NOT_TRACK=1`（または`true`）が最優先で、次に`CF_SEND_TELEMETRY`、`WRANGLER_SEND_METRICS`、端末に保存した設定の順に読む（[設定のコード](https://github.com/cloudflare/cf/blob/60e23d356d6a0a4e1ede5bb9f60e5e761e51f443/packages/cli/src/lib/telemetry/config.ts#L23-L94)）。端末の設定を変える`cf cli telemetry disable`は、CLIを起動するため初回起動前の手順に使わない。

`cf@1.0.0-rc.5`も`dist/run-ChZroiuN.mjs:2`で同じ環境変数を読み、無効なら送らない。`cf@0.15.0`は`dist/config-B4vIa0zp.mjs:2`で`CF_SEND_TELEMETRY=false`を無効と判定する。この版の`dist/run-BBBMrSrs.mjs:2`で読んだコマンド用の送信処理は、デバッグ表示だけでPOSTしない。rc.6と同じ優先順や送信動作とは扱わない。

## Voidが呼ぶcfは止まるが、Void自身は未確認

`void@1.12.2`は、依存先の`cf@1.0.0-rc.5`を子プロセスで起動するときに`CF_SEND_TELEMETRY=false`を渡す。配布物の`dist/deploy-DtJeunLF.mjs:2693–2713`と`dist/cli/cloudflare-operation-process.mjs:290–322,341–345,372–382`で確かめた。[この版の子プロセスのソース](https://github.com/voidzero-dev/void/blob/18b83324a04d68d81f78c754f1e83e0d85d8f941/packages/void/src/cli/cf-version-runner.ts#L260-L288)にも同じ値がある。

Voidの配布物では`package.json:15–17`と`dist/cli/cli.mjs:82–87`からCLIの起動先をたどった。配布物の`dist/`と`docs/`、[公開ソース](https://github.com/voidzero-dev/void/tree/18b83324a04d68d81f78c754f1e83e0d85d8f941/packages/void/src/cli)、[CLIの説明](https://void.cloud/reference/cli)、[v1.12.2のリリースノート](https://github.com/voidzero-dev/void/releases/tag/v1.12.2)からは、Void自身の利用状況を送る経路も、それを止める環境変数、設定、フラグも確認できなかった。送信がないと確認したわけではない。cfの環境変数をVoid自身に効くものとして扱わず、大関さんに未確認の点を渡す。Voidの試作は進めない。

cfで止めるのは利用状況の送信だけ。通常のAPI通信や、cfが起動する別のツールの通信は止めない。この調査は本番・結合検証・Cloudflareのアカウントへの接続を許すものではない。
