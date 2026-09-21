#!/usr/bin/env python3
"""
開発用ローカルサーバー（キャッシュ無効・ポート 8766 固定）
Usage:
  python3 tools/serve.py            # http://localhost:8766/
  python3 tools/serve.py 8766       # ポート指定（通常は変えない：localStorage がオリジン単位のため）
  open "http://localhost:8766/index.html?midi=samples/test_orchestra.mid"
ES module の import（./sprites.js 等）はキャッシュバスターを付けられないので、サーバー側で no-store にする。
プロジェクト（曲・音声・設定・素材のコピー）は projects/<名前>/ に保存する（2026-09-18。GET /projects.json で一覧）。
最終更新: 2026-09-12 / v0.2 / 生成元: PixelOrchestra

2026-09-12 修正：「何度かリロードしないとプレビューが真っ暗」の原因はこのサーバー側だった。
  - 標準の request_queue_size は 5（listen backlog）。ES module を十数本まとめて取りに来ると
    待ち行列があふれ、OS が接続を RST で落とす → ブラウザに ERR_CONNECTION_RESET →
    その module だけ import に失敗し、アプリが起動しないまま真っ暗になる（毎回ではないので非決定的）。
  - 標準の protocol_version は HTTP/1.0 ＝ keep-alive 無しで、ファイル 1 本ごとに新しい接続を張る。
    HTTP/1.1 にして接続を使い回し、そもそも同時接続数を減らす。
"""
import sys, os, re, json, time, shutil, posixpath, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 素材（スクリーンに映す透過 PNG / 緑背景 mp4）の置き場所。2026-09-13 ユーザー指定。
# 外付けドライブに素材を置いたまま使いたいので、ここだけを /media/ で公開する。
# tools/media_roots.txt があればそれを 1 行 1 パスで読む（無ければ下の既定値）。
DEFAULT_MEDIA_ROOTS = ['/Volumes/SunDisk 4TB/動画編集']

MEDIA_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.m4v'}
# 音声（上のバーの「音声」を素材フォルダから選ぶ用。場所がプリセットに保存される。2026-09-18 ユーザー指定）。
# スクリーンの素材選びに音声が混ざらないよう、一覧は別の口（/media-audio.json）で返す
AUDIO_EXT = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'}
_media_cache = {}   # 拡張子の組ごとに {'t': 時刻, 'data': 一覧}

def media_list(exts=MEDIA_EXT, max_files=20000):
    """素材ルートの中の画像・動画（exts で指定）を {フォルダ: [ファイル名]} で返す（UI のプルダウン用）。
    実測 954 ファイルで 0.15 秒程度なので、短時間のキャッシュだけ持つ。"""
    import time
    key = tuple(sorted(exts))
    c = _media_cache.get(key)
    if c and time.time() - c['t'] < 5:
        return c['data']
    out, n = {}, 0
    for root in media_roots():
        for dp, dns, fns in os.walk(root):
            dns[:] = sorted(d for d in dns if not d.startswith('.'))   # .Trashes 等は見ない
            names = sorted(f for f in fns if os.path.splitext(f)[1].lower() in exts)
            if not names:
                continue
            rel = os.path.relpath(dp, root)
            out.setdefault('' if rel == '.' else rel, []).extend(names)
            n += len(names)
            if n >= max_files:
                break
    _media_cache[key] = {'t': time.time(), 'data': out}
    return out

# ---- プロジェクト（2026-09-18 ユーザー指定）----
# 1 プロジェクト = projects/<名前>/ のフォルダ。設定（project.json）・MIDI（song.mid）・音声（audio.<拡張子>）・
# スクリーンとスカイドームの素材のコピー（files/）をまとめる。素材はコピーを参照するので、原本を動かしても消しても壊れない
# （原本の修正は、プロジェクトを保存し直した時に取り直す）。名前は日本語も可。フォルダの区切り・記号・先頭の . は不可
PROJECTS_DIR = 'projects'          # 起動時に chdir したアプリのフォルダ基準
_NAME_RE = re.compile(r'[^/\\\x00-\x1f<>:"|?*]{1,60}')
MAX_UPLOAD = 500 * 1024 * 1024     # 1 ファイルの上限（wav の長い曲でも収まる大きさ）

