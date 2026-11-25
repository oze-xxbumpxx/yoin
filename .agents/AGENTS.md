# .agents

毎回守る決まりは、リポジトリ直下の`AGENTS.md`。コマンドの範囲の全文は`docs/agents/command-scope.md`。

- Devin: 直下の`AGENTS.md`と`.agents/skills/devin-workflow/SKILL.md`を使う。担当は承認済みの計画のタスク、調査と小さな修正、PRのレビューへの対応。基本はDevin CLIで、難しいタスクはCLIからDevin Cloudに渡す。ブランチは`devin/<内容>`。Claude Codeのフックは動かないため、直下の`AGENTS.md`のブランチ運用、破壊的操作の事前確認、`docs/agents/command-scope.md`を守る。
- Devinへの委譲とDevinのPRのレビューは`.claude/skills/review-devin-pr/SKILL.md`。マージはユーザーが行う。
- PRの説明の「人が重点的に見るべきファイル」は、直下の`AGENTS.md`のとおり毎回書く。
