# コマンドの範囲

もとはリポジトリ直下の`AGENTS.md`の「コマンドの範囲」。中身は移しただけで、決まりは変えていない。短い禁止は直下の`AGENTS.md`の「してはいけないこと」。2026-11-27に、ADR-0008（AWSとNeonからCloudflareへ移す）に合わせて、AWSとNeonの言葉をCloudflareの言葉に直した。

## コマンドの範囲

Claude Code、Devin、Codexがコマンドを実行してよい範囲は、この節に書く。
根拠はOpenAIの記事「Inside the Codex sandbox」（2026-11-18、https://openai.com/index/inside-the-codex-sandbox ）。
記事の既定は、作業フォルダの中だけを書き換え、`.git`の設定は読み取りだけにし、通信は必要なときだけ足す、というもの。
yoinはOSによる強制をまだ入れず、同じ範囲を文章の決まりとして置く。
DevinにはClaude Codeの危険操作フックが効かないので、起動引数の`--permission-mode dangerous`が付いていても、この範囲は広がらない。

書き込んでよいのは、今の作業クローンの作業ツリーと、下に書く状態ディレクトリだけ。
コミットと、作業ブランチへのpushに必要なgitの更新は、作業ツリーへの書き込みに含める。
次の場所は変えない。

- `.git/hooks`、`.git/config`、`core.hooksPath`、リモートのURL
- ホームディレクトリの設定（`~/.gitconfig`、`~/.ssh`、`~/.aws`、`~/.codex`、シェルの設定）
- 作業クローンの外。ただし、次の状態ディレクトリを除く

品質確認（`bash .claude/scripts/run-quality-gates.sh`）と、ハーネスが状態を残す処理は、`.claude/lib/harness-paths.mjs`が決めた状態ディレクトリへ書いてよい。
既定は`~/.local/state/<名前空間>`である。
`XDG_STATE_HOME`か`HARNESS_STATE_DIR`があれば、そちらを使う。
このディレクトリ以外を、ホームディレクトリへ確認なしに書かない。
上の設定ファイルは、この例外に含めない。
この例外は、PRの「コマンドの範囲」に書かなくてよい。

確認なしで通信してよい相手は、次の3つ。

- このリポジトリのGitHub。`git fetch`、作業ブランチへの`git push`、このリポジトリを見る`gh`
- パッケージの取得先。依存を新しく足してよいのは、依頼がその依存を含めているときだけ
- 手元のテストが使うlocalhost
  - Voidの起動が許可されたら、手元の開発サーバー（中でD1・R2・Queuesを手元に作る）はここに入る。D1は`--local`だけを使う。
  - void・cf CLI・wranglerは、利用状況をCloudflareなどへ送る機能を止めてから動かす。wranglerは`WRANGLER_SEND_METRICS=false`で止まる。
  - cf CLIは、大関さんがこの手順の変更を承認し、その変更が`main`に入ってから起動できる。起動するたびに環境変数`CF_SEND_TELEMETRY`を`false`にする。確認した版は`cf@0.15.0`、`cf@1.0.0-rc.5`、`cf@1.0.0-rc.6`。ほかの版は、止め方を確かめるまで起動しない。
  - この承認で起動できるのはcf CLIだけ。Void自身の送信を止める方法は未確認なので、試験（C02）は完了していない。Voidが呼ぶcfの送信を止めても、Void自身は起動しない。
  - 根拠は[CLIの版と送信を止める方法の調査（C02）](https://github.com/oze-xxbumpxx/yoin/blob/eb6cdbd2cf5ae7f832fffcb182ae8ebc5514e03e/docs/reviews/first-slice-cli-telemetry.md)。この手順は、下にあるCloudflareのアカウントなどへの接続の禁止を変えない（ADR-0008）。
  - AWS Emulator（ADR-0004の2026-11-25の追記）は、ADR-0008でAWSをやめたので使わない

Cloudflareのアカウント（D1、R2、Queues、Workers、secret）、本番、結合検証には繋がない。もとのAWSとNeonにも繋がない。
`void deploy`、`void secret put`、`wrangler login`、D1のマイグレーションの適用（`--remote`）、D1を過去の時点に戻す操作もしない。危険操作のフック（`.claude/hooks/guard-dangerous.mjs`）はこのうちよく使うものを止めるだけで、全部ではない。フックが止めなくても、Cloudflareのアカウントに触れる操作はしない。`terraform apply`、`terraform destroy`もしない。
リポジトリのファイルや環境変数を、上の3つ以外へ送らない。

Gitが追跡しないディレクトリ（`node_modules`など）を書き換えて、不具合を直したことにしない。
その変更はPRに含まれず、次にコマンドを実行する人の手元の道具だけが変わる。
依存を変えるときは、リポジトリに入るロックファイルを変える。

範囲を超えるコマンドが要るときは、実行せずに止める。
何が要るかと、そうする理由を、ユーザーか呼び出し側に渡す。

品質コマンドを通したと書くときは、このセッションで実行したコマンドと終了コードを、PRの「確かめたこと」に書く。
PRの「コマンドの範囲」には、上の禁止に触れたものを書く。
無ければ「なし」と書く。

