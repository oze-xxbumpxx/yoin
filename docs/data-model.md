# データモデル

状態：確定（2026-11-06）。2026-11-07にレビューの指摘10件（YADR-01〜10）と、ユーザーストーリーで決まった3点（R8〜R10）を反映。スキーマとLambdaの分け方は[ADR-0002](decisions/ADR-0002-schema-and-functions.md)（2026-11-12承認）。

- 関連：[文脈マップ](context-map.md)、[用語集](glossary.md)、[ADR-0001](decisions/ADR-0001-bounded-contexts.md)、[PR/FAQ](prfaq.md)
- データベース：Neon（Postgres）の1つのデータベース。文脈ごとにスキーマを分ける

## 全体の決まり

- IDはUUIDv7をアプリで作る。
- テーブル名は用語集の英語名を複数形のスネークケースにする（`TicketApplication` → `ticket_applications`）。列もスネークケース。
- スキーマ名はモジュール名と同じ。`group`だけはSQLの予約語なので`groups`にする。
- 状態は`text`とCHECK制約で持つ。値は英語の小文字。
- 公演の日と開場・開演時刻は日本時間の`date`と`time`。チケットの期限とリマインドの送信時刻は`timestamptz`。
- 合計金額、受取できるか、行ったかどうかは保存せず、その場で計算する。
- ほかの文脈がメンバーを指すときは、`user_id`と`group_id`で持つ。
- 特に書いていない列はnull不可。

## 外部キーと、消したときの動き

外部キーごとに、親に従って消えるか、使われていれば消せないかを決める（YADR-07）。

| 動き | 外部キー |
|---|---|
| CASCADE（親に従って消える） | members・invite_links → groups、setlists・setlist_items・concert_artists → concerts、attendance_records・companions・concert_snapshots → attendances、distributions → ticket_applications、buyers・merch_requests → merch_listsとmerch_items、reminder_deliveries → remindersとpush_subscriptions |
| RESTRICT（使われていれば消せない） | concerts.venue_id、concerts.tour_id、concert_artists.artist_id、groups.owner_user_id |
| SET NULL | setlist_items.artist_id |

- 同じスキーマの中で別の行を指すときは、`(group_id, venue_id)`のように所属を含む複合外部キーにする。参照される側に`(group_id, id)`の一意制約を付ける。別グループの会場や品目は結べない。
- 文脈をまたぐID（公演ID、ツアーID、グループID、ユーザーID）には、RESTRICTの外部キーだけを張る。CASCADEは使わない。消す順番はコードが決め、順番を間違えたときにDBが断る。
- このため、マイグレーションはgroups → catalog → attendance・ticket・merch・notificationの順に流す。

## グループの所属と権限（YADR-01）

- 操作した人のIDは、リクエストの中身ではなくJWTから取る。
- 各文脈の公開関数は「操作した人」と「グループID」を受け取り、対象の行と、指定されたID（公演、会場、品目、メンバーなど）がすべて同じグループのものかを確かめる。違えば、存在しないときと同じ「見つからない」を返し、参照先の中身も返さない。
- グッズリストに載せる品目は、そのリストの公演か、公演のツアーのものに限る。

| 操作 | できる人 |
|---|---|
| アーティスト、ツアー、公演、会場、セトリ、品目の登録・編集 | グループのメンバー全員 |
| チケット申込の編集・削除、分配先の指定 | 申込者だけ |
| 購入担当の指定 | グループのメンバー全員。担当にできるのは同じグループのメンバー |
| 頼まれ物の編集・削除 | 頼んだ本人だけ |
| 参戦と参戦記録（座席、同行者、ひとこと）を見る | グループのメンバー全員。解散や外されたあとに本人に残った参戦は本人だけ（R8） |
| 参戦と参戦記録の編集・削除 | 本人だけ |
| 招待リンクの発行、解散 | オーナーだけ（自分用グループではできない） |
| メンバーを外す | オーナーだけ。自分自身は外せない（R10） |
| グループを抜ける | メンバー本人。オーナーは一番前から参加しているメンバーに引き継いでから抜ける。ほかにメンバーがいなければ解散を案内する。自分用グループは抜けられない（R10） |

## 書き込みの順番（YADR-02）

- 書き込みはすべて1つのDBトランザクションの中で行う。最初にグループの文脈の公開関数で、グループ（`groups.status = active`）と操作した人（`users.status = active`、`members.status = active`）を確かめ、その行を`FOR SHARE`でロックする。保存が終わるまでロックを持つ。
- 解散、退会、メンバーを外す・抜けるの開始は、同じ行を`disbanding` / `withdrawing` / `leaving`に更新する。更新は実行中の書き込みが終わるのを待ってから確定し、そのあとの書き込みは断られる。
- 同行者や分配先に別のメンバーを指定するときは、指定されたユーザーの行も同じようにロックして`active`かを確かめる。
- ほかの文脈のテーブルを読むことにはならない。グループの公開関数が同じトランザクションに参加するだけ。
- LambdaからNeonへの接続は、トランザクションの途中で判断を挟める方式にする（HTTPで1回ずつ送る方式は使わない）。道具は工程4で決める。

