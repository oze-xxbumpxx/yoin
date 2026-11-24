# 論点の記録: AWSのエミュレータを開発と試験に入れるか

- 機能名: aws-emulator
- 確認のページ: https://claude.ai/artifact/JNv7XSP9D5sDTBtKtuuHeQ
- 進み具合: docs/discussions/aws-emulator.progress.json

## 背景

2026-11-24に大関さんから、AWSのエミュレータ（手元のコンテナでAWSのAPIをまねる道具）を開発と試験に入れたいと提案があった。いまの試験計画（PR #43でマージ）は、CIで外部サービスにつながず、DBは使い捨てのPostgres、AWSの部品は代わりの実装、ログインは試験用のJWTで通す。Scheduler・失敗キュー・S3・SSMを実際のAPIの形で呼ぶのは、大関さんが結合検証のAWSで確かめるまで誰も試さない。道具を足すのはADR-0004の範囲なので、候補を比べて大関さんに選んでもらう。

## 前提

- ClaudeとDevinはAWSとNeonにつながない（AGENTS.md「コマンドの範囲」）。確認なしで通信してよいのは、このリポジトリのGitHub、パッケージの取得先、手元の試験が使うlocalhostだけ。
- CIは外部サービスにつながない（試験計画の冒頭、実装計画の「CIと成果物」）。
- 使うAWSの部品は、Lambda、API Gateway（HTTP API）、EventBridge Scheduler、Cognito、S3、SES、SQS、SSM Parameter Store、CloudFront（`docs/architecture.md`、ADR-0007）。
- 結合試験のDBはGitHub ActionsのPostgresのコンテナ（ADR-0004の決定8）。ここは変えない。
- 2026-11-24に調べた事実（出典は各論点の根拠）
  - LocalStackは2026-03-23から、使うのにアカウントと認証トークンが要る。無料のHobbyは「趣味と商用でない利用」向けで、CIで動かすことも含む。いちばん安い有料のBaseは1人月39ドル（年払い）か45ドル（月払い）。
  - LocalStackのHobbyに入るのは、Lambda、SQS、SES（v1）、EventBridge Scheduler、S3、SSM。CognitoのユーザープールとAPI GatewayのHTTP API（v2）はBase以上。
  - LocalStackのSchedulerは、予約した時刻に実際に宛先のLambdaやSQSを起動する。ただし、FlexibleTimeWindowを無視し、失敗しても再試行せず、止めていたあいだの分はやり直さない。
  - MiniStack・Flociは、アカウントの要らないMITライセンスの代わりの道具。MiniStackはCognitoやSchedulerも「対応」と書いているが、実際に動くかは確かめた記事が見つからなかった。

## 論点

### AWSのエミュレータに、どれを使うか

<!-- id: emulator-choice -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 最初の1本のCIのタスク（実装計画「CIと成果物」）は、まだDevinに渡していない。渡す前に決めれば、CIの作りと試験計画に最初から入れられる。
- 根拠: LocalStackの料金（https://www.localstack.cloud/pricing ）とライセンス（https://docs.localstack.cloud/aws/licensing/ ）、Scheduler（https://docs.localstack.cloud/aws/services/scheduler/ ）、Cognito（https://docs.localstack.cloud/aws/services/cognito-idp/ ）、API Gateway（https://docs.localstack.cloud/aws/services/apigateway/ ）、無料の代わりの道具の比較（https://innomizetech.com/blog/free-local-aws-emulators-in-2026-what-each-one-runs-and-where-each-one-stops ）、MiniStack（https://www.ministack.org/ ）
- 選択肢:
  - A) LocalStackの無料のHobbyを使う。認証トークンはGitHubのSecretsと各自の手元に置く
    - 利点: 利用者が多く、Schedulerが時刻に宛先を起動することを公式が書いている。Scheduler・SQS・S3・SSM・Lambdaが無料の範囲に入る
    - 欠点: CognitoとHTTP APIは入らないので、ログインは今の試験JWTのまま。商用でない利用が条件で、条件はまた変わりうる（2026-03に一度変わった）。LocalStackの認証の通信を「コマンドの範囲」に足し、トークンの置き場所が増える
  - B) アカウントの要らないMiniStackかFlociを使う
    - 利点: 無料でトークンも要らず、通信の決まりを変えなくてよい。MiniStackはCognitoとHTTP APIも対応と書いている
    - 欠点: 新しい道具で、Schedulerの起動やCognitoのJWTが実際に動くかを確かめた記録が見つからない。動かなければ試験の結果を信じられず、調べる手間がDevinに乗る
  - C) LocalStackの有料のBaseを使う
    - 利点: CognitoとHTTP APIも入り、ログインからAPIまでをエミュレータで通せる
    - 欠点: 月45ドル前後かかり、AWSの費用の試算（月約4.50円）の1万倍を超える。CognitoのメールOTPと登録前Lambdaがどこまで動くかは確かめていない
  - D) 入れない。今の代わりの実装と、結合検証のAWSでの確認のまま進める
    - 利点: 道具も決まりも増えない
    - 欠点: Schedulerの予約の引数やSQSの失敗キューの設定の誤りは、大関さんが結合検証で動かすまで見つからない
