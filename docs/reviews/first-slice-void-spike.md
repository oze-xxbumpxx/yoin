# 最初の1本: Voidの試作

## 上流への問い合わせ

オーナーが[VoidのIssue #946](https://github.com/voidzero-dev/void/issues/946)に問い合わせを投稿した。以下は投稿前の文案。

**Title: Does the Void CLI send usage telemetry, and can it be disabled before first run?**

Does the Void CLI itself send usage telemetry? If it does, which commands can send it, including the first invocation? Is there a supported way to opt out before running any Void command, such as an environment variable, a config setting, or a flag?

We inspected the [published `void@1.12.2` tarball](https://registry.npmjs.org/void/-/void-1.12.2.tgz) without running the CLI. In that tarball, `package.json:15–17` points to `dist/cli/cli.mjs`, which loads the main CLI at lines 82–87. We found `CF_SEND_TELEMETRY: "false"` in the environment passed to child `cf` processes (`dist/cli/cloudflare-operation-process.mjs:306–313, 340–345` and `dist/deploy-DtJeunLF.mjs:2698–2712`; see also the [pinned source](https://github.com/voidzero-dev/void/blob/18b83324a04d68d81f78c754f1e83e0d85d8f941/packages/void/src/cli/cf-version-runner.ts#L260-L288)).

That setting covers the bundled `cf` subprocess, not necessarily Void itself. We did not find a Void-specific opt-out in the tarball or the [CLI reference](https://void.cloud/reference/cli). If Void itself does not send usage telemetry in this release, could you confirm that? If there is an opt-out, please point us to the supported setting and the versions it covers.

## 遮断の方法と確認結果

このMacでは、`sandbox-exec`の下で外への名前解決とIPv4の接続が失敗した。オーナーはこの方法を試作に使うと決めた。この確認ではVoidもcfも起動していない。

次のプロファイルを`sandbox-exec -p`に渡した。`localhost:*`はこのMacではループバックのほか、同じMacの非ループバックIPv4アドレスへのTCPとUDPも許した。

```scheme
(version 1)
(allow default)
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
```

| 確認 | 遮断なし | 遮断あり |
|---|---|---|
| `curl -sS -m 5 https://example.com` | 終了コード0、577バイト取得 | 終了コード6、名前解決に失敗 |
| IPv4のTCP（`1.1.1.1:443`） | 接続成功 | `EPERM` |
| OSの名前解決（未使用の名前） | `1.1.1.1`に解決 | 名前解決に失敗 |
| IPv4のUDP（`1.1.1.1:53`へのDNS問い合わせ） | 問い合わせに対応する61バイトの応答を受信 | `EPERM`、送信できなかった |
| IPv6のTCP（`[2606:4700:4700::1111]:443`） | `EHOSTUNREACH`、経路なし | `EPERM` |

`lsof -nP -iTCP -sTCP:LISTEN`、`lsof -nP -iUDP`、`netstat`で待ち受けを調べた。設定済みのプロキシ環境変数や、有効なシステムプロキシ設定は見つからなかった。

- TCP: Devinの制御用サービス（`devin-remote`）は全IPv4アドレスの6080、6789、6790、9876と、ループバックの2ポートで待ち受けていた。`netstat`では`launchd`がSSH用の22番ポートで待ち受けていた（IPv4とIPv6）。
- UDP: `replicatord`とOSサービスのソケットがあった。`netstat`では`mDNSResponder`が5353番ポートで待ち受けていた（IPv4とIPv6）。

このMacには外へ出るIPv6の経路がないため、遮断なしで届く宛先とは比較できていない。待ち受けの用途から、任意の通信を外へ中継するプロキシではないと判断した。これらのサービスが実際に中継しないことは試していない。

### ホストの認証情報の読み取りを拒否する

通信の遮断に、認証情報の置き場の読み取り拒否を足した。`sandbox-exec`の`-p`に次のプロファイルを渡し、`-D HOST_HOME=<ホストのホームの絶対パス>`を指定した。試験するプロセスには、別の空の一時ディレクトリを`HOME`として渡した。

```scheme
(version 1)
(allow default)
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(deny file-read*
  (subpath (string-append (param "HOST_HOME") "/.ssh"))
  (subpath (string-append (param "HOST_HOME") "/.aws"))
  (subpath (string-append (param "HOST_HOME") "/.config"))
  (subpath (string-append (param "HOST_HOME") "/.npmrc"))
  (subpath (string-append (param "HOST_HOME") "/.gitconfig"))
  (subpath (string-append (param "HOST_HOME") "/.git-credentials"))
  (subpath (string-append (param "HOST_HOME") "/.git-credential-cache"))
  (subpath (string-append (param "HOST_HOME") "/.wrangler"))
  (subpath (string-append (param "HOST_HOME") "/Library/Keychains"))
  (subpath "/Library/Keychains")
  (subpath "/System/Library/Keychains"))
```

ディレクトリは`ls`、ファイルは読み取り用に開いて結果を比べた。出力は置き場の有無と読み取りの成否だけにし、中身は表示しなかった。

| 読み取りの対象 | ホストに存在 | 遮断なし | 遮断あり |
|---|---|---|---|
| ホストの`~/.ssh`、`~/.gitconfig`、`~/Library/Keychains`、`/Library/Keychains`、`/System/Library/Keychains` | あり | 読めた | 拒否 |
| ホストの`~/.aws`、`~/.config`、`~/.npmrc`、`~/.git-credentials`、`~/.git-credential-cache`、`~/.wrangler` | なし | 未実施 | 未実施 |
| 一時ディレクトリに作ったホストのホーム配下の全対象と、各対象ディレクトリ内の空ファイル | 模擬データのみ | 読めた | 拒否 |

| 通信の再確認 | 遮断なし | 遮断あり |
|---|---|---|
| HTTPS（`https://example.com`） | 終了コード0、577バイト取得 | 終了コード6、名前解決に失敗 |
| IPv4のTCP（`1.1.1.1:443`） | 接続成功 | `EPERM` |
| OSの名前解決（未使用の名前） | `1.1.1.1`に解決 | 名前解決に失敗 |
| IPv4のUDP（`1.1.1.1:53`へのDNS問い合わせ） | 問い合わせに対応する応答を受信 | `EPERM` |
| IPv6のTCP（`[2606:4700:4700::1111]:443`） | `EHOSTUNREACH`、経路なし | `EPERM` |
| IPv4のループバック（`127.0.0.1`） | 接続成功 | 接続成功 |

確認したのは、表にあるパスの読み取りだけである。キーチェーンのAPIや、表にない保存先は試していない。Voidとcfは起動していない。

### 要る環境変数だけを渡す

上のプロファイルを作業クローンの外に保存し、その絶対パスを`profile`に入れる。`PATH`に実行に要る道具を足すときは、そのディレクトリの絶対パスだけを足す。ホストの`PATH`は引き継がない。

```sh
host_home="$(cd "$HOME" && pwd -P)" || exit 1
spike_dir="$(/usr/bin/mktemp -d /tmp/yoin-void-spike.XXXXXXXX)" || exit 1
/bin/mkdir "$spike_dir/home" "$spike_dir/tmp" || exit 1

run_spike() (
  cd "$spike_dir" || exit 1
  /usr/bin/env -i PATH=/usr/bin:/bin HOME="$spike_dir/home" \
    TMPDIR="$spike_dir/tmp" LANG=C \
    /usr/bin/sandbox-exec -D "HOST_HOME=$host_home" -f "$profile" "$@"
)

run_spike /usr/bin/env | /usr/bin/cut -d= -f1
```

最後の行が出すのは、渡した環境変数の名前だけである。名前を試作の記録に残す。通信と読み取りの確認も`run_spike`で行い、すべての起動条件を満たしてから、同じ方法で試作を起動する。

## #114の起動前の確認（2026-11-28）

#116が`main`に入ったあと、macOS 26.6.2（arm64）で通信の遮断とファイルの読み取り拒否を確かめた。作業クローンの外に試作用のディレクトリを作り、上と同じプロファイルにホストのホームの実パスを渡した。`env -i`から渡した変数は`PATH`、`HOME`、`TMPDIR`、`LANG`だけで、`HOME`は空と確かめた。Voidとcfは起動していない。

| 通信の確認 | 遮断なし | 遮断あり |
|---|---|---|
| HTTPS（`https://example.com`） | HTTP 200 | 終了コード6、名前解決に失敗 |
| OSの名前解決（未使用の`sslip.io`配下の名前） | `192.0.2.7`に解決 | 名前解決に失敗 |
| IPv4 TCP（`example.com`の解決先`104.20.23.154:443`に直接接続） | 接続成功 | `EPERM` |
| IPv4 UDP（`8.8.8.8:53`へのDNS問い合わせ） | 問い合わせに対応する応答を受信 | `EPERM` |
| IPv6 TCP（`[2001:4860:4860::8888]:443`に直接接続） | `EHOSTUNREACH`、経路なし | `EPERM` |
| IPv4ループバック（`127.0.0.1`） | 接続成功 | 接続成功 |

| 読み取りの対象 | 遮断なし | 遮断あり |
|---|---|---|
| ホストにある`~/.ssh`、`~/.gitconfig`、`~/Library/Keychains`、`/Library/Keychains`、`/System/Library/Keychains` | 読めた | 拒否 |
| ホストの`~/.aws`、`~/.config`、`~/.npmrc`、`~/.git-credentials`、`~/.git-credential-cache`、`~/.wrangler` | 存在しない | 未実施 |
| ホストのホーム配下の全対象を模したファイルとディレクトリ、各対象ディレクトリ内の空ファイル | 読めた | 拒否 |

読み取りでは存在と成否だけを記録した。キーチェーンのAPIや表にない保存先は試していない。

| 待ち受け | 確認したサービス |
|---|---|
| TCP、全IPv4アドレス | `devin-remote`（6080、6789、6790、9876）、`launchd`のSSH（22） |
| TCP、全IPv6アドレス | `launchd`のSSH（22） |
| TCP、IPv4ループバック | `devin-remote`（32403） |
| UDP、固定ポート | `mDNSResponder`（5353、IPv4・IPv6）、`netbiosd`（137、138）、`syslogd`（64809）、`replicatord`（56858）、`fitnessintelligence`（54409、65509） |
| UDP、ポート表示なし | `airportd`、`configd_sim`、`identityservices`、`wifip2pd` |

`lsof`と`netstat`で待ち受けを調べた。有効なシステムプロキシ設定は見つからなかった。待ち受けサービスが外へ中継しないことは試していない。IPv6は遮断なしで届く宛先との比較ができなかった。

### 配布物と雛形の準備

取得先はnpmレジストリに限り、ロックファイルの配布元と整合性情報を確かめ、`npm ci --ignore-scripts`で入れた。まずVoidの配布物を調べ、別の空のディレクトリに既存画面と同じReactの静的な雛形を作るための依存を置いた。

| 用途 | 入れた版 |
|---|---|
| CLIと手元のWorkers実行環境 | `void@1.12.2`、同梱の`cf@1.0.0-rc.5`、`miniflare@5.20261123.1-beta`、`workerd@1.20261123.1`、`@cloudflare/workerd-darwin-arm64@1.20261123.1` |
| Reactの静的な雛形 | `@void/react@1.12.2`、`react@19.3.1`、`react-dom@19.3.1`、`hono@4.13.23` |
| 雛形の開発用 | `vite@8.4.0`、`typescript@7.0.2`、`oxc-transform-react@0.156.0`、`@types/react@19.3.3`、`@types/react-dom@19.3.0` |

`workerd`と`esbuild`（0.18.20、0.25.12、0.28.2）の`postinstall`は`node install.js`で、機種に合う実行ファイルを探して版を確かめる。見つからない場合は取得も試みる。macOS arm64用の実行ファイルは任意の依存パッケージから取得できた。`fsevents@2.3.3`にも配布済みのarm64対応バイナリがあった。これらを入れるためにインストールスクリプトが必須だという根拠は見つからなかった。スクリプトもバイナリも動かしていない。

`create-void@1.12.2`は配布物を読むだけにした。配布物の`dist/main-CYIGj7S3.mjs`では、Voidのインストール、`void init`、雛形の依存のインストールを順に呼ぶ。新しい場所でこの入口を使うと、通常はパッケージの取得が要るので使わない。

`void init`は同梱の雛形と画像からファイルを作る（`dist/init-B2VZ2Hut.mjs`）。`--deploy none`はVoidやCloudflareへの接続設定を飛ばす。依存を足すとインストールを呼び、雛形が書く`postinstall`は`void prepare`を呼ぶ。依存を先にそろえたReactの静的な雛形なら、このインストールの分岐を通らないと読める。

### Node.jsを入れ替えずにVoidを初起動した

このMacの既存のNode.jsは`v24.21.0`で、Voidとcfが求める版に届かない。両方が支える[Node.js 24.22.3の公式配布](https://nodejs.org/dist/v24.22.3/)からmacOS arm64版を取り、`SHASUMS256.txt`の値と一致することを確かめた。試作専用のディレクトリに展開し、既存のNode.jsは変えなかった。

試作用のNode.jsを`PATH`の先頭に置き、同じプロファイルで起動前の確認をやり直した。渡した環境変数は`PATH`、`HOME`、`TMPDIR`、`LANG`だけで、Voidの起動前に空の`HOME`を用意した。

| 確認 | 遮断なし | 遮断あり |
|---|---|---|
| HTTPS（`example.com`）とOSの名前解決 | HTTP 200、`192.0.2.7`に解決 | 名前解決に失敗 |
| IPv4の直接TCP（`172.66.147.243:443`）とUDP（`8.8.8.8:53`） | TCP接続、UDP応答あり | いずれも`EPERM` |
| IPv6の直接TCPとIPv4ループバック | 外向きIPv6は経路なし、ループバックは接続成功 | 外向きIPv6は`EPERM`、ループバックは接続成功 |
| ホストに存在する認証情報パス5件、模擬の認証情報パスと空ファイル15件 | 読めた | すべて拒否 |

ホストに存在しない認証情報パスは前と同じ6件だった。再確認時の待ち受けは、上の表にあるサービスに加え、`devin-remote`がIPv4ループバックの54175番でも待ち受けていた。有効なシステムプロキシ設定は見つからなかった。

| 遮断下で行った操作 | 結果 |
|---|---|
| `node …/void/dist/cli/cli.mjs --version` | 終了コード0、`1.12.2` |
| 同じ入口に`init --toolchain vite --framework react --starter static --deploy none --no-git`を渡す | 終了コード0、`Created a static React Pages starter` |

試作ディレクトリに`pages/index.tsx`、`vite.config.ts`、`void.config.ts`などができた。依存の指定は用意したロックファイルと一致し、出力に依存のインストールはなかった。遮断は緩めていない。C02は未完了のまま。開発サーバーの起動、C03のパスキー・Cookie・CronとD1の試験はまだ行っていない。CPU時間は、パスキーの確かめとPushの暗号を手元で動かせるようになってから、製品の実装前にオーナーが計る。
