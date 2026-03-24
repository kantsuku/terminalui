# Terminal UI — プロジェクト概要

## 口調
- ラム（うる星やつら）風で統一
- 語尾に「っちゃ」「のけ」「だっちゃ」を使う
- 例: 「まかせるっちゃ！」「ダーリン、何かないのけ？」「うち、がんばってるっちゃ！」「ちゅどーん！」など
- テキスト出力全般に適用。コードや技術的な内容はそのままでOK
- グローバルの口調設定はこのプロジェクトでは無効

## 何をするアプリか
スマホ（Tailscale経由）からPCのtmuxセッションをブラウザで操作するWebアプリ。

## アクセス方法
- スマホから: `http://100.121.161.76:3001`（Tailscale IP）
- PCから: `http://localhost:3001`

## 新PC初回セットアップ
```bash
cd ~/Desktop/terminal-ui
bash setup.sh
```
これだけで npm install・ビルド・uploadsフォルダ作成まで全部やるっちゃ。

## サーバー起動方法
```bash
cd ~/Desktop/terminal-ui
# ビルドが必要な場合（クライアント変更後）
npm run build
# バックグラウンドで起動（起動時に shell・claude セッションを自動作成）
nohup node server.js > /tmp/terminal-ui.log 2>&1 &
# 確認
lsof -i :3001
# ログ確認
tail -f /tmp/terminal-ui.log
# 停止
kill -9 $(lsof -t -i :3001)
```

### 自動起動セッションのカスタマイズ
環境変数 `AUTO_SESSIONS` で起動時に自動作成するセッションを指定できる（デフォルト: `shell:shell,claude:claude`）。
```bash
AUTO_SESSIONS="myshell:shell,ai:claude" nohup node server.js > /tmp/terminal-ui.log 2>&1 &
```

### プッシュ通知（ntfy.sh）
環境変数 `NTFY_TOPIC` でサーバー全体のデフォルトトピックを設定できる。
ユーザーごとのトピックは設定画面（⚙ → システム）から設定可能。設定画面の値が優先される。
```bash
NTFY_TOPIC=your-topic nohup node server.js > /tmp/terminal-ui.log 2>&1 &
```
- 3秒間出力がなくなったら「完了」通知（優先度3）
- 確認プロンプト検知で「返事が必要」通知（優先度4）
- 質問通知は30秒クールダウンでスパム防止

## 技術スタック
- **サーバー**: Node.js + Express + ws（WebSocket）+ @homebridge/node-pty-prebuilt-multiarch
- **クライアント**: React + Vite + xterm.js（@xterm/xterm）
- **tmux**: `/opt/homebrew/bin/tmux`（フルパス必須）
- **ポート**: 3001（3000は別サーバーが使用中）

## ディレクトリ構成
```
terminal-ui/
├── server.js          # Express + WebSocket サーバー
├── setup.sh           # 新環境セットアップ（npm install/build/launchd登録）
├── user-settings/     # ユーザー設定JSON（gitignore済み・バックアップ推奨）
├── uploads/           # アップロード画像（gitignore済み）
├── lib/
│   ├── tmux.js        # tmuxセッション管理（list/create/kill/rename）
│   └── ptyManager.js  # node-pty でtmuxにアタッチ、自動Enter機能
├── client/
│   ├── src/
│   │   ├── App.jsx                        # モバイル/PC自動判定
│   │   ├── hooks/useSessions.js           # セッション一覧ポーリング（3秒）
│   │   ├── hooks/useSettings.js           # キャラ設定（サーバー同期）
│   │   └── components/
│   │       ├── TerminalPanel.jsx          # xterm.js + WebSocket（自動再接続付き）
│   │       ├── MobileLayout.jsx           # スマホUI
│   │       ├── MobileLayout.css
│   │       ├── PCLayout.jsx               # PC UI（複数パネル）
│   │       ├── SettingsModal.jsx          # キャラ設定モーダル
│   │       └── NewSessionModal.jsx / RenameModal.jsx
│   └── vite.config.js  # /api, /ws → localhost:3001 にプロキシ
└── CLAUDE.md
```