## グループは1人でもよい

- 1人で行く公演も記録できるように、メンバーが1人だけのグループを認める。`groups.kind`で、仲間と使うグループ（`shared`）と自分用グループ（`personal`）を分ける。
- ユーザー登録のときに、自分用グループを1つだけ自動で作る。招待リンクは出せず、解散もできない。グループ一覧では「自分用」として分けて見せる。
- メンバーなら誰でも、仲間と使うグループを新しく作れる。新しい人の登録には、今までどおり招待リンクが要る。

## アーティストごとのまとめ方

- アーティストはグループごとに登録する。公演とアーティストは`catalog.concert_artists`で多対多にし、フェスと対バンを1件の公演で表す。
- `artists.name_key`に名前を正規化した値（NFKC、小文字、空白を除く）を持ち、グループの中で一意にする。
- 本人の参戦をアーティストごとにまとめるときは、グループをまたいで`name_key`でまとめる。解散後の参戦は`concert_snapshots.artist_name_keys`を使う。
- セトリの曲目に`artist_id`を持たせ、フェスでどのアーティストの曲かを示す。
- ツアーにはアーティストを持たせず、ツアーの公演に付いたアーティストから表示する。

名前でまとめるので、次の誤差が出る。MVP1ではこれを受け入れる（2026-11-07、YADR-09）。まとめ直す機能はMVP2で曲マスタと一緒に考える。

| 場合 | 例 | 集計 |
|---|---|---|
| 改名 | 「ネオン・パレード」が「NEON PARADE」に改名し、グループで名前を直した。改名前に解散したグループの写しは旧名のまま | 旧名と新名が別の行に出る |
| 同じ名前の別のアーティスト | 2つのグループに、別人の「ミナト」がいる | 1つの行に合算される |
| 表記ゆれ | 「ネオン・パレード」と「ネオンパレード」 | 正規化で「・」は消えないので別の行に出る。グループの中では、登録済みのアーティストを選ぶ画面で防ぐ |

## テーブル

### グループ（スキーマ`groups`）

#### `groups.users`ユーザー`User`

yoinに登録した人。Cognitoの言葉はこのテーブルの`cognito_sub`で止める

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `cognito_sub` | text | 一意。Cognitoのユーザーを指す |
| `display_name` | text | グループ内で見える名前 |
| `status` | text | `active` / `withdrawing`。退会を始めたら`withdrawing`にし、以後の操作を断る（F2・F4） |
| `created_at` | timestamptz |  |

#### `groups.groups`グループ`Group`

いつもの仲間の集まり

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `name` | text |  |
| `owner_user_id` | uuid | オーナー`Owner`。users.id（RESTRICT。退会では先に引き継ぐ） |
| `kind` | text | `shared`（仲間と使う）/ `personal`（自分用）。自分用はユーザー登録のときに1つだけ自動で作る（Q9）。招待リンクは出せず、解散もできない。退会のときに消す |
| `status` | text | `active` / `disbanding`。解散の処理を始めたら`disbanding`にして、途中で失敗しても再開できるようにする |
| `created_at` | timestamptz |  |

#### `groups.members`メンバー`Member`

グループに参加しているユーザー

| 列 | 型 | 説明 |
|---|---|---|
| `group_id` | uuid | PK・groups.id |
| `user_id` | uuid | PK・users.id |
| `joined_at` | timestamptz | オーナー退会時の引き継ぎ先を選ぶ順番にも使う（Q4） |
| `status` | text | `active` / `leaving`。外す・抜けるを始めたら`leaving`にし、そのグループでの操作を断る（R10） |

#### `groups.invite_links`招待リンク`InviteLink`

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid | groups.id |
| `token_hash` | text | 一意。URLのトークンはハッシュだけを保存する |
| `expires_at` | timestamptz | 有効期限 |
| `max_uses` | smallint | 利用回数の上限 |
| `used_count` | smallint |  |
| `revoked_at` | timestamptz | null可。解散の1段階目でここに時刻を入れる |

#### `groups.erasure_jobs`解散・退会の進み具合

解散と退会を途中から再開するための記録。専用の関数`erasure-worker`が読む（F3・Q5）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `kind` | text | `disband`（解散）/ `withdraw`（退会）/ `leave`（メンバーを外す・自分から抜ける） |
| `group_id` | uuid | null可。解散と`leave`の対象グループ |
| `user_id` | uuid | null可。退会と`leave`の対象ユーザー。(kind, group_id, user_id)は、終わっていない記録（`status`が`done`でないもの）の中で一意にする（部分一意インデックス、NULLS NOT DISTINCT）。抜けた人がまた入って、もう一度抜けられるようにするため |
| `step` | text | 終わった段階（例：`attendance`）。次の段階から再開する |
| `status` | text | `running` / `done` / `failed` |
| `attempts` | smallint | 失敗した回数 |
| `last_error` | text | null可 |
| `created_at` | timestamptz |  |
| `updated_at` | timestamptz |  |
| `watchdog_at` | timestamptz | null可。止まったときに再開させる1回限りの予約の時刻（R11）。終わったら予約を消してnullにする |

