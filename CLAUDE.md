# yoin

@AGENTS.md

共通の開発ルールと現在の状態はAGENTS.md。前回の作業はlogs/の最新。
PRを開いたときの自動レビューは、Codex（設定はリポジトリの外）とGitHub ActionsのClaudeが行う。Claudeはpushのたびにも動く。見る基準はAGENTS.mdの「Code Review Rules」と`REVIEW.md`。
機能の追加・修正は`develop-feature`スキルをこのセッションで進める。子エージェントは検証（`reviewer`、条件を満たすとき`security-reviewer`）と、広い探索（`Explore`）だけ。
人が読む文章は`shizen-nihongo`スキルと`.claude/rules/writing-style.md`。
フックは`.claude/settings.json`。危険な操作はフックが止める。
Devinへ渡したIssueのあとは`.claude/scripts/wait-for-pr.mjs`と`review-devin-pr`スキル。
