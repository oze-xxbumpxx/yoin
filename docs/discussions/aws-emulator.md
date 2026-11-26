# 論点の記録: AWSのエミュレータを開発と試験に入れるか

- 機能名: aws-emulator
- 確認のページ: https://claude.ai/artifact/JNv7XSP9D5sDTBtKtuuHeQ
- 進み具合: docs/discussions/aws-emulator.progress.json

## 背景

2026-11-24に大関さんから、AWSのエミュレータ（手元のコンテナでAWSのAPIをまねる道具）を開発と試験に入れたいと提案があった。いまの試験計画（PR #43でマージ）は、CIで外部サービスにつながず、DBは使い捨てのPostgres、AWSの部品は代わりの実装、ログインは試験用のJWTで通す。Scheduler・失敗キュー・S3・SSMを実際のAPIの形で呼ぶのは、大関さんが結合検証のAWSで確かめるまで誰も試さない。道具を足すのはADR-0004の範囲なので、候補を比べて大関さんに選んでもらう。

## 前提

- ClaudeとDevinはAWSとNeonにつながない（`docs/agents/command-scope.md`）。確認なしで通信してよいのは、このリポジトリのGitHub、パッケージの取得先、手元の試験が使うlocalhostだけ。
- CIは外部サービスにつながない（試験計画の冒頭、実装計画の「CIと成果物」）。
- 使うAWSの部品は、Lambda、API Gateway（HTTP API）、EventBridge Scheduler、Cognito、S3、SES、SQS、SSM Parameter Store、CloudFront（`docs/architecture.md`、ADR-0007）。
- 結合試験のDBはGitHub ActionsのPostgresのコンテナ（ADR-0004の決定8）。ここは変えない。

## 調べた事実

出典は、最初の論点の根拠にある。

- LocalStackは2026-03-23から、使うのにアカウントと認証トークンが要る。無料のHobbyは「趣味と商用でない利用」向けで、CIで動かすことも含む。いちばん安い有料のBaseは1人月39ドル（年払い）か45ドル（月払い）。
- LocalStackのHobbyに入るのは、Lambda、SQS、SES（v1）、EventBridge Scheduler、S3、SSM。CognitoのユーザープールとAPI GatewayのHTTP API（v2）はBase以上。
- LocalStackのSchedulerは、予約した時刻に実際に宛先のLambdaやSQSを起動する。ただし、FlexibleTimeWindowを無視し、失敗しても再試行せず、止めていたあいだの分はやり直さない。
- 2026-11-25に大関さんの依頼でAWS Emulator（1.0.610）をこの環境に入れて試した（下の「AWS Emulatorを試した結果」）。
- MiniStack・Flociは、アカウントの要らないMITライセンスの代わりの道具。MiniStackはCognitoやSchedulerも「対応」と書いているが、実際に動くかは確かめた記事が見つからなかった。

## AWS Emulatorを試した結果

2026-11-25に、版1.0.610をこの作業環境に入れ、利用状況の送信を止めて（`--telemetry off`）、Node.jsのAWS SDK v3から呼んだ。リージョンはap-southeast-1。

| 試したこと | 結果 |
| --- | --- |
| S3の署名付きURLでPUTとGET、期限切れのURL | 通った。期限切れは403で断った |
| SSMのSecureString | 復号の指定なしでは暗号のまま、指定ありで平文が返った |
| SQSの失敗キュー（受信2回で移す） | 3回目の受信の前に失敗キューへ移った |
| SESv2の送信 | 未確認の宛先を断った（本物のサンドボックスと同じ） |
| Schedulerの1回だけの予約（`at()`、`FlexibleTimeWindow`はOFF） | 予約した秒にSQSとLambdaを起動した。`Asia/Tokyo`の時刻も合った。実行ロールに権限が無いと起動を断り、ログに理由を出した |
| Node.js 22のLambda | 動いた。中からSQSへ送れた。ただし`process.version`はv22.0.0で、`createECDH`と`generateKeyPairSync('ec')`が無い（Web Pushの暗号が動かない） |
| Cognitoの登録前Lambda | 招待の無い登録を`UserLambdaValidationException`で断り、招待つきは通した。Cognitoに起動の権限を与えないと断った |
| CognitoのトークンとJWKS | RS256で署名したトークンを出し、JWKSも公開した。発行者は`https://cognito-idp.ap-southeast-1.localhost:9297/<プールID>` |
| HTTP APIのJWTの確認 | JWTなし・中身を書き換えたもの・期限切れは401。正しいトークンは200でLambdaに`sub`が届いた。署名の途中を1文字変えたトークンも200で通った |
| メールのコードでのログイン | 登録の確認のコードを試験から受け取る手段が無く、試せなかった（Cognitoにメール送信用のLambdaを足せば受け取れる作り） |
| Terraform | 試せなかった。Terraformのレジストリへの通信がこの環境の設定で止められた |

