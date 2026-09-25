#!/usr/bin/env python3
"""
チューブラーベル確認用の MIDI を作る（依存なし）。2026-09-25 ユーザー指定：「テスト midi、もっと叩かせて」
18 本（C4〜F5）すべてを、いろいろな叩き方で鳴らす：上昇・速い下降・同じ管の連打（手前の列／奥の列）・
左右の手が交互になる跳躍・ゆっくり（構えに戻りきる間隔）・左右同時・強弱。

Usage:
  python3 tools/make_tubular_test.py                       # samples/test_tubular.mid を生成（既存は samples/backup/ へ退避）
  python3 tools/make_tubular_test.py out.mid               # 出力先を指定
  python3 tools/make_tubular_test.py out.mid 100           # テンポ（BPM）を指定（既定 120。秒の間隔はテンポに比例して変わる）
最終更新: 2026-09-25 / v1.0 / 生成元: PixelOrchestra
"""
import os
import shutil
import struct
import sys
import time

PPQ = 480
LOW = 60   # C4：一番長い管。tubularTubeAt はパートの最低音を含む C を管の C に合わせる


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def track_chunk(events):
    """events: [(abs_tick, bytes)]"""
    events.sort(key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90))   # 同じ時刻は note off を先に
    data, last = b'', 0
    for tick, ev in events:
        data += vlq(tick - last) + ev
        last = tick
    data += vlq(0) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def meta(tp, payload):
    return b'\xff' + bytes([tp]) + vlq(len(payload)) + payload


def build(bpm):
    sec = lambda s: int(round(s * bpm / 60 * PPQ))   # 秒 → tick
    notes = []   # (開始秒, 長さ秒, 音, 強さ)
    t = 1.0

    def add(pitches, step, vel=90, dur=None):
        nonlocal t
        for p in pitches:
            for q in (p if isinstance(p, tuple) else (p,)):
                notes.append((t, dur or step * 0.9, q, vel))
            t += step

    add(range(LOW, LOW + 18), 0.5)                                 # 1. 上昇：18 本すべて（手前・奥の両方）
    t += 1.0
    add(range(LOW + 17, LOW - 1, -1), 0.3)                         # 2. 速い下降
    t += 1.0
    add([LOW + 4] * 4, 0.25)                                       # 3. 同じ管の連打：手前の列（E）
    t += 0.5
    add([LOW + 6] * 4, 0.25)                                       #    奥の列（F#）
    t += 1.0
    add([LOW, LOW + 17] * 4, 0.5)                                  # 4. 跳躍：低い C と高い F を交互（左右の手が交互）
    t += 1.0
    add([LOW + 2, LOW + 9, LOW + 13, LOW + 16], 1.5)               # 5. ゆっくり：構えに戻りきる間隔
    t += 0.5
    add([(LOW, LOW + 12), (LOW + 4, LOW + 16), (LOW + 7, LOW + 14)], 0.8)   # 6. 左右同時（低い管と高い管）
    t += 1.0
    for i, v in enumerate([30, 50, 70, 90, 110, 127, 100, 60]):   # 7. 強弱：だんだん強く→弱く
        add([LOW + 5 + (i % 3) * 2], 0.5, vel=v)
    end = t + 2.0

    ev = []
    for (s, d, p, v) in notes:
        ev.append((sec(s), bytes([0x90, p, v])))
        ev.append((sec(s + d), bytes([0x80, p, 0])))
    tempo = int(60_000_000 / bpm)
    head = [(0, meta(0x03, b'Tubular Bells')), (0, bytes([0xC0, 14]))]   # GM 15 番（0 始まりで 14）
    t0 = [(0, meta(0x51, tempo.to_bytes(3, 'big'))), (0, meta(0x58, bytes([4, 2, 24, 8]))), (sec(end), meta(0x01, b'end'))]
    mid = b'MThd' + struct.pack('>IHHH', 6, 1, 2, PPQ) + track_chunk(t0) + track_chunk(head + ev)
    return mid, len(notes), end


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(here, '..', 'samples', 'test_tubular.mid')
    bpm = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0
    mid, n, end = build(bpm)
    if os.path.exists(out):   # 上書き前に退避（TOOL_CRAFT_RULES §4-2）
        bdir = os.path.join(os.path.dirname(out), 'backup')
        os.makedirs(bdir, exist_ok=True)
        base = os.path.splitext(os.path.basename(out))[0]
        dst = os.path.join(bdir, f"{base}_backup_{time.strftime('%Y%m%d_%H%M%S')}.mid")
        shutil.copy2(out, dst)
        print(f"既存を退避: {dst}")
    with open(out, 'wb') as f:
        f.write(mid)
    print(f"書き出し: {out}（{n} 音・約 {end:.0f} 秒・{bpm:g} BPM）")


if __name__ == '__main__':
    main()
