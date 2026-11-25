# 論点の記録: PRのレビューをCodexとClaudeで自動にする

- 機能名: codex-review
- 確認のページ: https://claude.ai/artifact/F2JZQyonCYX5iccRTQNs77
- 進み具合: docs/discussions/codex-review.progress.json

## 背景

2026-11-25に大関さんから「レビューにCodexを使いたい。今は`codex review`を使っていると思う」と依頼があった。今の流れを調べると、ChatGPTのCodexのGitHub連携（`chatgpt-codex-connector`）がこのリポジトリに入っていて、PRを開いたときに自動でレビューしている。見直しは`AGENTS.md`の決まりどおり、PRに`@codex review`とコメントして頼んでいる。手元のCodex CLIの`codex review`は、リポジトリのスキルや道具からは呼んでいない。

同じ日の夜、大関さんから「Claudeの側も、頼まれて見る形でなく、PRを自動でフックしてレビューしてほしい」と追加の希望があった。同じ日に、大関さんがCursorで出したPR #80と#81がマージされ、PRを開いたときにClaudeが動くworkflow（`.github/workflows/claude-code-review.yml`）と、`AGENTS.md`の`## Code Review Rules`節が入っている。

## 前提

- `AGENTS.md`の「レビュー」は、Codexの役割を2つ決めている。設計の工程の敵対的レビューと、PRのレビュー。PRを開いたときは自動、指摘の直し・設計を変えるpush・ボットのPRでは`@codex review`で頼む。
- コードのPRは、Claude Code本人・`reviewer`・（条件を満たすとき）`security-reviewer`も並べて見る。DevinのPRはDevin Reviewも見る。
- レビュアーを増やして見落としを減らすのでなく、`REVIEW.md`を直して減らす（2026-11-18の判断）。
- 検査そのもの（`REVIEW.md`、`.github/workflows/`、ハーネス）を変えるときは、アプリのコードと別のPRにする。

## 調べた事実

- CodexのGitHubのレビューは、PRを開いたとき、下書きを「レビュー可能」にしたとき、`@codex review`・`@codex security review`のコメントで動く（PR #75のCodexの要約コメント）。
- Devin CLIが出すPRは大関さんのアカウントで作られるので、開いたときに自動のレビューが動く（PR #75、#76）。
- Codexは日本語で書き、GitHubではP0とP1の重さの指摘だけを出す。`AGENTS.md`の`## Code Review Rules`節を読む（OpenAIの説明、https://learn.chatgpt.com/docs/third-party/github ）。
- 直しのあとの見直しが抜けているPRがある。Claude Codeが出したPR（#74、#78）は、pushのたびに`@codex review`を頼んでいる。DevinのPRでは、#75（Codexが見たのは`dbb54b1`、今のheadは`0b59cfc`）と#76（`db14507`と`6b1cfa3`）で、Devinが直したあとの版をCodexが見ていない。`review-devin-pr`の手順に、`@codex review`を頼む段が無い。
- 手元のCodex CLIには`codex review`がある。`--base <ブランチ>`、`--uncommitted`、`--commit <SHA>`で範囲を選び、対話なしで動く。終了コードは、レビューが走ったかどうかで、指摘の有無ではない（https://www.mintlify.com/openai/codex/cli/review ）。
- `claude-code-review.yml`（PR #80・#81）は、`anthropics/claude-code-action@v1`をMaxの`CLAUDE_CODE_OAUTH_TOKEN`で動かす。動くのはPRを開いたときと、下書きをレビュー可能にしたときだけで、pushのたびには動かない。見るのはセキュリティと目立つ不具合で、`REVIEW.md`はベースブランチの版を読む。設計書・試験計画との突き合わせ、Devinへの`must`の投稿、完了の印は、今もMacのClaude Codeが`review-devin-pr`で頼まれたときにしている。
- このworkflowの実行は4回で、3回成功、1回失敗（PR #82の2回目、2026-11-25 14:35 UTC）。失敗は0.1秒で終わり、モデルを1回も呼んでいない。推測ですが、トークンの認証かMaxの上限で断られている。理由の文はログに出ておらず、15:02に大関さんの側で出力を見る変更が入った。
- Anthropicの管理型のCode Review（PRごとに自動で見る製品）は、TeamとEnterpriseのプランだけで、利用料は別にかかる（https://code.claude.com/docs/en/code-review ）。個人のMaxでは使えない。
- `claude-code-action`をMaxで動かすと、手元のClaude Codeと同じ枠を使う。トークンは`claude setup-token`を実行した人に結びつく（https://laracraft.tech/en/blog/how-to-set-up-claude-code-review-in-github-actions-with-your-claude-subscription ）。
- ChatGPT Plusでのレビュー回数の上限は、OpenAIの公開の資料に数が見つからなかった。料金のページは、手元とクラウドの利用が同じ枠を使い、週の上限もありうると書く（https://chatgpt.com/codex/pricing/ ）。GitHubのレビューは別の「コードレビュー」の枠に数えるという第三者の記事（https://repowise.dev/blog/comparisons/codex-code-review-setup-pricing ）と、ダッシュボードに余りがあるのに上限の返事が来たという報告（https://github.com/openai/codex/issues/31001 ）がある。実際の残りは、大関さんのCodexの利用状況のページでしかわからない。