## 論点

### AWSのエミュレータに、どれを使うか

<!-- id: emulator-choice -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 決定
- なぜ今: 最初の1本のCIのタスク（実装計画「CIと成果物」）は、まだDevinに渡していない。渡す前に決めれば、CIの作りと試験計画に最初から入れられる。
- 根拠: AWSの記事（https://aws.amazon.com/jp/blogs/news/test-your-applications-against-aws-locally-with-aws-emulator/ ）、AWS Emulatorのリポジトリ（https://github.com/aws/aws-emulator ）、下の「AWS Emulatorを試した結果」、LocalStackの料金（https://www.localstack.cloud/pricing ）とライセンス（https://docs.localstack.cloud/aws/licensing/ ）、Scheduler（https://docs.localstack.cloud/aws/services/scheduler/ ）、Cognito（https://docs.localstack.cloud/aws/services/cognito-idp/ ）、API Gateway（https://docs.localstack.cloud/aws/services/apigateway/ ）、無料の代わりの道具の比較（https://innomizetech.com/blog/free-local-aws-emulators-in-2026-what-each-one-runs-and-where-each-one-stops ）、MiniStack（https://www.ministack.org/ ）
- 選択肢:
  - A) AWSが公開したAWS Emulatorを使う（2026-11-11公開、CC0、無料、アカウント不要）。起動のときに利用状況の送信を止める
    - 利点: yoinで使う部品がすべて入っている。2026-11-25に試し、Schedulerが予約した秒に宛先を起動し、実行ロールの権限が足りないと起動を断ることまで確かめた。CognitoとHTTP APIも動くので、登録前Lambdaの拒否やJWTの無いAPI呼び出しの拒否も試せる
    - 欠点: 公開から2週間で、毎日版が上がる。Lambdaは本物のNode.jsでなく、Web Pushの暗号（ECDHとES256の署名）が動かない。HTTP APIのJWTの確認は、署名を壊したトークンを通した。メールのコードを試験で受け取るには、Cognitoに送信用のLambdaを足す必要がある
  - B) LocalStackの無料のHobbyを使う。認証トークンはGitHubのSecretsと各自の手元に置く
    - 利点: 利用者が多く、Schedulerが時刻に宛先を起動することを公式が書いている。Scheduler・SQS・S3・SSM・Lambdaが無料の範囲に入る
    - 欠点: CognitoとHTTP APIは入らない。商用でない利用が条件で、条件はまた変わりうる（2026-03に一度変わった）。LocalStackの認証の通信を「コマンドの範囲」に足し、トークンの置き場所が増える
  - C) アカウントの要らないMiniStackかFlociを使う
    - 利点: 無料でトークンも要らない
    - 欠点: Schedulerの起動やCognitoのJWTが実際に動くかを確かめた記録が見つからない
  - D) LocalStackの有料のBaseを使う
    - 利点: CognitoとHTTP APIも入る
    - 欠点: 月45ドル前後かかり、AWSの費用の試算（月約4.50円）の1万倍を超える
  - E) 入れない。今の代わりの実装と、結合検証のAWSでの確認のまま進める
    - 利点: 道具も決まりも増えない
    - 欠点: Schedulerの予約の引数や権限、SQSの失敗キューの設定の誤りは、大関さんが結合検証で動かすまで見つからない
