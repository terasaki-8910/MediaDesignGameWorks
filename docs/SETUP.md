# 公開と改善ループの設定

コードはそろっているので、残っているのはアカウントの設定だけです。ここに書いた設定は、ブラウザのダッシュボードで本人が行う必要があります（認証情報をリポジトリや AI に渡さないため）。必須なのは、main へのマージ、Vercel の Blob ストアの接続、GitHub への `CLAUDE_CODE_OAUTH_TOKEN` の登録の3つで、それ以外は任意です。

## 最初に：作業ブランチを main にマージする

Vercel は main ブランチの内容を本番の URL に公開します。ゲームのコードは作業ブランチ（`claude/...`）にあり、main にマージするまでは、本番の URL を開くと 404 NOT_FOUND になります。GitHub の毎日の定期実行も、main にあるワークフローだけが動きます。

GitHub のリポジトリの画面で「Pull requests」タブを開き、「New pull request」を押して、base を `main`、compare を作業ブランチにして Pull Request を作ります。CI（テストとビルド）が通ったら、「Merge pull request」の既定の方法（Create a merge commit）でマージしてください。Squash や Rebase でも動きますが、Rebase ではコミットの作成者が AI のままになり、Vercel の Hobby プランでデプロイが止まることがあります。マージすると Vercel が自動でデプロイし、1〜2分で本番の URL にタイトル画面が出ます。

## Vercel（ゲームの公開とログの保存）

Vercel で「Add New → Project」から、この GitHub リポジトリをインポートします。フレームワークは Vite として自動で認識され、`vercel.json` の設定でビルドされます。

次に、プロジェクトの「Storage」タブで Blob ストアを作成し、このプロジェクトに接続します。アクセスは Private を推奨し、接続する環境には少なくとも Production を含めてください。接続すると、プロジェクトの環境変数に `BLOB_STORE_ID`（新しいストア）または `BLOB_READ_WRITE_TOKEN` が追加されます。どちらでも動き、値をコピーする必要はありません。接続した後に一度デプロイし直すと（main へのマージでも同じ）、ゲームから送られたログが保存されるようになります。

接続できたかどうかは、本番の URL の後ろに `/api/telemetry` を付けて開くと確かめられます。`"storage":"oidc"` か `"storage":"token"` と表示されれば接続できていて、`"none"` なら、ストアが Production に接続されていないか、接続した後にデプロイし直していません。実際に保存されるかは、ゲームを少し遊んでからタブを閉じ、Blob ストアの画面のファイル一覧に `telemetry/日付/` のファイルが現れるかで確かめられます。

Hobby プランの Blob は、書き込みと一覧の取得が月2,000回、読み出しが月10,000回までで、超えると30日間使えなくなります。ゲームはログを3分ごとと画面を閉じたときにまとめて送り、改善ループは前日までのログを1日数ファイルにまとめてから読むので、通常の使い方なら上限に届きません。ダッシュボードでストアのファイル一覧を開くことも回数に数えられるので、何度も開き直さないようにしてください。

`ai/history/` だけが変わったコミットでは再ビルドしないよう、`vercel.json` に Ignored Build Step を設定してあります。

## GitHub（改善ループ）

リポジトリの「Settings → Secrets and variables → Actions」で値を登録します。この画面には「Secrets」と「Variables」の2つのタブがあり、Secrets は登録後に値を見られない秘密の値、Variables は見える設定値です。どちらも「New repository secret」または「New repository variable」を押し、Name と値を入れて保存します。

必須なのは、Secrets の `CLAUDE_CODE_OAUTH_TOKEN` だけです。手元の PC で `claude setup-token` を実行するとブラウザでの認証の後にトークンが表示されるので、それを値として登録します（Claude のサブスクリプションの利用枠を使います）。プレイログは、改善ループが GitHub の発行する OIDC トークンで本人確認をしてゲームの API から受け取るので、Blob のトークンを GitHub に登録する必要はありません。

任意の設定は次のとおりです。

| 種類 | 名前 | 入れる値 | 使いどころ |
|---|---|---|---|
| Variable | `AI_LOOP_MODE` | `auto`、`pr`、`off` のどれか | 未設定なら `auto` と同じ |
| Variable | `CLAUDE_MODEL` | Claude Code の `--model` に渡す名前 | 未設定なら契約の既定のモデル |
| Variable | `BOT_GIT_NAME`、`BOT_GIT_EMAIL` | 自動コミットの作成者名とメールアドレス | 既定でリポジトリの所有者の名前と noreply アドレスになるので、通常は不要 |
| Secret | `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` | Vercel のアクセストークン、チームの ID、プロジェクトの ID | 上の方法でもデプロイが止まる場合だけ |
| Variable | `AI_MIN_NEW_SESSIONS`、`AI_MAX_RUNS_PER_MONTH` | 数値（既定は1と20） | Claude Code を起動する条件と月の上限を変えたいとき |
| Variable | `TELEMETRY_EXPORT_URL` | `https://<ドメイン>/api/telemetry-export` | 本番のドメインを `mirrordimension.vercel.app` から変えたときだけ |

