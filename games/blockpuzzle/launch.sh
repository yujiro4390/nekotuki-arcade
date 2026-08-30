#!/bin/bash
# Launches the block puzzle game via a local server (not file://) so the
# browser address bar never shows the real filesystem path on screen.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8971
cd "$DIR" || exit 1

if ! lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  disown
  sleep 1
fi

open "http://127.0.0.1:$PORT/"
