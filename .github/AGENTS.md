# .github

毎回守る決まりは、リポジトリ直下の`AGENTS.md`。レビューの手順の全文は`docs/agents/review.md`。

- `.github/workflows/`とPRの雛形は、検査そのものである。アプリのコードと別のPRにする。
- `claude-code-review.yml`は、PRを開いたとき、下書きを解除したとき、追加のpushのたびに動く。pushのあとは前回のレビューからの差分を見る。下書き、fork、ラベル`skip-claude-review`は除く。
- このファイルを変えたPRでは、actionは既定ブランチと内容が一致するまでレビューを飛ばす。飛ばしているあいだ、ジョブは成功になる。
