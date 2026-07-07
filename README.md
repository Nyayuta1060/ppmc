# ppmc

`ppmc` は `pdf-presenter-mobile-console` の略です。PDF presenter と mobile console を一体で扱う、Rust 製の PDF プレゼンツールを目指しています。

`pdfpc` のように PC 上で聴衆画面と発表者画面を分けつつ、スマートフォンの標準ブラウザからページ送りやタイマー操作ができる OS 非依存のモバイル連携を重視します。iOS / Android の専用アプリは前提にしません。

## 目標

- PDF をそのままスライドとして表示する。
- 発表者画面と聴衆画面を分けて表示する。
- キーボード、マウス、将来的なモバイル Web コンソールから操作する。
- インストール後は `ppmc slides.pdf` で起動できるようにする。
- GitHub Releases から AppImage / deb / インストールスクリプトで配布する。

## 現在の状態

PoC として以下を実装済みです。

- Tauri + Vite のデスクトップアプリ構成
- 発表者画面と聴衆画面の 2 ウィンドウ表示
- ページ番号の状態同期
- フルスクリーン切り替え
- モニター情報表示
- PDFium による PDF ページの画像レンダリング
- レンダリング済みページの簡易メモリキャッシュ
- ファイルダイアログまたはパス入力による PDF 読み込み
- 起動引数で渡された PDF パスの自動読み込み準備
- キーボード、クリック、ホイールによるページ操作
- 独自 `.ppmc` ファイルによる発表者ノート表示
- Linux 向け AppImage / deb の GitHub Actions リリースワークフロー
- AppImage を `~/.local/bin/ppmc` から起動するインストールスクリプト

まだ実装前の主な機能は、タイマー、モバイル Web コンソール、QR コード接続です。

## 開発

依存関係と開発用 PDFium を用意して、フロントエンドと Rust バックエンドを確認します。

```bash
npm install
scripts/setup-pdfium.sh
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Tauri 開発サーバーで起動する場合:

```bash
npm run tauri -- dev
```

起動後、発表者画面の `Choose PDF` から PDF を選択します。開発用に PDF パスの直接入力も残しています。

起動引数で PDF を渡す形も想定しています。

```bash
ppmc slides.pdf
```

## `.ppmc` ノート

PDF と同じディレクトリに同名の `.ppmc` ファイルを置くと、PDF 読み込み時に自動で発表者ノートとして読み込みます。例: `slides.pdf` に対して `slides.ppmc`。

```toml
version = 1

[pages.1]
notes = """
1 ページ目で話すこと。
"""

[pages.2]
notes = """
2 ページ目で話すこと。
"""
```

## PDF レンダリング

PDF レンダリングには PDFium を使います。開発環境では以下で `src-tauri/resources/pdfium/libpdfium.so` を取得します。

```bash
scripts/setup-pdfium.sh
```

実行時の探索順は、`PPMC_PDFIUM_LIB`、`PPMC_PDFIUM_DIR`、Tauri の resource dir、`src-tauri/resources/pdfium`、実行ファイル周辺、システムライブラリです。

リリース版では、GitHub Releases の配布物に PDFium を同梱し、一般ユーザーが追加セットアップなしで起動できる形を目指します。

## 配布方針

初期の公開先は GitHub Releases です。

Linux 向けの優先順位:

1. AppImage
2. deb パッケージ
3. `curl` / `wget` で取得できるインストールスクリプト
4. snap は後続対応候補

配布形式に関係なく、インストール後は `ppmc` コマンドで起動できる状態を目指します。deb は `/usr/bin/ppmc` を提供し、AppImage はインストールスクリプトで `~/.local/bin/ppmc` に wrapper を作成します。

GitHub Releases 公開後は、以下の形式でインストールできるようにします。

```bash
curl -fsSL https://raw.githubusercontent.com/Nyayuta1060/ppmc/main/scripts/install.sh | sh
```

バージョンを固定する場合:

```bash
PPMC_VERSION=v0.1.0 sh scripts/install.sh
```

## ドキュメント

詳細な仕様とフェーズ分割は [docs/design.md](docs/design.md) を参照してください。