## 論点

### Codexにレビューのどこまでを任せるか

<!-- id: codex-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 最初の1本の実装のPR（#75、#76）がDevinから出始めた。この先13タスク分のPRが続くので、今のうちに見る人と順番を決めておく。
- 根拠: 上の「調べた事実」。PR #75・#76のCodexの要約コメント、`.claude/skills/review-devin-pr/SKILL.md`の「自動投稿」
- 選択肢:
  - A) 今のGitHubのCodexのレビューを続け、抜けている「Devinが直したあとの見直し」を手順に足す
    - 利点: 道具が増えない。Plusの枠の使い方も今と変わらない。#75・#76のような、直した版をCodexが見ないまま渡る穴がふさがる
    - 欠点: PRを開く前の誤りは、PRを開くまで見つからない
  - B) Aに加えて、PRを出す前に手元の`codex review --base main`を回す
    - 利点: PRに出る前に指摘を直せるので、往復が減る
    - 欠点: 手元のCodexはMacでしか動かない。DevinとClaude Codeの両方に道具と手順が増える。手元とクラウドで同じ枠を使うので、上限に早く当たる
  - C) Claude Code本人と`reviewer`のレビューをやめ、Codexに置き換える
    - 利点: Claudeの使う量が減る
    - 欠点: CodexはGitHubでP0・P1しか出さないので、設計書との食い違いや試験の観点の抜けを拾う人がいなくなる。これまでの指摘はClaudeと`reviewer`の分が多い（工程5ではreviewer 13件、Codex 0件）
- 推奨: A（道具を増やさずに、いま実際に抜けている見直しをふさげる。手元の`codex review`は、Aで往復が多いと分かってから足せばよい。`## Code Review Rules`節はPR #80で入った）

### 直したあとの見直しを、誰がいつ頼むか

<!-- id: codex-rereview-trigger -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 上の論点でAかBを選ぶと、この段を手順に書く必要がある。
- 根拠: PR #75・#76で見直しが抜けたこと。PR #74・#78ではClaude Codeがpushのたびに頼んでいること
- 選択肢:
  - A) `review-devin-pr`で、Devinの直しを確かめるround 1以降の最初に、Claude Codeが`@codex review`をコメントする。Claude Codeが自分で出したPRは今どおり
    - 利点: 文言だけの直しでは頼まない、という今の決まりをClaude Codeが判断できる。枠を無駄に使わない
    - 欠点: Claude Codeが手順を飛ばすと、また抜ける。完了の印の前に「headにCodexのレビューがあるか」を確かめる段で拾う
  - B) GitHub Actionsで、pushのたびに`@codex review`を自動でコメントする
    - 利点: 人もAIも忘れようがない
    - 欠点: Devinは小さなpushを何回も重ねるので、そのたびに枠を使う。検査そのもの（`.github/workflows/`）を変えるので別のPRと人の確認が要る
- 推奨: A（今の決まりのまま、手順の1行と完了前の確かめで抜けをふさげる）

### 自動で動くClaudeのレビューに、どこまでさせるか

