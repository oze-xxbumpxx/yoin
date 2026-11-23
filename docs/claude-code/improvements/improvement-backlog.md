# 改善バックログ

候補・提案の一覧。起票したら1行追加し、ステータスを更新する。
採番は`IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 設計のレビューで、途中で止まる・2回流れる・前の版と重なる流れの穴が見つかる（工程3で2回、工程4で1回、足したあとの通知の設計の見直し（PR #15）と工程5で1回ずつ）。問いの前にこの流れを書き出す。`ask-questions`の進め方3に1文足した | accepted | candidates/design-step4-dev-tools.md（事象1）、candidates/design-step3-data-model.md（事象1）、candidates/design-step5-api-design.md（事象1）、logs/2026-11-21.md（PR #15） | 2026-11-21 |

accepted / rejected以外の行が、セッション開始時とスプリントの集計の「未決定IMP」になる。

## 留め置き（昇格せず、再発を見る）

振り返りで昇格条件（同じ型が3回）を満たさなかった知見。同じ型が再び起きたら発生回数を足し、3回になったら上の表に起票する。

| 知見 | 発生回数 | 出典 | 更新日 |
| --- | --- | --- | --- |
| 定期に動く処理の費用（外部サービスを起こし続ける）を、構成図を作るまで見落とす。工程6では、操作の散らばり方でNeonが休止しないことを見落とした | 2 | candidates/design-step3-data-model.md、candidates/design-step6-region-and-cost.md（事象1） | 2026-11-22 |
| 人数・件数の下限を推測で置き、ユーザーに訂正される | 1 | candidates/design-step3-data-model.md | 2026-11-12 |
| 確認項目や決まりを事例の一言から書き、出典の設計にある例外を読み落とす | 1 | candidates/verification-loop.md | 2026-11-18 |
| 同じ工程の問いを、2つのスレッドが別々に出す・追う。最初の1本の要件では、券の文字の色の答えがどちらのスレッドにも届かなかった | 2 | candidates/design-step4-dev-tools.md、candidates/first-slice-requirements.md（事象4） | 2026-11-24 |
| 推奨と違う答えの理由を聞いたが答えが無く、聞き直さずに工程を閉じる | 1 | candidates/design-step4-dev-tools.md | 2026-11-21 |
| 画面に出す項目の出どころ（どのAPIのどの欄か）をたどらず、画面を作る段で抜けが見つかる | 1 | candidates/design-step5-api-design.md | 2026-11-21 |
| Claudeが仮に決めたことを、ADRでユーザーの決定と同じ段に書く。工程6では、ほかの文書に写すときに仮の印を落とした | 2 | candidates/design-step5-api-design.md、candidates/design-step6-region-and-cost.md（事象5） | 2026-11-22 |
| 暴走時の費用を入口のサービスの単価だけで数え、同じ要求で動くほかのサービスを足し忘れる | 1 | candidates/design-step6-region-and-cost.md（事象2） | 2026-11-22 |
| 外部サービス自身のバックアップの保持期間を読まず、利用者への約束に短い期限を書く | 1 | candidates/design-step6-region-and-cost.md（事象3） | 2026-11-22 |
| 送られた答えの写しを読まずに、ユーザーに答えを催促する | 1 | candidates/design-step6-region-and-cost.md（事象4） | 2026-11-22 |
| 2つの保存先にまたがる処理で、片方だけできて止まったときの続け方を書かない | 2 | candidates/first-slice-requirements.md（事象1、2か所） | 2026-11-24 |
| 初めて使う人の流れと、データが0件の画面を要件に書かない | 2 | candidates/first-slice-requirements.md（事象2、2か所） | 2026-11-24 |
| 置き換える文字列が1回だけ出るかを確かめずに一括で置き換え、別の箇所を書き換える | 1 | candidates/first-slice-requirements.md（事象3） | 2026-11-24 |
