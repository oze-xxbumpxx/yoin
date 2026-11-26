# yoin

@AGENTS.md
@docs/agents/current-state.md
@docs/agents/how-we-work.md
@docs/agents/roles.md
@docs/agents/review.md
@docs/agents/improvement.md
@docs/agents/session.md
@docs/agents/command-scope.md
@.claude/AGENTS.md
@.agents/AGENTS.md
@.github/AGENTS.md
@docs/AGENTS.md

毎回守る決まりは、直下の`AGENTS.md`。長い手順と背景は、その索引の先で、上の取り込みでも読む。前回の作業はlogs/の最新。
PRを開いたときの自動レビューは、Codex（設定はリポジトリの外）とGitHub ActionsのClaudeが行う。Claudeはpushのたびにも動く。見る基準は`AGENTS.md`の「Code Review Rules」と`REVIEW.md`。
機能の追加・修正は`develop-feature`スキルをこのセッションで進める。子エージェントは検証（`reviewer`、条件を満たすとき`security-reviewer`）と、広い探索（`Explore`）だけ。
人が読む文章は`shizen-nihongo`スキルと`.claude/rules/writing-style.md`。
フックは`.claude/settings.json`。危険な操作はフックが止める。
Devinへ渡したIssueのあとは`.claude/scripts/wait-for-pr.mjs`と`review-devin-pr`スキル。
