#!/usr/bin/env node
/*
 * ピアノの胴の一番下の行（y 33）の輪郭を型に、胴（y 20..32）と蓋（y 12..19）を作り直す
 * 最終更新: 2026-09-25 / v1.0 / 生成元: PixelOrchestra
 *
 * ユーザーが編集画面（/edit.html?part=piano）で y 33 の輪郭だけ直して保存した時に使う。
 *   胴の中身（y 23..32）＝輪郭の内側を黒で埋める
 *   金のフレーム（y 22）＝縁 2 セルを黒、内側を金
 *   胴の上の縁（y 20..21）＝縁 2 セルだけ（内側は空ける）
 *   蓋（y 12..19）＝斜めの面（sprites.js の pianoLidY と同じ）を輪郭で切る。突っかい棒（z 26）も置き直す
 *   譜面台・鍵盤（z 44 より手前の y 12..19、z 50..）・脚・ペダルは触らない
 * 書き換える前に assets/voxel/backup/piano_<日時>_before_fill.json へ退避する。
 *
 * Usage:
 *   node tools/piano_fill.js                          # assets/voxel/piano.json を補完（退避つき）
 *   node tools/piano_fill.js path/to/piano.json       # 別のファイルを補完
 *   node tools/piano_fill.js --dry-run                # 書き換えず、変わるセル数と輪郭の一致だけ表示
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'assets', 'voxel', 'piano.json'));
if (!fs.existsSync(file)) { console.error(`✗ ${file} がありません。編集画面でピアノを保存してから実行してください`); process.exit(1); }

const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const W = d.w, BLACK = 'a', GOLD = 'b', BASE_Y = 33;
if (d.palette?.[BLACK]?.toLowerCase() !== '#101016' || d.palette?.[GOLD]?.toLowerCase() !== '#a7791c') {
  console.error('✗ パレットの a（黒）・b（金）が想定と違います。編集画面で色を足した・消した可能性があるので、中身を確認してください');
  process.exit(1);
}
const L = d.layers.map((zl) => zl.map((r) => r.split('')));

// 型：y 33 の奥行き z ごとの左右の端（生の x）
const F = [];
for (let z = 0; z < d.depth; z++) {
  const r = L[z][BASE_Y]; let lo = -1, hi = -1;
  for (let x = 0; x < W; x++) if (r[x] !== '.') { if (lo < 0) lo = x; hi = x; }
  F[z] = lo < 0 ? null : [lo, hi];
}
const U = (raw) => W - 1 - raw;                   // 生の x → 奏者から見た x（低音側 0。データは左右反転して持っている）
const lidY = (xu) => 19 - Math.floor(xu / 10);    // 蓋の行（sprites.js の pianoLidY と同じ）
let changed = 0;
const set = (z, y, x, v) => { if (L[z][y][x] !== v) { L[z][y][x] = v; changed++; } };

for (let z = 0; z < 44; z++) {
  const f = F[z];
  for (let y = 20; y <= 32; y++) for (let x = 0; x < W; x++) {
    let v = '.';
    if (f && x >= f[0] && x <= f[1]) {
      const inner = z >= 2 && x >= f[0] + 2 && x <= f[1] - 2;
      v = y <= 21 ? (inner ? '.' : BLACK) : y === 22 ? (inner ? GOLD : BLACK) : BLACK;
    }
    set(z, y, x, v);
  }
  for (let y = 12; y <= 19; y++) for (let x = 0; x < W; x++) {
    set(z, y, x, f && x >= f[0] && x <= f[1] && y === lidY(U(x)) ? BLACK : '.');
  }
}
{ // 突っかい棒：z 26、輪郭の高音側の端から 4 セル内側
  const f = F[26];
  if (f) { const xu = (W - f[0]) - 4, raw = U(xu); for (let y = lidY(xu) + 1; y < 20; y++) set(26, y, raw, BLACK); }
}
for (let z = 44; z < 50; z++) { // 譜面台の手前〜鍵盤の奥：胴の外を消し、内を埋める
  const f = F[z];
  for (let y = 20; y <= 32; y++) for (let x = 0; x < W; x++) {
    const inside = f && x >= f[0] && x <= f[1];
    if (!inside && L[z][y][x] !== '.') set(z, y, x, '.');
    if (inside && L[z][y][x] === '.') set(z, y, x, BLACK);
  }
}

const out = { ...d, layers: L.map((zl) => zl.map((r) => r.join(''))) };
const ext = (y, z) => { const r = out.layers[z][y]; let lo = -1, hi = -1; for (let x = 0; x < W; x++) if (r[x] !== '.') { if (lo < 0) lo = x; hi = x; } return lo < 0 ? null : [lo, hi]; };
let mism = 0;
for (let z = 0; z < 50; z++) for (let y = 22; y <= 32; y++) if (JSON.stringify(ext(y, z)) !== JSON.stringify(ext(BASE_Y, z))) mism++;

if (dry) { console.log(`[dry-run] 変わるセル ${changed} / 胴の輪郭の不一致 ${mism}`); process.exit(0); }
if (!changed) { console.log('変わるセルはありません（すでに y 33 の輪郭どおり）'); process.exit(0); }

const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
const backupDir = path.join(path.dirname(file), 'backup');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `piano_${ts}_before_fill.json`);
fs.copyFileSync(file, backup);
fs.writeFileSync(file, JSON.stringify(out));
console.log(`✓ 補完しました：変わったセル ${changed} / 胴の輪郭の不一致 ${mism}`);
console.log(`  退避：${path.relative(process.cwd(), backup)}`);
console.log('  編集画面のタブは再読み込みしてください（そのまま保存すると補完が消えます）');