# ---- 編集したボクセル（2026-09-21 ユーザー指定）----
# 衣装の部位（髪・兜・顔）を編集画面 /edit.html で直接いじって、ここに JSON で保存する。
# アプリ側は起動時に GET /voxels.json で全部読み、手続き的に作る形の代わりに使う。
VOXEL_DIR = 'assets/voxel'
_VOXEL_KEY = re.compile(r'[A-Za-z0-9_-]{1,40}')

def voxel_all():
    out = {}
    if os.path.isdir(VOXEL_DIR):
        for n in sorted(os.listdir(VOXEL_DIR)):
            if not n.endswith('.json'):
                continue
            try:
                with open(os.path.join(VOXEL_DIR, n), encoding='utf-8') as f:
                    out[n[:-5]] = json.load(f)
            except Exception as e:
                print(f'[voxel] {n} を読めません: {e}')
    return out

def project_dir(name):
    """プロジェクト名 → フォルダの絶対パス。使えない名前・フォルダの外を指すものは None"""
    if not _NAME_RE.fullmatch(name or '') or name.startswith('.') or name.strip() != name:
        return None
    base = os.path.realpath(PROJECTS_DIR)
    d = os.path.realpath(os.path.join(base, name))
    return d if d.startswith(base + os.sep) else None

def list_projects():
    out = []
    if os.path.isdir(PROJECTS_DIR):
        for n in sorted(os.listdir(PROJECTS_DIR)):
            pj = os.path.join(PROJECTS_DIR, n, 'project.json')
            if not os.path.isfile(pj):
                continue
            try:
                with open(pj, encoding='utf-8') as f:
                    d = json.load(f)
                out.append({'name': n, 'savedAt': d.get('savedAt'),
                            'midi': (d.get('midi') or {}).get('name'), 'audio': (d.get('audio') or {}).get('name')})
            except Exception as e:
                print(f'[projects] {pj} を読めません: {e}')
                out.append({'name': n, 'broken': True})
    return out

# ---- 公開（2026-09-18 ユーザー指定）：アプリ本体とプロジェクトのフォルダを romashige.com へ送る ----
# 見る側は https://romashige.com/pixel-orchestra/?view=<名前>（index.html の視聴モード）。
# 送るのはこの手元のサーバー（~/.netrc の FTP 認証）。ドメイン側には書き込み用の口を置かない。
# FTP（lftp）を試し、だめなら SSH（鍵）の rsync に切り替える（~/CLAUDE.md「デプロイ先の使い分け」）。変わったファイルだけ送る
PUBLISH = {
    'url': 'https://romashige.com/pixel-orchestra/',
    'ftp_host': 'sv1141.xserver.jp', 'ftp_dir': '/romashige.com/public_html/pixel-orchestra',
    'ssh': 'shigemirai@sv1141.xserver.jp', 'ssh_port': '10022', 'ssh_key': os.path.expanduser('~/.ssh/shigemirai.key'),
    'ssh_dir': '/home/shigemirai/romashige.com/public_html/pixel-orchestra',
}
APP_FILES = ['index.html', 'style.css']   # アプリ本体（視聴モードもこれで動く）
APP_DIRS = ['src', 'assets']

