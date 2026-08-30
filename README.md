# にゃんこつき アーケード

にゃんこつきのミニゲーム10本をブラウザで遊べる形にまとめたリポジトリ。GitHub Pagesで公開している。

## ゲーム一覧

| フォルダ | タイトル |
| --- | --- |
| `games/blockpuzzle` | ブロックパズル |
| `games/rungame` | ねこつきラン |
| `games/03_waon` | 和音を作れゲーム |
| `games/04_chordquiz` | コード当てクイズ |
| `games/05_shooting` | ミニシューティング |
| `games/06_haetataki` | 刺される前に叩け |
| `games/07_tomero` | 10秒で止めろゲーム |
| `games/08_shinkeisuijaku` | 神経衰弱ゲーム |
| `games/09_shiwake` | 仕分けゲーム |
| `games/10_mosaic` | モザイク解除クイズ |

多くのゲームはキーボード操作が前提。

## 開発メモ

各ゲームフォルダの `launch.sh` / `serve.py` はローカル確認用（GitHub Pages上では未使用）。

現時点では各ゲームの編集元（source of truth）は別の場所にあり、`games/` はその公開用コピー。
今後、編集元をこのリポジトリに一本化する予定（Desktopアプリのショートカット付け替えとセットで対応）。
