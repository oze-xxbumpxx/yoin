# docs

毎回守る決まりは、リポジトリ直下の`AGENTS.md`。いまの状態の全文は`docs/agents/current-state.md`。

- 設計文書は`docs/`に置く（`prfaq.md`、`glossary.md`、`context-map.md`、`data-model.md`、`architecture.md`、`user-stories.md`。ADRは`docs/decisions/`）。承認はPRのマージで残す。
- コードの名前には、用語集の英語名をそのまま使う（例: `Concert`、`Attendance`、`TicketApplication`、`MerchItem`）。
- L2 / L3の問いと答えは`docs/discussions/`、試験の観点は`docs/tests/`、設計は`docs/designs/`、実装計画は`docs/implementation-plans/`、要件は`docs/requirements/`。
- 試験の観点を変えるときは、アプリのコードと別のPRにする（`docs/agents/review.md`）。
