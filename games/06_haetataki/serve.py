#!/usr/bin/env python3
"""HTTP Range(部分リクエスト)に対応した簡易静的ファイルサーバー。
標準の `python3 -m http.server` は Range ヘッダに対応しておらず、
音声ファイルをモバイル回線で再生する際に「全部ダウンロードし終わるまで
再生が始まらない」原因になるため、代わりにこれを使う。
"""
import os
import re
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class RangeRequestHandler(SimpleHTTPRequestHandler):
    # Pythonのmimetypesは .m4a を非標準の audio/mp4a-latm と判定するため上書きする
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".m4a": "audio/mp4"}

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None

        f = open(path, "rb")
        fs = os.fstat(f.fileno())
        file_len = fs.st_size
        range_header = self.headers.get("Range")

        if range_header:
            m = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if m:
                start_str, end_str = m.groups()
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else file_len - 1
                end = min(end, file_len - 1)
                if start > end or start >= file_len:
                    f.close()
                    self.send_error(416, "Requested Range Not Satisfiable")
                    return None
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-type", self.guess_type(path))
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_len}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
                self.end_headers()
                f.seek(start)
                self._range_length = length
                return f

        self.send_response(200)
        self.send_header("Content-type", self.guess_type(path))
        self.send_header("Content-Length", str(file_len))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        length = getattr(self, "_range_length", None)
        if length is None:
            return super().copyfile(source, outputfile)
        remaining = length
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def end_headers(self):
        # 開発中はスマホのSafari等が古いJS/HTMLをキャッシュし続けて
        # 直した内容が反映されない事故が起きやすいため、常にキャッシュ無効化する
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    os.chdir(directory)
    server = ThreadingHTTPServer(("0.0.0.0", port), RangeRequestHandler)
    print(f"Serving {directory} on port {port} (Range requests supported)")
    server.serve_forever()
