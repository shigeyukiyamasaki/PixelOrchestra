#!/usr/bin/env python3
"""
画像 → ボクセル用ドットデータ（JS）変換
Usage:
  python3 tools/img2voxel.py 入力画像 出力.js 名前 [幅セル数]
    例: python3 tools/img2voxel.py ~/Desktop/tenchi.jpg src/logoData.js tenchi 96

やること:
  1. 余白（白）を切り落とす
  2. 指定した幅のセル数へ縮小（高さは縦横比から自動）
  3. 各セルの色を固定パレットの最近傍へ丸め、背景（白）は透明にする
  4. 「1 文字 = 1 セル」の行配列＋パレットを JS として書き出す（sprites.js の makePart がこれを描く）

最終更新: 2026-09-12 / v0.1 / 生成元: PixelOrchestra
"""
import sys, os, json
from PIL import Image

# パレット：記号 → 色。'.' は透明（背景）
PALETTE = {
    'w': '#f2f6fa',  # 白フチ
    'n': '#163450',  # 濃紺の輪郭
    'b': '#1f7fc0',  # 明るい青（本体）
    'd': '#12689d',  # 青の影
}
BG_LUM = 232  # これより明るく彩度が低いセルは背景（透明）とみなす


def nearest(rgb):
    r, g, b = rgb
    best, bestd = '.', 1e9
    for key, hexcol in PALETTE.items():
        pr, pg, pb = (int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < bestd:
            best, bestd = key, d
    return best


def classify(rgb):
    """1 画素を 背景 '.' / 白 'w' / 青 'b' / 紺 'n' に分ける"""
    r, g, b = rgb
    lum = (r + g + b) / 3
    sat = max(r, g, b) - min(r, g, b)
    if lum > BG_LUM and sat < 30:
        return '.'
    if lum < 72:
        return 'n'          # 濃紺の外枠（#163450 は輝度 51）
    if b - r > 40:
        return 'b'          # 青（#12689d は輝度 93。輝度で切ると紺と混ざるので色味で分ける）
    return 'w'


def convert(src, width_cells):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if classify(px[x, y]) != '.':
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
    crop = im.crop((minx, miny, maxx + 1, maxy + 1))
    cw, ch = crop.size
    cpx = crop.load()
    W = width_cells
    H = max(1, round(W * ch / cw))
    # セル（元画像の矩形領域）ごとに画素を分類して数える。細い線が消えないよう、
    # 濃紺 → 青 → 白 の順に「一定割合あれば採用」する（平均色を取ると細線が中間色になって消える）
    rows = []
    for cy in range(H):
        y0, y1 = round(cy * ch / H), max(round((cy + 1) * ch / H), round(cy * ch / H) + 1)
        row = ''
        for cx in range(W):
            x0, x1 = round(cx * cw / W), max(round((cx + 1) * cw / W), round(cx * cw / W) + 1)
            cnt = {'.': 0, 'w': 0, 'b': 0, 'n': 0}
            for y in range(y0, y1):
                for x in range(x0, x1):
                    cnt[classify(cpx[x, y])] += 1
            total = max(1, (x1 - x0) * (y1 - y0))
            if cnt['n'] / total >= 0.35: row += 'n'
            elif cnt['b'] / total >= 0.30: row += 'b'
            elif (cnt['w'] + cnt['b'] + cnt['n']) / total >= 0.45: row += 'w'
            else: row += '.'
        rows.append(row)
    return rows


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 96
    rows = convert(os.path.expanduser(src), width)
    body = (
        '/*\n * PixelOrchestra — %s\n * %s から自動生成（tools/img2voxel.py）。手で編集しない\n */\n'
        'export const %s = {\n  palette: %s,\n  rows: [\n%s\n  ],\n};\n'
    ) % (
        os.path.basename(out), os.path.basename(src), name,
        json.dumps(PALETTE, ensure_ascii=False),
        '\n'.join("    '%s'," % r for r in rows),
    )
    with open(out, 'w', encoding='utf-8') as f:
        f.write(body)
    print(f'wrote {out} ({len(rows[0])}×{len(rows)} セル)')


if __name__ == '__main__':
    main()