### 公演カタログ（スキーマ`catalog`）

#### `catalog.artists`アーティスト`Artist`

グループごとに登録する

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid | groups.groups.id（RESTRICT） |
| `name` | text | 入力されたままの名前 |
| `name_key` | text | 名前を正規化した値（NFKC、小文字、空白を除く）。(group_id, name_key)で一意。グループをまたぐまとめにも使う（Q1） |

#### `catalog.venues`会場`Venue`

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `name` | text |  |
| `nearest_station` | text | null可 |
| `memo` | text | null可 |

#### `catalog.tours`ツアー`Tour`

公演に共通する情報

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `name` | text |  |
| `merch_sales_info` | text | null可。グッズの販売時間など |
| `official_url` | text | null可 |

#### `catalog.concerts`公演`Concert`

1回のライブ。確定した公演だけを入れる（Q3）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `tour_id` | uuid | null可。(group_id, tour_id)でtoursを指す（RESTRICT）。単発の公演やフェスはnull |
| `venue_id` | uuid | (group_id, venue_id)でvenuesを指す（RESTRICT）。別グループの会場は結べない |
| `title` | text | null可。単発の公演名やフェス名。tour_idかtitleのどちらかは必ず入れる（CHECK。F6） |
| `date` | date | 公演日（日本時間） |
| `doors_open_at` | time | null可。開場時刻。過去の公演は空でもよい |
| `starts_at` | time | null可。開演時刻 |
| `official_url` | text | null可 |

#### `catalog.concert_artists`公演とアーティストの対応

1つの公演に複数のアーティスト（フェス、対バン）を持たせる（Q1）

| 列 | 型 | 説明 |
|---|---|---|
| `concert_id` | uuid | PK・concerts.id |
| `artist_id` | uuid | PK・artists.id（RESTRICT） |
| `position` | smallint | 出演順。ワンマンは1件だけ |

#### `catalog.setlists`セトリ`Setlist`

公演ごとに1つ。同時に編集したときの上書きを防ぐ版番号を持つ

| 列 | 型 | 説明 |
|---|---|---|
| `concert_id` | uuid | PK・concerts.id |
| `version` | int | 保存のたびに1増やす。古い版からの保存は断る |
| `updated_by` | uuid | null可。最後に保存したユーザー。退会でnull |
| `updated_at` | timestamptz |  |

#### `catalog.setlist_items`曲目`SetlistItem`

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `concert_id` | uuid | setlists.concert_id |
| `position` | smallint | (concert_id, position)で一意 |
| `title` | text | 曲名の文字列（MVP1） |
| `artist_id` | uuid | null可。フェスでどのアーティストの曲かを示す（SET NULL） |
| `note` | text | null可。「アンコール」など |

#### `catalog.drafts`下書き`Draft`

確定前の公演。中身はJSONで持ち、確定したらconcertsなどの行を作って消す（Q3）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `created_by` | uuid | users.id。退会で本人の下書きを消す |
| `source` | text | `manual` / `autofill`（MVP2） |
| `payload` | jsonb | ツアー名、公演の日付と会場名、アーティスト名など。会場やアーティストがまだ決まっていなくてもよい |
| `created_at` | timestamptz |  |

### 参戦記録（スキーマ`attendance`）

#### `attendance.attendances`参戦`Attendance`

誰がどの公演に行くか。解散後も本人に残る

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | 参戦する本人（Q2） |
| `group_id` | uuid | null可。解散でnullにする。nullの参戦は本人だけが読める |
| `concert_id` | uuid | null可。catalog.concerts.id（RESTRICT）。解散で写しを作るのと同時にnullにする。(user_id, concert_id)で一意 |
| `created_at` | timestamptz |  |

#### `attendance.attendance_records`参戦記録`AttendanceRecord`

行が1つあれば「行った」。参戦と1対1

| 列 | 型 | 説明 |
|---|---|---|
| `attendance_id` | uuid | PK・attendances.id |
| `seat` | text | null可。座席`Seat`。ブロック、列、番号を自由に書く |
| `comment` | text | null可。ひとこと |
| `hidden_companion_count` | smallint | 人数表示に置き換えた同行者の数。初期値0 |
| `recorded_at` | timestamptz |  |

#### `attendance.companions`同行者`Companion`

メンバーか、yoinを使っていない人の名前のどちらか一方を持つ

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `attendance_id` | uuid | attendance_records.attendance_id |
| `user_id` | uuid | null可。メンバーのとき |
| `name` | text | null可。yoinを使っていない人のとき |

#### `attendance.concert_snapshots`公演の写し`ConcertSnapshot`

解散のときに参戦ごとに作る。あとから変わらない

