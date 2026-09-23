/*
 * PixelOrchestra — sprites.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * プログラム生成の「仮ドット絵」。本番の絵に差し替える時はここの draw 関数を
 * 画像読み込み（同じ pivot 指定）に置き換えればよい。
 * 座標系：キャンバス左上原点・y 下向き（px）。pivot はそのピクセル座標で指定する。
 */

export const PX = 0.075; // 基本グリッドの 1ピクセル = 0.075 world unit（34px の体 ≒ 2.55 unit。座標・pivot・手の位置はこの単位）
export const VOX = PX / 2; // ボクセル 1 個 = 基本グリッドの半分（2 倍解像度の絵の 1 ドット）。res:1 のパーツは 1 ドット = 2×2 ボクセル

export const C = {
  coat: '#1b1b26', coat2: '#2b2b3c', shirt: '#f4f4f4', skin: '#efbea7', skin2: '#d79c82',
  shoe: '#0c0c10', wood: '#8a4b2a', wood2: '#5a2e14', gold: '#e2b348', gold2: '#a7791c',
  silver: '#d5dbe2', silver2: '#8d97a3', black: '#101016', white: '#ffffff',
  copper: '#b8703a', copper2: '#7e4a22', head: '#efe7d5', eye: '#111111', ivory: '#f6f1dc',
};
const HAIR = ['#2b1b12', '#5a3a1e', '#d9c27a', '#3a3a3a', '#8c2e2e', '#6d4b31', '#c9c9c9'];

class Pen {
  constructor(g) { this.g = g; }
  r(x, y, w, h, col) { if (w <= 0 || h <= 0) return; this.g.fillStyle = col; this.g.fillRect(x, y, w, h); }
  p(x, y, col) { if (col === null) { this.g.clearRect(x, y, 1, 1); return; } this.r(x, y, 1, 1, col); }
  line(x0, y0, x1, y1, col) { // ブレゼンハム
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    let x = x0, y = y0;
    for (let i = 0; i < 4096; i++) { // 中断条件（暴走防止）
      this.p(x, y, col);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  disc(cx, cy, rad, col) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.5) this.p(cx + x, cy + y, col);
  }
  ring(cx, cy, rad, col) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = x * x + y * y;
      if (d <= rad * rad + rad * 0.5 && d >= (rad - 1) * (rad - 1) + (rad - 1) * 0.5) this.p(cx + x, cy + y, col);
    }
  }
}

/**
 * ドット絵パーツをボクセル（押し出し）メッシュとして生成する。
 * ドットを描いたキャンバスを読み取り、塗られたピクセルを奥行き depth のボクセル柱にして露出面だけをメッシュ化。
 * pivot（回転の中心）がメッシュのローカル原点、+z が正面。同じ定義のパーツはジオメトリを共有（キャッシュ）。
 * opts: { depth: 奥行き[px], z0: 背面の z[px], back: 背面の色置換 {from:to} }
 */
// 絵の方式：'voxel'（押し出し立体）／'sprite'（2D の板・ビルボード）。切替後は奏者を作り直す
export let PART_STYLE = 'voxel';
export function setPartStyle(style) { PART_STYLE = style === 'sprite' ? 'sprite' : 'voxel'; }

const partCache = new Map();
// 自己発光（emissive）をボクセルの色で光らせる：Lambert の emissive は一様な色なので、そのままだと絵が白く霞む。
// 頂点色を掛けて「その絵の色のまま光る」ようにする。emissive が黒（既定）なら見た目は変わらない。
// 関数を 1 つだけ共有する（同じ関数なら three.js がシェーダーを使い回す）。2026-09-17
function emissiveByVertexColor(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif');
}

/**
 * opts.res: 描画グリッドの解像度。1 = 基本グリッド（従来の絵。1 ドット = 2×2 ボクセル）、2 = 2 倍解像度（1 ドット = 1 ボクセル）。
 *   w/h/pivot/depth/z0 は res のグリッド単位で指定する（res:2 なら細かい px）。
 * opts.side: 側面図の描画関数（省略可）。指定すると正面図の押し出しと側面図の押し出しの共通部分で立体を削り出す。
 *   側面図のキャンバスは 幅 = depth（奥行き、左が背面 z0）・高さ = h、y は正面図と同じ行。
 * opts.top: 上面図の描画関数（省略可）。幅 = w（x は正面図と同じ列）・高さ = depth（上が背面 z0）。3 面削り出し。
 * opts.carve: (x, y, z) => true で削る（ベルの穴・太鼓の中など、面図では表せない中空用）。x=列, y=行(上が0), z=0..depth-1
 * opts.colorOf: (x, y, z) => '#rrggbb' | null。ボクセルごとの色の上書き（頭の後ろ半分を髪色にする等）
 */
/** 直前に makePart が受け取った引数（bakePart が同じ形を焼き出すために使う。2026-09-21） */
let _lastPartArgs = null;
export function lastPartArgs() { return _lastPartArgs; }

export function makePart(w, h, pivotX, pivotY, draw, opts = {}) {
  _lastPartArgs = { w, h, pivotX, pivotY, draw, opts };   // 焼き出し（bakePart）が同じ引数を使えるように控える
  const res = opts.res ?? 1;
  if (PART_STYLE === 'sprite') return makePartSprite(w, h, pivotX, pivotY, draw, res);
  const depth = opts.depth ?? 2, z0 = opts.z0 ?? 0;
  const key = opts.key || `${draw.toString()}|${(opts.side || '').toString()}|${(opts.top || '').toString()}|${(opts.carve || '').toString()}|${(opts.colorOf || '').toString()}|${w},${h},${pivotX},${pivotY},${depth},${z0},${res}|${opts.accent || ''}`;
  let geo = partCache.get(key);
  if (!geo) {
    const { img, sideImg, topImg } = partImages(w, h, depth, draw, opts);
    const cell = PX / res;   // グリッド単位 → 世界サイズ（res:1 は 1 ドット = 2×2 ボクセル、res:2 = 1 ボクセル）
    geo = voxelize(img, w, h, pivotX, pivotY, depth, z0, opts.back || null, cell, sideImg, topImg, opts.carve || null, opts.colorOf || null);
    partCache.set(key, geo);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = emissiveByVertexColor;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.baseColor = mat.color.clone(); // 明滅の対象の目印（フラッシュは emissive で行う。puppet.js の _attackFlash）
  mesh.userData.size = { w, h, depth };
  return mesh;
}

/** 正面図・側面図・上面図の ImageData を作る（makePart と bakePart で共有） */
function partImages(w, h, depth, draw, opts) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(new Pen(g));
  let sideImg = null, topImg = null;
  if (opts.side) {
    const sc = document.createElement('canvas');
    sc.width = depth; sc.height = h;
    const sg = sc.getContext('2d');
    opts.side(new Pen(sg));
    sideImg = sg.getImageData(0, 0, depth, h);
  }
  if (opts.top) {
    const tc = document.createElement('canvas');
    tc.width = w; tc.height = depth;
    const tg = tc.getContext('2d');
    opts.top(new Pen(tg));
    topImg = tg.getImageData(0, 0, w, depth);
  }
  return { img: g.getImageData(0, 0, w, h), sideImg, topImg };
}

// 2D 版：ドット絵をテクスチャにした板（最近傍補間）。pivot がローカル原点
function makePartSprite(w, h, pivotX, pivotY, draw, res = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(new Pen(g));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;   // ドット絵は最近傍補間（TOOL_CRAFT_MEDIA §1-3）
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const cell = PX / res;
  const geo = new THREE.PlaneGeometry(w * cell, h * cell);
  geo.translate((w / 2 - pivotX) * cell, (pivotY - h / 2) * cell, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.baseColor = mat.color.clone();
  mesh.userData.size = { w, h, depth: 0 };
  return mesh;
}

// ピクセル → ボクセル → 露出面のみの BufferGeometry（頂点色・法線付き）
// cell: 1 グリッドの世界サイズ。sideImg があれば側面図（幅 depth × 高さ h）で z 方向を削る（2 面削り出し）
/**
 * 露出面だけの BufferGeometry を組む共通部分（2026-09-21 に切り出し：手続き的な部位と、
 * 画面で編集したボクセルデータの両方から同じメッシュを作るため。面の出し方・背面色の扱いは従来どおり）。
 *   filled(x,y,z) -> boolean ／ colorAt3(x,y,z) -> [r,g,b]（0〜1）／ backAt(x,y,z) -> 一番奥の面の色
 */
function meshCells({ w, h, depth, pivotX, pivotY, z0, cell, filled, colorAt3, backAt }) {
  const filledBehind = (x, y, z) => { for (let k = 0; k < z; k++) if (filled(x, y, k)) return true; return false; };
  const pos = [], nor = [], col = [];
  const quad = (a, b, c, e, n, rgb) => { // 4 頂点（反時計回り）→ 2 三角形
    for (const v of [a, b, c, a, c, e]) { pos.push(v[0] * cell, v[1] * cell, v[2] * cell); nor.push(...n); col.push(...rgb); }
  };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) for (let z = 0; z < depth; z++) {
    if (!filled(px, py, z)) continue;
    const rgb = colorAt3(px, py, z);
    const x0 = px - pivotX, x1 = x0 + 1;
    const y1 = pivotY - py, y0 = y1 - 1;
    const zb = z0 + z, zf = zb + 1;
    const front = z === depth - 1 || !filled(px, py, z + 1);
    const backF = z === 0 || !filled(px, py, z - 1);
    const rearmost = backF && !filledBehind(px, py, z);
    if (front) quad([x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf], [0, 0, 1], rgb);                 // 正面（+z）
    if (backF) quad([x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb], [0, 0, -1], rearmost ? backAt(px, py, z) : rgb); // 背面（-z）
    if (!filled(px - 1, py, z)) quad([x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb], [-1, 0, 0], rgb); // 左
    if (!filled(px + 1, py, z)) quad([x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf], [1, 0, 0], rgb);  // 右
    if (!filled(px, py - 1, z)) quad([x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb], [0, 1, 0], rgb);  // 上
    if (!filled(px, py + 1, z)) quad([x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf], [0, -1, 0], rgb); // 下
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

const hex2rgb = (s) => { const v = parseInt(s.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// ピクセル → ボクセル → 露出面のみの BufferGeometry（頂点色・法線付き）
// cell: 1 グリッドの世界サイズ。sideImg があれば側面図（幅 depth × 高さ h）で z 方向を削る（2 面削り出し）
function voxelize(img, w, h, pivotX, pivotY, depth, z0, back, cell = PX, sideImg = null, topImg = null, carve = null, colorOf = null) {
  const o = occupancy(img, w, h, depth, sideImg, topImg, carve);
  const d = img.data;
  const colorAt = (x, y) => [d[(y * w + x) * 4] / 255, d[(y * w + x) * 4 + 1] / 255, d[(y * w + x) * 4 + 2] / 255];
  // 背面色の置換：キー色との距離が近ければ置換（hsl→rgb の丸めで 1 ずれることがあるので厳密一致にしない）
  const backEntries = back ? Object.entries(back).map(([k, v]) => { const a = parseInt(k.slice(1), 16); return [[(a >> 16) & 255, (a >> 8) & 255, a & 255], hex2rgb(v)]; }) : [];
  const backAt = (x, y) => {
    const i = (y * w + x) * 4;
    for (const [k, v] of backEntries) {
      if (Math.abs(d[i] - k[0]) <= 6 && Math.abs(d[i + 1] - k[1]) <= 6 && Math.abs(d[i + 2] - k[2]) <= 6) return v;
    }
    return colorAt(x, y);
  };
  const colorAt3 = (x, y, z) => {
    if (colorOf) { const c = colorOf(x, y, z); if (c) return hex2rgb(c); }
    return colorAt(x, y);
  };
  return meshCells({ w, h, depth, pivotX, pivotY, z0, cell, filled: o, colorAt3, backAt });
}

/** 正面図 AND 側面図 AND 上面図 AND not carve の占有判定を返す */
function occupancy(img, w, h, depth, sideImg, topImg, carve) {
  const d = img.data;
  const filledFront = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const sd = sideImg ? sideImg.data : null;
  const filledSide = (z, y) => !sd || (z >= 0 && z < depth && y >= 0 && y < h && sd[(y * depth + z) * 4 + 3] > 127);
  const td = topImg ? topImg.data : null;
  const filledTop = (x, z) => !td || (x >= 0 && x < w && z >= 0 && z < depth && td[(z * w + x) * 4 + 3] > 127);
  return (x, y, z) => filledFront(x, y) && filledSide(z, y) && filledTop(x, z) && !(carve && carve(x, y, z));
}

/**
 * 部位 → 編集用のボクセルデータ（2026-09-21 ユーザー指定：髪型などを画面で直接いじるため）。
 * makePart と同じ引数を渡すと、占有と色をそのまま焼き出す。
 * 形式：{ res, w, h, depth, z0, pivotX, pivotY, palette, back, layers }
 *   layers[z] = 高さ h の文字列の配列（1 文字 = 1 セル。'.' は空、それ以外は palette の記号）
 */
export function bakePart(w, h, pivotX, pivotY, draw, opts = {}) {
  const res = opts.res ?? 1, depth = opts.depth ?? 2, z0 = opts.z0 ?? 0;
  const { img, sideImg, topImg } = partImages(w, h, depth, draw, opts);
  const filled = occupancy(img, w, h, depth, sideImg, topImg, opts.carve || null);
  const d = img.data;
  const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/=<>[]{}()!?@#$%&~^_|;:,';
  const palette = {}, byHex = {};
  const sym = (hex) => {
    if (byHex[hex]) return byHex[hex];
    const k = KEYS[Object.keys(palette).length];
    if (!k) return byHex[hex] = Object.keys(palette)[0] || 'a';   // 色数が尽きたら先頭に寄せる（実際には起きない想定）
    palette[k] = hex; byHex[hex] = k;
    return k;
  };
  const layers = [];
  for (let z = 0; z < depth; z++) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        if (!filled(x, y, z)) { row += '.'; continue; }
        let hex = null;
        if (opts.colorOf) hex = opts.colorOf(x, y, z);
        if (!hex) { const i = (y * w + x) * 4; hex = rgb2hex(d[i], d[i + 1], d[i + 2]); }
        row += sym(hex.toLowerCase());
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return { res, w, h, depth, z0, pivotX, pivotY, palette, back: opts.back || null, layers };
}

/** 編集済みボクセルデータ → メッシュ（makePart の代わり。accent はキャッシュのキー）。
 *  編集画面のように毎回作り直す場合は cache:false（キャッシュが際限なく増えるため） */
export function voxelPart(data, accent = 'voxel', { cache = true } = {}) {
  const { w, h, depth, z0, pivotX, pivotY, palette, back, layers } = data;
  const cell = PX / (data.res ?? 1);
  const key = `voxel|${accent}|${w},${h},${depth},${z0},${pivotX},${pivotY}`;
  let geo = cache ? partCache.get(key) : null;
  if (!geo) {
    const at = (x, y, z) => {
      if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= depth) return null;
      const ch = layers[z][y][x];
      return ch === '.' ? null : (palette[ch] || null);
    };
    const backMap = back ? Object.fromEntries(Object.entries(back).map(([k, v]) => [k.toLowerCase(), v])) : null;
    const colorAt3 = (x, y, z) => hex2rgb(at(x, y, z));
    const backAt = (x, y, z) => { const c = at(x, y, z); return hex2rgb((backMap && backMap[c]) || c); };
    geo = meshCells({ w, h, depth, pivotX, pivotY, z0, cell, filled: (x, y, z) => !!at(x, y, z), colorAt3, backAt });
    if (cache) partCache.set(key, geo);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = emissiveByVertexColor;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.baseColor = mat.color.clone();
  mesh.userData.size = { w, h, depth };
  return mesh;
}

/**
 * 木の楽器の個体差（2026-09-11、顔の二色と同じ考え方）：共有ジオメトリを複製し、木の色の頂点だけを
 *   1) ニスの色味（seed で色相 ±6°・明るさ ±8%）で全体に色を振り
 *   2) 2px 単位の区画ハッシュで 25% を少し暗くして木目の塊感を出す
 * 6 頂点＝1 面なので面の中心で判定し、面内で色が割れないようにする。木の判定は「赤 > 緑 > 青 で赤と青の差が大きい」茶系
 */
/**
 * パーツの色を置き換える（衣装のキーカラー用。2026-09-21 ユーザー指定）。map = { '#元の色': '#新しい色' }、tol は 0〜255 の許容差。
 * ジオメトリは共有・キャッシュされているので、置き換えが 1 か所でもあれば複製してから頂点色を書き換える（applyWoodVariation と同じ作り）
 */
export function recolorParts(root, map, tol = 3) {
  const entries = Object.entries(map).map(([k, v]) => [new THREE.Color(k), new THREE.Color(v)]);
  const near = (a, b) => Math.abs(a - b) * 255 <= tol;
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes?.color) return;
    const src = m.geometry.attributes.color;
    let geo = null;
    for (let i = 0; i < src.count; i++) {
      const r = src.getX(i), g = src.getY(i), b = src.getZ(i);
      for (const [from, to] of entries) {
        if (!(near(r, from.r) && near(g, from.g) && near(b, from.b))) continue;
        if (!geo) geo = m.geometry.clone();
        geo.attributes.color.setXYZ(i, to.r, to.g, to.b);
        break;
      }
    }
    if (geo) { geo.attributes.color.needsUpdate = true; m.geometry = geo; }
  });
  return root;
}

export function applyWoodVariation(root, seed) {
  const h3 = (x, y, z) => { let n = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (seed * 2654435761), 1) >>> 0; n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const r0 = h3(1, 2, 3), r1 = h3(4, 5, 6);
  const hueShift = (r0 - 0.5) * 12 / 360, lightMul = 1 + (r1 - 0.5) * 0.16;
  const c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
  const cellPx = PX * 2; // 区画 = 2px
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes?.color) return;
    const geo = m.geometry.clone();
    const col = geo.attributes.color, pos = geo.attributes.position;
    for (let i = 0; i + 5 < col.count; i += 6) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if (!(r > g && g > b && r - b > 0.15)) continue; // 木の茶系だけ
      if (isMetalColor(r, g, b)) continue;             // 金・真鍮・銅は茶系の条件に入ってしまうので除く。
                                                       // ずらすと金属色の一致判定（metalOf）から外れる（2026-09-23）
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 6; k++) { cx += pos.getX(i + k); cy += pos.getY(i + k); cz += pos.getZ(i + k); }
      const grain = h3(Math.floor(cx / 6 / cellPx + 50), Math.floor(cy / 6 / cellPx + 50), Math.floor(cz / 6 / cellPx + 50)) < 0.25 ? 0.9 : 1;
      c.setRGB(r, g, b).getHSL(hsl);
      c.setHSL((hsl.h + hueShift + 1) % 1, hsl.s, Math.min(1, hsl.l * lightMul * grain));
      // ずらした先が金属色に入ってしまったら元の色のままにする。
      // 例：ファゴットの木 #8a4e2a がニスの個体差で #7c4726 になり、濃い銅 #7e4a22 と一致して
      // 胴の一部が金属として光っていた（2026-09-23）
      if (isMetalColor(c.r, c.g, c.b)) continue;
      for (let k = 0; k < 6; k++) col.setXYZ(i + k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    m.geometry = geo;
  });
}