## データの永続化と移行
- **ユーザー設定**（キャラ名/画像/セリフ等）: `user-settings/{userName}.json` に保存
  - 環境変数 `SETTINGS_DIR` で変更可（デフォルト: プロジェクト内 `user-settings/`）
  - 旧環境の `~/.termui-settings/` は `setup.sh` 実行時に自動移行
- **アップロード画像**: `uploads/` に保存
  - 環境変数 `UPLOAD_DIR` で変更可（デフォルト: プロジェクト内 `uploads/`）
- どちらも gitignore 済みなので別途バックアップ推奨っちゃ

## 重要な実装メモ

### tmux パス問題
tmuxのフルパスを使う。PATHに入っていないことがある。
```js
const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
```

### Claude Code セッション起動
`which` でフルパス解決してから tmux に渡す。
```js
const { stdout } = await execAsync(`which ${command} 2>/dev/null || echo ${command}`);
await execAsync(`${TMUX} new-session -d -s "${sessionName}" "${fullPath}"`);
```

### node-pty 互換性
Node.js v24 では `node-pty` が動かない。`@homebridge/node-pty-prebuilt-multiarch` を使う。

### 自動再接続
TerminalPanel.jsx でWebSocket切断時に2秒後に自動再接続する。
`mounted` フラグでアンマウント後の再接続を防ぐ。

### iOS タッチ問題
ボタンは `onClick` ではなく `onPointerDown` + `e.preventDefault()` を使う。

### レイアウト切替
- 画面幅 < 1024px → モバイル自動
- localStorage の `termui-force-mode` で手動上書き可能

## モバイルUIの構成
```
[ヘッダー: ☰ セッションタブ]
[ステータスバー: ● 接続済み  ‹ 1/N ›]
[ターミナル（セッションカラー border-top + 背景薄染め）]
--- 入力エリア ---
[スキル行: /clear  /commit  git push  git status ... (横スクロール)]
[↑] [↓]                              [自動⏎] [⏎ Enter]
[textarea.............................] [▶]
```
- ヘッダーの ＋ と 🖥 ボタンは削除済み（ドロワーから操作）
- セッションごとに異なる背景色（SESSION_COLORS 配列、6色循環）

### スキル一覧（MobileLayout.jsx の SKILLS 配列）
| ラベル | コマンド | 説明 |
|--------|----------|------|
| /clear | /clear\r | 会話リセット |
| /commit | /commit\r | コミット作成 |
| git push | git push\r | プッシュ |
| git status | git status\r | 変更確認 |
| git diff | git diff\r | 差分確認 |
| /help | /help\r | ヘルプ |
| /add . | /add .\r | 全ファイル追加 |

### 自動Enter機能
`自動⏎` ボタンをONにするとptyManager.jsのパターンマッチで自動的にEnterを送信。
- "enter to confirm" / "press enter" → `\r`
- "do you want to" / "allow" / "trust" / "proceed?" → `\r`
- "(y/n)" / "[Y/n]" など → `y\r`
- "is this ok?" / "are you sure" → `y\r`
- **重要**: WS再接続時に autoYes 状態を自動で再送信する（MobileLayout の connState useEffect）

## よくある問題

### サーバーが起動しない
```bash
# ポート使用中か確認
lsof -i :3001
# 強制終了
kill -9 $(lsof -t -i :3001)
```

### スマホからアクセスできない
Tailscale が両デバイスで有効か確認。PC側のIPは `100.121.161.76`。

### tmuxセッションがない
```bash
/opt/homebrew/bin/tmux new-session -d -s default
```

### Claude Codeの確認プロンプトに反応しない
- `自動⏎` をONにする（再接続後も状態は自動復元される）
- ログで実際のプロンプトを確認: `grep "AutoYes" /tmp/terminal-ui.log`
- パターンが合わない場合は ptyManager.js の AUTO_YES_PATTERNS に追加
