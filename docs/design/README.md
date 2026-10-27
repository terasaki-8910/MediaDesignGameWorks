# FOLD / CITY 設計レビュー v0.2（承認待ち）

ChatGPT との壁打ちで作成された企画・技術設計書 v0.1 を検証し、実装できる粒度まで具体化したもの。作成日は 2026-10-27。ゲーム本体の実装はまだ始めておらず、このレビューの承認後に着手する。

| ファイル | 内容 |
|---|---|
| [00_original_v0.1.md](00_original_v0.1.md) | v0.1 の原本（差分を追うための基準） |
| [01_review.md](01_review.md) | 要件の整理、課題26件の指摘、方式の比較（建築変形、ペンローズの階段、迷路の制約、LLM による生成、LLM の実行方式）、面白さを高める代替案、エリア別の具体案 |
| [02_architecture.md](02_architecture.md) | 3D アセットの制作方針、性能予算、ライブラリの評価、システム構成、ステージのデータモデル、検証ルール、テレメトリ、AI 改善パイプライン、デプロイと秘密情報 |
| [03_roadmap.md](03_roadmap.md) | 依存関係つきのタスク分解、スケジュール案、スコープの階層、Vertical Slice の実装計画と完成判定基準 |
| [verification/](verification/README.md) | パズル案・螺旋回廊の寸法・回転体の余白を確かめた検証スクリプトと結果 |

---

## 結論の要約

企画は成立する。核となる「建築を回して道を作る」遊びは、有限個の状態を持つパズルとして機械的に検証でき、ブラウザでも十分な見た目を出せる。ただし、自由に歩き回れる三人称視点と、検証できる迷路を両立させるには、設計の段階で3つのことを固定する必要がある。1つ目は移動のルールで、歩行セルからは接続が一致したポートを通ってしか出られないようにし、それ以外の境界は手すりと不可視の壁で自動的に塞ぐ（ジャンプは演出に限定する）。2つ目は変形のルールで、操作は動かない場所にあるコンソールからだけ行い、変形中は入力をロックし、回転の掃引が他の建築とぶつかる変形は「干渉」として実行できないようにする。3つ目はペンローズの階段の実現方式で、歩いて体験する無限ループは周期的な空間と見えないテレポートで作り、錯視の絵は固定視点から見る模型として分離する。

技術構成は、three.js 0.186（WebGLRenderer）、pmndrs/postprocessing、Rapier 0.21、Vite 8、TypeScript 6.0、Zod 4、Vitest、Playwright、Biome を推奨する。WebGPURenderer は three.js の開発の主軸だが、メッシュ数の多い場面で CPU 負荷が重いという報告があり、最初の週の Spike で実測比較してから決める。公開は Vercel、ログは Vercel Function を経由して Supabase の Postgres に保存し、改善ループは GitHub Actions の定期実行で回す。LLM は Claude Code の非対話実行で動かし、提案ファイルを書くことと検証コマンドを実行することだけを許す。提案の適用、検証、コミット、デプロイは LLM を使わない別のジョブが行う。

最大のリスクはスケジュール、特にプレイデータを集める期間である。v0.1 の計画では LLM 連携が最終盤にあり、提出物に必要な「改善前後の比較」を作るだけのデータが集まらない恐れがある。そこで、最初の週にデプロイからログ、LLM、コミット、再デプロイまでの最小構成を一周させ、Area 1 の Vertical Slice を完成した時点で公開してデータ収集を始める計画に組み替えた。

LLM の変更範囲は段階で管理する。数値パラメータ（Tier 0）と、人間が見た目と検証を済ませた選択肢の中からの選択（Tier 1）は自動で適用する。LLM が新しい部屋を丸ごと生成する場合（Tier 2）は、本編ではなく Extra モードに公開する。コードの変更（Tier 3）は PR を作るだけに留める。クリア率などの指標だけを追うとパズルが自明になってしまうので、セクションごとに人間が書く「意図契約」（教える内容、最短手数の幅、必須のギミック）を検証器で強制する。

Area 1 は、道路ブロックを回すだけの導入（1手）、面に道が刻まれた巨大な立方体「パスキューブ」、塔のアームとの干渉を使う「フォールド・ゲート」の3セクションで構成する。後の2つは状態探索で検証し、最短手数がそれぞれ2手と3手で、詰み状態がなく、誤った初手は1手の遠回りで済むことを確かめた。一辺12 mの立方体を回すと角が面から2.49 m外側まで掃引することも数値で確かめ、立方体の周囲に隙間を空けて自動で伸びる渡し板でつなぐ設計にした。

