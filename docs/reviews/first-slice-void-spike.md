# 最初の1本: Voidの試作

## 上流への問い合わせ案（未投稿）

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