| 列 | 型 | 説明 |
|---|---|---|
| `attendance_id` | uuid | PK・attendances.id |
| `title` | text | 公演のtitle、なければツアー名 |
| `date` | date |  |
| `venue_name` | text |  |
| `artist_names` | text[] | 出演順の名前。未登録なら空の配列 |
| `artist_name_keys` | text[] | artists.name_keyと同じ正規化。アーティストごとのまとめに使う |
| `setlist` | jsonb | 曲名、順番、アーティスト名、メモの配列。セトリ未登録なら空の配列 |
| `taken_at` | timestamptz |  |

### チケット（スキーマ`ticket`）

#### `ticket.ticket_applications`チケット申込`TicketApplication`

1回の申込と、その状態と期限

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `concert_id` | uuid | catalog.concerts.id（RESTRICT）。同じグループの公演だけ |
| `applicant_user_id` | uuid | 申込者`Applicant`。リマインドの宛先。申込を編集・削除できるのは申込者だけ |
| `sale_name` | text | null可。「FC先行」など、どの受付か |
| `quantity` | smallint | 枚数 |
| `pickup_method` | text | 受取方法`PickupMethod`：`convenience`（コンビニ発券）/ `smart`（スマチケ） |
| `status` | text | `applied` → `won` / `lost`（当落`LotteryResult`）→ `paid` → `picked_up`。先着の申込は`won`から始めてよい。期限切れは保存せず、`won`のまま入金期限を過ぎたら「期限切れ」と計算する（R9） |
| `result_announced_at` | timestamptz | null可。結果発表日時 |
| `payment_deadline` | timestamptz | null可。入金期限`PaymentDeadline`。過ぎても`won`なら期限切れ。期限切れでも申込者は`paid`に直せる |
| `pickup_starts_at` | timestamptz | null可。受取開始日時`PickupStartsAt`。受取できるかは保存せず計算する |
| `updated_at` | timestamptz |  |

#### `ticket.distributions`分配`Distribution`

スマチケの1枚ごとの渡し先

| 列 | 型 | 説明 |
|---|---|---|
| `ticket_application_id` | uuid | PK・ticket_applications.id |
| `seq` | smallint | PK。何枚目か（1〜枚数） |
| `user_id` | uuid | null可。同じグループのメンバーに渡すとき |
| `guest_name` | text | null可。yoinを使っていない人に渡すとき（Q5） |
| `distributed_at` | timestamptz | null可。渡し終えた時刻 |

### グッズ（スキーマ`merch`）

#### `merch.merch_items`グッズ`MerchItem`

ツアーに属し、ツアーがない公演では公演に属する

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `tour_id` | uuid | null可 |
| `concert_id` | uuid | null可。tour_idとconcert_idはどちらか一方だけ入れる。どちらも同じグループのもの |
| `name` | text | 品名 |
| `price` | int | null可。円 |
| `image_key` | text | null可。S3のオブジェクトキー。下書きを確定したら、下書きの画像を引き継ぐ |
| `position` | smallint | 一覧の並び順 |

#### `merch.merch_lists`グッズリスト`MerchList`

公演ごとに1つ

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `concert_id` | uuid | 一意 |

#### `merch.buyers`購入担当`Buyer`

リストの品目ごとに、当日買いに行くメンバー

| 列 | 型 | 説明 |
|---|---|---|
| `merch_list_id` | uuid | PK・merch_lists.id |
| `merch_item_id` | uuid | PK・merch_items.id。リストの公演か、そのツアーの品目だけ |
| `user_id` | uuid | 同じグループのメンバー |

#### `merch.merch_requests`頼まれ物`MerchRequest`

誰がどの品目をいくつ欲しいか。自分の分も1行で持ち、頼んだ人と購入担当が違う行を「頼まれ物」として見せる

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `merch_list_id` | uuid | merch_lists.id |
| `merch_item_id` | uuid | merch_items.id |
| `requested_by` | uuid | 頼んだ人。(merch_list_id, merch_item_id, requested_by)で一意 |
| `quantity` | smallint | 1以上 |

#### `merch.drafts`下書き`Draft`

確定前の品目。公演カタログの下書きとは別のテーブル

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `group_id` | uuid |  |
| `created_by` | uuid |  |
| `source` | text | `manual` / `autofill`（MVP2） |
| `payload` | jsonb | 品名、価格、属するツアーか公演、画像のキー |
| `created_at` | timestamptz |  |

#### `merch.object_deletions`消す予定の画像

品目や下書きを消すのと同じトランザクションで画像のキーを書き、S3から消せたら行を消す（F3）

| 列 | 型 | 説明 |
|---|---|---|
| `object_key` | text | PK |
| `requested_at` | timestamptz |  |
| `attempts` | smallint | 失敗した回数 |

### 通知（スキーマ`notification`）

#### `notification.reminders`リマインド`Reminder`

