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
