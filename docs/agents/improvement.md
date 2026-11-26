# 振り返りと改善

もとはリポジトリ直下の`AGENTS.md`の「振り返りと改善」。中身は移しただけで、決まりは変えていない。

## 振り返りと改善

tomotabiでは改善のサイクルを休眠にしたが、yoinでは回す。ただし、1回の失敗でスキルを変えない。

1. L2 / L3のPRがマージされたら、`reflect-task`で`docs/claude-code/improvements/candidates/<task-id>.md`に振り返りを書く。観測した事象と発生回数だけを短く書く。
2. 設計の工程を閉じたときも、同じ形で振り返りを1本書く。設計はclaude.aiのプロジェクトで進むので、工程を閉じるPRを出すセッションが書く。
3. DevinのPRへの指摘は、`review-devin-pr`が委譲の記録（`docs/claude-code/improvements/delegations/`）に種類ごとに数える。
4. 同じ型の事象が3回になったら、`docs/claude-code/improvements/improvement-backlog.md`に起票し、直し方をユーザーに出す。1〜2回のものは留め置きの表に回数だけ足す。
5. ユーザーが採用したら、`improve-harness`の手順でスキルやルールに一文足し、PRにする。足したあとに同じ型が減ったかを、次の振り返りで数える。