<!-- id: claude-auto-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- なぜ今: 大関さんは、頼まれて見る形をやめたい。今のworkflowはセキュリティと目立つ不具合だけを見て、設計書との突き合わせとDevinへの指摘はMacのClaude Codeに頼んだときだけ動く。
- 状態: 回答待ち
- 根拠: `.github/workflows/claude-code-review.yml`、`.claude/skills/review-devin-pr/SKILL.md`の「レビュー」と「自動投稿」、Anthropicの管理型のCode Review（https://code.claude.com/docs/en/code-review ）
- 選択肢:
  - A) 今のworkflowを広げ、`review-devin-pr`の1回のレビュー（`REVIEW.md`・設計書・試験計画との突き合わせ、`must`と`nit`の投稿）までをGitHub Actionsでする。完了の印とマージ判断の取りまとめは、今どおりClaude Codeが確かめてから出す
    - 利点: PRを開くとすぐ、設計書まで見たレビューが付く。Devinは監視中なので、`must`を受けて自分で直し始める。完了の印を自動で出さないので、スレッドの解決やCodexの見直しを確かめないまま「マージしてよい」が付くことは無い
    - 欠点: Actionsの1回の実行で読める量に上限があり（今は10ターン）、大きなPRでは設計書を読み切れないことがある。Maxの枠を手元と分け合う
  - B) 今のworkflowのまま（セキュリティと目立つ不具合だけ）にし、突き合わせのレビューは今どおり頼まれたときにする
    - 利点: workflowを変えない
    - 欠点: 大関さんの希望（頼まなくても見る）に届かない
  - C) 完了の印までGitHub Actionsに任せ、Macでのレビューをやめる
    - 利点: 頼むことが何も無くなる
    - 欠点: スレッドを解決したか、Codexが今のheadを見たか、という完了の前の確かめを、1回の実行の中でしなければならない。Devinが直すたびに動くので、完了の印が早く付きすぎるおそれがある
  - D) Anthropicの管理型のCode Reviewを使う
    - 利点: workflowを書かなくてよい
    - 欠点: TeamかEnterpriseのプランが要り、利用料も別にかかる
- 推奨: A（頼まなくても設計書まで見たレビューが付き、マージの前の確かめは今の手順のまま残せる）

### 自動のClaudeのレビューを、いつ動かすか

<!-- id: claude-auto-trigger -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 今は開いたときだけ動くので、Devinが直したあとの版はClaudeもCodexも見ない（#75・#76）。
- 根拠: `claude-code-review.yml`の`on`、PR #75・#76のコミットの数。`AGENTS.md`の「ブランチとPR」は、PR #81で「Claudeレビューは開いたときと下書きを解除したときだけ動き、追加のpushでは動かない」と書いた。Aを選ぶと、この文を書き換える
- 選択肢:
  - A) 開いたときと、pushのたび（`synchronize`）に動かす。同じPRで前の実行が動いていたら止め、最新の版だけを見る。pushのあとは前回のレビューからの差分を見る
    - 利点: Devinが直すたびに、頼まなくても見直しが付く
    - 欠点: Devinは小さなpushを続けるので、実行の回数が増え、Maxの枠を使う。前の実行を止める設定で、続けたpushは最後の1回にまとまる
  - B) 開いたときだけ自動で、そのあとは`@claude review`とコメントしたときに動かす
    - 利点: 枠を使う回数が少ない
    - 欠点: 直したあとの見直しを、誰かが頼む必要が残る
- 推奨: A（直したあとの見直しの抜けを、頼む人なしでふさげる）

### 回数の上限に当たったときにどうするか

<!-- id: codex-limit -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: CodexのPlusの上限の数が公開されておらず、ClaudeのMaxの枠も手元とActionsで分け合う。さらに、Devinの委譲を増やす12月にPRが増える。
- 根拠: 料金のページ（https://chatgpt.com/codex/pricing/ ）、上限の返事が来た報告（https://github.com/openai/codex/issues/31001 ）
- 選択肢:
  - A) Codexが上限の返事を返したら、大関さんに一言知らせる。L0 / L1のPRはClaude Codeと`reviewer`のレビューで進める。L2 / L3のPRは、`AGENTS.md`の決まりどおり、上限が戻ってから`@codex review`を頼み直し、それまでマージの判断に渡さない
  - B) 上限の返事が来たら、どのPRも戻るまでマージの判断に渡さない
- 推奨: A（小さなPRまでCodexを待つと、Devinの無料期間中の委譲が詰まる。Claudeの自動のレビューが上限で止まったときも同じ扱いにする）
- 決定: A
- 推奨と同じか: 同じ
- 理由: 仮決定。大関さんの答えで変える
