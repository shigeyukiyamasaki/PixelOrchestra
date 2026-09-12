#!/usr/bin/env python3
"""
文字列 → ドット絵（手描き相当）→ ボクセル用データ（JS）
Usage:
  python3 tools/text2voxel.py 文字列 出力.js 名前 [1文字のセル数] [白フチの太さ]
    例: python3 tools/text2voxel.py 天地創造 src/logoDotsData.js TENCHI_DOTS 24 2

img2voxel.py（元画像を写し取る）との違い:
  - 字形は太ゴシックから起こす（元ロゴの崩した字形ではなく、整ったドット絵フォント風）
  - 色は自前で設計する：上が濃紺・下が青の縦グラデーション、外に白フチ、内側は埋める板
最終更新: 2026-09-12 / v0.1 / 生成元: PixelOrchestra
"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont

FONT = '/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc'
PALETTE = {
    'w': '#f2f6fa',  # 外縁の白フチ
    'n': '#163450',  # 濃紺（本体・上）
    'b': '#1f7fc0',  # 青（本体・下）
    'i': '#e6edf4',  # 内側を埋める板
}


def render(text, cell):
    """文字を cell×cell のドットに落とす（縦に少し詰めて字面を大きく取る）"""
    n = len(text)
    px = cell * 8                       # 一度大きく描いてから縮小（形が安定する）
    font = ImageFont.truetype(FONT, int(px * 0.96))
    img = Image.new('L', (px * n, px), 0)
    d = ImageDraw.Draw(img)
    for i, ch in enumerate(text):
        bb = d.textbbox((0, 0), ch, font=font)
        x = i * px + (px - (bb[2] - bb[0])) // 2 - bb[0]
        y = (px - (bb[3] - bb[1])) // 2 - bb[1]
        d.text((x, y), ch, font=font, fill=255)
    small = img.resize((cell * n, cell), Image.LANCZOS)
    sp = small.load()
    return [[sp[x, y] > 110 for x in range(cell * n)] for y in range(cell)]


def build(mask, thickness):
    H, W = len(mask), len(mask[0])
    pad = thickness + 1
    W2, H2 = W + pad * 2, H + pad * 2
    grid = [['.'] * W2 for _ in range(H2)]
    for y in range(H):
        for x in range(W):
            if mask[y][x]:
                # 上が濃紺、下が青の縦グラデーション（元ロゴの配色に合わせる）
                grid[y + pad][x + pad] = 'n' if y < H * 0.45 else 'b'
    # 外側（縁から届く空白）
    outside = [[False] * W2 for _ in range(H2)]
    stack = [(0, 0)]
    outside[0][0] = True
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W2 and 0 <= ny < H2 and not outside[ny][nx] and grid[ny][nx] == '.':
                outside[ny][nx] = True
                stack.append((nx, ny))
    core = [(x, y) for y in range(H2) for x in range(W2) if grid[y][x] != '.']
    t2 = thickness * thickness
    for y in range(H2):
        for x in range(W2):
            if grid[y][x] != '.' or not outside[y][x]:
                continue
            for cx, cy in core:
                dx, dy = cx - x, cy - y
                if dx * dx + dy * dy <= t2:
                    grid[y][x] = 'w'
                    break
    for y in range(H2):
        for x in range(W2):
            if grid[y][x] == '.' and not outside[y][x]:
                grid[y][x] = 'i'
    return [''.join(r) for r in grid]


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    text, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
    cell = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    thickness = int(sys.argv[5]) if len(sys.argv) > 5 else 2
    rows = build(render(text, cell), thickness)
    body = (
        '/*\n * PixelOrchestra — %s\n * 「%s」を太ゴシックから起こしたドット絵（tools/text2voxel.py）。手で編集しない\n */\n'
        'export const %s = {\n  palette: %s,\n  rows: [\n%s\n  ],\n};\n'
    ) % (os.path.basename(out), text, name, json.dumps(PALETTE, ensure_ascii=False),
         '\n'.join("    '%s'," % r for r in rows))
    with open(out, 'w', encoding='utf-8') as f:
        f.write(body)
    print(f'wrote {out} ({len(rows[0])}×{len(rows)} セル)')


if __name__ == '__main__':
    main()
