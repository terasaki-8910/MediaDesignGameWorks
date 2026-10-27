# 公開と改善ループの設定

コードはそろっているので、残っているのはアカウントと秘密情報の設定だけです。ここに書いた設定は、ブラウザのダッシュボードで本人が行う必要があります（認証情報をリポジトリやAIに渡さないため）。

## Vercel（ゲームの公開とログの保存）

Vercel で「Add New → Project」から、この GitHub リポジトリをインポートします。フレームワークは Vite として自動で認識され、`vercel.json` の設定でビルドされます。デプロイが終わると公開URLが発行されます。

次に、プロジェクトの「Storage」タブで Blob ストアを作成し、このプロジェクトに接続します。アクセスは Private を推奨します。接続すると、環境変数 `BLOB_READ_WRITE_TOKEN` がプロジェクトに自動で追加され、ゲームから送られたログが保存されるようになります（変数を追加した後は一度再デプロイしてください）。ストアが無い間も、ゲームはログを受け付けるだけで保存せずに動きます。

`ai/history/` だけが変わったコミットでは再ビルドしないよう、`vercel.json` に Ignored Build Step を設定してあります。

## GitHub（改善ループ）

リポジトリの「Settings → Secrets and variables → Actions」で、次の値を登録します。

| 種類 | 名前 | 値 | 必須 |
|---|---|---|---|
| Secret | `CLAUDE_CODE_OAUTH_TOKEN` | 手元のPCで `claude setup-token` を実行して表示されるトークン（Claude のサブスクリプションの利用枠を使います） | 必須 |
| Secret | `BLOB_READ_WRITE_TOKEN` | Vercel の Blob ストアの画面に表示される読み書き用トークン（集計のために読むだけに使います） | 必須 |
| Variable | `AI_LOOP_MODE` | `auto`（自動で反映）、`pr`（PR を作るだけ）、`off`（停止） | 推奨（未設定なら auto と同じ動き） |
| Variable | `CLAUDE_MODEL` | 使うモデルを固定したい場合だけ指定 | 任意 |
| Secret | `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` | Vercel のアカウント設定で作るトークンと、`vercel link` で生成される `.vercel/project.json` の値 | 任意（下記） |
| Variable | `BOT_GIT_NAME`、`BOT_GIT_EMAIL` | 自動コミットの作成者名とメールアドレス | 任意（下記） |

定期実行（`schedule`）はデフォルトブランチのワークフローだけが動くので、この作業ブランチを main にマージしてから有効になります。動作確認は「Actions → improve → Run workflow」から行い、`force` にチェックを入れると、新しいプレイが少なくても Claude Code が動きます。実行結果の要約は、ワークフローの Summary と成果物（`ai-work`）で確認できます。

自動コミットの後のデプロイについて注意があります。Vercel の Hobby プランでは、コミットの作成者がプロジェクトの所有者と一致しない場合にデプロイが止まることがあります。`VERCEL_TOKEN` などの3つを登録しておくと、改善ループが Vercel CLI で直接デプロイするので、この制限を受けません。登録しない場合は Vercel の Git 連携でデプロイされますが、止まった場合は `BOT_GIT_NAME` と `BOT_GIT_EMAIL` にご自身の GitHub の名前と noreply アドレスを設定する方法もあります。

公開リポジトリで60日間コミットが無いと、GitHub は定期実行を自動で無効にします。授業期間中は問題になりませんが、止まっていたら Actions の画面から有効にし直してください。提出の直前には `AI_LOOP_MODE` を `off` にしておくと、採点の間にステージが変わりません。

## 費用と上限

Claude Code はサブスクリプションの利用枠（回数制限）の範囲で動きます。1回の実行は最大20ターンで、新しいプレイが8セッション未満の日は Claude Code を起動しません。月の実行回数は20回までに制限しています。この2つの値は、Actions の Variables に `AI_MIN_NEW_SESSIONS` と `AI_MAX_RUNS_PER_MONTH` を登録すると変えられます。Vercel と Blob は無料枠の範囲で収まる見込みです。

## アセットの差し替え

プレイヤーを人型モデルにしたい場合は、VRM ファイルを `public/assets/player.vrm` に置くと、マントの人物の代わりに使われます（歩行はプログラムで動かすので、アニメーションのファイルは不要です）。配布されているモデルを使う場合は、利用条件を確認してください。

門のモデルは `art/blender/gen_gate.py` で生成しています。Python 3.13 で `pip install bpy==5.2.3` をした環境で `python art/blender/gen_gate.py` を実行すると、`public/assets/gate.glb` が作り直されます。Blender 本体があれば `blender --background --python art/blender/gen_gate.py` でも同じです。

## プレイテストの印

友人に遊んでもらうときは、URL に `?playtest=1` を付けると、そのログに印が付き、集計で区別できます。
