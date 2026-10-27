# FOLD / CITY

折り畳まれた都市を歩き、建築を折り直して道を作る、ブラウザで遊ぶ3D空間パズルです。プレイデータを集計し、Claude Code がステージの調整案を作り、自動で検証してから反映・デプロイする「学習する都市」の仕組みを持っています。筑波大学「メディアデザイン」の授業課題として制作しています。

## 遊び方

キーボードとマウスで遊びます。WASD で移動（Shift でダッシュ、Space でジャンプ）、マウスで視点、操作盤の上で E を押すと Fold Mode に入り、A / D で変形先を選んで E で実行します。R でそのパズルをやり直し、Esc でポーズです。第一区画は「最初の折り目」「パスキューブ」「フォールド・ゲート」の3つのパズルで、最短手数はそれぞれ1手・2手・3手です。URL に `?demo=1` を付けると、ゲームが自分で最後まで遊ぶデモ再生になります（動画の素材づくりは [video/README.md](video/README.md)）。

## 開発

Node.js 22.18 以上が必要です（TypeScript を Node でそのまま実行するため）。

```bash
npm ci
npm run dev        # 開発サーバー
npm test           # ソルバー・検証器・改善ループの単体テスト
npm run validate   # ステージの検証（解けるか、詰みがないか、設計意図を満たすか）
npm run build      # 型チェックと本番ビルド
npm run preview    # ビルドの確認（http://localhost:4173）
npm run e2e        # ブラウザで歩くテストとデモ再生のテスト（preview 起動中に実行。npx playwright install chromium が必要）
npm run video:capture -- video/demo.yaml   # デモを1コマずつ書き出して MP4 にする（ffmpeg が必要）
```

URL に `?debug=1` を付けるとテスト用のフック（`window.__fold`）が有効になり、`?q=low|medium|high` で画質を指定できます。

## 構成

| 場所 | 内容 |
|---|---|
| `src/core/` | 描画に依存しないパズルの中核。ステージのコンパイル、接続の導出、干渉判定、ソルバー、検証器。ゲームと Node のツールで共有する |
| `src/game/` | three.js のゲーム本体。手続き生成の建築、背景都市、移動、カメラ、Fold Mode、音、テレメトリ |
| `src/stages/` | ステージデータ（`area1.json`）と調整用の数値（`tunables.json`）。改善ループが変更するのはここだけ |
| `api/` | Vercel Function。`telemetry.ts` はプレイログを受け取って Vercel Blob に保存し、`telemetry-export.ts` は改善ループにログを渡す（GitHub Actions の OIDC トークンで認証し、前日までのログを日ごとにまとめる） |
| `tools/ai/` | 改善ループの集計・判定・提案の検証・適用 |
| `tools/video/`、`video/` | デモ再生を1コマずつ書き出すツールと、その設定（`video/demo.yaml`） |
| `ai/` | エージェントへの指示（`prompts/`）、出力形式（`schemas/`）、改善履歴（`history/log.json`） |
| `art/blender/` | Blender の Python スクリプトで生成するアセット（`gen_gate.py` → `public/assets/gate.glb`） |
| `.github/workflows/` | `ci.yml`（テストとビルド）、`improve.yml`（毎日の改善ループ） |
| `docs/` | 設計書（`design/`）と公開・運用の手順（`SETUP.md`） |

## 改善ループ

ゲームは匿名のプレイログ（操作の回数・時間・おおまかな位置・アンケート）を送ります。GitHub Actions が毎日ゲームの API からログを受け取って集計し、新しいプレイがあれば Claude Code を非対話で起動します。Claude Code は集計結果とステージを読み、許可された範囲の変更（ヒントの時間や誘導の強さ、あらかじめ用意された配置の候補の選択）を提案ファイルに書き、検証コマンドで自分の提案を確かめます。その後、LLM を使わない別のジョブが提案を検証し直し、合格したときだけステージを書き換え、都市の改訂番号を上げてコミットし、デプロイします。改訂の内容はタイトル画面に表示され、`ai/history/log.json` に記録されます。

公開と運用の設定は [docs/SETUP.md](docs/SETUP.md)、設計の詳細は [docs/design/](docs/design/README.md) にあります。

## ライセンス

MIT License。第三者の素材は使っていません（建築・テクスチャ・音はコードとスクリプトで生成しています）。