`AI_LOOP_MODE` は改善の反映方法です。`auto` では、検証に通った改善がそのまま main にコミットされてデプロイされます。`pr` では Pull Request を作るだけで、マージするまで反映されません（この場合は「Settings → Actions → General」の一番下にある「Allow GitHub Actions to create and approve pull requests」をオンにしてください）。`off` にすると改善ループが止まるので、提出の直前に `off` にしておくと、採点の間にステージが変わりません。

`BOT_GIT_NAME` と `BOT_GIT_EMAIL` は、改善ループが作るコミットの作成者です。Vercel の Hobby プランは、作成者がプロジェクトの所有者ではないコミットをデプロイしないことがあるので、既定ではリポジトリの所有者の GitHub のユーザー名と noreply アドレス（`数字+ユーザー名@users.noreply.github.com`）を使います。別の名前にしたいときだけ登録してください。コミットのメッセージは `ai:` で始まり、実行のリンクが付くので、AI の改訂であることは区別できます。

`VERCEL_TOKEN` などの3つは、それでも AI のコミットのデプロイが止まる場合だけ使います。登録すると、改善ループが Vercel CLI で直接デプロイします。`VERCEL_TOKEN` は、Vercel の右上のアイコンから「Account Settings → Tokens」を開き、名前を付け、スコープにこのプロジェクトのあるチーム（Hobby の場合は自分の名前のチーム）を選び、有効期限を授業期間より長めにして作ります。値は作成したときにしか表示されないので、すぐにコピーしてください。`VERCEL_PROJECT_ID` はプロジェクトの「Settings → General」の下の方にある Project ID（`prj_` で始まる）、`VERCEL_ORG_ID` はチームの「Settings → General」の下の方にある Team ID（通常は `team_` で始まる）です。手元で `npx vercel link` を実行すると作られる `.vercel/project.json` の `projectId` と `orgId` も同じ値です。

## 動作確認

定期実行（毎日 3:17 JST）は main のワークフローだけが動くので、マージした後に有効になります。動作確認は「Actions → improve → Run workflow」から行い、`force` にチェックを入れると、新しいプレイが少なくても Claude Code が動きます。最初の実行は、ログを集める collect、提案を作る analyze、検証して反映する apply の3つのジョブが順に動けば成功で、データが少ないうちは、感想や記録に表れた問題を1か所だけ小さく直すか、「変更なし」の記録が `ai/history/log.json` にコミットされます。実行結果の要約は、ワークフローの Summary と成果物（`metrics` と `ai-work`）で確認できます。

公開リポジトリで60日間コミットが無いと、GitHub は定期実行を自動で無効にします。授業期間中は問題になりませんが、止まっていたら Actions の画面から有効にし直してください。

## 費用と上限

Claude Code はサブスクリプションの利用枠（回数制限）の範囲で動きます。1回の実行は最大20ターンで、新しいプレイが無い日は Claude Code を起動しません。月の実行回数は20回までに制限しています。少人数で遊ぶ前提なので、1人分のプレイでも改善を試みますが、セッションが5未満のときは1回の改訂で直すのは1か所まで、数値は1回で許容範囲の4分の1までしか動かさないので、1人の感想でステージが大きく変わることはありません。Vercel の関数と Blob は、上に書いた無料枠の範囲で収まる見込みです。

## Vercel 側の任意の環境変数

通常は不要です。リポジトリの名前を変えたり別のリポジトリに移したりした場合は、Vercel のプロジェクトの環境変数に `TELEMETRY_EXPORT_REPOSITORY`（`所有者/リポジトリ名`）を追加してください。ログを読める GitHub のワークフローを、このリポジトリのものに限っているためです。Blob ストアを Public で作った場合は、`TELEMETRY_BLOB_ACCESS` を `public` にすると無駄な再試行が減ります。

## アセットの差し替え

プレイヤーを人型モデルにしたい場合は、VRM ファイルを `public/assets/player.vrm` に置くと、マントの人物の代わりに使われます（歩行はプログラムで動かすので、アニメーションのファイルは不要です）。配布されているモデルを使う場合は、利用条件を確認してください。

門のモデルは `art/blender/gen_gate.py` で生成しています。Python 3.13 で `pip install bpy==5.2.3` をした環境で `python art/blender/gen_gate.py` を実行すると、`public/assets/gate.glb` が作り直されます。Blender 本体があれば `blender --background --python art/blender/gen_gate.py` でも同じです。

## プレイテストの印

友人に遊んでもらうときは、URL に `?playtest=1` を付けると、そのログに印が付き、集計で区別できます。