「この人に、この日に、この文面を届ける」予約。チケットの言葉は持たない

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | 宛先 |
| `dedupe_key` | text | 一意。呼ぶ側が決める文字列（例：`ticket:<申込ID>:payment_deadline`）。同じキーで予約し直すと上書きし、キーで取り消せる |
| `send_at` | timestamptz | 届ける時刻。期限の種類ごとに呼ぶ側が決める（Q3）。この時刻にEventBridge Schedulerの1回限りの予約を作る（R11） |
| `schedule_name` | text | 一意。Schedulerの予約の名前（`reminder-<id>`）。送ったら予約は自動で消える |
| `title` | text |  |
| `body` | text |  |
| `url` | text | null可。通知を押したときに開く画面 |
| `status` | text | `scheduled` → `sending` → `sent`、または`canceled`。取り消せるのは`scheduled`だけ（F5） |
| `claimed_at` | timestamptz | null可。送信の関数が引き受けた時刻。1回の送信を終えて、送れていない端末が残っていればnullに戻す |
| `sent_at` | timestamptz | null可 |

#### `notification.push_subscriptions`通知先`PushSubscription`

Web Pushを受け取る端末

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid |  |
| `endpoint` | text | 一意 |
| `p256dh` | text | Web Pushの鍵 |
| `auth` | text |  |
| `created_at` | timestamptz |  |
| `last_failed_at` | timestamptz | null可。送れなかった端末を画面で示すため |

#### `notification.reminder_deliveries`端末ごとの送信結果

送れていない端末だけをやり直すため（F5・Q4）

| 列 | 型 | 説明 |
|---|---|---|
| `reminder_id` | uuid | PK・reminders.id |
| `push_subscription_id` | uuid | PK・push_subscriptions.id |
| `status` | text | `sent` / `failed` / `gone`（端末が登録を消していた） |
| `attempted_at` | timestamptz |  |

## 解散と退会

### 動かし方（YADR-03、Q5）

- APIは解散・退会・メンバーを外す（抜ける）を受け付けると、F2のロックで状態を`disbanding` / `withdrawing` / `leaving`にし、`groups.erasure_jobs`に行を作ってすぐ応答する。
- 処理は専用の関数`erasure-worker`が行う。APIが非同期で起動する。誰も画面を開かなくても最後まで進む。
- 定期の起動はしない（R11）。APIはジョブを作るときに、EventBridge Schedulerで15分後の1回限りの予約（見張りの予約）を作ってから`erasure-worker`を起動する。`erasure-worker`は動き始めるたびに見張りの予約を1時間後に作り直し、終わったら消す。途中で止まっても、見張りの予約が起動して続きから再開する。Neonが起きるのは、ジョブがあるときだけになる。
- 段階ごとに`erasure_jobs.step`を進める。DBだけで済む処理は1つのトランザクションにまとめる（申込の削除と通知の予約の取り消し、同行者の削除と人数の加算、写しの作成と`concert_id`のnull化）。
- S3の画像は、品目や下書きを消すのと同じトランザクションで`merch.object_deletions`にキーを書く。S3から消せたキーだけ行を消し、失敗したキーは次の回にやり直す。
- 画像のアップロードは、一時置き場（`uploads/`）を通す（R13）。端末は一時置き場に上げてから、APIに確定を頼む。APIはF2のロックを持ったまま、グループとメンバーが有効かを確かめ、S3の中でコピーしてから`image_key`を書き、コミットする。ロックを持っている間は解散・退会・抜けるが始まらないので、コピーが解散の後に届くことはない。コピー先のキーは、確定した品目なら`groups/<group_id>/items/`、下書きなら`groups/<group_id>/drafts/<user_id>/`の下にする。コピーのあとでDBへの保存に失敗すると、どの行も指さない画像がこの下に残る。そのため解散では`groups/<group_id>/`の下を、退会と抜けるでは本人の`drafts/<user_id>/`の下を、`object_deletions`のキーに加えてまとめて消す。確定は同じ画像で何度やり直しても結果が変わらない。解散中・退会中・抜けている途中なら確定しない。一時置き場はS3のライフサイクルの設定で1日後に消えるので、確定されなかった画像も残らない。`groups/`の下に直接上げるURLは出さない。
- どの段階も「まだ残っている行だけを処理する」形にし、2回動いても結果が変わらないようにする。

### 解散で残すもの（Q2）

- 公演日が解散した日（日本時間）以前の参戦は、本人に残す。参戦ごとに`concert_snapshots`を作り、`concert_id`と`group_id`をnullにする。参戦記録がなくても残す。
- 公演日が解散した日より後の参戦（これからの予定）は消す。
- 解散後の参戦は、本人だけが読める。

### 退会で消す範囲（Q1）

- 消すもの：本人だけのデータ。アカウント（Cognitoと`users`）、メンバーの行、参戦と参戦記録と写し、本人が申込者の申込、頼まれ物、下書き、通知の予約と端末。
- 残すもの：グループの全員のデータ。公演、セトリ、確定した品目と画像は残し、作った人の情報は持たない（`setlists.updated_by`はnullにする）。
- ほかの人のデータの中の本人：同行者は人数に置き換える。分配先は空に戻す。購入担当は担当なしに戻す。
- ログには個人の情報を書かない。DBのバックアップは保持期間が過ぎると消える。このことを外部FAQに書く。

### 退会の手順（YADR-04）

