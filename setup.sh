#!/bin/bash
# terminal-ui 新PC初回セットアップスクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_LABEL="com.terminalui.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN="$(which node)"

echo "=== terminal-ui セットアップ ==="

# 1. npm install
echo "[1/5] npm install..."
cd "$SCRIPT_DIR"
npm install
cd client && npm install && cd ..

# 2. ビルド
echo "[2/5] クライアントビルド..."
npm run build

# 3. 必要ディレクトリ作成
echo "[3/5] ディレクトリ作成..."
mkdir -p "$SCRIPT_DIR/user-settings"
mkdir -p "$SCRIPT_DIR/uploads"

# 旧 ~/.termui-settings/ から移行（存在する場合）
if [ -d "$HOME/.termui-settings" ] && [ "$(ls -A "$HOME/.termui-settings" 2>/dev/null)" ]; then
  echo "  旧設定 (~/.termui-settings/) を user-settings/ に移行するっちゃ..."
  cp -n "$HOME/.termui-settings/"* "$SCRIPT_DIR/user-settings/" 2>/dev/null || true
  echo "  移行完了（元ファイルは ~/.termui-settings/ に残しておくっちゃ）"
fi

# 4. tmux 確認
echo "[4/5] tmux 確認..."
if ! /opt/homebrew/bin/tmux -V &>/dev/null; then
  echo "  tmux が見つかりません。brew install tmux を実行してください。"
else
  echo "  tmux OK: $(/opt/homebrew/bin/tmux -V)"
fi

# 5. launchd 自動起動登録（ログイン時に自動起動）
echo "[5/5] 自動起動登録..."
mkdir -p ~/Library/LaunchAgents

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>StandardOutPath</key>
  <string>/tmp/terminal-ui.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/terminal-ui.log</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

# 既に登録済みなら再読み込み
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "  自動起動登録完了（ログイン時に自動起動）"

echo ""
echo "=== セットアップ完了 ==="
echo "すでに起動中っちゃ: http://localhost:3001"
echo "ログ確認: tail -f /tmp/terminal-ui.log"
