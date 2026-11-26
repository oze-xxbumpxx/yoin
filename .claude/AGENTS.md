# .claude

毎回守る決まりは、リポジトリ直下の`AGENTS.md`。このディレクトリでは、次も守る。

- Claude Code: `CLAUDE.md`、`.claude/skills/`、検証用の`.claude/agents/`（`reviewer`と`security-reviewer`）、`.claude/settings.json`のフックを使う。ハーネスの状態を扱うコマンドをClaude Codeの外で実行するときは、settingsの`env.HARNESS_NAMESPACE`と同じ値を付ける。
- 改善のサイクルは`docs/agents/improvement.md`。振り返りと改善は、そこに書いた手順で回す。

## 現在有効なハーネス機能 / 休眠

**現行（今すぐ使う）**

- 作業分担、変更レベル分類、日次ログ、危険操作ガード、実在する品質コマンド、ハーネス試験（日常は`bash .claude/scripts/run-quality-gates.sh`。全件は`node --test .claude/tests/*.test.mjs`）。
- 機能の進め方は`develop-feature`スキル。畳んだあとに正しいスキルへ届くかの確認一覧は`.claude/evals/folded-loop-checklist.md`。
- 改善のサイクル（`docs/agents/improvement.md`）。tomotabiと違い、休眠にしない。

**休眠**

- `review-readiness` / Gate B / structured packetのhard stop（`docs/reviews/README.md`は未作成）。アプリのL2 / L3が複数回回るまで必須にしない。
- `.claude/evals/cases/`は配布元向けのまま使わない。
