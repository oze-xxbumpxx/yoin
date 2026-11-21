# 改善バックログ

候補・提案の一覧。起票したら1行追加し、ステータスを更新する。
採番は`IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 設計のレビューで、途中で止まる・2回流れる・前の版と重なる流れの穴が見つかる（工程3で2回、工程4で1回）。問いの前にこの流れを書き出す。`ask-questions`の進め方3に1文足した | accepted | candidates/design-step4-dev-tools.md（事象1）、candidates/design-step3-data-model.md（事象1） | 2026-11-21 |

accepted / rejected以外の行が、セッション開始時とスプリントの集計の「未決定IMP」になる。

## 留め置き（昇格せず、再発を見る）

振り返りで昇格条件（同じ型が3回）を満たさなかった知見。同じ型が再び起きたら発生回数を足し、3回になったら上の表に起票する。

| 知見 | 発生回数 | 出典 | 更新日 |
| --- | --- | --- | --- |
| 定期に動く処理の費用（外部サービスを起こし続ける）を、構成図を作るまで見落とす | 1 | candidates/design-step3-data-model.md | 2026-11-12 |
| 人数・件数の下限を推測で置き、ユーザーに訂正される | 1 | candidates/design-step3-data-model.md | 2026-11-12 |
| 確認項目や決まりを事例の一言から書き、出典の設計にある例外を読み落とす | 1 | candidates/verification-loop.md | 2026-11-18 |
| 同じ工程の問いを、2つのスレッドが別々に出す | 1 | candidates/design-step4-dev-tools.md | 2026-11-21 |
| 推奨と違う答えの理由を聞いたが答えが無く、聞き直さずに工程を閉じる | 1 | candidates/design-step4-dev-tools.md | 2026-11-21 |
