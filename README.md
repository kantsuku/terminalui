# Terminal UI

tmux セッションをブラウザで管理・操作する Web アプリ。PC では複数パネル同時表示、スマホではスワイプ切替 + 長文入力に対応。

## 前提条件

- **Node.js** 18 以上
- **tmux** インストール済み（`brew install tmux`）
- **Xcode Command Line Tools**（node-pty のビルドに必要）
  ```
  xcode-select --install
  ```

## セットアップ

```bash
# プロジェクトルートで依存インストール
cd ~/Desktop/terminal-ui
npm install

# クライアント依存インストール
cd client && npm install && cd ..
```

## 開発モードで起動

```bash
# ルートで実行（サーバー + クライアント開発サーバーを同時起動）
npm run dev
```

- サーバー: http://localhost:3000
- Vite 開発サーバー: http://localhost:5173 （こちらをブラウザで開く）
- スマホは同一 LAN 上で `http://<PCのIPアドレス>:5173` へアクセス

## 本番ビルド & 起動

```bash
# クライアントをビルド
npm run build

# サーバー単体で起動（ビルド済みクライアントも配信）
npm start
```

スマホは `http://<PCのIPアドレス>:3000` へアクセス。

## 機能一覧

| 機能 | PC | スマホ |
|------|:--:|:------:|
| セッション一覧 | サイドバー | ヘッダータブ + ハンバーガー |
| 新規セッション（Shell） | ○ | ○ |
| **新規セッション（Claude Code）** | ○ | ○ |
| セッション名リネーム | ○ | ○ |
| セッション終了 | ○ | ○ |
| 複数パネル同時表示（1/2/3/2×2） | ○ | - |
| ログ表示（xterm.js） | ○ | ○ |
| 入力送信 | ○ | ○ |
| **自動YES（y/n 自動応答）** | ○ | ○ |
| 補助キー（Tab/Esc/Ctrl/矢印/Clear） | - | ○ |
| 左右スワイプでセッション移動 | - | ○ |
| 長文入力エリア | - | ○ |
| Ctrl+C（中断） | ○ | ○ |
| セッション永続化（ブラウザを閉じても維持） | ○ | ○ |

## 自動YES 機能

パネル or スマホ入力欄の **YES** ボタンをオンにすると、以下のパターンを検出して自動で応答を送信します:

- `(y/n)`, `[Y/n]`, `(yes/no)` → `y` + Enter
- `Press Enter to continue` → Enter
- `Do you want to ...?` → `y` + Enter
- npm `Is this OK?` → `y` + Enter

## Claude Code セッション起動

「新規セッション」モーダルで **⚡ Claude Code** を選択すると、tmux 内で `claude` コマンドが自動的に起動します。`claude` コマンドが PATH に通っていることが必要です。

## トラブルシューティング

**node-pty のビルドエラー**
```bash
npm install --build-from-source
```

**tmux が見つからない**
```bash
brew install tmux
```

**ポート 3000 が使用中**
```bash
PORT=3001 npm start
```
