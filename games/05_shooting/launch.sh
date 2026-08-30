#!/bin/bash
# ミニシューティング ランチャー
# file:// で開くと画面録画時に実パスが映り込むので、必ずローカルサーバー経由で開く

PORT=8980
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! lsof -i ":$PORT" >/dev/null 2>&1; then
  (python3 "$DIR/serve.py" "$PORT" "$DIR" >/dev/null 2>&1 &)
  sleep 0.5
fi

# スマホ実機テスト用に、同じWiFi内からアクセスできるURLをダイアログで表示する
# (ターミナルを開かずに済むように。IPアドレスはこのポップアップにしか出さない)
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
if [ -n "$LAN_IP" ]; then
  osascript -e "display dialog \"同じWiFi内のスマホからはこちら:\n\nhttp://$LAN_IP:$PORT/\" with title \"ミニシューティング\" buttons {\"OK\"} default button 1" >/dev/null 2>&1 &
fi

open "http://127.0.0.1:$PORT/"
