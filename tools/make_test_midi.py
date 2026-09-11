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

# 進行（各小節のルート・和音）：C - Am - F - G を 6 周（24 小節 @ 96bpm = 60 秒）。全パートが最初から鳴る（2026-09-11。以前は段階的に楽器が増えていた）→ 最後は全員で全音符
PROG = [(60, [0, 4, 7]), (57, [0, 3, 7]), (53, [0, 4, 7]), (55, [0, 4, 7])] * 6
# 強弱パターン（小節ごとの倍率）とパートごとの位相ずらし。全パートが最初から鳴り、強弱は混在（2026-09-11）
DYN_PATTERN = [0.5, 0.95, 0.7, 1.0, 0.55, 0.85, 0.65, 1.0]
DYN_PHASE = {'vn1': 0, 'vn2': 1, 'va': 2, 'vc': 3, 'cb': 4, 'picc': 5, 'fl': 6, 'ob': 7, 'cl': 1, 'fg': 3, 'hn': 2, 'tp': 5, 'tb': 6, 'tuba': 4,
             'timp': 0, 'gc': 2, 'snare': 4, 'cym': 6, 'xylo': 1, 'mar': 3, 'cel': 5, 'pf': 7, 'hp': 2}
BARS = len(PROG)
BEAT = PPQ
FINAL = BARS - 1  # 最終小節：全員で全音符

# 最終小節で鳴らす音（全音符）。None の打楽器は個別に扱う
FINAL_PITCH = {
    'vn1': lambda r, c: r + 12 + c[2], 'vn2': lambda r, c: r + c[1], 'va': lambda r, c: r - 5 + c[1], 'vc': lambda r, c: r - 12, 'cb': lambda r, c: r - 24,
    'fl': lambda r, c: r + 24 + c[2], 'ob': lambda r, c: r + 12 + c[1], 'cl': lambda r, c: r + c[2], 'fg': lambda r, c: r - 12,
    'hn': lambda r, c: r - 5 + c[1], 'tp': lambda r, c: r + 12, 'tb': lambda r, c: r - 12 + c[2], 'tuba': lambda r, c: r - 24,
    'cel': lambda r, c: r + 24, 'hp': lambda r, c: r + 12, 'pf': lambda r, c: r, 'mar': lambda r, c: r + 12 + c[1], 'xylo': lambda r, c: r + 36,
}

