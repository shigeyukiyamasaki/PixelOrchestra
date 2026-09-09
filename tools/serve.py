#!/usr/bin/env python3
"""
開発用ローカルサーバー（キャッシュ無効・ポート 8766 固定）
Usage:
  python3 tools/serve.py            # http://localhost:8766/
  python3 tools/serve.py 8766       # ポート指定（通常は変えない：localStorage がオリジン単位のため）
  open "http://localhost:8766/index.html?midi=samples/test_orchestra.mid"
ES module の import（./sprites.js 等）はキャッシュバスターを付けられないので、サーバー側で no-store にする。
最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
"""
import sys, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *args):  # 静かに
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    print(f'serving {os.getcwd()} at http://localhost:{port}/ (no-cache)')
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