1. `users.status`を`withdrawing`にする（F2のロック）。画面には「退会を受け付けました」と出す。
2. Cognitoでサインアウトさせ、アカウントを無効にする。
3. `erasure-worker`がアプリのデータを消す。本人のセッションは要らない。
4. Cognitoのアカウントを削除する。
5. `users`の行を消し、`erasure_jobs`を`done`にする。

- 仲間と使うグループのオーナーなら、1の前に一番前から参加しているメンバーへ引き継ぐ。ほかにメンバーがいなければ、そのグループを解散する。自分用グループは解散と同じ順で消す。
- APIはJWTの署名と期限に加えて、`users`の行が`active`かを毎回確かめる。無効にしたあとも期限内のアクセストークンは残るが、この確認で断れる。
- `users`の行は、招待リンクから登録したときと、最初のオーナーを作るときだけ作る。知らない`sub`のJWTで自動登録はしない。

### メンバーを外す・自分から抜ける（R10）

- 外すのも抜けるのも同じ処理（`erasure_jobs.kind = leave`）で、その人の、そのグループでのデータだけを扱う。
- 始めに`members.status`を`leaving`にする（F2のロック）。その人はそのグループを見られず、書き込みもできなくなる。
- 参戦：公演日が外した（抜けた）日以前の参戦は写しを作って`concert_id`と`group_id`をnullにし、本人に残す。これからの予定は消す。
- チケット：その人が申込者の申込を消し、同じトランザクションで通知の予約を取り消す。ほかの人の申込でその人に分配した行は、渡し先を空に戻す。
- グッズ：その人の頼まれ物と下書きを消す（下書きの画像はobject_deletionsへ）。購入担当の行を消し、担当なしに戻す。
- ほかのメンバーの参戦記録でその人が同行者になっていたら、名前を人数に置き換える。
- 最後にmembersの行を消す。そのあと招待リンクから入り直すことはできる。

### 各文脈で起きること

| 文脈 | 解散のとき | 退会のとき（本人のuser_idで） |
|---|---|---|
| グループ | 最初に`groups.status`を`disbanding`にし、招待リンクに`revoked_at`を入れる。最後にmembers、invite_links、groupsを消す | 最初に`users.status`を`withdrawing`にする。membersの行を消す。最後にusersの行を消す |
| 参戦記録 | 過去の公演の参戦は写しを作って`concert_id`と`group_id`をnullにし、companionsを消してその数を`hidden_companion_count`に足す。これからの公演の参戦は消す | 本人のattendancesを消す（記録、同行者、写しも消える）。ほかの人のcompanionsで本人を指す行は消して、人数に足す |
| チケット | ticket_applicationsを消し（distributionsも消える）、同じトランザクションで通知の予約を取り消す | 本人が申込者の申込を消し、予約を取り消す。ほかの人の申込で本人に分配した行は、渡し先を空に戻す |
| グッズ | 画像のキーをobject_deletionsに書いてから、merch_items、merch_lists、draftsを消す。そのあとS3の画像を消す | 本人のmerch_requestsとdraftsを消す（下書きの画像はobject_deletionsへ）。本人が購入担当のbuyersの行を消す |
| 公演カタログ | グループの行をすべて消す | 本人のdraftsを消す。setlistsの`updated_by`をnullにする |
| 通知 | （チケットからの取り消しで済む） | 本人のreminders、reminder_deliveries、push_subscriptionsを消す |

## 通知

### 届ける時刻（Q3、YADR-08）

チケットが期限の種類ごとに送信時刻を決め、通知に予約する。

| 期限 | 届ける時刻 | `dedupe_key`の例 |
|---|---|---|
| 結果発表日時 | 発表の時刻 | `ticket:<申込ID>:result` |
| 受取開始日時 | 受取開始の時刻 | `ticket:<申込ID>:pickup` |
| 入金期限 | 前日の20時と、締切の3時間前の2回 | `ticket:<申込ID>:payment:eve`、`ticket:<申込ID>:payment:3h` |

- 予約したときに送信時刻がもう過ぎていたら、期限前なら次の起動で送り、期限を過ぎていれば予約しない。

### チケットの状態と予約（R9）

- 当選（`won`）にしたら、入金期限の2回の予約を作る。入金済み（`paid`）にしたら入金期限の予約を取り消し、受取開始の予約を作る。
- 落選、申込の削除、解散、退会、外す・抜けるでは、まだ届いていない予約を取り消す。期限を直したら予約を作り直す。
- 期限切れは保存しない。`won`のまま入金期限を過ぎた申込を「期限切れ」として表示・集計する（受取できるかを計算するのと同じ考え方）。定期の処理が要らず、申込者が期限切れから入金済みに直すのも`won` → `paid`の通常の更新で済む。
- 入金済みにしていない申込には受取開始の予約がないので、期限切れの申込に受取開始の通知は届かない。

### 予約の作り方（R11）

リマインドは1件ずつ、EventBridge Schedulerの1回限りの予約（`at(送信時刻)`）にする。15分ごとの定期の起動はしない。Neonが起きるのは、通知を送るときだけになる。