def publish(name, dry=False):
    """プロジェクト name を公開する。dry=True なら送らずに、送るものの一覧だけ出す。返り値 {ok, url, method, log}"""
    import subprocess
    d = project_dir(name)
    if not d or not os.path.isfile(os.path.join(d, 'project.json')):
        raise ValueError('公開するプロジェクトが見つかりません（先に保存してください）')
    url = PUBLISH['url'] + '?view=' + urllib.parse.quote(name)
    rel = f'{PROJECTS_DIR}/{name}'
    fd = PUBLISH['ftp_dir']
    dr = ' --dry-run' if dry else ''
    lines = ['set ftp:ssl-allow no', 'set net:timeout 20', 'set net:max-retries 2', 'set net:reconnect-interval-base 5',
             f'open {PUBLISH["ftp_host"]}']
    if not dry:                                            # 試し（dry）では向こうに何も作らない
        lines += [f'mkdir -p -f "{fd}/{PROJECTS_DIR}"']
    lines += [f'mirror -R --only-newer --no-perms --parallel=4{dr} "{x}" "{fd}/{x}"' for x in APP_DIRS]
    lines += [f'mirror -R --only-newer --no-perms --delete --parallel=4{dr} "{rel}" "{fd}/{rel}"']   # 使わなくなったコピーは向こうでも消す
    if not dry:
        lines += [f'put -O "{fd}" ' + ' '.join(f'"{f}"' for f in APP_FILES)]
    lines += ['bye']
    try:
        r = subprocess.run(['lftp', '-c', '; '.join(lines)], capture_output=True, text=True, timeout=900)
        if r.returncode == 0:
            return {'ok': True, 'url': url, 'method': 'ftp', 'log': (r.stdout + r.stderr)[-4000:]}
        ftp_err = (r.stderr or r.stdout)[-1500:]
    except Exception as e:
        ftp_err = str(e)
    print(f'[publish] FTP に失敗したので SSH に切り替えます: {ftp_err}')
    # SSH（rsync）。rsync -n が dry run
    ssh = f'ssh -i "{PUBLISH["ssh_key"]}" -p {PUBLISH["ssh_port"]} -o ConnectTimeout=20 -o BatchMode=yes'
    sd, host = PUBLISH['ssh_dir'], PUBLISH['ssh']
    log = []
    cmds = ([] if dry else [['ssh', '-i', PUBLISH['ssh_key'], '-p', PUBLISH['ssh_port'], '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', host,
             f'mkdir -p "{sd}/{PROJECTS_DIR}"']]) + [
            ['rsync', '-az', '-v'] + (['-n'] if dry else []) + ['-e', ssh] + APP_FILES + APP_DIRS + [f'{host}:{sd}/'],
            ['rsync', '-az', '-v', '--delete'] + (['-n'] if dry else []) + ['-e', ssh, rel + '/', f'{host}:{sd}/{rel}/']]
    for c in cmds:
        r = subprocess.run(c, capture_output=True, text=True, timeout=900)
        log.append(r.stdout + r.stderr)
        if r.returncode != 0:
            raise RuntimeError(f'FTP も SSH も失敗しました。FTP: {ftp_err.strip()[-300:]} / SSH: {(r.stderr or r.stdout).strip()[-300:]}')
    return {'ok': True, 'url': url, 'method': 'ssh', 'log': '\n'.join(log)[-4000:]}