// 太鼓のラグ／チューニングねじ：中心からの角度が n 等分の位置（±half セル幅）にあるか（2026-09-11）
function lugAngle(dx, dz, n, half) {
  const r = Math.hypot(dx, dz); if (r < 1e-6) return false;
  const a = Math.atan2(dz, dx), step = 2 * Math.PI / n;
  const k = Math.round(a / step);
  return Math.abs(a - k * step) * r <= half;
}

/**
 * ドットデータ（tools/img2voxel.py が画像から生成）→ ボクセルのパーツ。pivot = 底辺の中央。
 * data = { palette: { 記号: '#rrggbb' }, rows: ['....', ...] }。'.'（パレットに無い記号）は空セル。
 * 裏面は濃い色に置き換えて、後ろから見た時にのっぺりしないようにする（2026-09-12）
 */
export function dotPart(data, { depth = 6, res = 1, name = 'dots', back = null, inner = null } = {}) {
  const rows = data.rows, W = rows[0].length, H = rows.length;
  const skip = new Set(inner ? inner.chars.split('') : []);
  const drawOf = (want) => (d) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = rows[y][x], c = data.palette[ch];
      if (c && skip.has(ch) === want) d.p(x, y, c);
    }
  };
  const main = makePart(W, H, W / 2, H, drawOf(false), {
    res, depth, z0: -depth / 2, back,
    key: `dot|${name}|${W}x${H}|${depth}|${res}|${back ? Object.entries(back).join() : ''}|${inner ? inner.chars : ''}`,
  });
  if (!inner) return main;
  // 内側を埋める板（本体より奥に引っ込める）。本体が出っ張って見える
  const innerMesh = makePart(W, H, W / 2, H, drawOf(true), {
    res, depth: inner.depth ?? 4, z0: inner.z0 ?? (-depth / 2),
    key: `dotIn|${name}|${W}x${H}|${inner.depth}|${inner.z0}|${res}`,
  });
  const g = new THREE.Group();
  g.add(main, innerMesh);
  g.userData.size = main.userData.size;
  return g;
}

// ---------------- 人物パーツ ----------------

/**
 * 体（燕尾服・立ち姿）2 倍解像度 32×68（基本グリッド 16×34 相当）、pivot = 足元中央。
 * 側面図：胸が厚く腰が細く、脚は薄い。奥行き 12（基本 6）
 */
export function bodyHiRes(accent = '#c03030') {
  const back = { [C.shirt]: C.coat, [accent.toLowerCase()]: C.coat, [C.coat2]: C.coat2 };
  const front = (d) => {
    d.r(12, 10, 8, 6, C.skin);                                  // 首
    d.r(6, 16, 20, 26, C.coat);                                 // 上着
    d.r(5, 18, 1, 6, C.coat2); d.r(26, 18, 1, 6, C.coat2);      // 肩の張り
    d.r(6, 40, 20, 2, C.coat2);                                 // 裾のライン
    // シャツの V ゾーン（下へ狭まる）
    const v = [[12, 8], [13, 6], [13, 6], [14, 4], [14, 4], [15, 2], [15, 2], [15, 2], [15, 2], [15, 2], [15, 2], [15, 2], [15, 2], [15, 2]];
    v.forEach(([x, w], i) => d.r(x, 16 + i, w, 1, C.shirt));
    d.r(11, 16, 1, 2, C.coat2); d.r(20, 16, 1, 2, C.coat2);     // ラペルの陰
    d.r(12, 17, 8, 2, accent); d.r(15, 16, 2, 4, accent);       // 蝶ネクタイ
    d.p(15, 31, C.coat2); d.p(15, 35, C.coat2);                  // ボタン
    d.r(6, 42, 7, 10, C.coat); d.r(19, 42, 7, 10, C.coat);      // 燕尾
    d.r(8, 42, 7, 22, C.coat2); d.r(17, 42, 7, 22, C.coat2);    // ズボン
    d.r(9, 62, 5, 2, C.coat);                                    // 折り返し
    d.r(18, 62, 5, 2, C.coat);
    d.r(7, 64, 8, 4, C.shoe); d.r(17, 64, 8, 4, C.shoe);        // 靴
    d.r(8, 64, 6, 1, '#2a2a34');                                 // 靴の光沢
    d.r(18, 64, 6, 1, '#2a2a34');
  };
  // 側面図（幅 12 = 奥行き、右端が正面）：首 → 胸（厚い）→ 腰（細い）→ 脚（薄い）
  const side = (d) => {
    d.r(4, 10, 5, 6, C.skin);                 // 首
    d.r(0, 16, 12, 12, C.coat);               // 胸
    d.r(1, 28, 10, 14, C.coat);               // 腹〜腰
    d.r(1, 42, 9, 10, C.coat);                // 燕尾・腰
    d.r(2, 42, 8, 22, C.coat2);               // 脚
    d.r(1, 64, 11, 4, C.shoe);                // 靴（つま先は前へ）
  };
  return makePart(32, 68, 16, 68, front, { res: 2, depth: 12, z0: -6, back, accent, side });
}

/**
 * 体（燕尾服・立ち姿）16×34、pivot = 足元中央。ディテールは少なめ（2026-09-09 ユーザー判断：中途半端な描き込みより簡素な方が良い）。
 * 側面図で「胸が厚く腰が細く脚が薄い」立体だけ与える。奥行き 6
 */
// 任意の CSS 色（hsl() 等）を #rrggbb に正規化（背面色の置換表のキーに使う）
const _norm = document.createElement('canvas').getContext('2d');
function toHex(color) { _norm.fillStyle = color; return _norm.fillStyle; }

export function body(accent = '#c03030') {
  // 背面：シャツ・蝶ネクタイは表だけ（後ろから見たら上着の色）
  const back = { [C.shirt]: C.coat, [toHex(accent)]: C.coat };
  const side = (d) => {
    d.r(2, 5, 3, 3, C.skin);      // 首
    d.r(0, 8, 6, 6, C.coat);      // 胸
    d.r(1, 14, 4, 7, C.coat);     // 腹〜腰
    d.r(1, 21, 4, 11, C.coat2);   // 脚
    d.r(0, 32, 6, 2, C.shoe);     // 靴
  };
  return makePart(16, 34, 8, 34, (d) => {
    d.r(6, 5, 4, 3, C.skin);                 // 首
    d.r(3, 8, 10, 13, C.coat);               // 上着
    d.r(2, 9, 1, 8, C.coat2); d.r(13, 9, 1, 8, C.coat2); // 肩の陰
    d.r(6, 8, 4, 8, C.shirt);                // シャツ
    d.r(5, 9, 6, 2, accent);                 // 蝶ネクタイ（トラック色）
    d.r(3, 21, 4, 4, C.coat); d.r(9, 21, 4, 4, C.coat); // 燕尾
    d.r(4, 21, 3, 11, C.coat2); d.r(9, 21, 3, 11, C.coat2); // ズボン
    d.r(3, 32, 4, 2, C.shoe); d.r(9, 32, 4, 2, C.shoe);   // 靴
  }, { depth: 6, z0: -3, back, accent, side });
}

// ---------------- 座り姿勢のパーツ ----------------
// 立ち姿の体（16×34）からズボン以下を除いた上半身。pivot = 腰（座面の高さ y=13 に置く）。座った時も肩・首の高さは立ち姿と同じ
export function torsoSeated(accent = '#c03030') {
  const back = { [C.shirt]: C.coat, [toHex(accent)]: C.coat };
  const side = (d) => { d.r(2, 5, 3, 3, C.skin); d.r(0, 8, 6, 6, C.coat); d.r(1, 14, 4, 7, C.coat); };
  return makePart(16, 21, 8, 21, (d) => {
    d.r(6, 5, 4, 3, C.skin);                 // 首
    d.r(3, 8, 10, 13, C.coat);               // 上着
    d.r(2, 9, 1, 8, C.coat2); d.r(13, 9, 1, 8, C.coat2);
    d.r(6, 8, 4, 8, C.shirt);
    d.r(5, 9, 6, 2, accent);
  }, { depth: 6, z0: -3, back, accent, side });
}
/** 立った脚 16×13、pivot = 足元中央。body() の rows 21-34 と同じ絵（燕尾・ズボン・靴）。腰から上（torsoSeated）と分けて、揺れを上半身だけにする */
export function legsStanding() {
  const side = (d) => { d.r(1, 0, 4, 11, C.coat2); d.r(0, 11, 6, 2, C.shoe); };
  return makePart(16, 13, 8, 13, (d) => {
    d.r(3, 0, 4, 4, C.coat); d.r(9, 0, 4, 4, C.coat);       // 燕尾
    d.r(4, 0, 3, 11, C.coat2); d.r(9, 0, 3, 11, C.coat2);   // ズボン
    d.r(3, 11, 4, 2, C.shoe); d.r(9, 11, 4, 2, C.shoe);     // 靴
  }, { depth: 6, z0: -3, side });
}
/** 座った脚（ボクセル用）：太もも（前へ 10）・すね（下へ 12）・靴。配置は puppet 側 */
// 2 倍解像度（2026-09-10）。寸法は従来どおり（太もも 3×3×10、すね 3×12×3、靴 4×2×6 [px]）
// 断面は円（2026-09-11）。太ももは前へ伸びる横向きの柱なので x-y 面で円、すねは縦の柱で膝 r3.0 → 足首 r2.4 に細くなる
export function thigh() { return makePart(6, 6, 3, 6, (d) => { d.r(0, 0, 6, 6, C.coat2); }, { res: 2, depth: 20, z0: 0,
  carve: (x, y, z) => { const dx = x + 0.5 - 3, dy = y + 0.5 - 3; return dx * dx + dy * dy > 9; } }); }
export function shin()  { return makePart(6, 24, 3, 24, (d) => { d.r(0, 0, 6, 24, C.coat2); }, { res: 2, depth: 6, z0: 0, carve: roundColumn(3, 3, 3.0, 2.4, 0, 23) }); }
// 靴：つま先が細く丸い（上面図で絞る）。かかとは少し暗く
export function shoe()  { return makePart(8, 4, 4, 4, (d) => { d.r(0, 0, 8, 4, C.shoe); d.r(0, 0, 8, 1, '#2a2a34'); }, { res: 2, depth: 12, z0: 0,
  top: (d) => { d.r(0, 0, 8, 8, F); d.r(1, 8, 6, 2, F); d.r(2, 10, 4, 2, F); } }); }
/** 座った脚（2D 板用・正面図）16×14、pivot = 足元中央 */
export function legsSeatedSprite() {
  return makePart(16, 14, 8, 14, (d) => {
    d.r(3, 0, 4, 2, C.coat2); d.r(9, 0, 4, 2, C.coat2);    // 太もも（手前に短く見える）
    d.r(4, 2, 3, 10, C.coat2); d.r(9, 2, 3, 10, C.coat2);  // すね
    d.r(3, 12, 4, 2, C.shoe); d.r(9, 12, 4, 2, C.shoe);    // 靴
  });
}
/** 椅子 12×25 px（2 倍解像度 24×50 セル。背もたれ 12・座面 2・脚 11）、pivot = 床の後端中央。奥行き 12：背もたれは後ろ、脚は前後 2 本ずつ。
 *  背もたれは枠＋縦桟 3 本（隙間あり）。2026-09-10 解像度アップ */
export function chair() {
  // 座面は rows 26-30（上面 y=12px）：太もも（y 12-15）が座面に食い込まないよう 1px 低く（2026-09-11 ユーザー指摘）
  const side = (d) => { d.r(0, 0, 3, 26, F); d.r(0, 26, 24, 4, F); d.r(0, 30, 4, 20, F); d.r(20, 30, 4, 20, F); };
  return makePart(24, 50, 12, 50, (d) => {
    d.r(0, 0, 24, 3, '#4a3020'); d.r(0, 0, 3, 26, '#4a3020'); d.r(21, 0, 3, 26, '#4a3020'); // 背もたれの枠（上・左右）
    d.r(6, 3, 3, 23, '#5a3a26'); d.r(11, 3, 2, 23, '#5a3a26'); d.r(15, 3, 3, 23, '#5a3a26'); // 縦桟
    d.r(0, 26, 24, 4, '#6a4630'); d.r(0, 26, 24, 1, '#7a5238');                            // 座面（上面は少し明るく）
    d.r(0, 30, 4, 20, '#3a2418'); d.r(20, 30, 4, 20, '#3a2418');                          // 脚
    d.r(4, 42, 16, 2, '#3a2418');                                                          // 脚の貫（横木）
  }, { res: 2, depth: 24, z0: 0, side });
}

/** 頭（高解像度版・未採用）24×24 */
export function headHiRes(seed = 0, back = false) {
  const hair = HAIR[seed % HAIR.length];
  const backMap = { [C.skin]: hair, [C.skin2]: hair, [C.eye]: hair, '#ffffff': hair };
  const styleId = seed % 4; // 髪型の種類
  const front = (d) => {
    d.r(4, 6, 16, 18, C.skin);                         // 顔
    d.p(4, 6, null); d.r(4, 22, 1, 2, C.skin2); d.r(19, 22, 1, 2, C.skin2); // あご
    d.r(2, 2, 20, 8, hair);                            // 髪（頭頂）
    d.r(3, 1, 18, 1, hair); d.r(4, 0, 16, 1, hair);    // 丸み
    if (styleId === 0) { d.r(2, 10, 3, 6, hair); d.r(19, 10, 3, 6, hair); }           // もみあげ長め
    if (styleId === 1) { d.r(2, 10, 2, 3, hair); d.r(20, 10, 2, 3, hair); d.r(6, 10, 4, 2, hair); } // 前髪
    if (styleId === 2) { d.r(2, 10, 3, 10, hair); d.r(19, 10, 3, 10, hair); d.r(8, 10, 8, 1, hair); } // ロング
    if (styleId === 3) { d.r(2, 10, 2, 4, hair); d.r(20, 10, 2, 4, hair); d.r(13, 10, 6, 2, hair); }  // 横分け
    d.r(2, 12, 2, 4, C.skin); d.r(20, 12, 2, 4, C.skin); // 耳
    d.r(2, 14, 1, 1, C.skin2); d.r(21, 14, 1, 1, C.skin2);
    d.r(7, 12, 4, 1, hair); d.r(13, 12, 4, 1, hair);   // 眉
    d.r(8, 14, 2, 2, C.eye); d.r(14, 14, 2, 2, C.eye); // 目
    d.p(8, 14, '#ffffff'); d.p(14, 14, '#ffffff');     // ハイライト
    d.p(12, 17, C.skin2);                              // 鼻
    d.r(10, 19, 4, 1, C.skin2);                        // 口
    d.p(6, 17, '#e8a99a'); d.p(17, 17, '#e8a99a');     // 頬
  };
  // 側面図（幅 16 = 奥行き、右端が正面）：後頭部は丸く、鼻が少し出る
  const side = (d) => {
    d.r(3, 0, 10, 1, hair); d.r(1, 1, 13, 1, hair); d.r(0, 2, 15, 8, hair);
    d.r(1, 10, 14, 10, C.skin); d.r(2, 20, 12, 2, C.skin); d.r(4, 22, 9, 2, C.skin); // 顔〜あご
    d.r(15, 15, 1, 3, C.skin);                          // 鼻
    d.r(0, 10, 2, 6, hair);                             // 後頭部の髪
  };
  return makePart(24, 24, 12, 24, front, { res: 2, depth: 16, z0: -8, back: backMap, accent: `${hair}${styleId}${back}`, side });
}