作業量は、Claude Code が実装の大部分を担う前提で約64日（週5日で約13週）と見積もった。v0.1 の全範囲は、ほぼ専念できる場合に初めて収まる規模である。締切と作業時間によっては、Must（Area 1 と AI ループと動画）、Should（Area 3）、Could（Area 2 のパズルと Extra モード）の階層に沿って削る。

---

## v0.1 からの主な変更

| 項目 | v0.1 | v0.2 | 理由 |
|---|---|---|---|
| 通路の接続 | `nodes` と `connections` を記述 | キットのポートから計算で導く。手書きは周期リンクなどだけ | 見た目と論理のずれを構造的に防ぐ |
| ジャンプ | 自由 | 演出に限定（ポート封鎖規則） | 近道による迷路の破綻を防ぐ |
| 変形の条件 | 「決められた条件」（未定義） | 物理的な干渉から自動で導く。必要に応じて条件式を追加 | 直感的で、検証器でも計算できる |
| 変形の操作 | E で操作 | Fold Mode に入り、目標状態を選んでプレビューしてから確定 | 誤操作を減らし、悩みどころを「順番」に移す |
| ペンローズの階段 | 錯視、技術検証後に非ユークリッド空間 | 歩くループは周期空間、絵は固定視点の模型。ポータルは発展機能 | 自由カメラでも破綻しない |
| ミラーシフト | Area 3 で初登場し、すぐ複合パズルに使う | Area 3 の冒頭に単独の学習ビート。使える場所はミラー領域に限定 | 学習が間に合い、埋まり事故も防げる |
| LLM の変更範囲 | ステージデータと安全なパラメータ | Tier 0〜3、可変スロット、意図契約 | 品質を守りつつ「判断」と「生成」の両方に関与させる |
| LLM の実行 | 未決 | Claude Code の非対話実行（分析ジョブ）と、LLM を使わない適用ジョブに分離 | 権限を分け、検証を外側のハーネスで必ず行う |
| ログの保存 | Supabase を候補 | Vercel Function から Postgres の専用スキーマへ。Data API は使わず、最小権限のロール | 検証と上限を掛けられ、2026-10-30 の権限仕様の変更にも影響されない |
| デプロイ | Vercel の自動デプロイ | GitHub Actions から Vercel CLI で本番デプロイ | Hobby プランのコミット作成者の制限を避ける |
| 開発の順番 | LLM 連携は終盤 | 最初の週に Walking Skeleton、VS を早期公開してデータ収集 | 改善前後の比較に必要なデータの期間を確保する |
| Unity / Unreal | 必要に応じて使用 | 本線では使わない。動画もゲーム本体からキャプチャ | 移植できない資産に時間を使わない |
| 描画 | Three.js / WebGL | WebGLRenderer を既定、WebGPURenderer は実測で比較 | 安定性と生成精度を優先し、判断は実測で行う |

---

## 承認をお願いしたい判断

| # | 判断 | 推奨 | 代替案 |
|---|---|---|---|
| 1 | 移動と変形のルール（R1〜R6：ポート封鎖、アンカー、掃引干渉、選択式の操作、詰み防止、ジャンプは演出）を全ステージ共通の規則にする | 採用 | ジャンプを完全に無くす（より単純だが操作感が落ちる） |
| 2 | ペンローズの階段を周期空間と固定視点の模型で実装し、ポータルは発展機能に回す | 採用 | 初期版からポータルを実装する（Spike の追加が必要） |
| 3 | LLM の変更範囲を Tier 0・1 は自動適用、Tier 2 は Extra モード、Tier 3 は PR とする | 採用 | Tier 2 を作らず Tier 0・1 だけにする（「生成」の要素が弱くなる） |
| 4 | LLM の実行を Claude Code の非対話実行とし、分析ジョブと適用ジョブを分離する | 採用 | Messages API の単発呼び出し（安価だが自己検証のループがない） |
| 5 | 本番デプロイを GitHub Actions からの Vercel CLI に一本化する | 採用 | Vercel の Git 連携（Bot のコミットで止まる恐れ） |
| 6 | テレメトリを Vercel Function 経由で Postgres の専用スキーマに保存する | 採用 | ブラウザから Supabase の Data API へ直接書き込む（実装は簡単だが検証と上限が掛けられない） |
| 7 | 描画は WebGLRenderer を既定とし、Spike の実測で最終決定する | 採用 | 最初から WebGPURenderer と TSL で作る |
| 8 | 言語は TypeScript 6.0、Lint と整形は Biome | 採用 | TypeScript 7.0（高速だが周辺ツールの対応待ち） |
| 9 | Unity と Unreal を本線から外す | 採用 | 動画の一部だけ Unreal で作る（実プレイとの乖離に注意） |
| 10 | フェーズの組み替え（Walking Skeleton を最初に、VS を早期公開）と Area 1 のパズル案 | 採用 | v0.1 の順番のまま進める |
| 11 | スコープの階層。Area 2 と Area 3 のどちらかを削る場合は Area 2 を縮める | 採用 | Area 3 を縮める |

