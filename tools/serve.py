#!/usr/bin/env python3
"""
開発用ローカルサーバー（キャッシュ無効・ポート 8766 固定）
Usage:
  python3 tools/serve.py            # http://localhost:8766/
  python3 tools/serve.py 8766       # ポート指定（通常は変えない：localStorage がオリジン単位のため）
  open "http://localhost:8766/index.html?midi=samples/test_orchestra.mid"
ES module の import（./sprites.js 等）はキャッシュバスターを付けられないので、サーバー側で no-store にする。
最終更新: 2026-09-12 / v0.2 / 生成元: PixelOrchestra

2026-09-12 修正：「何度かリロードしないとプレビューが真っ暗」の原因はこのサーバー側だった。
  - 標準の request_queue_size は 5（listen backlog）。ES module を十数本まとめて取りに来ると
    待ち行列があふれ、OS が接続を RST で落とす → ブラウザに ERR_CONNECTION_RESET →
    その module だけ import に失敗し、アプリが起動しないまま真っ暗になる（毎回ではないので非決定的）。
  - 標準の protocol_version は HTTP/1.0 ＝ keep-alive 無しで、ファイル 1 本ごとに新しい接続を張る。
    HTTP/1.1 にして接続を使い回し、そもそも同時接続数を減らす。
"""
import sys, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # keep-alive で接続数を減らす（Content-Length は基底クラスが必ず付ける）

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/favicon.ico':  # 無いので 404 を出さず黙って空返し
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, fmt, *args):  # 静かに
        pass

class DevServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128  # 既定の 5 では module のまとめ読みで接続があふれて RST される

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    print(f'serving {os.getcwd()} at http://localhost:{port}/ (no-cache)')
    DevServer(('', port), NoCacheHandler).serve_forever()
