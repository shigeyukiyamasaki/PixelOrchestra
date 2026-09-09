#!/usr/bin/env python3
"""
テスト用オーケストラ MIDI 生成（依存なし）
Usage:
  python3 tools/make_test_midi.py                 # samples/test_orchestra.mid を生成
  python3 tools/make_test_midi.py out.mid         # 出力先を指定
  python3 tools/make_test_midi.py out.mid 110     # テンポ指定
最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
"""
import sys, os, struct, random

PPQ = 480
random.seed(7)

def vlq(n):
    out = [n & 0x7F]; n >>= 7
    while n: out.append(0x80 | (n & 0x7F)); n >>= 7
    return bytes(reversed(out))

def track_chunk(events):
    """events: list of (abs_tick, bytes)"""
    events.sort(key=lambda e: e[0])
    data = b''; last = 0
    for tick, ev in events:
        data += vlq(tick - last) + ev; last = tick
    data += vlq(0) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data

def meta(tp, payload): return b'\xff' + bytes([tp]) + vlq(len(payload)) + payload

# 進行（各小節のルート・和音）：C - Am - F - G を2周、ffへ
PROG = [(60, [0, 4, 7]), (57, [0, 3, 7]), (53, [0, 4, 7]), (55, [0, 4, 7])] * 2
BARS = len(PROG)
BEAT = PPQ