## 確認したい事項

提出の締切と動画の仕様（長さ、形式、提出方法）を教えてほしい。スケジュール案は 2026-11-02 の週から約13週、週5日作業できると仮定して組んでいるので、締切と週あたりの作業可能時間によってスコープを決め直す。3D アートについては、ご自身で Blender の作業をどの程度するか（Claude Code が書く Blender の Python スクリプトを中心にしてよいか）と、目指す見た目の参考画像があれば知りたい。プレイテストとデータ収集に参加してくれる人数の見込み（学内か学外か）も、改善ループの設計（ゲートの閾値）に関わる。

LLM の認証方法と予算も決めてほしい。推奨は Anthropic API キーで、従量課金だが Console で月額の上限を設定できる。Pro / Max などのサブスクリプションで発行できる CI 用のトークンもドキュメントで案内されているが、利用枠は個人の通常利用を前提としていると書かれており、リポジトリの設定を読み込まない安全な起動方法（`--bare`）では使えない。月の予算の上限（試算では月10〜30ドル程度）もあわせて教えてほしい。各サービスのアカウント（Vercel は Hobby プランでよいか、Supabase、リポジトリの公開・非公開）と、性能の基準にする手元のノートPCの機種も教えてほしい。学外の人のプレイデータを集める場合に研究倫理審査が必要かどうかは、授業担当への確認をお願いしたい。UI の言語は日本語と英語の2つを想定している。

## 承認後に最初に行うこと

承認を受けたら、最初の1週間で Phase 0 を行う。前半の2日で、Walking Skeleton（Vercel への CLI デプロイ、テレメトリの受信と保存、定期ワークフロー、Claude Code による空の提案、コミット、再デプロイ）と、Blender から three.js までのアセットパイプラインを実際に動かし、外部サービスの制約を全て洗い出す。後半の3日で、三人称の移動とカメラ、変形と背景都市の描画性能（WebGLRenderer と WebGPURenderer の比較を含む）、ペンローズのループの継ぎ目を検証し、結果をこの設計書に反映してから Phase 1 に入る。詳しくは [03_roadmap.md](03_roadmap.md) の §10 にある。

---

## 参考情報（2026-10-27 に確認）

- three.js WebGPURenderer の公式マニュアル（WebGL2 へのフォールバック、WebGLRenderer には大きな新機能を追加しない方針）：https://threejs.org/manual/en/webgpurenderer
- WebGPURenderer が多メッシュの場面で CPU 負荷・初回フレームが重いという報告（r183）：https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904
- WebGPU の主要ブラウザ対応：https://web.dev/blog/webgpu-supported-major-browsers
- pmndrs/postprocessing：https://github.com/pmndrs/postprocessing
- Rapier のキャラクターコントローラ（JavaScript 3D）：https://rapier.rs/javascript3d/classes/KinematicCharacterController.html
- Vite 8 の発表：https://vite.dev/blog/announcing-vite8
- Vercel：コミットがデプロイされない理由（コミット作成者の検証）：https://vercel.com/kb/guide/commits-not-triggering-deployments
- Vercel：Claude Code と Cursor Agent のコミットはチームの席なしでデプロイを起動できる：https://vercel.com/changelog/claude-code-and-cursor-agent-no-longer-require-a-team-seat
- Vercel Community：Hobby で AI の共同作成者トレーラーによりデプロイが止まった報告：https://community.vercel.com/t/vercel-hobby-plan-deployment-blocked-by-claude-code-ai-co-author-attribution/35972
- Supabase：無料プロジェクトの一時停止：https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase：public スキーマの新規テーブルが Data API に自動公開されなくなる変更（既存プロジェクトは 2026-10-30 から）：https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- GitHub Actions：60日間活動がない公開リポジトリでの定期ワークフローの無効化：https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
- Claude Code の GitHub Actions での利用：https://code.claude.com/docs/en/github-actions.md
- Claude Code の非対話実行と権限ルール：https://code.claude.com/docs/en/headless.md 、https://code.claude.com/docs/en/permissions.md
- Claude Code の認証と、認証情報の利用に関する記述：https://code.claude.com/docs/en/authentication.md 、https://code.claude.com/docs/en/legal-and-compliance.md
- Claude の料金：https://platform.claude.com/docs/en/about-claude/pricing
- Claude の構造化出力：https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Blender 5.2 LTS と glTF 書き出しの meshopt 対応（二次情報）：https://app.cinevva.com/de/guides/blender-5-for-game-artists

ライブラリの版数は同日に npm レジストリで確認した。Claude の料金は 2026-10-06 時点の値である。
