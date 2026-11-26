# 環境と監視

結合検証と本番は `environments/integration` と `environments/production` が同じモジュールを呼び出します。AWSはシンガポール（`ap-southeast-1`）に限定します。Terraformの`default`ワークスペースだけを使います。

| 所有 | 構成 |
| --- | --- |
| 環境別 | HTTP APIとJWT検査、Cognito、3つのLambda、Schedulerグループ、失敗キュー、PWA、通知先、キューとGatewayの警報 |
| 結合検証だけ | アカウントの月5ドル予算、SESのバウンス・苦情抑止、リージョン合計のLambdaとSESの警報 |

共有設定は本番にも効きます。変更するPRはオーナーが差分を見てマージします。本番の配置は別途、オーナーの承認が必要です。

## AWSにつながずに確かめる（I10）

リポジトリのルートから、Terraform 1.12.2、Node.js 24、`zip`、`jq`を用意して実行します。

```sh
bash infra/terraform/tests/check-i10.sh
```

ロック済みのプロバイダーを使い、バックエンドを起動せず、両環境と初回準備を検査します。IaCの試験だけに使うZIPとメールアドレスは実配置に渡しません。PRとmainの「Terraform I10」もこのコマンドを使います。

## 配置の引き継ぎ（#73）

このPRは定義と検査だけです。製品成果物と2人のE2Eがそろうまで配置しません。仮のLambdaは実環境へ配置しません。

- オーナーは[初回準備](bootstrap/README.md)のM09を済ませ、両環境のSES送信元を同じAWSアカウントのシンガポールで検証し、利用申請を行います。プールは手で直しません。
- デプロイは、承認済みの対象SHAと対象環境を決めてから、初回準備の`backends`出力で該当環境の設定だけを選びます。キー、ロック、バケット、アカウントを確認して対応するルートを初期化します。環境別のOIDCロールに別環境・初回状態を渡しません。
- IaC適用ロールのリソース作成権限は配置側で追加します。最初のSES連携で必要な`iam:CreateServiceLinkedRole`はIaC適用ロールにだけ許可し、`iam:AWSServiceName = email.cognito-idp.amazonaws.com`を必須にします。初回状態、CIロール自体や他環境を変更する権限は追加しません。既存の状態用ロールの権限はこのPRで広げません。
- CI成果物の`SHA`と対象の完全SHAを照合し、`SHA256SUMS`で全ファイルを検査してから、同じ絶対パスの`release_dir`と`release_sha`、配置開始時のRFC3339時刻`deployed_at`をTerraformへ渡します。TerraformはLambdaの3つのZIPについても照合します。planとapplyは同じ成果物を使い、planの平文をログや公開成果物に出しません。
- 非公開の入力は`ses_sender_email`と`alarm_email`です。オーナーが配置ジョブへ渡し、ソースやログに書きません。LambdaにはSSMの名前だけを渡し、値は実行時に取得します。
- `deployment`出力のAPI URL・Cognito IDを後続の公開設定に使います。VAPID公開鍵は配置側で別に渡します。PWAを出力先S3に置き、`config.json`には`Cache-Control: no-store`を付けます。CloudFrontは`/assets/*`以外をキャッシュしません。
- オーナーは環境ごとのSNSメール購読を確認し、配置後に試験計画のM06・M07・M10を確かめます。本番は承認済みの配置後だけ確認します。

## 通知実装の引き継ぎ（#69）

予約作成・更新には、Lambdaに渡した`SCHEDULER_GROUP_NAME`、`SCHEDULER_ROLE_ARN`、`SCHEDULER_TARGET_ARN`と`NOTIFICATION_FAILURE_QUEUE_ARN`を使います。予約名は`reminder-*`に限ります。Schedulerの各ターゲットに失敗キュー、最大再試行2回、保持上限3600秒を指定します。通知送信Lambdaの非同期呼び出しも同じキューへ送ります。アプリが一時失敗の残った通知を報告するときは`NOTIFICATION_FAILURE_QUEUE_URL`を使います。キューからの再送は作りません。