def notes_for(part):
    """part -> list of (tick, dur, pitch, vel)"""
    ev = []
    for bar, (root, chord) in enumerate(PROG):
        b0 = bar * 4 * BEAT
        # 強弱：小節ごとに pp〜ff を行き来し、パートごとに位相をずらして混在させる（2026-09-11 ユーザー指定：満遍なく入り混じり）
        dyn = DYN_PATTERN[(bar + DYN_PHASE.get(part, 0)) % len(DYN_PATTERN)]
        v = lambda base: max(20, min(127, int(base * dyn + random.randint(-12, 12))))
        if bar == FINAL:
            if part in FINAL_PITCH: ev.append((b0, 4 * BEAT - 40, FINAL_PITCH[part](root, chord), v(110)))
            elif part == 'timp': ev.append((b0, 4 * BEAT - 40, root - 24, v(120)))
            elif part in ('gc', 'cym'): ev.append((b0, 2 * BEAT, 36 if part == 'gc' else 49, v(120)))
            elif part == 'snare':
                for i in range(16): ev.append((b0 + i * BEAT // 4, BEAT // 8, 38, v(70 + 3 * i)))
            continue
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
        elif part == 'picc':  # 後半、旋律の 1 オクターブ上で装飾
            if True:
                for i in range(8): ev.append((b0 + i * BEAT // 2, BEAT // 2 - 30, root + 36 + chord[(i * 2) % 3], v(80)))
        elif part == 'fl':  # 旋律
            if True:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT - 60, root + 24 + chord[(i * 2) % 3], v(85)))
        elif part == 'ob':
            if True:
                ev.append((b0, 2 * BEAT, root + 12 + chord[1], v(80))); ev.append((b0 + 2 * BEAT, 2 * BEAT, root + 12 + chord[2], v(80)))
        elif part == 'cl':
            if True:
                for i in range(2): ev.append((b0 + i * 2 * BEAT, 2 * BEAT - 40, root + chord[2], v(75)))
        elif part == 'fg':
            if True:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT // 2, root - 12 + chord[0], v(80)))
        elif part == 'hn':
            if True:
                ev.append((b0, 4 * BEAT - 40, root - 5 + chord[1], v(90)))
        elif part == 'tp':
            if True:
                for i in (0, 2, 3): ev.append((b0 + i * BEAT, BEAT // 2, root + 12 + chord[0], v(100)))
        elif part == 'tb':
            if True:
                ev.append((b0, 2 * BEAT - 40, root - 12 + chord[0], v(95))); ev.append((b0 + 2 * BEAT, 2 * BEAT - 40, root - 12 + chord[2], v(95)))
        elif part == 'timp':
            ev.append((b0, BEAT // 2, root - 24, v(110)))
            ev.append((b0 + 2 * BEAT, BEAT // 2, root - 24, v(95)))
            if True:
                for i in range(4): ev.append((b0 + 3 * BEAT + i * BEAT // 4, BEAT // 8, root - 24, v(100)))
        elif part == 'gc':  # グランカッサ：小節頭＋後半は3拍目も
            ev.append((b0, BEAT // 2, 36, v(115)))
            ev.append((b0 + 2 * BEAT, BEAT // 2, 36, v(100)))
        elif part == 'xylo':  # 16分の走句（高音）
            if bar % 2 == 1:
                for i in range(8): ev.append((b0 + 2 * BEAT + i * BEAT // 4, BEAT // 8, root + 24 + chord[i % 3] + (12 if i >= 4 else 0), v(90)))
        elif part == 'cel':   # 和音の分散
            if True:
                for i in range(4): ev.append((b0 + i * BEAT, BEAT // 2, root + 24 + chord[i % 3], v(70)))
        elif part == 'hp':
            if True:
                for i in range(8): ev.append((b0 + i * BEAT // 2, BEAT // 2, root + 12 + chord[i % 3] + 12 * (i // 4), v(70)))
        elif part == 'tuba':  # 小節頭と3拍目のバス
            if True:
                for i in (0, 2): ev.append((b0 + i * BEAT, BEAT - 40, root - 24, v(95)))
        elif part == 'snare':  # 2・4拍目＋後半はロール気味の16分
            if True:
                for i in (1, 3): ev.append((b0 + i * BEAT, BEAT // 4, 38, v(85)))
            if True:
                for i in range(4): ev.append((b0 + 3 * BEAT + i * BEAT // 4, BEAT // 8, 38, v(75)))
        elif part == 'cym':  # 4小節ごとの頭でクラッシュ
            if bar % 4 == 0: ev.append((b0, 2 * BEAT, 49, v(110)))
        elif part == 'mar':  # 8分の分散和音（中音域）
            if True:
                for i in range(8): ev.append((b0 + i * BEAT // 2, BEAT // 2 - 20, root + chord[i % 3] + (12 if i % 2 else 0), v(80)))
        elif part == 'pf':  # 小節頭の和音＋4拍目の低音
            if True:
                for n in chord: ev.append((b0, 2 * BEAT - 40, root + n, v(90)))
                ev.append((b0 + 3 * BEAT, BEAT - 40, root - 12, v(85)))
    return ev

# (トラック名, プログラム番号, チャンネル, part)
PARTS = [
    ('Violin I', 40, 0, 'vn1'), ('Violin II', 40, 1, 'vn2'), ('Viola', 41, 2, 'va'), ('Cello', 42, 3, 'vc'), ('Contrabass', 43, 4, 'cb'),
    ('Piccolo', 72, 5, 'picc'), ('Flute', 73, 5, 'fl'), ('Oboe', 68, 6, 'ob'), ('Clarinet', 71, 7, 'cl'), ('Bassoon', 70, 8, 'fg'),
    ('Horn', 60, 10, 'hn'), ('Trumpets_HW', 56, 11, 'tp'), ('Trumpets_CB', 56, 11, 'tp'), ('Trombone', 57, 12, 'tb'), ('Tuba', 58, 12, 'tuba'),
    ('Timpani', 47, 13, 'timp'), ('Gran Cassa', 116, 9, 'gc'), ('Snare Drum', 116, 9, 'snare'), ('Cymbals', 116, 9, 'cym'),
    ('Xylophone_HW', 13, 15, 'xylo'), ('Marimba', 12, 15, 'mar'), ('Celeste_BBC', 8, 15, 'cel'), ('Piano', 0, 15, 'pf'), ('Harp', 46, 14, 'hp'),
]

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples', 'test_orchestra.mid')
    bpm = float(sys.argv[2]) if len(sys.argv) > 2 else 96.0  # 24 小節 × 4 拍 @ 96bpm = 60 秒
    tracks = []
    t0 = [(0, meta(0x03, b'Tempo/Meta')), (0, meta(0x51, struct.pack('>I', int(60_000_000 / bpm))[1:])), (0, meta(0x58, bytes([4, 2, 24, 8])))]
    tracks.append(track_chunk(t0))
    for name, prog, ch, part in PARTS:
        ev = [(0, meta(0x03, name.encode())), (0, bytes([0xC0 | ch, prog]))]
        # 強弱の CC：弦は CC11 で曲全体のクレッシェンド（velocity はほぼ一定）、金管は CC1 で各小節スウェル
        if part in ('vn1', 'vn2', 'va', 'vc', 'cb'):
            for k in range(BARS * 8):
                ev.append((k * BEAT // 2, bytes([0xB0 | ch, 11, int(40 + 85 * k / (BARS * 8))])))
        if part in ('hn', 'tp', 'tb', 'tuba'):
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
