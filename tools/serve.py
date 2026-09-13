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
import sys, os, re, json, posixpath, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 素材（スクリーンに映す透過 PNG / 緑背景 mp4）の置き場所。2026-09-13 ユーザー指定。
# 外付けドライブに素材を置いたまま使いたいので、ここだけを /media/ で公開する。
# tools/media_roots.txt があればそれを 1 行 1 パスで読む（無ければ下の既定値）。
DEFAULT_MEDIA_ROOTS = ['/Volumes/SunDisk 4TB/動画編集']

def media_roots():
    conf = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media_roots.txt')
    roots = []
    if os.path.exists(conf):
        with open(conf, encoding='utf-8') as f:
            roots = [ln.strip() for ln in f if ln.strip() and not ln.startswith('#')]
    return [os.path.realpath(r) for r in (roots or DEFAULT_MEDIA_ROOTS)]

class NoCacheHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # keep-alive で接続数を減らす（Content-Length は基底クラスが必ず付ける）

    def end_headers(self):
        # 素材（/media/）は no-store にしない。Chrome の動画再生は no-store だとバッファできず
        # readyState 0 のまま止まる（2026-09-13 実測。fetch では取れるのに <video> だけ動かない）
        if not self.path.startswith('/media/'):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/favicon.ico':  # 無いので 404 を出さず黙って空返し
            self._empty(204)
            return
        if path.startswith('/media/'):   # 素材は Range 対応で返す（動画のシークと再生に必要）
            self._serve_media(self.translate_path(self.path))
            return
        if path == '/media-roots.json':   # 素材ルートの一覧（絶対パスを /media/ の URL に直すのに使う）
            body = json.dumps(media_roots(), ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def translate_path(self, path):
        # /media/<素材ルートからの相対パス> を、公開ルートの中のファイルへ読み替える。
        # 範囲外（.. でルートの外へ出る等）は解決後に弾く
        raw = urllib.parse.urlparse(path).path
        if not (raw == '/media' or raw.startswith('/media/')):
            return super().translate_path(path)
        rel = urllib.parse.unquote(raw[len('/media/'):], errors='surrogatepass')
        rel = posixpath.normpath(rel).lstrip('/')
        for root in media_roots():
            full = os.path.realpath(os.path.join(root, rel))
            if (full == root or full.startswith(root + os.sep)) and os.path.exists(full):
                return full
        return os.path.join(os.getcwd(), '__not_found__')

    # ブラウザ間で設定を共有するための保存口（2026-09-12 追加）。
    # localStorage はブラウザごとに隔離されていて同期できないので、ここにファイルとして置く。
    # 受け付けるのは /settings.json と /backup/<名前>.json だけ（名前は英数と . _ - のみ＝パス抜け対策）。
    def do_POST(self):
        path = self.path.split('?')[0]
        if path != '/settings.json' and not re.fullmatch(r'/backup/[A-Za-z0-9_.-]{1,40}\.json', path):
            self._empty(404)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        try:
            json.loads(body.decode('utf-8'))       # 壊れた JSON は保存しない（設定が飛ぶのを防ぐ）
        except Exception:
            self._empty(400)
            return
        dest = os.path.join(os.getcwd(), path.lstrip('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(body)
        self._empty(204)

    # 素材の配信。SimpleHTTPRequestHandler は Range を解さないので、ここだけ自前で返す
    def _serve_media(self, full):
        if not os.path.isfile(full):
            self._empty(404)
            return
        size = os.path.getsize(full)
        start, end, status = 0, size - 1, 200
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', (self.headers.get('Range') or '').strip())
        if m:
            a, b = m.group(1), m.group(2)
            if a:
                start, end = int(a), (int(b) if b else size - 1)
            elif b:
                start = max(0, size - int(b))
            end = min(end, size - 1)
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', self.guess_type(full))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        try:
            with open(full, 'rb') as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass        # 動画は途中で接続を切ることがある（シーク・停止）

    def _empty(self, code):
        self.send_response(code)
        self.send_header('Content-Length', '0')
        self.end_headers()

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
