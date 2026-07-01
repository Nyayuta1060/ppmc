# ppmc

`ppmc` は PDF プレゼン向けのデスクトップアプリです。PC の発表者画面/聴衆画面と、将来的なスマートフォン Web コンソール連携を前提にしています。

## 現在の状態

PoC として以下を実装しています。

- Tauri + Vite のデスクトップアプリ構成
- 発表者画面と聴衆画面の 2 ウィンドウ
- ページ番号の状態同期
- フルスクリーン切り替え
- モニター情報表示
- PDFium による PDF ページの画像レンダリング
- ファイルダイアログまたはパス入力による PDF 読み込み

## 開発

```bash
npm install
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Tauri 開発サーバーで起動する場合:

```bash
npm run tauri dev
```

起動後、発表者画面の `Choose PDF` から PDF を選択します。開発用に PDF パスの直接入力も残しています。

将来的なインストール後の起動形式は以下を想定しています。

```bash
ppmc slides.pdf
```

## PDFium

PDF レンダリングには PDFium の動的ライブラリが必要です。現在の PoC は、実行ディレクトリの PDFium ライブラリを優先し、見つからない場合はシステムライブラリから探します。

将来的なリリースでは、GitHub Releases の配布物に PDFium を同梱する方針です。

## 配布方針

初期の公開先は GitHub Releases とします。

Linux 向けの優先順位:

1. AppImage
2. deb パッケージ
3. `curl` / `wget` で取得できるインストールスクリプト
4. snap は後続対応候補

配布形式に関係なく、インストール後は `ppmc` コマンドで起動できる状態を目指します。deb は `/usr/bin/ppmc` を提供し、AppImage はインストールスクリプトで `~/.local/bin/ppmc` に wrapper または symlink を作成する想定です。

詳細設計は [docs/design.md](docs/design.md) を参照してください。
