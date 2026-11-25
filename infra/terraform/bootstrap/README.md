# 初回準備と状態の移行（オーナーのみ）

オーナーがMacで初回用のTerraformを適用し、ローカル状態をS3の初回専用キーへ移します。結合検証と本番のCIは、それぞれの状態とロックだけを扱います。この手順ではアプリやDBマイグレーションを配置しません。

## 1. AWSとNeonの接続先を確かめる

- 変更を承認してから作業を始めます。結合検証を先に準備します。本番のNeon作成やSSM登録は、本番側の準備をオーナーが承認した後に行います。
- Macの暗号化されたローカル領域に、このPRがマージされたリポジトリを用意します。クラウド同期、共有バックアップ、画面収録、シェルのトレースを切ります。`umask 077`を設定し、`TF_LOG`と`TF_LOG_PATH`を解除します。
- AWS CLI v2、Terraform 1.12以降（1.x）、Node.js 24、pnpm、jqを用意します。AWSのオーナー用プロファイルで一時認証し、環境に残った別のAWS認証変数を解除します。`AWS_PROFILE`を設定し、`aws sts get-caller-identity --query Account --output text`が対象の12桁のAWSアカウントIDであることを確かめます。以下では同じ認証を使います。
- [Neon Console](https://console.neon.tech/)でシンガポール（AWSの`ap-southeast-1`）に結合検証・本番のプロジェクトを1つずつ作ります。各プロジェクトのプール経由と直接接続の文字列を区別して用意します。
- このAWSアカウントにGitHub用OIDCプロバイダーが既にある場合は適用前に止め、オーナーが既存の利用者と管理元を確認します。共有プロバイダーを消して作り直さないでください。

## 2. 初回用Terraformをローカルで適用する

リポジトリのルートから、対象アカウントIDを設定して実行します。初回は`backend.tf`を作りません。状態は暗号化された作業場所にだけ作ります。

```sh
cd infra/terraform/bootstrap
export TF_VAR_aws_account_id='<対象の12桁のAWSアカウントID>'
terraform init
terraform fmt -check -recursive
terraform validate
terraform test
terraform plan
terraform apply
```

`plan`と`apply`はオーナーの端末だけで実行します。`apply`が出す変更を読み、想定したS3とIAMだけを作ることを確かめてから承認します。planをファイルやログに残しません。S3はバージョン管理、暗号化、公開アクセスの遮断を有効にします。AWSは初回のバージョン管理が反映されるまで最大15分待つよう案内しているため、状態を初めて書く前に15分待ちます。

## 3. 初回専用キーへ移す

同じ暗号化された作業場所で実行します。次のコマンドは状態本体ではなく、S3の設定だけを`bootstrap.tfbackend`に出します。

```sh
terraform output -json backends | jq -er '.bootstrap | to_entries[] | "\(.key) = \(.value | tojson)"' > bootstrap.tfbackend
printf 'terraform {\n  backend "s3" {}\n}\n' > backend.tf
terraform init -migrate-state -backend-config=bootstrap.tfbackend
```

移行先が`bootstrap/terraform.tfstate`であることを確かめ、状態のコピーを承認します。`bootstrap/terraform.tfstate.tflock`はこの状態を扱うTerraformだけが使います。成功するまで、ローカル状態と一時バックアップを保持します。以後の作業コピーでは同じS3設定で`terraform init -reconfigure -backend-config=bootstrap.tfbackend`を実行します。初回用のbackend設定をCIに渡しません。

| 用途 | 状態キー | ロックキー |
| --- | --- | --- |
| 初回 | `bootstrap/terraform.tfstate` | `bootstrap/terraform.tfstate.tflock` |
| 結合検証 | `integration/terraform.tfstate` | `integration/terraform.tfstate.tflock` |
| 本番 | `production/terraform.tfstate` | `production/terraform.tfstate.tflock` |

後続の環境用Terraformには、`terraform output -json backends`の対応するS3設定だけを渡します。`default`ワークスペースを使い、結合検証と本番をTerraformワークスペースで切り替えません。CIから初回状態を`terraform_remote_state`で読みません。

## 4. オーナーがSSMへ値を登録する

ルートへ戻り、同じAWSプロファイルと対象アカウントを確かめます。端末で入力します。値をコマンド引数、環境変数、ファイルに入れません。

```sh
pnpm --dir scripts install --ignore-workspace --frozen-lockfile
node scripts/bootstrap-ssm.ts integration
# 本番の準備を承認した後だけ実行する
node scripts/bootstrap-ssm.ts production
```

| SSM名の末尾 | 入れる値 | 読む役割 |
| --- | --- | --- |
| `runtime/database-url` | Neonのプール経由の接続文字列 | 環境のLambda |
| `runtime/invite-hmac-key` | 招待トークンを作る環境専用の秘密 | 必要なLambdaだけ |
| `runtime/vapid-private-key` | 環境専用のVAPID秘密鍵 | 通知送信Lambda |
| `migration/database-url` | Neonの直接接続文字列 | DBマイグレーション用CI |
| `seed/owner-email`、`seed/owner-display-name` | その環境で使うオーナーのメールアドレス、表示名 | 初期データ用CI |

値は端末に表示されません。スクリプトは`SecureString`で新しく登録し、登録済みの値は上書きしません。途中からやり直すには末尾の名前を追加します（例: `node scripts/bootstrap-ssm.ts integration migration/database-url`）。値の変更は初回登録とは別にオーナーが行います。VAPID公開鍵は秘密ではなく、後続の配置でPWAに渡します。

リポジトリのルートで次を実行し、名前とARNを確認します。環境用Terraformには必要な名前とARNだけを渡し、Lambdaのロールには必要なパラメーターの`ssm:GetParameter`だけを許可します。TerraformのSSMリソースやデータソースで値を扱いません。

```sh
terraform -chdir=infra/terraform/bootstrap output -json ssm_parameter_names
terraform -chdir=infra/terraform/bootstrap output -json ssm_parameter_arns
```

## 5. オーナーがGitHubの承認とOIDCを設定する

1. [GitHub Environments](https://github.com/oze-xxbumpxx/yoin/settings/environments)で`integration`と`production`を作り、デプロイ元を`main`に限ります。本番はオーナーを必須レビュー担当にし、管理者による承認の迂回も無効にします。設定を使えない場合は本番のジョブを有効にしません。
2. リポジトリの管理者はOIDCの既存設定と利用中のロールを先に確認します。この変更はリポジトリの全OIDCトークンに効きます。既存の利用者がいる場合は切り替えを承認してから、[OIDC subjectのリポジトリ設定API](https://docs.github.com/en/rest/actions/oidc#customize-the-oidc-subject-claim-for-a-repository)で次のJSONを`PUT /repos/oze-xxbumpxx/yoin/actions/oidc/customization/sub`に送ります。

   ```json
   {"use_default":false,"include_claim_keys":["repo","context","job_workflow_ref"]}
   ```

3. 後続のデプロイは`deploy.yml`から、`main`で管理する再利用可能な`deploy-terraform.yml`、`deploy-migration.yml`、`deploy-seed.yml`の各ジョブを呼びます。AWSを使うジョブ内で対象のGitHub Environmentを指定し、`id-token: write`でOIDCの短期認証を取ります。本番のジョブは承認とSHA照合を終えるまで本番の権限を取りません。ルートから`terraform -chdir=infra/terraform/bootstrap output -json ci_role_arns`でロールARNを確認できます。長期のAWSキーやSSMの値をGitHub Secretsに置きません。
4. このPRが作るCIロールには、対象の状態またはSSMパラメーターの権限だけを付けます。後続のPRでアプリ用の権限を足す際、CIに初回用バケットポリシーやOIDC・CIロール自体を変更する権限を渡しません。

## 6. オーナーが状態の移行と権限を確かめる（M09）

1. オーナーのMacで、リポジトリのルートから次を実行します。状態を読めて、planが終了コード0で終わることを確かめます。終了コード2は意図しない差分、1はエラーです。結果は端末だけで見ます。状態やplanの内容をチケットやPRに貼りません。

   ```sh
   terraform -chdir=infra/terraform/bootstrap state list >/dev/null
   terraform -chdir=infra/terraform/bootstrap plan -detailed-exitcode
   ```

2. CIのOIDCジョブが揃ったら、各CIロールの短期認証でバケットの`bootstrap/terraform.tfstate`に対する`aws s3api head-object`が`403`（`AccessDenied`）になることを確かめます。認証違いやキーの不存在を合格にしません。先にオーナーの認証で同じキーが存在することを確かめます。
3. 同じCI認証で次を実行し、`AccessDenied`になることを確かめます。`bucket`には対象バケット名を入れます。既存の状態のETagと一致しない条件を付けるため、権限が漏れていても既存の状態を書き換えません。`PreconditionFailed`など、`AccessDenied`以外は不合格です。無条件の書き込みや削除はしません。本番のロールを取る試験にもオーナーの承認が必要です。

   ```sh
   (
     empty_body=$(mktemp "${TMPDIR:-/tmp}/yoin-m09.XXXXXX") || exit 1
     trap 'rm -f "$empty_body"' EXIT
     aws s3api put-object --bucket "$bucket" --key bootstrap/terraform.tfstate \
       --body "$empty_body" --if-match '"m09-never-matches"'
   )
   ```

4. 移行と権限の確認が済んだら、初回用キーを残し、暗号化された場所のローカル状態と一時バックアップだけを破棄します。確認の記録は結果と終了コードだけを残し、値、状態、plan、OIDCトークンはログや成果物に含めません。

## AWSにつながずに確かめる

バックエンドを作っていない作業コピーで、`terraform init -backend=false`、`terraform fmt -check -recursive`、`terraform validate`、`terraform test`を実行します。試験はAWSのモックで動きます。SSMスクリプトは手順4のコマンドで依存を入れ、ルートで`pnpm --dir scripts test`を実行します。テストのSSM送信は差し替えていて、実際の値やAWSの認証を使いません。