- 予約するとき：先にSchedulerの予約（名前は`reminder-<予約ID>`）を作り、そのあとDBに`reminders`の行を書く。DBの書き込みが失敗しても、予約が起動したときに行がないので何も送らない。
- 取り消すとき：先にDBの行を`canceled`にし、そのあとSchedulerの予約を消す。予約を消せなくても、起動したときに`canceled`を見て送らない。
- 時刻を直すとき：Schedulerの予約を新しい時刻に更新してから、DBの`send_at`を直す。起動した時刻がDBの`send_at`より前なら、送らずに`send_at`で予約を作り直す。
- 予約したときに送信時刻を過ぎていたら、期限前なら1分後に予約し、期限を過ぎていれば予約しない。
- 送れなかった端末があれば、5分後に1回限りの再送の予約を作る（3回まで）。
- 予約は送ったあと自動で消える設定にする。Schedulerの予約の作成と削除はAPIから呼ぶので、`api`と`erasure-worker`にその権限を与える。

### 送り方（F5、Q4）

- 送信の関数は、送る前に予約を`sending`に更新し、`claimed_at`に今の時刻を入れて引き受ける。更新できた予約だけを送る。
- 引き受けられるのは、`scheduled`の予約と、`sending`で`claimed_at`がnullか10分より前の予約。10分は送信の関数のタイムアウトより長くする。送信の途中で関数が止まっても、10分たてば引き受け直せる。
- 引き受けるときは、送る前に10分後に動く見張りの1回限りの予約（`reminder-watch-<予約ID>`）を作る。送り終えたら消す。関数が止まったときは、この予約で起動し直す。
- 引き受け直したときは、`reminder_deliveries`を見て、送れていない端末だけに送る。
- 取り消しは`scheduled`の予約だけを`canceled`にする。引き受けより先に取り消せば送らない。同じ起動が2回届いても、2回目は引き受けに失敗して送らない。
- 端末ごとの結果を`reminder_deliveries`に残し、送れていない端末だけをやり直す。
- 避けるのは取りこぼし。送信の直後に処理が止まったときの重複と、引き受けたあとに取り消された通知が届くことは許す。

## 前の決定から変える点

- 文脈マップとADR-0001では「各文脈はメンバーIDを使う」とした。参戦は解散後も本人に残るので、ユーザーIDとグループIDで持つ形に変える。メンバーかどうかの確認はグループの文脈に聞く点は変えない。2026-11-12にADR-0002の承認で確定した。
- 自分が買う分も`merch_requests`に入れ、頼んだ人と購入担当が違う行を画面で「頼まれ物」として見せる。用語集の定義は変えない。
- 2026-11-06の「文脈をまたぐIDに外部キーを張らない」は、2026-11-07に「RESTRICTだけ張る」に変えた。
- 2026-11-06の「Lambdaは2つ」は、2026-11-07に「`erasure-worker`を足して3つ」に変えた。
- PR/FAQの「通知は期限の当日中に届けばよい」を、期限の種類ごとの時刻に変えた。
- 2026-11-10、PR #1のレビュー（Codex）を受けて2点を直した。送信の途中で止まったリマインドを10分後に引き受け直せるようにした（見張りの予約を足した）。`erasure_jobs`の一意の決まりを、終わっていない記録だけにかけるようにした。

## 決めたこと

2026-11-06

| # | 決めること | 決定 |
|---|---|---|
| Q1 | 参戦記録をアーティストごとにまとめる方法 | 公演に複数のアーティストを持たせ、グループをまたぐときは名前でまとめる |
| Q2 | ほかの文脈がメンバーを指す方法 | ユーザーIDとグループIDで持つ |
| Q3 | 下書きをどう持つか | 別テーブルにJSONで持つ |
| Q4 | オーナーが退会したときの扱い | 一番前から参加しているメンバーに引き継ぐ。ほかにいなければ解散 |
| Q5 | スマチケの分配先にyoinを使っていない人を入れられるか | 名前で入れられる |
| Q6 | 文脈をまたぐIDに外部キーを張るか | 張らない（11-07にR6で変更） |
| Q7 | Lambdaの関数をどう分けるか | APIで1つ、通知の送信で1つ（11-07にR5で変更） |
| Q8 | グループの文脈のスキーマ名 | `groups` |
| Q9 | 1人で行く公演を記録するグループをどう作るか | 登録したときに自分用グループを自動で作る |

2026-11-07（レビュー対応）

| # | 決めること | 決定 |
|---|---|---|
| R1 | 退会で消す「本人のデータ」の範囲 | 本人だけのデータを消し、共有データは残す |
| R2 | 解散したとき、どの参戦を本人に残すか | 過去の公演は残し、これからの予定は消す |
| R3 | リマインドをいつ届けるか | 期限の種類ごとに時刻を決める |
| R4 | 通知の重複と取りこぼしのどちらを避けるか | 取りこぼしを避け、まれな重複は許す |
| R5 | 解散と退会の処理をどこで動かすか | 専用の関数を足して裏で処理する |
| R6 | 文脈をまたぐIDに外部キーを張るか | RESTRICTだけ張る |
| R7 | 名前でまとめることの誤差を受け入れるか | MVP1では受け入れる |