def notes_for(part):
    """part -> list of (tick, dur, pitch, vel)"""
    ev = []
    for bar, (root, chord) in enumerate(PROG):
        b0 = bar * 4 * BEAT
        dyn = 0.55 + 0.45 * (bar / (BARS - 1))  # だんだん強く
        v = lambda base: max(20, min(127, int(base * dyn + random.randint(-6, 6))))
        if part == 'vn1':   # 8分音符の刻み（高音）＋ 小節頭にキースイッチ（C-1=24, vel 1）
            ev.append((b0, 30, 24 + (bar % 3), 1))
            for i in range(8): ev.append((b0 + i * BEAT // 2, BEAT // 2 - 20, root + 12 + chord[i % 3], v(95)))
        elif part == 'vn2':
            for i in range(4): ev.append((b0 + i * BEAT, BEAT - 30, root + chord[(i + 1) % 3], v(85)))
        elif part == 'va':
            for i in range(4): ev.append((b0 + i * BEAT, BEAT - 30, root - 5 + chord[1], v(80)))
        elif part == 'vc':  # 2分音符
            for i in range(2): ev.append((b0 + i * 2 * BEAT, 2 * BEAT - 40, root - 12, v(90)))
        elif part == 'cb':
            ev.append((b0, 4 * BEAT - 40, root - 24, v(90)))
        elif part == 'fl':  # 後半から旋律
            if bar >= 2:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT - 60, root + 24 + chord[(i * 2) % 3], v(85)))
        elif part == 'ob':
            if bar >= 3:
                ev.append((b0, 2 * BEAT, root + 12 + chord[1], v(80))); ev.append((b0 + 2 * BEAT, 2 * BEAT, root + 12 + chord[2], v(80)))
        elif part == 'cl':
            if bar >= 1:
                for i in range(2): ev.append((b0 + i * 2 * BEAT, 2 * BEAT - 40, root + chord[2], v(75)))
        elif part == 'fg':
            if bar >= 1:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT // 2, root - 12 + chord[0], v(80)))
        elif part == 'hn':
            if bar >= 4:
                ev.append((b0, 4 * BEAT - 40, root - 5 + chord[1], v(90)))
        elif part == 'tp':
            if bar >= 5:
                for i in (0, 2, 3): ev.append((b0 + i * BEAT, BEAT // 2, root + 12 + chord[0], v(100)))
        elif part == 'tb':
            if bar >= 5:
                ev.append((b0, 2 * BEAT - 40, root - 12 + chord[0], v(95))); ev.append((b0 + 2 * BEAT, 2 * BEAT - 40, root - 12 + chord[2], v(95)))
        elif part == 'timp':
            ev.append((b0, BEAT // 2, root - 24, v(110)))
            if bar >= 4: ev.append((b0 + 2 * BEAT, BEAT // 2, root - 24, v(95)))
            if bar >= 6:
                for i in range(4): ev.append((b0 + 3 * BEAT + i * BEAT // 4, BEAT // 8, root - 24, v(100)))
        elif part == 'gc':  # グランカッサ：小節頭＋後半は3拍目も
            ev.append((b0, BEAT // 2, 36, v(115)))
            if bar >= 4: ev.append((b0 + 2 * BEAT, BEAT // 2, 36, v(100)))
        elif part == 'xylo':  # 16分の走句（高音）
            if bar >= 3:
                for i in range(8): ev.append((b0 + 2 * BEAT + i * BEAT // 4, BEAT // 8, root + 24 + chord[i % 3] + (12 if i >= 4 else 0), v(90)))
        elif part == 'cel':   # 和音の分散
            if bar >= 2:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT // 2, root + 24 + chord[i % 3], v(70)))
        elif part == 'hp':
            if bar >= 2:
                for i in range(8): ev.append((b0 + i * BEAT // 2, BEAT // 2, root + 12 + chord[i % 3] + 12 * (i // 4), v(70)))
    return ev

# (トラック名, プログラム番号, チャンネル, part)
PARTS = [
    ('Violin I', 40, 0, 'vn1'), ('Violin II', 40, 1, 'vn2'), ('Viola', 41, 2, 'va'), ('Cello', 42, 3, 'vc'), ('Contrabass', 43, 4, 'cb'),
    ('Flute', 73, 5, 'fl'), ('Oboe', 68, 6, 'ob'), ('Clarinet', 71, 7, 'cl'), ('Bassoon', 70, 8, 'fg'),
    ('Horn', 60, 10, 'hn'), ('Trumpet', 56, 11, 'tp'), ('Trombone', 57, 12, 'tb'),
    ('Timpani', 47, 13, 'timp'), ('Gran Cassa', 116, 9, 'gc'), ('Xylophone_HW', 13, 15, 'xylo'), ('Celeste_BBC', 8, 15, 'cel'), ('Harp', 46, 14, 'hp'),
]

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples', 'test_orchestra.mid')
    bpm = float(sys.argv[2]) if len(sys.argv) > 2 else 100.0
    tracks = []
    t0 = [(0, meta(0x03, b'Tempo/Meta')), (0, meta(0x51, struct.pack('>I', int(60_000_000 / bpm))[1:])), (0, meta(0x58, bytes([4, 2, 24, 8])))]
    tracks.append(track_chunk(t0))
    for name, prog, ch, part in PARTS:
        ev = [(0, meta(0x03, name.encode())), (0, bytes([0xC0 | ch, prog]))]
        # 強弱の CC：弦は CC11 で曲全体のクレッシェンド（velocity はほぼ一定）、金管は CC1 で各小節スウェル
        if part in ('vn1', 'vn2', 'va', 'vc', 'cb'):
            for k in range(BARS * 8):
                ev.append((k * BEAT // 2, bytes([0xB0 | ch, 11, int(40 + 85 * k / (BARS * 8))])))
        if part in ('hn', 'tp', 'tb'):
            for bar in range(BARS):
                for k in range(8):
                    ev.append((bar * 4 * BEAT + k * BEAT // 2, bytes([0xB0 | ch, 1, int(50 + 70 * (k / 7))])))
        for tick, dur, pitch, vel in notes_for(part):
            ev.append((tick, bytes([0x90 | ch, pitch, vel])))
            ev.append((tick + dur, bytes([0x80 | ch, pitch, 0])))
        tracks.append(track_chunk(ev))
    header = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as f: f.write(header + b''.join(tracks))
    print(f'wrote {out} ({len(tracks)} tracks, {BARS} bars @ {bpm} bpm)')

if __name__ == '__main__':
    main()
