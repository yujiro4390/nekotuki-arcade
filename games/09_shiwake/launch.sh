#!/bin/bash
# 仕分けゲーム ランチャー
# file:// で開くと画面録画時に実パスが映り込むので、必ずローカルサーバー経由で開く

PORT=8973
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! lsof -i ":$PORT" >/dev/null 2>&1; then
  # 標準の http.server は Range リクエスト非対応でモバイル再生が遅れるため、
  # 独自のRange対応サーバー(serve.py)を使う
  (python3 "$DIR/serve.py" "$PORT" "$DIR" >/dev/null 2>&1 &)
  sleep 0.5
fi

open "http://127.0.0.1:$PORT/"
