#!/bin/bash
# terminal-ui 新PC初回セットアップスクリプト

set -e

echo "=== terminal-ui セットアップ ==="

# 1. npm install
echo "[1/4] npm install..."
npm install
cd client && npm install && cd ..

# 2. ビルド
echo "[2/4] クライアントビルド..."
npm run build

# 3. 必要ディレクトリ作成
echo "[3/4] ディレクトリ作成..."
mkdir -p ~/Desktop/uploads

# 4. tmux 確認
echo "[4/4] tmux 確認..."
if ! /opt/homebrew/bin/tmux -V &>/dev/null; then
  echo "  tmux が見つかりません。brew install tmux を実行してください。"
else
  echo "  tmux OK: $(/opt/homebrew/bin/tmux -V)"
fi

echo ""
echo "=== セットアップ完了 ==="
echo "起動: nohup node server.js > /tmp/terminal-ui.log 2>&1 &"
echo "URL:  http://localhost:3001/?user=あなたの名前"
