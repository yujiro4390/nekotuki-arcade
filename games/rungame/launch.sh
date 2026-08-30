#!/bin/bash
# ねこつきラン ランチャー
# file:// で開くと画面録画時に実パスが映り込むので、必ずローカルサーバー経由で開く

PORT=8972
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! lsof -i ":$PORT" >/dev/null 2>&1; then
  (cd "$DIR" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  sleep 0.5
fi

open "http://127.0.0.1:$PORT/"