/** 頭 12×12、pivot = 首の付け根中央。側面図で後頭部を丸める。奥行き 8 */
export function head(seed = 0, back = false) {
  const hair = HAIR[seed % HAIR.length];
  // 背面は髪の色（顔は正面だけ）
  const backMap = { [C.skin]: hair, [C.skin2]: hair, [C.eye]: hair };
  const side = (d) => {
    d.r(2, 0, 5, 1, hair); d.r(1, 1, 7, 4, hair); d.r(0, 2, 8, 3, hair); // 頭頂〜後頭部の丸み
    d.r(0, 5, 8, 5, C.skin); d.r(1, 10, 7, 2, C.skin);                   // 顔〜あご
  };
  return makePart(12, 12, 6, 12, (d) => {
    d.r(2, 3, 8, 9, back ? C.skin2 : C.skin);
    d.r(1, 1, 10, 4, hair);
    d.r(1, 4, 1, 3, hair); d.r(10, 4, 1, 3, hair);
    if (back) { d.r(2, 3, 8, 6, hair); return; }
    d.p(4, 7, C.eye); d.p(8, 7, C.eye);
    d.r(5, 10, 3, 1, C.skin2);
  }, { depth: 8, z0: -4, back: backMap, accent: `${hair}${back}`, side });
}

/** 上腕 5×9、pivot = 肩（上端中央）。肘は下端 (2, 9) */
// 縦の柱の断面を円にする削り（2026-09-11 ユーザー指定：腕・脚のブロック感をなくす）。
// 行 y0..y1 の範囲で、半径 r0（y0）→ r1（y1）に細くなる。中心 (cx, cz) はセル座標。範囲外の行は削らない
export const roundColumn = (cx, cz, r0, r1, y0, y1) => {
  const f = (x, y, z) => {
    if (y < y0 || y > y1) return false;
    const r = r0 + (r1 - r0) * ((y - y0) / Math.max(1, y1 - y0));
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
    return dx * dx + dz * dz > r * r;
  };
  f.toString = () => `roundColumn(${cx},${cz},${r0},${r1},${y0},${y1})`; // makePart のキャッシュキーはソース文字列なので、引数を含めて区別する
  return f;
};
const roundArm = (r0, r1, h) => roundColumn(5, 4, r0, r1, 0, h - 1); // 腕：x 中心 5、z 中心 4（depth 8）
export function upperArm() { // 2 倍解像度 10×22 セル（肩の下 10px = ARM_UPPER）、pivot = 肩（上端から 1 セル）。断面は円、肩側 r3.3 → 肘側 r2.7 セル
  return makePart(10, 22, 5, 2, (d) => { d.r(0, 0, 10, 22, C.coat); }, { res: 2, depth: 8, z0: -4, carve: roundArm(3.3, 2.7, 22) });
}
/** 肩の球 5×5×5 px（2 倍解像度で円）、pivot = 中心。上腕の根元に付けて、肩関節が前へ出ても胴と腕の間が空かない */
export function shoulderPad() {
  return makePart(10, 10, 5, 5, (d) => { d.disc(5, 5, 4, C.coat); }, { res: 2, depth: 10, z0: -5, side: (d) => { d.disc(5, 5, 4, F); }, top: (d) => { d.disc(5, 5, 4, F); } });
}
/** 手首の球 2.5px（2 倍解像度で直径 5 セル）、pivot = 中心。手首で手が前腕に対して曲がった時、角が割れて見えないように埋める（2026-09-23） */
export function wristBall(skin) {
  return makePart(5, 5, 2.5, 2.5, (d) => { d.disc(2, 2, 2, skin); }, { res: 2, depth: 5, z0: -2.5, accent: `wrist|${skin}`,
    side: (d) => { d.disc(2, 2, 2, F); }, top: (d) => { d.disc(2, 2, 2, F); } });
}
/** 前腕＋手 5×10、pivot = 肘（上端中央） */
export function foreArm() {
  return makePart(5, 10, 2, 1, (d) => { d.r(1, 0, 3, 6, C.coat); d.r(1, 6, 3, 4, C.skin); }, { depth: 3, z0: -1.5 });
}
/** 手首あり版：前腕（袖のみ）、pivot = 肘。手は別パーツ */
export function foreArmNoHand() { // 2 倍解像度 10×17 セル（肘の下 7.5px = FORE_NOHAND）、pivot = 肘（上端から 1 セル）。断面は円、肘側 r2.9 → 手首側 r2.3 セル
  return makePart(10, 17, 5, 2, (d) => { d.r(0, 0, 10, 17, C.coat); }, { res: 2, depth: 8, z0: -4, carve: roundArm(2.9, 2.3, 17) });
}
/** 手 5×5、pivot = 手首（上端中央）。-y が指先 */
export function hand() {
  return makePart(5, 5, 2, 1, (d) => { d.r(1, 0, 3, 4, C.skin); d.r(1, 3, 3, 1, C.skin2); }, { depth: 3, z0: -1.5 });
}

/** 腕 5×16、pivot = 肩（上端中央）。垂らした状態で描く */
export function arm() {
  return makePart(5, 16, 2, 1, (d) => {
    d.r(1, 0, 3, 12, C.coat);
    d.r(1, 12, 3, 4, C.skin);
  });
}

const F = '#000'; // 側面図・上面図の塗り色（形だけ。色は正面図が使われる）

// 鍵盤打楽器（実物写真 YX-320 / YM-460 に合わせて。2026-09-22 ユーザー提示）
// 音板は紫檀（濃い赤茶）。白鍵をやや明るく、黒鍵を暗くして並びが読めるようにする
const ROSE_W = '#7e4234', ROSE_B = '#5e2f26';
const ROSE = [ROSE_W, ROSE_B, ROSE_W, ROSE_B, ROSE_W, ROSE_W, ROSE_B, ROSE_W, ROSE_B, ROSE_W, ROSE_B, ROSE_W];
const FRAME_BK = '#23232a';   // フレーム・脚（黒塗りのスチール）
const BRASS = '#c9a24a', BRASS2 = '#8f6f2c';   // 共鳴管（くすんだ真鍮。C.gold は明るすぎた）
// ---- 金属として扱う色（2026-09-23 ユーザー指定）----
// 楽器単位ではなく**頂点色**でメタリックかどうかを決める。こうすると、木や革が主体の楽器
// （スネア・グランカッサ・シロフォン等）でも、スタンドの銀・ラグ・共鳴管の真鍮だけが金属になる。
// 頂点色にはパレットの色がそのまま入っている（面ごとの陰影は焼き込まれていない）ので、色の一致で判定できる。
// 一致は「各成分の差が METAL_EPS 未満」の完全一致に近い判定にする。距離で緩く見ると
// 木（C.wood #8a4b2a）と銅（C.copper2 #7e4a22）のように近い色を拾ってしまう
const METAL_COLORS = [C.gold, C.gold2, C.silver, C.silver2, C.copper, C.copper2,
  BRASS, BRASS2,
  '#f3d27a',              // 金管のハイライトの帯
  '#b8c0c8', '#eef2f6',   // フルートのリッププレート・ハイライト
  '#c99a36'];             // 銅鑼の中央の打ち出し
const METAL_EPS = 0.02;   // ≒ 5/255
const METAL_RGB = METAL_COLORS.map((h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; });
function isMetalColor(r, g, b) {
  return METAL_RGB.some((c) => Math.abs(c[0] - r) < METAL_EPS && Math.abs(c[1] - g) < METAL_EPS && Math.abs(c[2] - b) < METAL_EPS);
}

/**
 * 鍵盤打楽器の立体を決める（実物写真 YX-320 / YM-460 に合わせて。2026-09-22 ユーザー提示）。
 *
 * ・**打面（音板の上端）は全部同じ高さ**（打点が音程によらず固定なので傾けられない）
 * ・長さの違いは**奥行き**で表す（高音ほど短い）。音板は薄く前後に長い＝写真どおりの比率
 * ・**奥（奏者から遠い側）の端は一直線**に揃え、長さの違いは手前側だけで付ける（実物どおり。2026-09-23 ユーザー指定）。
 *   楽器は奏者の前（rig +z）に回転なしで置くので、セルの z が大きい側が奥
 * ・手前のレールも音板の手前の端に沿って**斜め**にする（同日ユーザー指定。直線のままだと高音側の音板が浮いて見えた）。
 * ・脚は左右の端の外寄りから生やす。音板・共鳴管の列と重ならない（2026-09-23）。
 *   左右の端も手前の端は斜めの線まで削る（右＝高音側の端が音板より手前へ出っ張っていた。同日ユーザー指定）。
 *   そのため右の手前の脚は、削った後の端の手前の縁（legZ.R の手前の値を自動計算）から生やす
 * ・**1 列**。白鍵・黒鍵の 2 列にすると、この解像度（幅 28px に 16 枚）では 1 枚あたりの
 *   奥行きが半分になり、音板が「厚い短いブロック」に見えてしまうので採らない。
 *   鍵盤の並びは色（白鍵をやや明るく）だけで示す
 * ・フレームは写真どおり**前後 2 本のレール＋左右の端の箱**。真ん中を抜いて共鳴管を見せる
 *
 * carve は **true を返したセルを削る**。座標は res 倍したセル番号。
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const NEAR_RAIL_OUT = 2;   // 手前のレールを音板の手前の端から奏者側へ出す幅（セル。2 = 1px）
const keyboardRig = ({ barY, frameY, x0, pitch, n, zc, lo, hi, railW, endX, w, legZ, casterY, tubes = null }) => {
  const far = zc + lo / 2;                                                           // 音板の奥の端（全部揃う）
  const nearAt = (x) => { const t = clamp01((x - x0) / pitch / (n - 1)); return far - (lo + (hi - lo) * t); }; // 列 x の音板の手前の端（連続）
  const frontAt = (x) => Math.floor(nearAt(x)) - NEAR_RAIL_OUT;                   // 列 x のフレーム（レール・端）の手前の縁
  // 脚の奥行き（手前, 奥）。右の手前は削った後の端の手前の縁から（左は legZ.L のまま）
  const legs = { L: legZ.L, R: [Math.max(legZ.R[0], frontAt(w - 1)), legZ.R[1]] };
  const f = (x, y, z) => {
    if (y < barY) {                                   // 音板：高音ほど短い。奥の端（一番長い音板の奥端）で揃え、手前側だけ短くなる
      const i = Math.round((x - x0) / pitch);
      if (i < 0 || i >= n) return false;
      const L = lo + (hi - lo) * (i / (n - 1)), far = zc + lo / 2;
      return z + 0.5 > far || z + 0.5 < far - L;
    }
    if (y < frameY) {                                 // フレーム：前後のレールだけ残す（端は箱のまま）
      if (x < endX || x >= w - endX) return z < frontAt(x);   // 左右の端（幅 endX）は中を抜かない。手前だけ斜めの線まで削る
      // 手前のレールの手前の端（斜め）。音板の手前の端より NEAR_RAIL_OUT セル奏者側へ出して幅を広げる
      // （2026-09-23 ユーザー指定：幅を太く。奥側へ広げると音板の下に隠れて見えないので手前へ出す）
      if (z < frontAt(x)) return true;                                                  // レールより手前は空ける
      // レールと奥のレールの間を抜く。手前のレールの幅は奥と同じ railW（外側＝手前の端はそのまま、内側を削る。
      // 2026-09-23 ユーザー指定：下から覗くと手前だけ太かった）
      return z >= frontAt(x) + railW && z <= 2 * zc - 1 - railW;
    }
    // 共鳴管（tubes = { y0, len(i), depth, off, row(i) }）：各管を真上の音板の中心の奥行きに置く。音板は奥で揃い手前だけ短くなるので、
    // 中心は高音ほど奥へずれ、管の並びが音板の斜めの線に沿う（2026-09-23 ユーザー指定）。側面図は全部の管が入る帯にしておき、列ごとに削る
    if (tubes && y >= tubes.y0 && (x - x0) % pitch < 2) {
      const i = Math.floor((x - x0) / pitch);
      if (i >= 0 && i < n && y < tubes.y0 + tubes.len(i)) {
        // 2 列（2026-09-23 ユーザー指定）：tubes.row(i) が -1 なら手前の列、+1 なら奥の列。音板の中心から tubes.off ずらす
        const c = far - (lo + (hi - lo) * (i / (n - 1))) / 2 + (tubes.row ? tubes.row(i) * tubes.off : 0);
        const k = Math.round(c - tubes.depth / 2);        // 奥行きは幅と同じ tubes.depth セル＝断面が正方形（2026-09-23 ユーザー指定）
        return z < k || z >= k + tubes.depth;
      }
    }
    // 左右の端の下：その側の脚 2 本（2 セル）とキャスター（脚の 2 セル手前から 6 セル）の奥行きだけ残す。
    // 側面図は左右両方の脚・共鳴管が入る帯にしてあるので、列ごとに削り分ける
    if (x < endX || x >= w - endX) {
      const [a, b] = y >= casterY ? [-2, 4] : [0, 2];
      return !legs[x < endX ? 'L' : 'R'].some((lz) => z >= lz + a && z < lz + b);
    }
    return false;
  };
  f.toString = () => `keyboardRig(${barY},${frameY},${x0},${pitch},${n},${zc},${lo},${hi},${railW},${endX},${w},${legZ.L}/${legZ.R},${casterY},${NEAR_RAIL_OUT},${tubes ? tubes.y0 + ':' + tubes.depth + ':' + tubes.off + ':' + tubes.len + ':' + tubes.row : ''})`;
  return f;
};
// シロフォン：音板 行 4（奥行き z 2-17・中心 10、長さ 16→9）／フレーム 行 5-7
const XYLO_BARS = keyboardRig({ barY: 5, frameY: 8, x0: 4, pitch: 3, n: 16, zc: 10, lo: 16, hi: 9, railW: 4, endX: 6, w: 56, legZ: { L: [5, 13], R: [9, 16] }, casterY: 34 });   // 右の奥の脚は奥のレールの真下（2026-09-23 ユーザー指定：手前に入りすぎ）。
// 右の脚の前後の間隔は左より狭く（右 3.5px・左 4px。同日ユーザー指定。手前の脚で調節）
const MARIMBA_TUBE_LEN = (i) => 15 - Math.floor(i * 10 / 21);   // マリンバの共鳴管の長さ（行。高音ほど短い）
const MARIMBA_TUBE_ROW = (i) => (ROSE[i % 12] === ROSE_B ? 1 : -1); // 共鳴管の列：白鍵にあたる音板は手前、黒鍵にあたる音板は奥（実物どおり）
// マリンバ：音板 行 2（奥行き z 2-21・中心 12、長さ 20→11）／フレーム 行 3-5
const MARIMBA_BARS = keyboardRig({ barY: 3, frameY: 6, x0: 4, pitch: 3, n: 22, zc: 12, lo: 20, hi: 11, railW: 4, endX: 6, w: 74, legZ: { L: [5, 17], R: [10, 21] }, casterY: 32,   // 右の脚 2 本は右の端の奥行き（z 9〜23）の中央に合わせる（2026-09-23 ユーザー指定）
  tubes: { y0: 6, len: MARIMBA_TUBE_LEN, depth: 2, off: 2.5, row: MARIMBA_TUBE_ROW } });

/**
 * 頭パーツ（24×30・res 2・pivot (12,24)）の pivot より下、rows 24-25 に「少し太い首」を足す。
 *
 * 胴の首は幅 4px・奥行き 3px で、その上端は顎より 0.5px 下、肩は 2.4px 下。顎は幅 10px あるので、
 * 首の左右に空が素通しになって頭が浮いて見えた（2026-09-21 ユーザー指摘、実測）。
 * **真っ直ぐな首のまま**、胴の首より一回り太い柱を顎の下に足して隙間だけ埋める。
 * 顎幅から首幅へ斜めに絞る案は「じょうごみたいで顔が間延びする」として却下された（2026-09-21 ユーザー）。
 * 胴・上着・肩関節（SHOULDER y=25.5）・楽器の口元座標には触らない。
 *
 * **元の首（胴の幅 4px）はそのまま見せる**。埋めるのは顎と首の上端の 0.5px だけなので高さ 1px に留める
 * （3px にすると元の首を覆ってしまう。2026-09-21 ユーザー指摘）。幅 6px（胴の首 +2）・奥行き 4px（同 +1）。
 * **正面図と側面図の両方を呼ぶこと**。
 */
const NECK_STUB = { y: 24, h: 2, x: 6, w: 12, z: 5, d: 8 }; // セル（res 2 なので 2 セル = 1px）
export function headNeckStub(d, skin) { d.r(NECK_STUB.x, NECK_STUB.y, NECK_STUB.w, NECK_STUB.h, skin); }
export function headNeckStubSide(d)   { d.r(NECK_STUB.z, NECK_STUB.y, NECK_STUB.d, NECK_STUB.h, F); }
// 弦楽器の背面：f 字孔・指板・駒・弦・テールピースは裏板の色にする（裏から見ると板とネックだけ）
const STRING_BACK = (plate) => ({ [C.black]: plate, [C.ivory]: plate, '#2a2a30': plate, '#3a3a44': plate });
// 木管のベルの穴（8×40 の絵、row ≥ 34 を中空に）
const WW_BELL_HOLE = (x, y, z) => { if (y < 34) return false; const r = (y >= 36 ? 3 : 2) - 1; const dx = x - 3.5, dz = z - 3.5; return dx * dx + dz * dz < r * r; };

