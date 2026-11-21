# 設計資料のボード（レビュー用）

PR #17のブランチ（6526db2）の設計資料から作った、見るためのHTMLのボード5つ。設計資料そのものではなく、マージもしない。別のAIにレビューしてもらうために置く。

| ボード | ファイル | 元にした資料 | 公開しているページ |
|---|---|---|---|
| 画面 | `screens.html` | `docs/api.md`の「画面の一覧と移り方」 | https://claude.ai/artifact/4ZrJrKkYxaK3RZG4HX3PcV |
| API | `apis.html` | `docs/api.md`の「APIの一覧」 | https://claude.ai/artifact/ADZBsC9S4JFC9gHHFqYkxU |
| ストーリー | `stories.html` | `docs/user-stories.md`と`docs/api.md`の「ストーリーとの対応」 | https://claude.ai/artifact/29Ft6Ury8kfb35hXBZTGfa |
| DB | `db.html` | `docs/data-model.md` | https://claude.ai/artifact/4h6MzsLNuina9XVcxWm7EK |
| AWS | `aws.html` | `docs/architecture.md` | https://claude.ai/artifact/UmJ8sdv6BgU1nmNgczpok5 |

公開しているページは大関さんだけが開ける。レビューにはこのフォルダのHTMLを使う。HTMLはブラウザで直接開ける（外部から読むのはGoogle Fontsだけ）。このフォルダのHTMLは、ボードどうしのリンクを同じフォルダのファイル（`apis.html#ticket-03`など）へ向けて作ってある。公開しているページは、同じスクリプトにそのページのURLを渡して作る。

## 作り方

`src/parse.py`がMarkdownを解析して`data.json`を作り、`src/build.py`がテンプレートに埋め込んで5つのHTMLを作る。設計資料から機械的に取り出した部分と、Claudeが組み立てた部分がある。

- 設計資料から取り出した部分：画面・API・ストーリー・テーブル・列・構成要素・決めたことの文言、画面とAPIとストーリーの対応、画面の移り方、AWSの線。
- Claudeが組み立てた部分：画面のワイヤーフレーム（`src/wf.js`）、APIの要求と応答の例（`src/ex.js`）、APIの「要求が通る順番」の図とロック・リマインドの札（`src/render.js`の`flags`）、DBの外部キーの消したときの動きの割り当て（`src/render2.js`の`refsOf`）、AWSの部品と決定・処理の流れの対応（`src/render2.js`の`NODE_DEC`・`FLOW_EDGES`）、設計資料の図（mermaid）に無く文章から足した点線の線（C-4のSQS、送信の関数と`erasure-worker`が見張りの予約を動かす線、`api`がS3の中で画像をコピーする線）。

## 見てほしいこと

1. 設計資料と食い違っていないか。特に「Claudeが組み立てた部分」が、`docs/`の設計資料の決まりと矛盾していないか。例：要求と応答の例の欄・状態コード、ロックの種類、外部キーのCASCADE / RESTRICT、どのLambdaがどの部品につながるか。
2. 設計資料にあるのにボードから落ちているもの、ボードにあるのに設計資料に無いもの。
3. 初めて見る人にとって分かりやすいか。分かりにくい言葉、誤解を招く図、見つけにくい情報。

指摘には、どのボードのどのタブか（例：APIボードの「申込の状態を変える」）と、根拠になる設計資料の場所を添える。