- 推奨: A（無料でトークンも要らず、試験計画が結合検証まで残しているSchedulerの起動と権限を、CIで先に確かめられる。動かないと分かったWeb Pushの暗号とJWTの署名の確認は、今どおり手元の試験と結合検証で見る）
- 決定: A
- 推奨と同じか: 同じ
- 理由: 推奨のとおり
- 選ばなかった理由: B（CognitoとHTTP APIが入らず、アカウントと認証トークンが要る）、C（動くことを確かめた記録が見つからない）、D（月45ドル前後かかる）、E（Schedulerの権限や失敗キューの誤りが結合検証まで見つからない）
- 反映先: docs/decisions/ADR-0004-dev-tools.mdの2026-11-25の追記、AGENTS.mdの「コマンドの範囲」
- 決めた日: 2026-11-25

### エミュレータで、何を確かめるか

<!-- id: emulator-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 決定
- なぜ今: 範囲でCIの作りと、試験計画のどの試験を書き直すかが変わる。
- 根拠: 試験計画`docs/tests/first-slice.md`のI04〜I07・I13・M07・M08、実装計画の「iPhoneへの通知」「環境と監視」
- 選択肢:
  - A) AWSにつなぐ部品の結合試験だけに使う。Schedulerの予約の作成・世代の切り替え・取り消し、SQSの失敗キュー、S3の署名付きURL、SSMの読み取り、SchedulerからLambdaが起動されること。CIではPostgresのコンテナと並べて動かす
    - 利点: 今の試験計画の層をそのまま使い、代わりの実装で済ませていたところだけを本物のAPIの形に置き換えられる。時刻の決まりは今どおり固定時計の試験で確かめる。Web Pushの送信の中身は、エミュレータのLambdaでなく手元のNode.jsで動かす
    - 欠点: Terraformの定義の誤りは、今どおり結合検証まで見つからない
  - B) Aに加えて、Terraformもエミュレータに適用して試す
    - 利点: Scheduler・SQS・S3・SSM・Lambdaの定義の誤りを、PRのうちに見つけられる
    - 欠点: Terraformで作れるかはまだ試していない（レジストリへの通信が止められた）。エミュレータで通っても、本番のAWSで通るとは限らない
  - C) 手元の開発でも、画面からAPIまでをエミュレータで動かす
    - 利点: 確かめのスキル（verify-first-slice）で、通知の予約まで手元で動きを見られる
    - 欠点: エミュレータのJWTの確認は署名を壊したトークンも通すので、ログインの確かめには使えない。開発用の起動の手順が増える
- 推奨: A（試験計画で代わりの実装に頼っていたところだけを置き換えるのが、変える量に対して得るものが大きい。Bは、Terraformを試してから足すかを決めればよい）
- 決定: A
- 推奨と同じか: 同じ
- 理由: 推奨のとおり
- 選ばなかった理由: B（Terraformで作れるかをまだ試せていない）、C（JWTの確認が署名を見ないので、ログインの確かめに使えない）
- 反映先: docs/decisions/ADR-0004-dev-tools.mdの2026-11-25の追記
- 決めた日: 2026-11-25

### 決めたことを、どこに書くか

<!-- id: emulator-rollout -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 決定
- なぜ今: 実装計画と試験計画はDevinが書く分担（AGENTS.md「進め方の決まり」）なので、Claudeが直す範囲を決めておく。
- 根拠: AGENTS.md「進め方の決まり」「コマンドの範囲」、ADR-0004の決定8
- 選択肢:
  - A) ClaudeがADR-0004への追記と、AGENTS.mdの「コマンドの範囲」への1行（エミュレータは利用状況の送信を止めて起動する。LocalStackなら認証の通信を足す）をPRにする。試験計画と実装計画の直しは、ClaudeがIssueにしてDevinに渡す。CIのタスクより先に入れる
    - 利点: 分担の決まりのとおり。CIのタスクが、直した試験計画を読んで作れる
    - 欠点: PRが2本になる
  - B) ClaudeがADRと試験計画の両方を1本のPRで直す
    - 利点: 早い
    - 欠点: 試験計画はDevinが書く分担を外れる
- 推奨: A（分担の決まりのとおり）
- 決定: A
- 推奨と同じか: 同じ
- 理由: 仮決定に異議なし
- 選ばなかった理由: B（試験計画はDevinが書く分担から外れる）
- 反映先: このPR（ADR-0004とAGENTS.md）と、試験計画・実装計画を直すDevin向けのIssue
- 決めた日: 2026-11-25