def _write_atomic(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)

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
        # readyState 0 のまま止まる（2026-09-13 実測。fetch では取れるのに <video> だけ動かない）。
        # プロジェクトの中の音声・画像・動画も同じ（project.json は保存し直すので no-store のまま）
        p = self.path.split('?')[0]
        if not (p.startswith('/media/') or (p.startswith('/projects/') and not p.endswith('.json'))):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/favicon.ico':  # 無いので 404 を出さず黙って空返し
            self._empty(204)
            return
        if path.startswith('/media/') or path.startswith('/projects/'):   # 素材・プロジェクトの中身は Range 対応で返す（動画・音声のシークと再生に必要）
            self._serve_media(self.translate_path(self.path))
            return
        if path == '/voxels.json':        # 編集済みボクセル（部位キー → データ）
            self._json(200, voxel_all())
            return
        if path == '/projects.json':      # プロジェクトの一覧
            self._json(200, list_projects())
            return
        if path in ('/media-roots.json', '/media-list.json', '/media-audio.json'):
            # roots: 絶対パスを /media/ の URL に直すため。list: 画像・動画の一覧／audio: 音声の一覧（UI の素材選び用）
            if path == '/media-roots.json':
                data = media_roots()
            else:
                exts = AUDIO_EXT if path == '/media-audio.json' else MEDIA_EXT
                if 'refresh=1' in (self.path.split('?', 1) + [''])[1]:
                    _media_cache.pop(tuple(sorted(exts)), None)
                data = media_list(exts)
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
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
        if path.startswith('/projects/'):
            self._post_project(path)
            return
        if path.startswith('/voxels/'):    # 編集したボクセルの保存
            self._post_voxel(path)
            return
        if path.startswith('/publish/'):   # 公開（?dry=1 で送らずに一覧だけ）
            name = urllib.parse.unquote(path[len('/publish/'):], errors='surrogatepass')
            dry = 'dry=1' in (self.path.split('?', 1) + [''])[1]
            try:
                self._json(200, publish(name, dry))
            except Exception as e:
                print(f'[publish] {name}: {e}')
                self._json(500, {'error': str(e)})
            return
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

    # ---- プロジェクトの保存・削除（2026-09-18 ユーザー指定）----
    # POST /projects/<名前>/song.mid        … MIDI の中身（そのまま）
    # POST /projects/<名前>/audio.<拡張子>  … 手元のファイルから読んだ音声の中身（そのまま）
    # POST /projects/<名前>/project.json    … 設定。assets（素材の URL）と audio.url はサーバーがコピーしてまとめる
    # DELETE /projects/<名前>                … フォルダごと削除（画面側で確認してから呼ぶ）
    def _project_parts(self, path):
        rest = urllib.parse.unquote(path[len('/projects/'):], errors='surrogatepass')
        return rest.split('/') if rest else []

    def _post_project(self, path):
        parts = self._project_parts(path)
        d = project_dir(parts[0]) if len(parts) == 2 else None
        if not d:
            self._json(400, {'error': 'プロジェクト名に使えない文字があります（/ \\ : * ? " < > | と先頭の . は使えません。60 文字まで）'})
            return
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_UPLOAD:
            self._json(413, {'error': 'ファイルが大きすぎます（500MB まで）'})
            return
        body = self.rfile.read(length)
        fname = parts[1]
        try:
            os.makedirs(d, exist_ok=True)
            if fname == 'song.mid' or re.fullmatch(r'audio\.(' + '|'.join(e[1:] for e in AUDIO_EXT) + ')', fname):
                _write_atomic(os.path.join(d, fname), body)
                self._json(200, {'ok': True})
            elif fname == 'project.json':
                self._json(200, self._save_project(parts[0], d, json.loads(body.decode('utf-8'))))
            else:
                self._json(400, {'error': f'保存できないファイル名です: {fname}'})
        except Exception as e:
            print(f'[projects] {parts[0]}/{fname} の保存に失敗: {e}')
            self._json(500, {'error': f'保存に失敗しました（{e}）'})

    def _save_project(self, name, d, data):
        """設定を書き、素材をコピーしてまとめる。返り値は {copies: {元の URL: コピーの URL}}"""
        qname = urllib.parse.quote(name)
        # 音声：URL（素材フォルダ・別のプロジェクト等）から読んでいたらコピーする。手元のファイルは先に送られている
        a = data.get('audio') or None
        if a and a.get('url'):
            src = self._resolve_src(a['url'])
            ext = os.path.splitext(src or '')[1].lower()
            if not src or ext not in AUDIO_EXT:
                raise ValueError(f'音声の元ファイルが見つかりません: {a["url"]}')
            dst = os.path.join(d, 'audio' + ext)
            if os.path.realpath(src) != os.path.realpath(dst):
                shutil.copyfile(src, dst + '.tmp')
                os.replace(dst + '.tmp', dst)
            a = {'name': a.get('name') or os.path.basename(src), 'file': 'audio' + ext}
        keep_audio = a['file'] if a else None
        for f in os.listdir(d):   # 使わなくなった音声を消す（拡張子が変わった時など）
            if f.startswith('audio.') and f != keep_audio:
                os.remove(os.path.join(d, f))
        if not data.get('midi') and os.path.exists(os.path.join(d, 'song.mid')):
            os.remove(os.path.join(d, 'song.mid'))
        # スクリーン・スカイドームの素材：いったん files.new にまとめてから files と入れ替える
        # （保存し直しでは元が files/ の中にあるので、先に全部読み切ってから古い方を消す）
        files, new = os.path.join(d, 'files'), os.path.join(d, 'files.new')
        shutil.rmtree(new, ignore_errors=True)
        os.makedirs(new)
        copies, used = {}, set()
        for url in data.get('assets') or []:
            if url in copies:                                  # 同じ素材を何か所で使っていても、コピーは 1 つ
                continue
            src = self._resolve_src(url)
            if not src:
                print(f'[projects] {name}: 素材が見つからないのでコピーしません: {url}')
                continue
            stem, ext = os.path.splitext(os.path.basename(src))
            fn, k = stem + ext, 2
            while fn in used:                                  # 別フォルダの同じ名前は -2, -3… を付ける
                fn, k = f'{stem}-{k}{ext}', k + 1
            used.add(fn)
            shutil.copyfile(src, os.path.join(new, fn))
            copies[url] = f'projects/{qname}/files/{urllib.parse.quote(fn)}'
        shutil.rmtree(files, ignore_errors=True)
        os.replace(new, files)
        out = {'savedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'settings': data.get('settings') or {},
               'midi': data.get('midi'), 'audio': a, 'copies': copies}
        _write_atomic(os.path.join(d, 'project.json'), json.dumps(out, ensure_ascii=False, indent=1).encode('utf-8'))
        return {'ok': True, 'copies': copies}

    def _resolve_src(self, url):
        """画面が使っている素材の URL → ファイルの絶対パス。素材フォルダ（media/…）かアプリのフォルダの中だけ。無ければ None"""
        if not url or re.match(r'^[a-z]+:', url):              # http: blob: data: はコピーしない
            return None
        u = '/' + url.split('?')[0].lstrip('/')
        if u.startswith('/media/'):
            full = self.translate_path(u)
        else:
            base = os.path.realpath(os.getcwd())
            full = os.path.realpath(os.path.join(base, urllib.parse.unquote(u.lstrip('/'))))
            if not full.startswith(base + os.sep):
                return None
        return full if os.path.isfile(full) else None

    def do_DELETE(self):
        path = self.path.split('?')[0]
        if path.startswith('/voxels/'):    # 編集を捨てて、手続き的に作る元の形へ戻す
            key = path[len('/voxels/'):].removesuffix('.json')
            if not _VOXEL_KEY.fullmatch(key):
                self._json(400, {'error': '部位のキーが不正です'})
                return
            f = os.path.join(VOXEL_DIR, key + '.json')
            if os.path.isfile(f):
                os.remove(f)
            self._empty(204)
            return
        parts = self._project_parts(path) if path.startswith('/projects/') else []
        d = project_dir(parts[0]) if len(parts) == 1 else None
        if not d:
            self._json(400, {'error': '削除できない名前です'})
            return
        if os.path.isdir(d):
            shutil.rmtree(d)
        self._empty(204)

    def _post_voxel(self, path):
        key = path[len('/voxels/'):].removesuffix('.json')
        if not _VOXEL_KEY.fullmatch(key):
            self._json(400, {'error': '部位のキーが不正です（英数と _ - のみ、40 文字まで）'})
            return
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        try:
            data = json.loads(body.decode('utf-8'))
            for k in ('w', 'h', 'depth', 'z0', 'pivotX', 'pivotY', 'palette', 'layers'):
                if k not in data:
                    raise ValueError(f'{k} がありません')
            if len(data['layers']) != data['depth']:
                raise ValueError('layers の枚数が depth と合いません')
        except Exception as e:
            self._json(400, {'error': f'保存できない形です（{e}）'})
            return
        try:
            os.makedirs(VOXEL_DIR, exist_ok=True)
            dest = os.path.join(VOXEL_DIR, key + '.json')
            if os.path.isfile(dest):   # 上書きの前に旧版を退避（TOOL_CRAFT_RULES §6-1）。backup/ の中は一覧に出さない
                bdir = os.path.join(VOXEL_DIR, 'backup')
                os.makedirs(bdir, exist_ok=True)
                shutil.copy2(dest, os.path.join(bdir, f'{key}_{time.strftime("%Y%m%d_%H%M%S")}.json'))
            _write_atomic(dest, json.dumps(data, ensure_ascii=False, indent=1).encode('utf-8'))
            self._json(200, {'ok': True, 'path': f'{VOXEL_DIR}/{key}.json'})
        except Exception as e:
            self._json(500, {'error': f'保存に失敗しました（{e}）'})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