// ---------------- 楽器パーツ ----------------
// それぞれ [mesh] を返す。pivot は「体に取り付ける点」または「手に持つ点」。

/**
 * 弦楽器の糸巻き（ペグボックス）＋渦巻き。4 倍解像度の別パーツ（2026-09-10 ユーザー要望：丸みを出す）。
 * 軸は +x（ネックの延長方向）、pivot = ネックとの継ぎ目の中心。上から見ると渦巻きは円、ペグは ±y に突き出す。
 * 渦の目は側面（±y の面）に溝を彫って表す。r = 渦巻きの半径 [px]（4 倍解像度）
 * @returns {THREE.Object3D}
 */
function scrollPart(neckColor, r = 3) {
  const len = 4 * r, h = 4 * r, cy = 2 * r, depth = 4 * r, zc = 2 * r, cx = len - r; // 渦巻きの中心 x
  const pw = Math.max(3, Math.round(1.3 * r)), py0 = cy - (pw >> 1);                  // ペグボックスの幅（y）
  const ph = 2 * r, pz0 = zc - r;                                                       // ペグボックスの高さ（z）
  const pegX = [Math.round(len * 0.18), Math.round(len * 0.42)];                       // ペグの位置（2 本 × 左右）
  const knob = Math.max(2, Math.round(r * 0.7));
  return makePart(len, h, 0, cy, (d) => {
    d.r(0, py0, cx - r + 1, pw, neckColor);                                              // ペグボックス
    for (const x of pegX) { d.r(x, 1, 1, h - 2, C.black); d.r(x - 1, 0, knob, 2, C.black); d.r(x - 1, h - 2, knob, 2, C.black); } // ペグ（軸＋つまみ）
    d.r(cx - r, cy - r + 1, 2 * r, 2 * r - 2, neckColor);                                // 渦巻き（正面からは幅 2r-2。丸みは上面図の円）
  }, { res: 4, depth, z0: -zc, accent: neckColor,
       top: (d) => { d.r(0, pz0, cx - r + 1, ph, F); d.disc(cx, zc, r, F); },
       side: (d) => { d.r(pz0, py0, ph, pw, F); d.r(zc - 1, 0, 2, h, F); d.r(zc - r, cy - r + 1, 2 * r, 2 * r - 2, F); },
       // 渦の目の溝：渦巻きの側面（±y の外側 1 層）で、渦の中心から半径 0.4r〜0.75r の輪を 1 ボクセル彫る
       carve: (x, y, z) => {
         const outer = y < cy - r + 2 || y >= cy + r - 2;
         if (x < cx - r || !outer) return false;
         const rho = Math.hypot(x - cx + 0.5, z - zc + 0.5);
         return rho > 0.4 * r && rho < 0.75 * r;
       } });
}
/** 胴と糸巻きをまとめる（pos は 2 倍解像度 px、pivot 基準。axis: 'x' = ネックが +x、'y' = ネックが +y） */
/** 指板：胴・ネックの表板の上に乗る別の物体（厚み thick セル）。pivot は左上（2026-09-16 ユーザー指定：塗りでなく厚みを持たせる）。
 *  弦は塗りで表す：横向き（バイオリン）は上半分の行、縦向きで幅 2（チェロ）は片側の列、幅 3（コントラバス）は両端の 2 列をグレーに */
function fingerboardPart(w, h, thick = 1) {
  return makePart(w, h, 0, 0, (d) => {
    d.r(0, 0, w, h, C.black);
    const G = '#2a2a30';
    if (h > w) { d.r(0, 0, 1, h, G); if (w >= 3) d.r(w - 1, 0, 1, h, G); }   // 縦向き：片側（幅 3 なら両端）
    else d.r(0, 0, w, 1, G);                                                  // 横向き：上の行
  }, { res: 2, depth: thick, z0: 0, accent: `fb|${w}x${h}x${thick}` });
}
/** 胴 + 渦巻き（+ 指板）。pos はセル単位（VOX）。fb = { w, h, pos:[x,y,z], thick }：z は表板の面（胴の depth の端）に置く */
function withScroll(body, scroll, pos, axis = 'x', fb = null) {
  const g = new THREE.Group();
  scroll.position.set(pos[0] * VOX, pos[1] * VOX, pos[2] * VOX);
  if (axis === 'y') scroll.rotation.z = Math.PI / 2;
  g.add(body, scroll);
  if (fb) {
    const thick = fb.thick ?? 1;
    const f = fingerboardPart(fb.w, fb.h, thick);
    f.position.set(fb.pos[0] * VOX, fb.pos[1] * VOX, fb.pos[2] * VOX);
    g.add(f);
  }
  g.userData.size = body.userData.size;
  return g;
}