- 推奨: A（無料の範囲で、試験計画が実環境まで残しているSchedulerと失敗キューを先に確かめられる。ログインは今も試験JWTで通しているので、Cognitoが無くても困らない）

### エミュレータで、何を確かめるか

<!-- id: emulator-scope -->

- 工程: 設計
- 種類: 設計
- 優先度: 高
- 状態: 回答待ち
- なぜ今: 範囲でCIの作りと、試験計画のどの試験を書き直すかが変わる。
- 根拠: 試験計画`docs/tests/first-slice.md`のI04〜I07・I13・M07・M08、実装計画の「iPhoneへの通知」「環境と監視」
- 選択肢:
  - A) AWSにつなぐ部品の結合試験だけに使う。Schedulerの予約の作成・世代の切り替え・取り消し、SQSの失敗キュー、S3の署名付きURL、SSMの読み取り、SchedulerからLambdaが起動されること。CIではPostgresのコンテナと並べて動かす
    - 利点: 今の試験計画の層をそのまま使い、代わりの実装で済ませていたところだけを本物のAPIの形に置き換えられる。時刻の決まりは今どおり固定時計の試験で確かめる
    - 欠点: Terraformの定義の誤りは、今どおり結合検証まで見つからない
  - B) Aに加えて、Terraformもエミュレータに適用して試す
    - 利点: Scheduler・SQS・S3・SSM・Lambdaの定義の誤りを、PRのうちに見つけられる
    - 欠点: 無料の範囲ではCognitoとHTTP APIを作れないので、環境の定義を分けて一部だけ流す仕組みが要る。本番と違う定義を持つことになる
  - C) 手元の開発でも、画面からAPIまでをエミュレータで動かす
    - 利点: 確かめのスキル（verify-first-slice）で、通知の予約まで手元で動きを見られる
    - 欠点: ログインは試験JWTの入口を手元でも使うことになり、開発用の起動の手順が増える
- 推奨: A（試験計画で代わりの実装に頼っていたところだけを置き換えるのが、変える量に対して得るものが大きい。Bは本番と違う定義を持つことになる）

### 決めたことを、どこに書くか

<!-- id: emulator-rollout -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: 実装計画と試験計画はDevinが書く分担（AGENTS.md「進め方の決まり」）なので、Claudeが直す範囲を決めておく。
- 根拠: AGENTS.md「進め方の決まり」「コマンドの範囲」、ADR-0004の決定8
- 選択肢:
  - A) ClaudeがADR-0004への追記（とAなら「コマンドの範囲」の1行）をPRにする。試験計画と実装計画の直しは、ClaudeがIssueにしてDevinに渡す。CIのタスクより先に入れる
    - 利点: 分担の決まりのとおり。CIのタスクが、直した試験計画を読んで作れる
    - 欠点: PRが2本になる
  - B) ClaudeがADRと試験計画の両方を1本のPRで直す
    - 利点: 早い
    - 欠点: 試験計画はDevinが書く分担を外れる
- 推奨: A（分担の決まりのとおり）
