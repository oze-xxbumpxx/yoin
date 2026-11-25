# 現在の状態

もとはリポジトリ直下の`AGENTS.md`の「現在の状態」。中身は移しただけで、決まりは変えていない。

## 現在の状態

- yoinは、いつもの仲間でグループを作り、公演ごとの記録（セトリ・参戦記録）とチケット・グッズの準備を共有する招待制のPWA。2027年1月のプレリリースを目標にMVP1を作る。1月に間に合わせるために設計を削ることはしない。
- 設計は工程ごとに進めている。工程1（PR/FAQ）と工程2（用語集・文脈マップ・ADR-0001）は確定。工程3（データモデル・ADR-0002）は2026-11-12にADR-0002を承認して確定。工程6のうちAWS構成は2026-11-13に先に確定した（`docs/architecture.md`）。文脈の中の層の分け方はADR-0003として2026-11-17に承認した。工程4（開発の道具。言語・ORM・マイグレーション・Neonへの接続・IaC・境目の検査・画面）は2026-11-21にADR-0004を承認して確定。工程5（API設計。画面の一覧と移り方、画面ごとのAPI、APIの形の決まり）は2026-11-21にADR-0005を承認して確定（`docs/api.md`）。工程6の残り（リージョン・費用の試算・DBを戻せる期間・AWSアカウントのプラン）は2026-11-22にADR-0006を承認して確定。AWSとNeonはシンガポールに置く。設計の工程1〜6はすべて確定した。
- 設計文書は`docs/`に置く（`prfaq.md`・`glossary.md`・`context-map.md`・`data-model.md`・`architecture.md`・`user-stories.md`、ADRは`docs/decisions/`）。承認はPRのマージで残す。
- 採用スタック: AWS（Lambda、EventBridge Scheduler、Cognito、S3、CloudFront）、Neon（PostgreSQL）、Web Push。道具はADR-0004で決めた: TypeScript、Drizzle ORM、Neonのサーバーレスドライバー、Terraform、React＋Vite、HonoとZod（型は`hono/client`で画面と共有）、Powertools for AWS LambdaのLogger、eslint-plugin-boundaries、pnpm・Vitest・fast-check・Playwright・GitHub Actions。まだアプリのコードは無い。
- コードの名前には、用語集の英語名をそのまま使う（例: `Concert`、`Attendance`、`TicketApplication`、`MerchItem`）。
- スタック固有の規約は、採用済みの技術にだけ適用する。存在しない設計書・コマンド・レビュー結果をあるものとして扱わない。
- 品質コマンド: まだ無い。ハーネスの`run-quality-gates.sh`はロックファイルからパッケージマネージャーを選び、実在するものだけを実行する。