export const INSTRUMENT = {
  // バイオリン 28×16（2倍解像度）。下部・くびれ・上部のふくらみ、駒（x=10）、指板、渦巻き、あご当て。厚みは薄く中央だけ盛る
  // 胴：ネック＋渦巻き ≒ 6：4（実物の比率）。駒は x=10（基本座標 -2）
  // 1st / 2nd はどちらも同じ絵（violin1 を本体にして violin2 はエイリアス。2026-09-12 ユーザー指定で楽器の選択肢を分けた）
  violin1: () => withScroll(makePart(28, 16, 14, 8, (d) => {
    d.disc(7, 8, 6, C.wood); d.disc(14, 8, 4, C.wood); d.r(10, 5, 5, 7, C.wood);   // 胴（下部・上部のふくらみ、くびれ）
    d.p(11, 4, null); d.p(11, 12, null); d.p(12, 4, null); d.p(12, 12, null);     // くびれの切れ込み
    d.r(3, 5, 1, 7, '#a0623c'); d.r(13, 6, 1, 5, '#a0623c');                       // 艶
    d.r(5, 5, 1, 2, C.black); d.r(5, 10, 1, 2, C.black); d.r(12, 5, 1, 2, C.black); d.r(12, 10, 1, 2, C.black); // f 字孔
    d.r(2, 7, 4, 2, C.black); d.r(6, 7, 2, 2, C.black);                             // テールピース・駒下の弦（駒 x 10 との間に 2 セル空ける。2026-09-16 ユーザー指定）
    d.r(18, 7, 7, 2, C.wood2);                                                      // ネック（糸巻きは別パーツ）。指板は別の物体（withScroll の fb）で表板の上に乗せる（2026-09-16）
    d.r(10, 6, 1, 4, C.ivory);                                                      // 駒
    d.r(1, 10, 4, 3, C.black);                                                      // あご当て
  }, { res: 2, depth: 4, z0: -2, side: (d) => { d.r(2, 2, 2, 12, F); d.r(0, 4, 4, 8, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 3), [11, 0, 1], 'x',
    { w: 12, h: 2, pos: [-1, 1, 2], thick: 1 }),   // 指板：cells x 13-24 / rows 7-8 を表板の面（z 2）に 1 セル厚で。駒（x 10）には届かせない（2026-09-16 ユーザー指摘） // ネックは表板側 2 セル（胴の延長でなく、胴の上に乗る。2026-09-16 ユーザー指摘）。渦巻きもその中心へ
  // ヴィオラ 32×18（2倍解像度）：バイオリンより一回り大きく、濃い色。駒は x=12（基本座標 -2）
  viola: () => withScroll(makePart(32, 18, 16, 9, (d) => {
    d.disc(8, 9, 7, C.wood2); d.disc(16, 9, 5, C.wood2); d.r(12, 5, 5, 9, C.wood2);
    d.p(13, 4, null); d.p(13, 14, null); d.p(14, 4, null); d.p(14, 14, null);
    d.r(3, 5, 1, 9, '#8a4a34'); d.r(15, 7, 1, 5, '#8a4a34');
    d.r(6, 6, 1, 2, C.black); d.r(6, 11, 1, 2, C.black); d.r(14, 6, 1, 2, C.black); d.r(14, 11, 1, 2, C.black);
    d.r(2, 8, 5, 2, C.black); d.r(7, 8, 3, 2, C.black);                             // テールピース・駒下の弦（駒 x 12 との間に 2 セル空ける。2026-09-16）
    d.r(21, 8, 7, 2, C.wood);                                                       // ネック（糸巻きは別パーツ）。指板は別の物体（2026-09-16）
    d.r(12, 7, 1, 4, C.ivory);
    d.r(1, 11, 5, 3, C.black);
  }, { res: 2, depth: 5, z0: -2.5, side: (d) => { d.r(3, 2, 2, 14, F); d.r(0, 4, 5, 10, F); }, back: STRING_BACK(C.wood2) }), scrollPart(C.wood, 3), [12, 0, 1.5], 'x',
    { w: 13, h: 2, pos: [-1, 1, 2.5], thick: 1 }),   // 指板：cells x 15-27。駒（x 12）には届かせない（2026-09-16） // ネックは表板側 2 セル（2026-09-16）
  // チェロ 24×60（2倍解像度）。渦巻き・ネック・上部/下部のふくらみ・くびれ・f 字孔・駒（row 36）・テールピース・エンドピン
  cello: () => withScroll(makePart(24, 60, 12, 60, (d) => {
    d.r(11, 3, 2, 16, C.wood2);                                            // ネック（糸巻きは別パーツ）。幅は指板と同じ 2 セル（2026-09-16 ユーザー指定：茶色が太かった）
    d.disc(12, 21, 7, C.wood); d.r(6, 26, 12, 4, C.wood); d.disc(12, 38, 10, C.wood); // 上部・くびれ（4 行）・下部
    d.p(6, 26, null); d.p(17, 26, null); d.p(6, 29, null); d.p(17, 29, null);
    d.r(6, 18, 1, 7, '#a0623c'); d.r(4, 32, 1, 12, '#a0623c');              // 艶（ふくらみの円の内側に収める。はみ出すと側面に板が飛び出て見える。2026-09-11）
    d.r(7, 30, 1, 7, C.black); d.r(16, 30, 1, 7, C.black);                   // f 字孔（駒の左右、駒を挟んで上下に伸びる。2026-09-11）
    // 指板は別の物体（withScroll の fb。rows 3-30 × cells 11-12 を表板の上に）（2026-09-16）
    d.r(9, 33, 6, 1, C.ivory);                                             // 駒（胴 rows 14-48 の真ん中より少し下。基本 y=13.5）
    d.r(11, 36, 2, 10, C.black); d.r(11, 46, 2, 3, C.black);                // 弦（黒。駒 row 33 の下 2 行を空ける）・テールピース（弦と同じ 2 セル幅。胴の下端 row 48 で止める。2026-09-16 ユーザー指定）
    d.r(12, 49, 1, 11, C.silver);                                          // エンドピン（幅 1 セル、胴の直下 row 49 から。2026-09-16 ユーザー指定：細く・長く見えて OK）
  }, { res: 2, depth: 8, z0: 0, side: (d) => { d.r(7, 0, 1, 16, F); d.r(1, 14, 6, 4, F); d.r(0, 18, 8, 31, F); d.r(4, 49, 1, 11, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 4), [0, 57, 7.5], 'y',
    { w: 2, h: 28, pos: [-1, 57, 8], thick: 1 }), // ネックは表板側 1 セル（＋指板 1 セル。2026-09-16 ユーザー指定で薄く）。渦巻きもその中心へ。指板は表板（z 8）の上に 1 セル // 厚み 12 → 8 セル（34cm → 22cm。2026-09-11 ユーザー指摘）
  // コントラバス 28×76（2倍解像度）。渦巻き・ネック・ふくらみ・くびれ・f 字孔・駒（row 38 = 基本 y 19）・エンドピン。立奏用
  // エンドピンは 8 セル（4px）・幅 1 セル、pivot（床に着く点）は row 72（2026-09-16 ユーザー指定：細く。
  // 2px だと後傾＋横倒しで胴の下端の角がピンの先より下に来て、ピンが浮いて見えたので 4px に）。
  // 前のめりで胴が床に沈む問題は puppet.js の floorStand（ピンの先を支点に傾く）で対処
  contrabass: () => withScroll(makePart(28, 76, 14, 72, (d) => {
    d.r(13, 4, 3, 14, C.wood2);                                            // ネック（糸巻きは別パーツ）。幅は指板と同じ 3 セル（2026-09-16 ユーザー指定）
    d.disc(14, 26, 10, C.wood); d.r(7, 32, 14, 10, C.wood); d.disc(14, 50, 13, C.wood); // 上部・くびれ・下部
    d.p(7, 33, null); d.p(20, 33, null); d.p(7, 41, null); d.p(20, 41, null);
    d.r(5, 22, 1, 9, '#a0623c'); d.r(3, 44, 1, 14, '#a0623c');              // 艶（ふくらみの円の内側に収める。2026-09-11）
    d.r(8, 38, 1, 9, C.black); d.r(19, 38, 1, 9, C.black);                   // f 字孔（駒の左右、駒を挟んで上下に。2026-09-11）
    // 指板は別の物体（rows 4-37 × cells 13-15。2026-09-16）
    d.r(10, 42, 8, 1, C.ivory);                                            // 駒（胴 rows 16-63 の真ん中より少し下。基本 y=17）
    d.r(13, 47, 3, 6, C.black); d.r(13, 53, 3, 11, C.black);                // 弦（黒・幅は指板と同じ 3 セル。駒 row 42 の下 4 行を空ける。2026-09-16）・テールピース（同じ 3 セル幅で胴の最下行 row 63 まで。2026-09-16 ユーザー指定）
    d.r(14, 64, 1, 8, C.silver);                                           // エンドピン（rows 64-71、幅 1 セル）
  }, { res: 2, depth: 9, z0: 0, side: (d) => { d.r(7, 4, 2, 14, F); d.r(1, 16, 7, 6, F); d.r(0, 22, 9, 42, F); d.r(4, 64, 1, 8, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 5), [0, 68, 8], 'y',
    { w: 3, h: 34, pos: [-1, 68, 9], thick: 1 }),   // 指板 rows 4-37（駒 row 42 との隙間 4 行。2026-09-16）   // 胴の厚み 14 → 9 セル（2/3。2026-09-16 ユーザー指定）。ネックは表板側 2 セル、渦巻きは z 8、指板は表板（z 9）の上。y は pivot（row 72）基準で 72-4 = 68 // ネックは表板側 2 セル（＋指板 1 セル。2026-09-16 ユーザー指定で薄く）。渦巻きもその中心へ。指板は表板（z 14）の上に 1 セル // 厚み 16 → 14 → 9 セル（2026-09-11 / 2026-09-16）
  // 弓・指揮棒は 2 倍解像度グリッドで細く（断面 1×1 / 0.5×0.5 基本 px）
  // 弓 52×2（2 倍解像度＝26px。40 から 1.3 倍に延長、2026-09-10 ユーザー指定）。pivot = フロッグ（手元）
  // 奥行きは指揮棒と同じ 1 セル（2026-09-16 ユーザー指定：細く）。高さは 2 行＝毛（白）と棹（茶）が重なる。
  // 弦を擦るのは毛なので、毛を弦側（row 0 = ローカル +y 側）に置く（2026-09-16 ユーザー指摘：上下が逆だった）
  bow: () => makePart(52, 2, 2, 1, (d) => { d.r(2, 0, 48, 1, C.ivory); d.r(0, 1, 52, 1, C.wood2); d.r(0, 0, 3, 2, C.black); }, { res: 2, depth: 1, z0: -0.5 }),

  // ---- 木管（2倍解像度。断面は丸く、ベルは中空）----
  // フルート 40×6：頭部管（歌口）・主管のキー・足部管。断面は丸
  // フルート 40×6（2 倍解像度）：管は 2 セル（＝1px）角の細い棒。キーとリッププレートだけ上下に 1 セルはみ出す（2026-09-10 ユーザー指示で細く）
  flute: () => makePart(40, 6, 2, 2, (d) => {
    d.r(0, 1, 40, 2, C.silver); d.r(0, 1, 10, 2, C.silver2); d.r(36, 1, 4, 2, C.silver2); // 主管・頭部管・足部管
    d.r(5, 0, 3, 4, '#b8c0c8'); d.p(6, 1, C.black);                                        // リッププレート・歌口
    for (let x = 14; x < 36; x += 4) { d.r(x, 0, 3, 1, C.silver2); d.r(x, 3, 3, 1, C.silver2); } // キー
    d.r(12, 1, 26, 1, '#eef2f6');                                                           // ハイライト
  }, { res: 2, depth: 2, z0: -1, side: (d) => { d.r(0, 0, 2, 6, F); }, top: (d) => { d.r(0, 0, 40, 2, F); } }),
  // ピッコロ 20×6（2 倍解像度）：フルートの半分の長さ。黒檀の管に銀の頭部管・キー。構え方はフルートと同じ（2026-09-10）
  piccolo: () => makePart(20, 6, 2, 2, (d) => {
    d.r(0, 1, 20, 2, '#2a2420'); d.r(0, 1, 7, 2, C.silver2);                               // 管（黒檀）・頭部管（銀）
    d.r(4, 0, 3, 4, '#b8c0c8'); d.p(5, 1, C.black);                                        // リッププレート・歌口
    for (let x = 9; x < 19; x += 3) { d.r(x, 0, 2, 1, C.silver2); d.r(x, 3, 2, 1, C.silver2); } // キー
    d.r(8, 1, 11, 1, '#4a403a');                                                            // 艶
  }, { res: 2, depth: 2, z0: -1, side: (d) => { d.r(0, 0, 2, 6, F); }, top: (d) => { d.r(0, 0, 20, 2, F); } }),
  // オーボエ 8×40：リード・円錐の管・キー・ベル（中空）。pivot = リードの先（口）
  oboe: () => makePart(8, 40, 4, 0, (d) => {
    d.r(3, 0, 2, 3, C.ivory); d.r(3, 2, 2, 1, C.black); d.r(3, 3, 2, 2, C.silver);          // リード・コルク・ステープル
    d.r(3, 5, 2, 8, C.wood2); d.r(2, 13, 4, 18, C.wood2); d.r(1, 31, 6, 5, C.wood2); d.r(0, 36, 8, 4, C.wood2); // 管（円錐）・ベル
    d.r(2, 14, 1, 16, '#6e3a1c');                                                           // 艶
    for (let y = 8; y < 30; y += 4) { d.r(5, y, 2, 2, C.silver); d.p(1, y + 2, C.silver); } // キー
    d.r(2, 13, 4, 1, C.silver2); d.r(2, 24, 4, 1, C.silver2);                               // 継ぎ目
  }, { res: 2, depth: 8, z0: -4, side: (d) => { d.r(3, 0, 2, 5, F); d.r(3, 5, 2, 8, F); d.r(2, 13, 4, 18, F); d.r(1, 31, 6, 5, F); d.r(0, 36, 8, 4, F); },
       top: (d) => { d.disc(4, 4, 3, F); }, carve: WW_BELL_HOLE }),
  // クラリネット 8×40：マウスピース・バレル・円筒の管・キー・ベル（中空）
  clarinet: () => makePart(8, 40, 4, 0, (d) => {
    d.r(3, 0, 2, 4, C.black); d.r(3, 2, 2, 1, C.silver);                                   // マウスピース・リガチャー
    d.r(2, 4, 4, 4, C.black); d.r(2, 8, 4, 24, C.black); d.r(1, 32, 6, 4, C.black); d.r(0, 36, 8, 4, C.black); // バレル・管・ベル
    d.r(2, 9, 1, 22, '#2a2a34');                                                            // 艶
    for (let y = 10; y < 30; y += 4) { d.r(5, y, 2, 2, C.silver); d.p(1, y + 2, C.silver); } // キー
    d.r(2, 8, 4, 1, C.silver2); d.r(2, 16, 4, 1, C.silver2); d.r(2, 24, 4, 1, C.silver2); d.r(2, 32, 4, 1, C.silver2); // 継ぎ目
  }, { res: 2, depth: 8, z0: -4, side: (d) => { d.r(3, 0, 2, 4, F); d.r(2, 4, 4, 28, F); d.r(1, 32, 6, 4, F); d.r(0, 36, 8, 4, F); },
       top: (d) => { d.disc(4, 4, 3, F); }, carve: WW_BELL_HOLE }),
  // ファゴット 10×68：長い主管（上にベル）・平行するウィングジョイント（上端は全高の 2/3。ここからボーカルが出る）・下のブーツ。pivot = 底中央
  // ボーカル（銀の曲管）とリードは別パーツで、ウィングジョイントの上端から奏者側（-z）へ曲がって伸びる（リードはてっぺんではない。2026-09-10 ユーザー指摘）
  bassoon: () => {
    const body = makePart(10, 68, 4, 68, (d) => {
      d.r(2, 0, 4, 68, C.wood); d.r(1, 0, 6, 4, C.coat2);                                    // 主管・ベル（黒いキャップ）
      d.r(6, 22, 3, 40, C.wood2);                                                             // ウィングジョイント（rows 22-62）
      d.r(1, 58, 8, 10, C.wood2); d.r(2, 66, 6, 2, C.black);                                  // ブーツ
      d.r(3, 6, 1, 50, '#6e3a1c');                                                            // 艶
      d.r(6, 22, 3, 1, C.silver);                                                             // ウィングジョイント上端の金具
      for (let y = 26; y < 56; y += 6) { d.r(5, y, 2, 1, C.silver); d.p(1, y + 3, C.silver); } // キー
    }, { res: 2, depth: 8, z0: -4, side: (d) => { d.r(2, 0, 4, 68, F); d.r(1, 58, 6, 10, F); } });
    // ボーカル 12×8（2倍解像度）：右下（ウィングの上端 = pivot）から左上（リード）へ。描画の -x を奏者側（-z）へ向けて取り付ける
    const bocal = makePart(12, 8, 11, 7, (d) => {
      d.line(11, 7, 3, 1, C.silver); d.line(11, 6, 3, 0, C.silver); d.line(10, 7, 2, 1, C.silver); // 曲管（太さ 2）
      d.r(0, 0, 3, 2, C.ivory); d.p(2, 1, C.black);                                            // リード・糸巻き
    }, { res: 2, depth: 2, z0: -1 });
    bocal.position.set(3.5 * VOX, 46 * VOX, 0);
    if (PART_STYLE !== 'sprite') bocal.rotation.y = -Math.PI / 2; // 絵は pivot から -x へ伸びる → -x を -z（奏者の口）へ向ける。2D の板では左へ伸ばしたまま
    body.add(bocal);
    return body;
  },
  // トランペット 36×12（2倍解像度）。マウスピース・リードパイプ・ピストン 3 本・下の U 管・ベルの広がり
  trumpet: () => makePart(36, 12, 0, 6, (d) => {
    d.r(0, 5, 3, 2, C.silver);                                             // マウスピース
    d.r(3, 5, 22, 2, C.gold);                                              // リードパイプ
    d.r(8, 8, 2, 2, C.gold); d.r(8, 9, 16, 2, C.gold); d.r(22, 8, 2, 2, C.gold); // 下の U 管
    for (let i = 0; i < 3; i++) { d.r(12 + i * 3, 1, 2, 9, C.gold2); d.r(12 + i * 3, 0, 2, 1, C.silver); } // ピストン
    d.r(25, 4, 3, 4, C.gold); d.r(28, 3, 2, 6, C.gold); d.r(30, 1, 2, 10, C.gold); d.r(32, 0, 3, 12, C.gold); d.r(35, 0, 1, 12, C.gold2); // ベル
    d.r(26, 4, 8, 2, '#f3d27a');                                            // ハイライト（1px の帯。線でなく面で。2026-09-11）
  }, { res: 2, depth: 12, z0: -6,
       side: (d) => { d.disc(6, 6, 6, F); d.r(5, 4, 2, 4, F); },                                  // 断面は円（ベルが丸く見える）
       top: (d) => { d.r(0, 5, 25, 2, F); d.r(8, 4, 16, 4, F); d.r(12, 3, 8, 6, F); d.r(25, 4, 3, 4, F); d.r(28, 3, 2, 6, F); d.r(30, 1, 2, 10, F); d.r(32, 0, 4, 12, F); }, // 管は細く、ベルは正面と同じ広がり
       // ベルの穴：x ≥ 26 で外径 R(x) より 1 内側を中空に（朝顔の内側が見える）
       carve: (x, y, z) => { if (x < 26) return false; const R = x >= 32 ? 6 : x >= 30 ? 5 : x >= 28 ? 3 : 2; const r = R - 1.2; const dy = y - 5.5, dz = z - 5.5; return dy * dy + dz * dz < r * r; } }),
  // ---- 金管（2倍解像度。ベルは円断面＋中空）----
  // ホルン 28×28：巻いた主管・ロータリー 3 つ・マウスパイプ・右下に広がるベル（右手を入れる）
  horn: () => makePart(28, 28, 14, 14, (d) => {
    d.ring(11, 14, 10, C.gold); d.ring(11, 14, 9, C.gold); d.ring(11, 14, 6, C.gold2);      // 主管の巻き・内側の管
    d.r(6, 10, 9, 6, C.gold2); d.r(6, 9, 2, 2, C.silver); d.r(9, 9, 2, 2, C.silver); d.r(12, 9, 2, 2, C.silver); // ロータリーとレバー
    d.r(0, 12, 8, 2, C.gold); d.r(0, 12, 2, 2, C.silver);                                   // マウスパイプ・マウスピース
    d.r(16, 16, 4, 6, C.gold); d.r(20, 14, 3, 10, C.gold); d.r(23, 12, 3, 14, C.gold); d.r(26, 10, 2, 18, C.gold2); // ベル
    d.r(17, 17, 8, 2, '#f3d27a');                                                          // ハイライト（1px の帯）
  }, { res: 2, depth: 16, z0: -4,
       side: (d) => { d.r(6, 4, 4, 22, F); d.disc(8, 19, 8, F); },
       top: (d) => { d.r(0, 6, 20, 4, F); d.r(16, 5, 4, 6, F); d.r(20, 3, 3, 10, F); d.r(23, 1, 3, 14, F); d.r(26, 0, 2, 16, F); },
       carve: (x, y, z) => { if (x < 20) return false; const R = x >= 26 ? 9 : x >= 23 ? 7 : 5; const r = R - 1.5; const dy = y - 19, dz = z - 7.5; return dy * dy + dz * dz < r * r; } }),
  // トロンボーン：本物の構造どおり 3 パーツ（2026-09-10 ユーザー指摘を反映：管は左肩の上を通って後方まで伸び、そこで U ターンしてベルへ。ベルは口の高さ）。
  //   スライド部（本体）：マウスピース → 上の内管 → 先端 → 下の内管（戻り）。pivot = マウスピース、rows 12-19
  //   ベル部：下の内管の端から横管で左へ 7.5px（頭の横）→ ネックパイプが後方（左肩の上）へ → 後端で U ターンして上へ → ベル管が前へ → ベル。
  //          ベル管は口より 1.25px 上、ベルの中心は口のすぐ上（縁はあご〜眉）。絵の x=14 がマウスピース（x<14 は後方）
  //   外管：別パーツで音程に応じて +x へ動く
  //   スライド部はマウスピースの軸まわりに 60° ロールし、2 本の管が縦並びでなく斜め（ほぼ横並び）になる（2026-09-10 ユーザー提供の写真より）
  trombone: () => {
    const root = new THREE.Group();
    // BB：ベル管を縮めてベルを奏者側へ寄せる量 [絵 px]（2026-09-12 ユーザー指定：管が長すぎた）。
    // 内管もこの分だけ短くする。内管がベルの先や外管の U 字より前へ出ると「横線の残骸」「スライドから骨がはみ出す」に見える
    const BB = 14; // 8 → 14（2026-09-12 ユーザー指定でベル管をさらに 6px 短縮。円錐の形状は変わらない）
    const body = makePart(34, 20, 0, 13, (d) => {
      d.r(0, 12, 3, 2, C.silver);                                                             // マウスピース
      // 内管（上・下。外管が伸びると露出）。間隔 6 行・長さ 30。
      // 実物の内管は銀色なのでマウスピースと同じ色にし、マウスピース寄りの 2px だけ外管と同じ黄色（2026-09-12 ユーザー指定）
      d.r(3, 13, 2, 1, C.gold); d.r(3, 19, 2, 1, C.gold);
      d.r(5, 13, 28, 1, C.silver); d.r(5, 19, 28, 1, C.silver);
      d.r(4, 13, 1, 7, C.silver);                                                             // 支柱（銀）：上下の内管をつなぐ。左手はここを握る（2026-09-12 ユーザー指定）
      d.r(4, 13, 1, 7, C.silver);                                                             // 支柱（銀）：上下の内管をつなぐ。左手はここを握る（2026-09-12 ユーザー指定）
      // 管の断面は 1×1（高さ＝奥行き）。上面マスクの z を 2 → 1 にして、ロール後に縦長のリボンに見えないようにする（2026-09-12 ユーザー指定）
    }, { res: 2, depth: 12, z0: -6, side: (d) => { d.r(4, 0, 4, 20, F); }, top: (d) => { d.r(0, 5, 34, 1, F); } });
    // ネックパイプ（戻りの管）と U ターン・横管は削除（2026-09-12 ユーザー指摘）。
    // 前端が横へ直角に曲がってスライドへ繋がる作りなので、横から見ると曲がりが見えず「宙に浮いた横棒」にしか見えない。
    // ボクセルの粗さでは管に見えないうえ、スライドの上側の管が「下の管」として読めるので無くても破綻しない
    // BW：後端の U 字（ベル管 ↔ 戻りの管）のぶんだけ絵を後ろへ広げる量。pivot も同じだけずらす
    const BW = 3;
    const bell = makePart(48 - BB + BW, 20, 14 + BW, 13, (d) => {
      d.r(BW, 11, 33 - BB, 1, C.gold);                                                        // ベル管（前へ）。半径 0.5px＝1 行（2026-09-12 ユーザー指定）
      d.r(BW, 16, 18, 1, C.gold);                                                             // 戻りの管（スライドの下の管と一直線。2026-09-12 ユーザー指定）
      d.r(0, 11, BW, 6, C.gold);                                                              // 後端の U 字：四角く描いて carve で円弧に削る
      // ベル（rows 6-17）。半径は 1→2→3→4→5→6 と 1px ずつ。段の「幅」（管の軸方向）は管に近い順に 6, 4, 3, 1, 1, 1 px（2026-09-12 ユーザー指定）。
      // 根元をゆっくり・先端を急に開く形。一番広がった部分は濃い色のフチ（明るい色の帯は無し）
      d.r(BW + 32 - BB, 11, 6, 2, C.gold); d.r(BW + 38 - BB, 10, 4, 4, C.gold); d.r(BW + 42 - BB, 9, 3, 6, C.gold); d.r(BW + 45 - BB, 8, 1, 8, C.gold); d.r(BW + 46 - BB, 7, 1, 10, C.gold); d.r(BW + 47 - BB, 6, 1, 12, C.gold2);
    }, { res: 2, depth: 24, z0: -18,
         // 側面マスクは使わない（形は正面図・上面図・carve で決める）。
         // 以前は d.disc(18, 11, 6) で朝顔を丸くしていたが、ドットの中心と朝顔の中心（y 11.5 / z 17.5）が
         // 半セルずれていて、フチの丸が上下左右で不均等になっていた（2026-09-12 ユーザー指摘）
         top: (d) => {
           d.r(0, 17, BW + 33 - BB, 1, F);                                                     // ベル管・戻りの管・後端の U 字（z 17。半径 0.5px）
           d.r(BW + 32 - BB, 17, 6, 2, F); d.r(BW + 38 - BB, 16, 4, 4, F); d.r(BW + 42 - BB, 15, 3, 6, F); d.r(BW + 45 - BB, 14, 1, 8, F); d.r(BW + 46 - BB, 13, 1, 10, F); d.r(BW + 47 - BB, 12, 1, 12, F); // ベル（中心 z 17.5）：半径 1→2→3→4→5→6
         },
         // 朝顔：段ごとの半径 R で、外側（角）と内側（管の中）の両方を丸く削る。
         // 外側も削らないと 1 段 1 段が四角い輪になり、階段の角が立つ（2026-09-12 ユーザー指摘）
         carve: (x, y, z) => {
           if (x < BW) {                                                                      // 後端の U 字：中心 (BW, 14)・半径 2.5・太さ 1 の円弧だけ残す
             const dx = x + 0.5 - BW, dy = y + 0.5 - 14, d = Math.hypot(dx, dy);
             return d < 2 || d > 3;
           }
           if (x < BW + 32 - BB) return false;                                                // 管の直線部はそのまま
           const R = x >= BW + 47 - BB ? 6 : x >= BW + 46 - BB ? 5 : x >= BW + 45 - BB ? 4 : x >= BW + 42 - BB ? 3 : x >= BW + 38 - BB ? 2 : 1;
           const dy = y - 11.5, dz = z - 17.5, d2 = dy * dy + dz * dz;                        // セル中心は index + 0.5。朝顔の中心は y 12 / z 18 なので差は index - 11.5 / -17.5
           if (d2 > R * R) return true;                                                       // 外側の角を落とす
           return x >= BW + 42 - BB && d2 < (R - 1.2) * (R - 1.2);                            // 半径 3 以降は中を抜く（根元の 2 段は塞いだまま）
         } });
    // ベル管の左右位置。スライドと同じ面に寄せると顔に近づきすぎるので元の位置のまま（2026-09-12 ユーザー指定）。
    // 戻りの管はスライドの下の管より 2px ほど外側を平行に走る（繋ぎ目はねじれるが、寄せるより見た目が良い）
    bell.position.set(0, 0, 10 * VOX);
    if (PART_STYLE !== 'sprite') body.rotation.x = -Math.PI / 3; // スライド部のロール：下の管が奏者の左（絵の +z）へ振れる
    root.add(body, bell);
    // 外管 33×7：上下 2 本の管・先端の U 字・支柱。pivot = 左端・上の管の行（本体の x=6 に置く）。
    // 管の太さ（1 行）と上下の間隔（6 行）は内管とぴったり同じにして、同じ軸に重ねる（2026-09-12 ユーザー指定）。
    // 長さ・間隔とも 2026-09-12 に 1.5 倍（22×5・間隔 4 → 33×7・間隔 6）。
    // 奥行きだけ内管（2）より広い 3 にして外側から包む（面が完全に重なると描画がちらつくため）
    const slide = makePart(33, 7, 0, 0, (d) => {
      d.r(0, 0, 29, 1, C.gold); d.r(0, 6, 29, 1, C.gold);                                       // 上下の管
      d.r(29, 0, 4, 7, C.gold);                                                                 // U 字：四角く描いて carve で円弧に削る（角を丸く・太さ 1px・色は管と同じ。2026-09-12 ユーザー指定）
      d.r(1, 0, 1, 7, C.silver);                                                                // 支柱
      // 奥行きは 1（管の太さと同じ）。スライド部は -60° ロールしているので、奥行きが大きいと
      // 画面上では管が縦長のリボンに見える（2026-09-12 ユーザー指定で 3 → 1）
      // z0 は内管と同じ中心（セル中心 z=-0.5）に合わせる。-0.5 だと外管だけ 0.5 セル手前に寄り、
      // スライド部は -60° ロールしているため画面では上へずれて見える（2026-09-12 ユーザー指摘）
    }, { res: 2, depth: 1, z0: -1,
         // U 字の先端：中心 (29.5, 3.5)・半径 3・太さ 1 の円弧だけ残す（上下の管の中心が半径 3 の円周上に乗る）
         carve: (x, y) => {
           if (x < 29) return false;
           const dx = x + 0.5 - 29.5, dy = y + 0.5 - 3.5, d = Math.hypot(dx, dy);
           return d < 2.5 || d > 3.5;
         } });
    // 内管と上下の面がぴったり重なるので、外管を手前に描いて面のちらつき（z-fighting）を防ぐ
    slide.material.polygonOffset = true;
    slide.material.polygonOffsetFactor = -1;
    slide.material.polygonOffsetUnits = -1;
    slide.position.set(6 * VOX, 0, 0);
    slide.userData.baseX = 6 * VOX;
    body.add(slide);
    root.userData.slide = slide;
    root.userData.size = body.userData.size;
    return root;
  },
  // チューバ 32×44：上に開く大きなベル（中空）・巻いた胴・ピストン 4 本・左へ出るマウスパイプ。pivot = 底中央
  tuba: () => makePart(32, 44, 16, 44, (d) => {
    d.r(4, 0, 24, 2, C.gold2); d.r(5, 2, 22, 4, C.gold); d.r(8, 6, 16, 4, C.gold); d.r(10, 10, 12, 4, C.gold); // ベル（上向き）・喉
    d.r(6, 14, 20, 2, C.gold); d.r(4, 16, 24, 24, C.gold); d.r(6, 40, 20, 2, C.gold); d.r(8, 42, 16, 2, C.gold2); // 胴（丸み）
    d.r(6, 22, 20, 1, C.gold2); d.r(6, 31, 20, 1, C.gold2);                                 // 管の継ぎ目
    d.r(11, 18, 10, 12, C.gold2); for (let x = 10; x <= 19; x += 3) d.r(x, 16, 2, 2, C.silver); // ピストンとボタン
    d.r(3, 25, 8, 2, C.gold); d.r(0, 24, 3, 3, C.silver);                                   // マウスパイプ・マウスピース
    d.r(6, 18, 2, 20, '#f3d27a');                                                          // ハイライト（1px の帯）
  }, { res: 2, depth: 20, z0: -4,
       side: (d) => { d.r(2, 0, 16, 2, F); d.r(3, 2, 14, 4, F); d.r(5, 6, 10, 4, F); d.r(6, 10, 8, 4, F); d.r(2, 14, 16, 28, F); d.r(4, 42, 12, 2, F); },
       top: (d) => { d.disc(16, 10, 12, F); d.r(4, 4, 24, 12, F); d.r(0, 6, 6, 6, F); },
       carve: (x, y, z) => { if (y > 10) return false; const R = y < 2 ? 11 : y < 6 ? 10 : 7; const r = R - 1.5; const dx = x - 15.5, dz = z - 9.5; return dx * dx + dz * dz < r * r; } }),

  // ---- 打楽器（2倍解像度。太鼓・シンバルは上から見て丸い）----
  // ティンパニ 56×32：皮・フープ・銅の椀・脚・ペダル。pivot = 皮の中央
  timpani: () => makePart(56, 32, 28, 0, (d) => {
    d.r(0, 5, 56, 8, C.silver2);                                                            // チューニングねじの下地（carve で 8 本だけ残す。2026-09-11）
    d.r(4, 0, 48, 4, C.head); d.r(2, 4, 52, 2, C.silver);                                   // 皮・フープ
    d.r(2, 6, 52, 8, C.copper); d.r(5, 14, 46, 6, C.copper); d.r(10, 20, 36, 4, C.copper2); d.r(18, 24, 20, 3, C.copper2); // 椀
    d.r(8, 8, 3, 10, '#d08c50');                                                            // 艶
    d.r(10, 26, 3, 6, C.silver2); d.r(43, 26, 3, 6, C.silver2); d.r(26, 27, 4, 5, C.silver2); // 脚
    d.r(24, 30, 8, 2, C.black);                                                             // ペダル
  }, { res: 2, depth: 56, z0: 0,
       side: (d) => { d.r(4, 0, 48, 4, F); d.r(2, 4, 52, 2, F); d.r(0, 5, 56, 8, F); d.r(2, 6, 52, 8, F); d.r(5, 14, 46, 6, F); d.r(10, 20, 36, 4, F); d.r(18, 24, 20, 3, F); d.r(10, 26, 3, 6, F); d.r(43, 26, 3, 6, F); d.r(26, 27, 4, 5, F); },
       top: (d) => { d.disc(28, 28, 27, F); },
       // 行ごとの半径で真円に削る（皮 24・フープ 26・椀 26→23→18→10。3 面の交差だけだと角の丸い四角になる）。
       // 椀の外（R 26〜27.5、rows 5-12）はチューニングねじ 8 本の位置だけ残す（1px 張り出す粗い部品。2026-09-11）
       carve: (x, y, z) => { if (y >= 26) return false; const r = Math.hypot(x - 27.5, z - 27.5); if (y >= 5 && y < 13 && r > 26.5) return !(r <= 27.6 && lugAngle(x - 27.5, z - 27.5, 8, 1.4)); const R = y < 4 ? 24 : y < 14 ? 26 : y < 20 ? 23 : y < 24 ? 18 : 10; return r > R + 0.5; },
       colorOf: (x, y, z) => (y >= 5 && y < 13 && Math.hypot(x - 27.5, z - 27.5) > 26.5 ? C.silver2 : null) }),
  // スネア 32×20：皮・フープ・クロームの胴とラグ・脚
  // スネア 32×34：胴＋**スタンド**（支柱＋十字の脚）。pivot = 皮の中央上。h 34 で床（inst.pos y 17 の 17px 下）まで届く
  // 以前は行 17-19 に 1.5px の突起があるだけで、太鼓が床から 6.7px 浮いていた（2026-09-22 ユーザー指摘）
  snare: () => makePart(32, 34, 16, 0, (d) => {
    d.r(0, 6, 32, 8, C.silver2);                                                            // ラグの下地（carve で 8 本だけ残す。2026-09-11）
    d.r(4, 0, 24, 3, C.head); d.r(2, 3, 28, 2, C.silver);
    d.r(3, 5, 26, 10, C.silver);                                                            // 胴（ラグは立体で外に張り出す）
    d.r(2, 15, 28, 2, C.silver);
    d.r(15, 17, 2, 14, C.silver2);                                                          // スタンドの支柱（行 17-30）
    d.r(9, 31, 14, 3, C.silver2);                                                           // 脚の台（carve で十字に削る。行 31-33＝床）
  }, { res: 2, depth: 32, z0: 0,
       side: (d) => { d.r(4, 0, 24, 3, F); d.r(2, 3, 28, 2, F); d.r(0, 6, 32, 8, F); d.r(3, 5, 26, 10, F); d.r(2, 15, 28, 2, F); d.r(15, 17, 2, 14, F); d.r(9, 31, 14, 3, F); },
       top: (d) => { d.disc(16, 16, 15, F); },
       // 行ごとの半径で真円に削る（皮 12・フープ 14・胴 13）。胴の外（R 13.5〜15、rows 6-13）はラグ 8 本の位置だけ残す
       carve: (x, y, z) => {
         const dxs = x - 15.5, dzs = z - 15.5;
         if (y >= 31) return !(Math.hypot(dxs, dzs) <= 7 && (Math.abs(dxs) <= 1 || Math.abs(dzs) <= 1));  // 脚の台＝十字
         if (y >= 17) return !(Math.abs(dxs) <= 1 && Math.abs(dzs) <= 1);                                  // 支柱
         const r = Math.hypot(x - 15.5, z - 15.5); if (y >= 6 && y < 14 && r > 13.5) return !(r <= 15.2 && lugAngle(x - 15.5, z - 15.5, 8, 1.2)); const R = y < 3 ? 12 : y < 5 ? 14 : y < 15 ? 13 : 14; return r > R + 0.5; },
       colorOf: (x, y, z) => (y >= 6 && y < 14 && Math.hypot(x - 15.5, z - 15.5) > 13.5 ? C.silver2 : null) }),
  // シンバル 36×5：カップ・薄い円盤（上から見て丸い）。色は明るい金 1 色（2026-09-23 ユーザー指定で濃い金との 2 トーンを廃止）
  // 2026-09-23 ユーザー指定で 2 点：
  // (1) 奏者側の面に生えていた銀の突起（革ひもの結び目のつもりだった d.r(17,5,2,3,C.silver2)）を削除。
  // (2) **縁が分厚い**のを直す。縁は「薄い金 2 セル（行 2・3）＋濃い金 1 セル（行 4）」の貼り合わせで 3 セルあった。
  //     薄い金を全部消すと湾曲が無くなるので、薄い金の**半径だけ** 17 → 13 セルに詰める（carve）。
  //     これで外周 13〜17 セルは濃い金 1 セルだけの薄い縁になり、中央側は 3 セル残って湾曲が保たれる。
  //     ※円盤ごと 17→15 セルに縮める案・外周を濃い金に塗り替える案は、どちらも厚みが変わらず却下された
  cymbal: () => makePart(36, 5, 18, 0, (d) => { d.r(14, 0, 8, 1, C.gold); d.r(12, 1, 12, 1, C.gold); d.r(0, 2, 36, 3, C.gold); d.r(0, 4, 36, 1, C.gold); },
    { res: 2, depth: 36, z0: -18, side: (d) => { d.r(14, 0, 8, 1, F); d.r(12, 1, 12, 1, F); d.r(0, 2, 36, 3, F); }, top: (d) => { d.disc(18, 18, 17, F); },
      carve: (x, y, z) => (y >= 2 && y <= 3 && Math.hypot(x - 17.5, z - 17.5) > 13) }),
  // ハイハット 32×36（2026-09-19 ユーザー指定）：上下 2 枚のシンバル（カップ付き）・支柱・3 本脚・ペダル。pivot = 上のカップの頂点（中央）。
  // 大きさ・中心はスネアと同じ（直径 16px、中心は z 16 セル）。行ごとの半径は carve で決める（正面図は色だけ）。
  // 脚は下 6 行で広がる 3 本（奏者から遠い左右 2 本と、奏者側の 1 本）。奏者側にペダル（黒）
  // ハイハット 32×36。サスシン（直径 17.5px）より**一回り小さく**（直径 11.5px）、**薄く**（1 枚 1 セル＝0.5px）。
  // 濃い黄色（C.gold2）は色を変えるのではなく**層ごと消す**（2026-09-23 ユーザー指定）。
  // 以前は 1 セル内側に引っ込んだ層（r 10.5）を裏・表として重ねていたが、金に塗り替えても側面が陰になって
  // 「内側の濃い黄色」に見えたため削除した。脚の位置を変えないよう、支柱の開始行だけ 7 → 5 に詰める。pivot = カップの頂点
  hihat: () => makePart(32, 36, 16, 0, (d) => {
    d.r(0, 0, 32, 1, C.gold); d.r(0, 1, 32, 1, C.gold);                                      // 上のシンバル：カップ・皿
    d.r(0, 2, 32, 2, C.silver);                                                              // 2 枚の間のロッド
    d.r(0, 4, 32, 1, C.gold);                                                                // 下のシンバル：皿
    d.r(0, 5, 32, 31, C.silver2);                                                            // 支柱・脚
  }, { res: 2, depth: 32, z0: 0, top: (d) => { d.disc(16, 16, 15, F); },
       carve: (x, y, z) => {
         const dx = x - 15.5, dz = z - 15.5, r = Math.hypot(dx, dz);
         if (y === 0) return r > 3.5;                                                        // カップ
         if (y === 1) return r > 11.5;                                                       // 上のシンバル（1 セル厚）
         if (y <= 3) return r > 1;                                                           // ロッド
         if (y === 4) return r > 11.5;                                                       // 下のシンバル（1 セル厚）
         if (y < 30) return r > (y < 18 ? 1 : 1.6);                                          // 支柱（下半分は太い外筒）
         if (y >= 34 && Math.abs(dx) <= 3.5 && dz < -2 && dz > -13) return false;             // ペダル（奏者側 = z の小さい側）
         const R = 1.5 + 7.5 * (y - 30) / 5;                                                 // 脚：付け根から床へ広がる
         if (r <= 1.6 && y < 32) return false;
         return ![[-0.87, 0.5], [0.87, 0.5], [0, -1]].some(([ux, uz]) => Math.hypot(dx - ux * R, dz - uz * R) <= 0.9);
       },
       colorOf: (x, y, z) => (y >= 34 && Math.abs(x - 15.5) <= 3.5 && z - 15.5 < -2 ? C.black : null) }),
  // サスペンデッドシンバル 36×36（2026-09-19 ユーザー指定）：スタンドに 1 枚。ハイハットから下のシンバルとペダルを除いた作り。pivot = カップの頂点（中央）。
  // 直径 18px（ハイハットより一回り大きい）、中心は z 18 セル（9px）。表は行 2（pivot の 1px 下）。脚は下 6 行で広がる 3 本
  suscymbal: () => makePart(36, 36, 18, 0, (d) => {
    d.r(0, 0, 36, 2, C.gold); d.r(0, 2, 36, 1, C.gold); d.r(0, 3, 36, 1, C.gold);            // カップ・表・縁（2026-09-23 ユーザー指定で明るい金に統一。濃い金との 2 トーンは廃止）
    d.r(0, 4, 36, 2, C.black);                                                               // フェルトと蝶ねじ
    d.r(0, 6, 36, 30, C.silver2);                                                            // スタンド・脚
  }, { res: 2, depth: 36, z0: 0, top: (d) => { d.disc(18, 18, 17, F); },
       carve: (x, y, z) => {
         const dx = x - 17.5, dz = z - 17.5, r = Math.hypot(dx, dz);
         if (y <= 1) return r > (y === 0 ? 2.5 : 4.5);                                      // カップ
         // 合わせシンバルと同じ直し（2026-09-23 ユーザー指定）：上の薄い金（行 2）と濃い金（行 3）の
         // 貼り合わせで縁が分厚かったので、薄い金の半径だけ 17.5 → 13 に詰める。
         // 外周 13〜17.5 は濃い金 1 セルだけの薄い縁になり、中央側は 2 セル残って湾曲が保たれる
         if (y <= 3) return r > (y === 2 ? 13 : 17.5);                                       // 表（薄い金）は小さく、縁（濃い金）が外周
         if (y <= 5) return r > 1.6;                                                         // フェルト・蝶ねじ
         if (y < 30) return r > (y < 18 ? 1 : 1.6);                                          // スタンド（下半分は太い外筒）
         const R = 1.5 + 7.5 * (y - 30) / 5;                                                 // 脚：付け根から床へ広がる
         if (r <= 1.6 && y < 32) return false;
         return ![[-0.87, 0.5], [0.87, 0.5], [0, -1]].some(([ux, uz]) => Math.hypot(dx - ux * R, dz - uz * R) <= 0.9);
       } }),
  // 銅鑼（タムタム）64×90（2026-09-19 ユーザー指定）：木の枠（柱 2 本・横木・足）から紐で吊った円盤。pivot = 底中央。
  // 円盤は直径 27px・中心の高さ 24px、厚み 1px で、正面（+z）が面。枠の柱・横木・円盤は奥行きの中央（z 11-12 セル）の 1px、足だけ前後いっぱいに伸ばす
  // 枠と「吊られた部分（紐＋円盤）」は別の部品（2026-09-19 ユーザー指定：打つと円盤と紐が揺れる）。
  // 吊られた部分は横木の下の紐の付け根（列 32・行 7 ＝ 床から 41.5px）を支点に、userData.swing の回転（x 軸＝面に垂直な前後の振り子）で揺らす（puppet.js）
  gong: () => {
    const opts = { res: 2, depth: 24, z0: -12, side: (d) => { d.r(11, 2, 2, 84, F); d.r(0, 86, 24, 4, F); } };
    const root = new THREE.Group();
    const frame = makePart(64, 90, 32, 90, (d) => {
      d.r(0, 4, 2, 86, C.wood2); d.r(62, 4, 2, 86, C.wood2); d.r(0, 4, 64, 3, C.wood2);      // 柱・横木
      d.r(0, 2, 2, 2, C.gold2); d.r(62, 2, 2, 2, C.gold2);                                   // 柱の頭の飾り
    }, opts);
    // 円盤はシンバルのように中央へ向けて段差を付けて立体にする（2026-09-23 ユーザー指定）。
    // 縁〜打ち出しの輪の外は従来の 2 セル（1px）のまま、輪（半径 18）の内側で +1 セル、中央（半径 7）で +2 セル、
    // **正面（+z）側へ**盛り上げる。奏者が叩く裏面（-z）の位置は変わらないので、打点（puppet.js の strike）は触らない。
    // 段の境目は絵の輪・中央の円と同じ判定（Pen.disc の r² ≤ rad² + rad/2）で揃える
    const inDisc = (x, y, rad) => (x - 32) ** 2 + (y - 42) ** 2 <= rad * rad + rad * 0.5;
    const hanging = makePart(64, 90, 32, 7, (d) => {
      d.r(26, 7, 1, 9, C.black); d.r(37, 7, 1, 9, C.black);                                  // 吊り紐
      // 円盤の地と打ち出しの輪の色は 2026-09-23 ユーザー指定で入れ替え（地＝明るい金、輪＝濃い金）
      d.disc(32, 42, 27, C.gold); d.ring(32, 42, 27, C.copper2); d.ring(32, 42, 26, C.copper2); // 円盤・縁（濃い）
      d.ring(32, 42, 18, C.gold2); d.disc(32, 42, 7, '#c99a36');                             // 打ち出しの輪・中央
    }, { ...opts, side: (d) => { d.r(11, 2, 4, 84, F); d.r(0, 86, 24, 4, F); },
         carve: (x, y, z) => (z === 13 ? !inDisc(x, y, 18) : z === 14 ? !inDisc(x, y, 7) : false) });
    const swing = new THREE.Group();
    swing.position.set(0, (90 - 7) / 2 * PX, 0);   // 支点：絵の行 7（res 2 なので 1 行 = 0.5px）
    swing.add(hanging);
    root.add(frame, swing);
    root.userData.swing = swing;
    root.userData.size = frame.userData.size;
    return root;
  },
  // チューブラーベル 60×66（2026-09-19 ユーザー指定）：金属の枠（柱 2 本・上の横木・床の台）から真鍮の管 12 本を吊る。pivot = 底中央。
  // 管は左が長い（低音）→ 右が短い（高音）で 26px → 16px、上端（キャップ）の高さは揃えて 30px。管 i の中心は列 8+4i（rig x = -11 + 2i）。
  // 厚みは 1px（奥行き z 3-4 セル）、床の台だけ前後に広げる
  tubularbells: () => makePart(60, 66, 30, 66, (d) => {
    d.r(0, 0, 60, 3, C.silver2); d.r(0, 0, 2, 66, C.silver2); d.r(58, 0, 2, 66, C.silver2);   // 上の横木・柱
    d.r(0, 62, 60, 4, C.silver2); d.r(26, 62, 8, 3, C.black);                                  // 床の台・ダンパーのペダル
    for (let i = 0; i < 12; i++) {
      const x = 7 + 4 * i, len = 52 - Math.round(i * 20 / 11);
      d.r(x, 3, 1, 2, C.black); d.r(x + 1, 3, 1, 2, C.black);                                  // 吊り紐
      d.r(x, 5, 2, 2, C.silver);                                                               // キャップ（叩く所）
      d.r(x, 7, 1, len - 2, C.gold); d.r(x + 1, 7, 1, len - 2, C.gold2);                       // 管（右半分を陰に）
    }
  }, { res: 2, depth: 8, z0: -4,
       side: (d) => { d.r(3, 0, 2, 62, F); d.r(0, 62, 8, 4, F); } }),
  // マレット類（2倍解像度。頭は球）。長さは実物比（ティンパニ/鍵盤 ≒ 36cm = 20px、大太鼓 ≒ 40cm = 22px、スティック ≒ 40cm = 22px）
  // マレット：pivot = 握り（柄の端から 3px 先）。柄の手前 3px が拳の後ろへ出る。先端までの距離は 10px のまま
  // （2026-09-22 ユーザー指摘：拳からスティックが突き出ているように見える＝握りが柄の端にあった）
  mallet: () => makePart(6, 26, 3, 6, (d) => { d.r(2, 0, 2, 20, C.wood2); d.disc(3, 22, 3, C.ivory); },
    { res: 2, depth: 6, z0: -3, side: (d) => { d.r(2, 0, 2, 20, F); d.disc(3, 22, 3, F); }, top: (d) => { d.disc(3, 3, 3, F); } }),
  // 鍵盤打楽器（シロフォン・マリンバ）用の小さいマレット。頭の直径 2px（ティンパニ等の mallet は 3px）。
  // 音板 1 本の幅が 1px なので、3px の頭だと 2 本ぶんを覆ってしまっていた（2026-09-23 ユーザー指摘）。
  // 実物もティンパニのマレット（頭 5cm 前後）よりシロフォンのマレット（2.5〜3cm ＝ 音板の幅と同程度）の方が小さい
  // ※ disc の半径は整数のみ（for (let y = -rad; y <= rad; y++) が非整数だとセルに乗らない）。
  //   半径 1 = 3 セル = 1.5px、半径 2 = 5 セル = 2.5px、半径 3 = 6 セル = 3px（従来の mallet）
  keymallet: () => makePart(6, 26, 3, 6, (d) => { d.r(2, 0, 2, 22, C.wood2); d.disc(3, 24, 1, C.ivory); },
    { res: 2, depth: 6, z0: -3, side: (d) => { d.r(2, 0, 2, 22, F); d.disc(3, 24, 1, F); }, top: (d) => { d.disc(3, 3, 1, F); } }),
  // 大マレット（グランカッサ）：同じく pivot = 握り（柄の端から 3px 先）
  bigmallet: () => makePart(10, 28, 5, 6, (d) => { d.r(4, 0, 2, 19, C.wood2); d.disc(5, 22, 5, C.white); d.r(3, 20, 1, 4, '#e6e6e6'); },
    { res: 2, depth: 10, z0: -5, side: (d) => { d.r(4, 0, 2, 19, F); d.disc(5, 22, 5, F); }, top: (d) => { d.disc(5, 5, 5, F); } }),
  // スティック（スネア・ハイハット）：同じく pivot = 握り（柄の端から 3px 先）。先端までの距離は 11px のまま
  stick: () => makePart(6, 28, 3, 6, (d) => { d.r(2, 0, 2, 26, C.wood); d.r(2, 26, 2, 2, '#c9a06a'); }, { res: 2, depth: 2, z0: -1 }),
  // シロフォン 56×28：明るい木の音板 16 枚・フレーム・脚。pivot = 底中央
  // **打面（音板の上端）は全部同じ高さ**。以前は下端をフレームに固定して高さを変えていたので、
  // 高音ほど打面が下がり、固定高さ（rig y 22）で振り下ろすマレットが空を叩いていた（2026-09-22 ユーザー指摘）。
  // 音程による長さの違いは実物どおり**奥行き**で表す（高音ほど短い）＝下の carve
  xylophone: () => makePart(56, 36, 28, 36, (d) => {   // h 36：打面 16px。スネアの打面と同じ高さにして、腕の形・叩き方を揃える（2026-09-22 ユーザー指定）
    // 脚は左右の端の箱の外寄りから生やす（2026-09-23 ユーザー指定：内側にあると音板・共鳴管の列と重なった）
    d.r(0, 8, 2, 26, FRAME_BK); d.r(54, 8, 2, 26, FRAME_BK);                               // 脚（黒・細く 2 セル＝1px。端の箱の真下から接地まで）
    d.r(0, 34, 6, 2, FRAME_BK); d.r(50, 34, 6, 2, FRAME_BK);                                // 脚の台（キャスター）
    // 共鳴管は 2026-09-23 ユーザー指定で削除
    d.r(2, 5, 52, 3, FRAME_BK);                                                            // フレーム（黒。中は carve で前後 2 本のレールに）
    d.r(0, 5, 6, 3, FRAME_BK); d.r(50, 5, 6, 3, FRAME_BK);                                 // 左右の端（外側へ広げて 3px。高さはレールと同じ。2026-09-23 ユーザー指定）
    for (let i = 0; i < 16; i++) d.r(4 + i * 3, 4, 2, 1, ROSE[i % 12]);                    // 音板（紫檀・上端 4・厚み 1 セル＝0.5px・幅 2 セル。2026-09-23 ユーザー指定で 1px → 0.5px、フレームごと 0.5px 上げた）
  }, { res: 2, depth: 20, z0: 0,
       side: (d) => { d.r(2, 4, 16, 4, F); d.r(0, 5, 20, 3, F); d.r(5, 8, 2, 26, F); d.r(9, 8, 2, 26, F); d.r(3, 34, 10, 2, F); d.r(16, 8, 2, 26, F); d.r(14, 34, 6, 2, F); d.r(13, 8, 2, 26, F); d.r(3, 34, 6, 2, F); d.r(11, 34, 6, 2, F); },
       top: (d) => { d.r(0, 0, 56, 20, F); }, carve: XYLO_BARS }),
  // マリンバ 72×36：紫檀の音板 22 枚・下に共鳴管・フレーム・脚。pivot = 底中央
  // 打面はシロフォンと同じ理由で全部同じ高さ。音程の違いは奥行き（carve）と共鳴管の長さで見せる
  marimba: () => makePart(74, 34, 36, 34, (d) => {   // 幅 74：右の縁を外へ 2 セル（2026-09-23 下記）。pivot は 36 のまま（楽器の位置・打点は動かない）
   // h 34：打面 16px。シロフォンと同じくスネアの高さに揃える（2026-09-22 ユーザー指定）
    // 脚は左右の端の箱の外寄りから生やす（シロフォンと同じ。共鳴管の列と重ならない）
    d.r(0, 6, 2, 26, FRAME_BK); d.r(72, 6, 2, 26, FRAME_BK);                               // 脚（黒・細く 2 セル＝1px。端の箱の真下から接地まで）
    d.r(0, 32, 6, 2, FRAME_BK); d.r(68, 32, 6, 2, FRAME_BK);                                // 脚の台（キャスター）
    for (let i = 0; i < 22; i++) { const len = MARIMBA_TUBE_LEN(i); d.r(4 + i * 3, 6, 2, len, BRASS); d.r(5 + i * 3, 6, 1, len, BRASS2); } // 共鳴管（真鍮・高音ほど短い。右半分を暗く。奥行きは carve で音板の中心に）
    d.r(2, 3, 68, 3, FRAME_BK);                                                            // フレーム（黒。中は carve で前後 2 本のレールに）
    d.r(0, 3, 6, 3, FRAME_BK); d.r(68, 3, 6, 3, FRAME_BK);                                 // 左右の端（外側へ広げて 3px。高さはレールと同じ。2026-09-23 ユーザー指定）
    // 右の端は 66 → 68 へ：最後の音板（x 67-68）と深く重なり、音板の外に 3 セルしか見えずシロフォン（5 セル）より細く見えた（同日ユーザー指定）
    for (let i = 0; i < 22; i++) d.r(4 + i * 3, 2, 2, 1, ROSE[i % 12]);                    // 音板（紫檀・上端 2・厚み 1 セル＝0.5px。シロフォンと同じくフレームごと 0.5px 上げた）
  }, { res: 2, depth: 24, z0: 0,
       side: (d) => { d.r(2, 2, 20, 4, F); d.r(0, 3, 24, 3, F); d.r(7, 6, 15, 15, F); d.r(10, 6, 2, 26, F); d.r(3, 32, 11, 2, F); d.r(21, 6, 2, 26, F); d.r(19, 32, 5, 2, F); d.r(5, 6, 2, 26, F); d.r(17, 6, 2, 26, F); d.r(3, 32, 6, 2, F); d.r(15, 32, 6, 2, F); },
       top: (d) => { d.r(0, 0, 74, 24, F); }, carve: MARIMBA_BARS }),
  // グランカッサ 52×60：正面向きの大太鼓（白い皮・木の胴・フープ・ラグ・スタンド）。pivot = 底中央
  bassdrum: () => makePart(52, 60, 26, 60, (d) => {
    d.r(22, 48, 8, 12, C.silver2); d.r(8, 56, 36, 4, C.silver2);                            // スタンド
    d.disc(26, 26, 25, C.wood2);                                                            // 胴
    d.disc(26, 26, 21, C.head); d.ring(26, 26, 12, '#e4dcc8');                              // 皮
    d.ring(26, 26, 22, C.silver); d.ring(26, 26, 23, C.silver);                             // フープ
    for (let a = 0; a < 10; a++) { const x = 26 + Math.round(25 * Math.cos(a * Math.PI / 5)), y = 26 + Math.round(25 * Math.sin(a * Math.PI / 5)); d.r(x - 1, y - 1, 3, 3, C.gold2); } // ラグ（胴の縁から 1 セル外へ張り出す）
  }, { res: 2, depth: 16, z0: 0, side: (d) => { d.r(0, 0, 16, 52, F); d.r(6, 48, 4, 12, F); d.r(2, 56, 12, 4, F); },
       // 皮（R ≤ 21）は前後とも 2 セル奥へ引っ込め、フープ（R 22-23）が張り出して見える（2026-09-11）
       carve: (x, y, z) => Math.hypot(x - 26, y - 26) <= 21.5 && (z >= 14 || z <= 1) }),

  // ---- 鍵盤・ハープ（2倍解像度）----
  // チェレスタ 52×60：小さなアップライト型。上部パネル・鍵盤（手前に張り出す）・脚・ペダル。pivot = 底中央
  celesta: () => makePart(52, 60, 26, 60, (d) => {
    d.r(4, 0, 44, 52, C.wood); d.r(6, 2, 40, 22, C.wood2); d.r(8, 4, 36, 18, '#4a2410');    // 筐体・上部パネル
    d.r(2, 26, 48, 3, C.wood2);                                                             // 鍵盤蓋の縁
    d.r(6, 29, 40, 6, C.white); for (let i = 0; i < 13; i++) { if ([0, 1, 3, 4, 5].includes(i % 7)) d.r(8 + i * 3, 29, 2, 4, C.black); } // 鍵盤
    d.r(6, 35, 40, 2, C.black); d.r(6, 38, 40, 12, C.wood2);                                // 鍵盤の台・下のパネル
    d.r(6, 52, 4, 8, C.wood2); d.r(42, 52, 4, 8, C.wood2);                                  // 脚
    d.r(22, 54, 8, 4, C.gold2);                                                             // ペダル
  }, { res: 2, depth: 20, z0: 0, side: (d) => { d.r(0, 0, 16, 52, F); d.r(14, 26, 6, 10, F); d.r(2, 52, 4, 8, F); d.r(10, 52, 4, 8, F); }, top: (d) => { d.r(4, 0, 44, 16, F); d.r(6, 14, 40, 6, F); },
       back: { [C.white]: C.wood, [C.black]: C.wood, '#4a2410': C.wood2, [C.gold2]: C.wood } }),
  // グランドピアノ 80×52：蓋・胴（上から見て翼型）・鍵盤（白鍵 24・黒鍵はオクターブ配列）・脚 3 本・ペダル。pivot = 底中央
  piano: () => makePart(80, 52, 40, 52, (d) => {
    d.r(8, 0, 64, 8, C.black); d.r(10, 1, 60, 2, C.coat2);                                  // 蓋
    d.r(0, 8, 80, 20, C.black); d.r(2, 10, 76, 1, C.coat2); d.r(4, 26, 72, 2, C.coat2);     // 胴・艶・鍵盤蓋
    d.r(4, 28, 72, 6, C.white); for (let i = 0; i < 24; i++) { if ([0, 1, 3, 4, 5].includes(i % 7)) d.r(6 + i * 3, 28, 2, 4, C.black); } // 鍵盤
    d.r(2, 34, 76, 2, C.black);                                                             // 鍵盤の台
    d.r(6, 36, 4, 16, C.black); d.r(70, 36, 4, 16, C.black); d.r(22, 36, 4, 16, C.black);   // 脚（鍵盤側 2 本＋尾部 1 本。どれをどの奥行きに残すかは carve）
    d.r(39, 36, 2, 4, C.black); d.r(38, 40, 4, 6, C.black); d.r(36, 46, 8, 3, C.gold2);     // ペダルのリラ（支柱・リラ・ペダル）
  }, { res: 2, depth: 60, z0: 0,
       side: (d) => { d.r(0, 0, 44, 8, F); d.r(0, 8, 60, 20, F); d.r(50, 28, 10, 8, F); d.r(2, 36, 4, 16, F); d.r(54, 36, 4, 16, F); d.r(54, 36, 6, 13, F); },
       top: (d) => { d.r(0, 30, 80, 30, F); for (let z = 0; z < 30; z++) d.r(0, z, Math.round(80 - (29 - z) * 1.6), 1, F); }, // 鍵盤側は全幅、奥（尾部）ほど細い翼型
       // 脚：鍵盤側（z ≥ 50）は x=6・70 の 2 本、尾部（z < 10）は x=22 の 1 本。リラは鍵盤側だけ
       carve: (x, y, z) => y >= 36 && ((z >= 50 && x >= 22 && x < 26) || (z < 10 && (x < 10 || (x >= 36 && x < 44)))),
       back: { [C.white]: C.black, [C.coat2]: C.black, [C.gold2]: C.black } }),
  // ハープ 44×72：柱・湾曲したネック・弦（C 弦は赤）・共鳴胴（下ほど深い）・台座。pivot = 底中央
  harp: () => makePart(44, 72, 22, 72, (d) => {
    const neckY = (x) => 2 + Math.round(Math.pow((x - 8) / 33, 1.3) * 26);
    const boxAt = (y) => ({ x0: 10 + Math.round((68 - y) * 12 / 28), w: 32 - Math.round((68 - y) * 24 / 28) });
    for (let y = 40; y < 68; y++) { const b = boxAt(y); d.r(b.x0, y, b.w, 1, C.wood); d.p(b.x0, y, C.wood2); d.p(b.x0 + b.w - 1, y, C.wood2); } // 共鳴胴
    for (let x = 12; x <= 40; x += 2) { const yt = neckY(x) + 4; let yb = 68; for (let y = 40; y < 68; y++) { const b = boxAt(y); if (x >= b.x0 && x < b.x0 + b.w) { yb = y; break; } } d.r(x, yt, 1, yb - yt, x % 14 === 0 ? '#e05050' : C.silver); } // 弦
    for (let x = 8; x < 42; x++) d.r(x, neckY(x), 1, 4, C.gold);                            // ネック
    d.r(4, 0, 6, 66, C.gold); d.r(6, 2, 1, 62, '#c99a2f'); d.r(2, 0, 10, 4, C.gold2); d.r(2, 62, 10, 6, C.gold2); // 柱・柱頭・柱脚
    d.r(2, 68, 42, 4, C.wood2);                                                             // 台座
  }, { res: 2, depth: 12, z0: 0,
       side: (d) => { d.r(3, 0, 6, 4, F); d.r(4, 0, 4, 32, F); d.r(5, 0, 2, 68, F); for (let y = 40; y < 68; y++) { const w = 4 + Math.round((y - 40) * 8 / 28); d.r(Math.round(6 - w / 2), y, w, 1, F); } d.r(0, 68, 12, 4, F); },
       top: (d) => { d.r(2, 3, 10, 6, F); d.r(10, 0, 34, 12, F); } }),
  // 2nd バイオリンは 1st と同じ絵（2026-09-12）。旧データの 'violin' も同じ
  baton: () => makePart(24, 1, 0, 0, (d) => { d.r(0, 0, 24, 1, C.ivory); d.r(0, 0, 4, 1, C.black); }, { res: 2, depth: 1, z0: -0.5 }),
};
INSTRUMENT.violin2 = INSTRUMENT.violin1;
INSTRUMENT.violin = INSTRUMENT.violin1;

// ---- メタリック表現（2026-09-23 ユーザー指定）----
// Lambert には鏡面反射項が無いので、これまで金・銀は色（C.gold / C.gold2 の 2 階調）でしか表せなかった。
// 金属の楽器だけ MeshPhongMaterial に差し替えてハイライトを出す。環境マップ（PMREM）は使わない：
// 空の時刻・雲・天気を変えるたびに作り直しが要り、設定項目の多いこのツールと相性が悪いため。
// 鏡面色は頂点色に寄せる（metalShader）。1 つのパーツに金と銀が混ざっていても、それぞれの色で光る。
// パーツ側の opts は触らず、INSTRUMENT の生成関数を包んでマテリアルだけ差し替える（絵の定義に手を入れない）
function metalShader(shader) {
  // ブルームの素材として描くためのユニフォーム（全マテリアルで共有。renderFrame が pass を切り替える）
  shader.uniforms.uBloomPass = METAL_BLOOM.pass;
  shader.uniforms.uMetalDepth = METAL_BLOOM.depth;
  shader.uniforms.uMetalRes = METAL_BLOOM.res;
  shader.uniforms.uMetalThr = METAL_BLOOM.thr;
  // 頂点色がパレットの金属色と一致するかを見る関数を足す（GLSL ES 1.0 でも通るよう、配列を使わず展開する）
  const metalOf = 'float metalOf(vec3 c) {\n  float m = 0.0;\n'
    + METAL_RGB.map(([r, g, b]) => `  m = max(m, step(max(max(abs(c.r - ${r.toFixed(4)}), abs(c.g - ${g.toFixed(4)})), abs(c.b - ${b.toFixed(4)})), ${METAL_EPS}));\n`).join('')
    + '  return m;\n}\n';
  shader.fragmentShader = 'uniform float uBloomPass;\nuniform sampler2D uMetalDepth;\nuniform vec2 uMetalRes;\nuniform float uMetalThr;\n' + metalOf + shader.fragmentShader;
  emissiveByVertexColor(shader);   // 打鍵フラッシュ（emissive）の頂点色掛けは Phong でも同じく要る
  // (1) 鏡面色を頂点色へ寄せる（金は金、銀は銀のハイライト）
  // (2) 金属は拡散反射が弱いので diffuse を落とす。明暗のコントラストが付いて「塗り」から離れる。
  //     この暗さは**「金属のツヤ」スライダーから切り離した固定値**にする（2026-09-23 ユーザー指定）。
  //     ツヤに連動させていた時（mAmt = clamp(ツヤ × 0.5, 0, 1)）は、ツヤ 2 で頭打ちになる一方、
  //     ボクセルの面は軸に平行な平面ばかりで大半が鏡面の角度に入らないため、上げるほど地の色が暗くなるだけで
  //     「上げるほどツヤが減る」という逆の体感になっていた。今はスライダーは鏡面とフレネルだけを動かす
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_phong_fragment>',
    `#include <lights_phong_fragment>
      float mtl = 0.0;
      #ifdef USE_COLOR
        mtl = metalOf(vColor.rgb);                                   // 0 = 木・革・布など / 1 = 銀・金・真鍮・銅
        material.specularColor *= mtl * mix(vec3(1.0), vColor.rgb, 0.65);
      #endif
      material.diffuseColor *= mix(1.0, 0.725, mtl);   // 金属だけ地の色を落とす（= mix(1.0, 0.45, 0.5)）`);
  // (3) フレネル（縁の反射）。視線に対して浅い角度の面ほど強く光る。
  //     ボクセルは面が軸に平行な平面ばかりで、点光源の鏡面だけだと「明るくなった」以上にならなかった。
  //     フレネルは**カメラの角度で変わる**ので、視点を回した時に縁がギラっと動き、金属らしさが出る（2026-09-23 ユーザー指定）
  shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>',
    `{
      float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
      vec3 fTint = vec3(1.0);
      #ifdef USE_COLOR
        fTint = mix(vec3(1.0), vColor.rgb, 0.6);
      #endif
      outgoingLight += fres * specular * 0.8 * fTint * mtl;
    }
    #include <output_fragment>`);
  // (4) ブルームの素材として描く時（uBloomPass=1）：本編の深度で隠れた画素は捨てる
  shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
      if (uBloomPass > 0.5 && gl_FragCoord.z > texture2D(uMetalDepth, gl_FragCoord.xy / uMetalRes).r + 0.00002) discard;`);
  // (5) 同じく、最終色から「金属だけの閾値を超えた分」を抜いて出す。
  //     stage.js の brightMat（全体ブルームの明るさ抽出）と同じ式で、閾値だけ金属専用のものを使う。
  //     dithering_fragment の後＝トーンマッピング・エンコードまで済んだ最終色に掛ける
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
    `#include <dithering_fragment>
      if (uBloomPass > 0.5) {
        if (mtl < 0.5) discard;   // 金属でない画素は書かない（書くと全体ブルームが抜いた分を 0 で上書きしてしまう）
        float bm = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
        gl_FragColor.rgb *= max(0.0, bm - uMetalThr) / max(1e-3, bm);
        gl_FragColor.a = 1.0;
      }`);
}
// 鏡面の強さ（左メニューの「金属のツヤ」スライダー。1〜3、既定 2）。1 を超える値を使う：
// ボクセルの面は軸に平行な平面ばかりで、鏡面が 1 以下だとほとんどの面が反射角から外れて
// 「変わっていない」ようにしか見えなかったため（2026-09-23 に実機で値を振って決めた）
// 鏡面の強さ（固定）。以前は「金属のツヤ」スライダーだったが、金属のブルームを入れてからは
// 見た目への影響がほとんど無くなったのでスライダーを廃止し、既定値 2 に固定した（2026-09-23 ユーザー指定）。
// 1 を超える値を使う理由：ボクセルの面は軸に平行な平面ばかりで、鏡面が 1 以下だと
// ほとんどの面が反射角から外れて「変わっていない」ようにしか見えなかった
const METAL_SPEC = 2;
// ブルーム用のレイヤー（0 = 本編 / 1 = 太陽 / 2 = 天気 / 3 = 金属。TOOL_CRAFT_RULES §10-7 で既存を grep して空き番号を確認）。
// 金属だけ**低い閾値**でブルームに乗せるため、天気と同じ「専用レイヤーで素材だけ描き足す」方式を使う（2026-09-23 ユーザー指定）。
// 全体ブルームの閾値（レンズ欄）を下げると画面全部が光ってしまうので、金属には別の閾値を持たせる
export const METAL_LAYER = 3;
export const METAL_BLOOM = {
  pass: { value: 0 },                       // 1 = ブルームの素材として描いている（renderFrame が切り替える）
  depth: { value: null }, res: { value: new THREE.Vector2(1, 1) },   // 本編の深度で隠れた画素を捨てる
  thr: { value: 0.35 },                     // 金属だけのブルーム閾値（実効値）。main.js が「レンズ欄の閾値 × 割合」で入れる。下げるほど乗りやすい
};
/**
 * 金属の見え方をまとめて変える（左メニューの「金属のツヤ」スライダー、1〜3）。
 * root 以下の金属マテリアル（userData.metalBase を持つもの）に適用し、
 * 以降に作られるパーツにも同じ値が乗るようモジュールの現在値を更新する。
 * ハイライトの鋭さ（shininess）は楽器ごとの固定値（METAL_PARTS）で、スライダーは廃止（2026-09-23 ユーザー指定）
 */
export function setMetalThreshold(thr) {
  METAL_BLOOM.thr.value = thr;              // 閾値は全マテリアル共有のユニフォーム（天気と同じ作り）なのでシーンの走査は要らない
}
function applyMetal(obj, shininess) {
  if (PART_STYLE !== 'voxel' || !obj) return obj;  // 2D の板（テクスチャ付き）には掛けない
  obj.traverse((m) => {
    if (!m.isMesh || !m.material || m.material.map || m.material.isMeshPhongMaterial) return;
    const old = m.material;
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess });
    mat.specular.setRGB(METAL_SPEC, METAL_SPEC, METAL_SPEC);
    // 差し替えで消えてはいけない設定を引き継ぐ。makePart の後から各パーツが付けているものがある。
    // 2026-09-23：トロンボーンの外管の polygonOffset（内管と面がぴったり重なるので手前へずらして
    // z-fighting を防いでいる）が消え、金色のスライドから内管の白がちらついて見えた
    for (const k of ['polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
                     'transparent', 'opacity', 'alphaTest', 'depthTest', 'depthWrite', 'side', 'blending', 'toneMapped']) mat[k] = old[k];
    mat.userData.metalBase = shininess;            // 金属マテリアルの目印（楽器ごとのハイライトの鋭さ）
    mat.onBeforeCompile = metalShader;
    m.material = mat;
    old.dispose();
    m.userData.baseColor = mat.color.clone();      // フラッシュの対象の目印（makePart と同じ）
    m.layers.enable(METAL_LAYER);                  // 本編（0）に加えて、ブルーム用の描画でも拾う
  });
  return obj;
}
// 楽器ごとの艶（shininess）。大きいほどハイライトが小さく鋭い。銀（フルート）を一番鋭く、太鼓の金具を一番鈍く。
// ボクセルは面が平らなので、ハイライトは面ごとに一様に乗る（＝ドット絵の 2 階調の金属表現に近い見え方になる）
const METAL_SHINE = { flute: 40, piccolo: 40, trumpet: 28, horn: 26, trombone: 28, tuba: 24, cymbal: 20, hihat: 20, suscymbal: 20, tubularbells: 28, timpani: 16 };
const METAL_SHINE_DEFAULT = 26;
// **全ての楽器**に掛ける（2026-09-23 ユーザー指定）。金属かどうかは頂点色で決まる（metalOf）ので、
// 木や革が主体の楽器でも、スタンドの銀・ラグ・共鳴管の真鍮だけが光る。銅鑼の木の枠も自動で除かれる
for (const k of Object.keys(INSTRUMENT)) {
  const base = INSTRUMENT[k];
  const shine = METAL_SHINE[k] ?? METAL_SHINE_DEFAULT;
  INSTRUMENT[k] = () => applyMetal(base(), shine);
}

/**
 * パート名ラベル（ドット風の小さな文字板）。常にカメラを向く Sprite。
 * 小さなキャンバスに描いて最近傍拡大するので文字もドット絵風になる。
 */
export const LABEL_FONT = 'DotGothic16'; // ドットフォント（Google Fonts。index.html で読み込み）
export function nameLabel(text, color = '#ffffff', size = 1, outline = 3) {
  const SS = 3;                                    // 高解像度で描いて縮小（縁取りを滑らかに）
  const fontPx = 12 * SS;
  const font = `${fontPx}px "${LABEL_FONT}", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width);
  const pad = (5 + outline) * SS;                  // 余白（白縁のぶん広げる）
  const w = Math.min(220 * SS, tw + pad * 2), h = (16 + 2 * outline) * SS;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font; g.textBaseline = 'middle';
  // 文字をトラック色で塗る（色マークは廃止。2026-09-11 ユーザー指定）。
  // 縁取りは外側から 白 → 黒 の二重（2026-09-13 ユーザー指定）。太い方から先に描いて内側を上書きする
  g.lineJoin = 'round';
  // 白は黒より十分太くする。差が小さいと縮小時に黒と混ざって灰色に見える（2026-09-13 ユーザー指摘）。
  // outline は「見える白の帯の太さ [px]」。黒 3px の外側へ左右それぞれ outline だけ出す
  if (outline > 0) {
    g.lineWidth = (3 + outline * 2) * SS; g.strokeStyle = '#ffffff';
    g.strokeText(text, pad, h / 2 + SS * 0.5, w - pad * 2);
  }
  g.lineWidth = 3 * SS; g.strokeStyle = 'rgba(0,0,0,0.95)';
  g.strokeText(text, pad, h / 2 + SS * 0.5, w - pad * 2);
  g.fillStyle = color;
  g.fillText(text, pad, h / 2 + SS * 0.5, w - pad * 2);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  // 手前に奏者や楽器がある時は隠れるように、奥行きを見る（2026-09-13 ユーザー指定）。
  // ただし自分は深度を書かない（透明な余白が後ろのものを消さないように）
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
  sp.scale.set((w / SS) * 0.032 * size, (h / SS) * 0.032 * size, 1); // 1px ≒ 0.032 unit ×「パート名」の大きさ（2026-09-12）
  sp.renderOrder = 10;
  return sp;
}

// ---------------- 足元の光 ----------------
// 全奏者で 1 枚の放射状グラデーションのテクスチャを共有し、ぼかしスライダーで描き直す（色はマテリアル側）
const GLOW_TEX_SIZE = 128;
let glowCanvas = null, glowTex = null, glowSoftness = 0.6;
function drawGlow() {
  if (!glowCanvas) glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = GLOW_TEX_SIZE;
  const g = glowCanvas.getContext('2d');
  const img = g.createImageData(GLOW_TEX_SIZE, GLOW_TEX_SIZE);
  const c = GLOW_TEX_SIZE / 2, R = c - 1;
  const inner = R * (1 - glowSoftness); // ここまでは全開、ここから外へ向けてなめらかに消える
  for (let y = 0; y < GLOW_TEX_SIZE; y++) for (let x = 0; x < GLOW_TEX_SIZE; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    let a = 1;
    if (d >= R) a = 0;
    else if (d > inner) { const p = (d - inner) / Math.max(1e-6, R - inner); a = 1 - p * p * (3 - 2 * p); } // smoothstep
    const i = (y * GLOW_TEX_SIZE + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
}
/** ぼかし（0 = 輪郭くっきり … 1 = 中心から外へ全体がグラデーション） */
export function setGlowSoftness(v) {
  const s = Math.max(0, Math.min(1, v));
  if (glowTex && Math.abs(s - glowSoftness) < 1e-6) return;
  glowSoftness = s;
  drawGlow();
  if (glowTex) glowTex.needsUpdate = true;
}
function getGlowTexture() {
  if (!glowTex) {
    drawGlow();
    glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.minFilter = THREE.LinearFilter; glowTex.magFilter = THREE.LinearFilter; // 光はドットにしない
    glowTex.generateMipmaps = false;
  }
  return glowTex;
}
/** 足元の光（トラック色）。AdditiveBlending・opacity は baseOpacity × エネルギー × 濃度で制御 */
export function glowDisc(color) {
  const geo = new THREE.PlaneGeometry(2.6, 2.6);
  const mat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.userData.baseOpacity = mat.opacity;
  return m;
}