2026-11-07（ユーザーストーリーの問いへの答え。詳しくは[ユーザーストーリー](user-stories.md)）

| # | 決めること | 決定 |
|---|---|---|
| R8 | 参戦記録の座席とひとことを、同じグループのほかのメンバーも見られるか | 見られる。編集と削除は本人だけ |
| R9 | 入金期限を過ぎても入金済みにしていない申込を、自動で期限切れにするか | 自動で期限切れにする。期限切れは保存せず計算する。申込者は入金済みに直せる |
| R10 | メンバーを外す機能をMVP1に入れるか | 入れる。自分から抜けるも入れる。その人のデータは解散と同じ扱い |

2026-11-07（AWS構成を見て）

| # | 決めること | 決定 |
|---|---|---|
| R11 | リマインドを1件ずつ予約するか、定期的に起動してまとめて送るか | 1件ずつSchedulerの1回限りの予約を作る。Neonの無料枠の計算時間を、定期の起動で使い切らないため。解散・退会の再開も、定期の起動をやめて見張りの予約にする |

2026-11-13（AWS構成のレビューを受けて）

| # | 決めること | 決定 |
|---|---|---|
| R12 | グループを抜けた人が、手元に残った画像の取得用URLで画像を見られる時間 | 取得用URLの有効期限を5分にし、その間は見られる例外として認める。見るたびに確かめるには画像をLambdaに通す必要があり、費用と作りが重くなるため |
| R13 | 解散や削除のあとに、遅れて届いたアップロードで画像ができないようにする方法 | 一時置き場に上げてから、APIがグループの状態を確かめて確定する。確定されなかった画像は1日で自動で消える |

## 試験の一覧

レビューの通過条件を、工程4以降の試験にする。

| 指摘 | 試験 | 期待する結果 |
|---|---|---|
| YADR-01 | Aだけのメンバーと、AとBの両方のメンバーで、Aの画面からBの公演・会場・品目を指定する。A内で別のツアーの品目をリストに載せる | 取得も更新も「見つからない」で断る。Bの中身は返さない |
| YADR-02 | 書き込みを所属の確認の直後で止め、別のセッションで解散・退会を始める。逆の順番も試す | 先に確定した書き込みは削除・写しの対象に入る。開始後の書き込みは断る。孤児の行は0件 |
| YADR-03 | DB更新の直後、S3の応答前、一部の画像の削除に失敗した時点で止め、ジョブを再開する | 通知の取り消し漏れと画像の残りが0件。同行者は1回分だけ人数に足される。止まっても`erasure_jobs`で状態がわかる |
| YADR-04 | 期限内のJWTを持ったまま退会し、手順の途中で止める | 古いJWTで操作も登録もできない。再開後、R1の範囲がすべて消える |
| YADR-05 | 同じ起動を2回渡す。引き受けの前と後に取り消す。2端末のうち1端末だけ送れた直後に止める | 取り消しが先なら送らない。2回目の起動では送らない。送れていない端末だけに送る |
| YADR-06 | 予定・記録なしの過去公演・記録ありの過去公演を同じグループに入れ、セトリ未登録とツアー名だけの公演も含めて解散する | 過去の公演の参戦だけが残り、本人だけが読める。題名とセトリ未登録の表示が出る |
| YADR-07 | 使用中の会場を消す。オーナーが退会する | 会場は消せない。引き継いだグループとほかのメンバーのデータは残る |
| YADR-08 | 日本時間9時締切の入金期限、送信時刻を過ぎてからの予約、日付をまたぐ再試行 | 前日20時と6時に届く。締切前なら次の起動で送り、締切後は送らない |
| R9 | 当選のまま入金期限を過ぎる。その後、入金済みに直す | 期限を過ぎたら期限切れと表示され、受取開始の通知は届かない。入金済みに直すと受取開始の予約ができる |
| R10 | 書き込みの途中でメンバーを外す。過去の参戦・予定・申込・頼まれ物・購入担当・ほかの人の記録の同行者を持つメンバーで試す | 外し始めたあとの書き込みは断る。過去の参戦だけが本人に残り、ほかは消えるか空に戻る。同行者は人数になる |
| YADR-09 | 改名の前後、同じ名前の別人、解散の前後で集計する | 上の「アーティストごとのまとめ方」の表のとおりになる |

## 決めないこと

- 工程4以降：ORMとマイグレーションの道具、LambdaからNeonへの接続の道具（途中で判断を挟めるトランザクションが使えること）、インデックスの細部、文脈の境目を守る検査の道具、セトリを同時に編集したときの画面での見せ方
- 工程6まで：Neonの容量と計算時間、S3の料金、DBのバックアップの保持期間
- MVP2：曲マスタとアーティストのまとめ直し、下書きの`payload`に自動入力の出所を足すか
