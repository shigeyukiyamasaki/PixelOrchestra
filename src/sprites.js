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
  coat: '#1b1b26', coat2: '#2b2b3c', shirt: '#f4f4f4', skin: '#f1c9a5', skin2: '#d9a880',
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
/**
 * opts.res: 描画グリッドの解像度。1 = 基本グリッド（従来の絵。1 ドット = 2×2 ボクセル）、2 = 2 倍解像度（1 ドット = 1 ボクセル）。
 *   w/h/pivot/depth/z0 は res のグリッド単位で指定する（res:2 なら細かい px）。
 * opts.side: 側面図の描画関数（省略可）。指定すると正面図の押し出しと側面図の押し出しの共通部分で立体を削り出す。
 *   側面図のキャンバスは 幅 = depth（奥行き、左が背面 z0）・高さ = h、y は正面図と同じ行。
 * opts.top: 上面図の描画関数（省略可）。幅 = w（x は正面図と同じ列）・高さ = depth（上が背面 z0）。3 面削り出し。
 * opts.carve: (x, y, z) => true で削る（ベルの穴・太鼓の中など、面図では表せない中空用）。x=列, y=行(上が0), z=0..depth-1
 */
export function makePart(w, h, pivotX, pivotY, draw, opts = {}) {
  const res = opts.res ?? 1;
  if (PART_STYLE === 'sprite') return makePartSprite(w, h, pivotX, pivotY, draw, res);
  const depth = opts.depth ?? 2, z0 = opts.z0 ?? 0;
  const key = opts.key || `${draw.toString()}|${(opts.side || '').toString()}|${(opts.top || '').toString()}|${(opts.carve || '').toString()}|${w},${h},${pivotX},${pivotY},${depth},${z0},${res}|${opts.accent || ''}`;
  let geo = partCache.get(key);
  if (!geo) {
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
    // グリッド単位 → 世界サイズ（res:1 は 1 ドット = 2×2 ボクセル、res:2 = 1 ボクセル、res:4 = 半ボクセル）
    const cell = PX / res;
    geo = voxelize(g.getImageData(0, 0, w, h), w, h, pivotX, pivotY, depth, z0, opts.back || null, cell, sideImg, topImg, opts.carve || null);
    partCache.set(key, geo);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.baseColor = mat.color.clone(); // 明滅は baseColor × 倍率で行う（直接代入しない）
  mesh.userData.size = { w, h, depth };
  return mesh;
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
function voxelize(img, w, h, pivotX, pivotY, depth, z0, back, cell = PX, sideImg = null, topImg = null, carve = null) {
  const d = img.data;
  const filledFront = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const sd = sideImg ? sideImg.data : null;
  const filledSide = (z, y) => !sd || (z >= 0 && z < depth && y >= 0 && y < h && sd[(y * depth + z) * 4 + 3] > 127);
  const td = topImg ? topImg.data : null;
  const filledTop = (x, z) => !td || (x >= 0 && x < w && z >= 0 && z < depth && td[(z * w + x) * 4 + 3] > 127);
  // 3 次元の占有：正面図 AND 側面図 AND 上面図。z は 0..depth-1（0 = 背面側）
  const filled = (x, y, z) => filledFront(x, y) && filledSide(z, y) && filledTop(x, z) && !(carve && carve(x, y, z));
  const filledBehind = (x, y, z) => { for (let k = 0; k < z; k++) if (filled(x, y, k)) return true; return false; };
  const colorAt = (x, y) => [d[(y * w + x) * 4] / 255, d[(y * w + x) * 4 + 1] / 255, d[(y * w + x) * 4 + 2] / 255];
  // 背面色の置換：キー色との距離が近ければ置換（hsl→rgb の丸めで 1 ずれることがあるので厳密一致にしない）
  const backEntries = back ? Object.entries(back).map(([k, v]) => { const a = parseInt(k.slice(1), 16), b = parseInt(v.slice(1), 16); return [[(a >> 16) & 255, (a >> 8) & 255, a & 255], [((b >> 16) & 255) / 255, ((b >> 8) & 255) / 255, (b & 255) / 255]]; }) : [];
  const backColor = (x, y) => {
    const i = (y * w + x) * 4;
    for (const [k, v] of backEntries) {
      if (Math.abs(d[i] - k[0]) <= 6 && Math.abs(d[i + 1] - k[1]) <= 6 && Math.abs(d[i + 2] - k[2]) <= 6) return v;
    }
    return colorAt(x, y);
  };
  const pos = [], nor = [], col = [];
  const quad = (a, b, c, e, n, rgb) => { // 4 頂点（反時計回り）→ 2 三角形
    for (const v of [a, b, c, a, c, e]) { pos.push(v[0] * cell, v[1] * cell, v[2] * cell); nor.push(...n); col.push(...rgb); }
  };
  // 正面から見えない奥のボクセルの色：同じ行で一番手前の塗りの色（側面図で削った時の断面色）
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    if (!filledFront(px, py)) continue;
    const rgb = colorAt(px, py), rgbBack = backColor(px, py);
    for (let z = 0; z < depth; z++) {
      if (!filled(px, py, z)) continue;
      const x0 = px - pivotX, x1 = x0 + 1;
      const y1 = pivotY - py, y0 = y1 - 1;
      const zb = z0 + z, zf = zb + 1;
      const front = z === depth - 1 || !filled(px, py, z + 1);
      const backF = z === 0 || !filled(px, py, z - 1);
      const rearmost = backF && !filledBehind(px, py, z);
      if (front) quad([x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf], [0, 0, 1], rgb);                 // 正面（+z）
      if (backF) quad([x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb], [0, 0, -1], rearmost ? rgbBack : rgb); // 背面（-z）：一番奥の面は背面色
      if (!filled(px - 1, py, z)) quad([x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb], [-1, 0, 0], rgb); // 左
      if (!filled(px + 1, py, z)) quad([x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf], [1, 0, 0], rgb);  // 右
      if (!filled(px, py - 1, z)) quad([x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb], [0, 1, 0], rgb);  // 上
      if (!filled(px, py + 1, z)) quad([x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf], [0, -1, 0], rgb); // 下
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
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
/** 座った脚（ボクセル用）：太もも（前へ 10）・すね（下へ 12）・靴。配置は puppet 側 */
export function thigh() { return makePart(3, 3, 1.5, 3, (d) => { d.r(0, 0, 3, 3, C.coat2); }, { depth: 10, z0: 0 }); }
export function shin()  { return makePart(3, 12, 1.5, 12, (d) => { d.r(0, 0, 3, 12, C.coat2); }, { depth: 3, z0: 0 }); }
export function shoe()  { return makePart(4, 2, 2, 2, (d) => { d.r(0, 0, 4, 2, C.shoe); }, { depth: 6, z0: 0 }); }
/** 座った脚（2D 板用・正面図）16×14、pivot = 足元中央 */
export function legsSeatedSprite() {
  return makePart(16, 14, 8, 14, (d) => {
    d.r(3, 0, 4, 2, C.coat2); d.r(9, 0, 4, 2, C.coat2);    // 太もも（手前に短く見える）
    d.r(4, 2, 3, 10, C.coat2); d.r(9, 2, 3, 10, C.coat2);  // すね
    d.r(3, 12, 4, 2, C.shoe); d.r(9, 12, 4, 2, C.shoe);    // 靴
  });
}
/** 椅子 12×25（背もたれ 12・座面 2・脚 11）、pivot = 床の後端中央。奥行き 12：背もたれは後ろ、脚は前後 2 本ずつ */
export function chair() {
  const side = (d) => { d.r(0, 0, 2, 12, F); d.r(0, 12, 12, 2, F); d.r(0, 14, 2, 11, F); d.r(10, 14, 2, 11, F); };
  return makePart(12, 25, 6, 25, (d) => {
    d.r(0, 0, 12, 12, '#4a3020'); d.r(1, 1, 10, 10, '#5a3a26'); // 背もたれ
    d.r(0, 12, 12, 2, '#6a4630');                              // 座面
    d.r(0, 14, 2, 11, '#3a2418'); d.r(10, 14, 2, 11, '#3a2418'); // 脚
  }, { depth: 12, z0: 0, side });
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
export function upperArm() {
  return makePart(5, 9, 2, 1, (d) => { d.r(1, 0, 3, 9, C.coat); }, { depth: 3, z0: -1.5 });
}
/** 肩の球 5×5×5、pivot = 中心。上腕の根元に付けて、肩関節が前へ出た時に胴との隙間を埋める */
export function shoulderPad() {
  return makePart(5, 5, 2, 2, (d) => { d.r(0, 1, 5, 3, C.coat); d.r(1, 0, 3, 5, C.coat); }, { depth: 5, z0: -2.5, side: (d) => { d.r(0, 1, 5, 3, F); d.r(1, 0, 3, 5, F); } });
}
/** 前腕＋手 5×10、pivot = 肘（上端中央） */
export function foreArm() {
  return makePart(5, 10, 2, 1, (d) => { d.r(1, 0, 3, 6, C.coat); d.r(1, 6, 3, 4, C.skin); }, { depth: 3, z0: -1.5 });
}
/** 手首あり版：前腕（袖のみ）5×7、pivot = 肘。手は別パーツ */
export function foreArmNoHand() {
  return makePart(5, 7, 2, 1, (d) => { d.r(1, 0, 3, 7, C.coat); }, { depth: 3, z0: -1.5 });
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
function withScroll(body, scroll, pos, axis = 'x') {
  const g = new THREE.Group();
  scroll.position.set(pos[0] * VOX, pos[1] * VOX, pos[2] * VOX);
  if (axis === 'y') scroll.rotation.z = Math.PI / 2;
  g.add(body, scroll);
  g.userData.size = body.userData.size;
  return g;
}

export const INSTRUMENT = {
  // バイオリン 28×16（2倍解像度）。下部・くびれ・上部のふくらみ、駒（x=10）、指板、渦巻き、あご当て。厚みは薄く中央だけ盛る
  // 胴：ネック＋渦巻き ≒ 6：4（実物の比率）。駒は x=10（基本座標 -2）
  violin: () => withScroll(makePart(28, 16, 14, 8, (d) => {
    d.disc(7, 8, 6, C.wood); d.disc(14, 8, 4, C.wood); d.r(10, 5, 5, 7, C.wood);   // 胴（下部・上部のふくらみ、くびれ）
    d.p(11, 4, null); d.p(11, 12, null); d.p(12, 4, null); d.p(12, 12, null);     // くびれの切れ込み
    d.r(3, 5, 1, 7, '#a0623c'); d.r(13, 6, 1, 5, '#a0623c');                       // 艶
    d.r(5, 5, 1, 2, C.black); d.r(5, 10, 1, 2, C.black); d.r(12, 5, 1, 2, C.black); d.r(12, 10, 1, 2, C.black); // f 字孔
    d.r(2, 7, 4, 2, C.black);                                                       // テールピース
    d.r(8, 7, 14, 2, C.black); d.r(8, 7, 14, 1, '#2a2a30');                         // 指板（ネックの上まで）
    d.r(18, 7, 7, 2, C.wood2);                                                      // ネック（糸巻きは別パーツ）
    d.r(10, 6, 1, 4, C.ivory);                                                      // 駒
    d.r(1, 10, 4, 3, C.black);                                                      // あご当て
  }, { res: 2, depth: 4, z0: -2, side: (d) => { d.r(1, 2, 2, 12, F); d.r(0, 4, 4, 8, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 3), [11, 0, 0]),
  // ヴィオラ 32×18（2倍解像度）：バイオリンより一回り大きく、濃い色。駒は x=12（基本座標 -2）
  viola: () => withScroll(makePart(32, 18, 16, 9, (d) => {
    d.disc(8, 9, 7, C.wood2); d.disc(16, 9, 5, C.wood2); d.r(12, 5, 5, 9, C.wood2);
    d.p(13, 4, null); d.p(13, 14, null); d.p(14, 4, null); d.p(14, 14, null);
    d.r(3, 5, 1, 9, '#8a4a34'); d.r(15, 7, 1, 5, '#8a4a34');
    d.r(6, 6, 1, 2, C.black); d.r(6, 11, 1, 2, C.black); d.r(14, 6, 1, 2, C.black); d.r(14, 11, 1, 2, C.black);
    d.r(2, 8, 5, 2, C.black);
    d.r(10, 8, 16, 2, C.black); d.r(10, 8, 16, 1, '#2a2a30');
    d.r(21, 8, 7, 2, C.wood);                                                       // ネック（糸巻きは別パーツ）
    d.r(12, 7, 1, 4, C.ivory);
    d.r(1, 11, 5, 3, C.black);
  }, { res: 2, depth: 5, z0: -2.5, side: (d) => { d.r(1, 2, 3, 14, F); d.r(0, 4, 5, 10, F); }, back: STRING_BACK(C.wood2) }), scrollPart(C.wood, 3), [12, 0, 0]),
  // チェロ 24×60（2倍解像度）。渦巻き・ネック・上部/下部のふくらみ・くびれ・f 字孔・駒（row 36）・テールピース・エンドピン
  cello: () => withScroll(makePart(24, 60, 12, 60, (d) => {
    d.r(10, 3, 4, 12, C.wood2);                                            // ネック（糸巻きは別パーツ）
    d.disc(12, 17, 7, C.wood); d.r(6, 22, 12, 8, C.wood); d.disc(12, 38, 10, C.wood); // 上部・くびれ・下部
    d.p(6, 22, null); d.p(17, 22, null); d.p(6, 29, null); d.p(17, 29, null);
    d.r(4, 12, 1, 10, '#a0623c'); d.r(3, 30, 1, 14, '#a0623c');             // 艶
    d.r(7, 32, 1, 4, C.black); d.r(16, 32, 1, 4, C.black); d.r(7, 40, 1, 4, C.black); d.r(16, 40, 1, 4, C.black); // f 字孔
    d.r(11, 10, 2, 24, C.black); d.r(11, 10, 1, 24, '#2a2a30');              // 指板
    d.r(9, 36, 6, 1, C.ivory);                                             // 駒
    d.r(11, 37, 2, 10, '#3a3a44'); d.r(10, 46, 4, 6, C.black);              // 弦・テールピース
    d.r(11, 52, 2, 8, C.silver);                                           // エンドピン
  }, { res: 2, depth: 12, z0: 0, side: (d) => { d.r(4, 0, 4, 12, F); d.r(2, 10, 8, 4, F); d.r(0, 14, 12, 34, F); d.r(2, 48, 8, 4, F); d.r(5, 52, 2, 8, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 4), [0, 57, 6], 'y'),
  // コントラバス 28×76（2倍解像度）。渦巻き・ネック・ふくらみ・くびれ・f 字孔・駒（row 38 = 基本 y 19）・エンドピン。立奏用
  contrabass: () => withScroll(makePart(28, 76, 14, 76, (d) => {
    d.r(11, 4, 6, 14, C.wood2);                                            // ネック（糸巻きは別パーツ）
    d.disc(14, 26, 10, C.wood); d.r(7, 32, 14, 10, C.wood); d.disc(14, 50, 13, C.wood); // 上部・くびれ・下部
    d.p(7, 33, null); d.p(20, 33, null); d.p(7, 41, null); d.p(20, 41, null);
    d.r(4, 22, 1, 12, '#a0623c'); d.r(3, 44, 1, 16, '#a0623c');             // 艶
    d.r(8, 42, 1, 6, C.black); d.r(19, 42, 1, 6, C.black); d.r(8, 52, 1, 6, C.black); d.r(19, 52, 1, 6, C.black); // f 字孔
    d.r(13, 12, 3, 30, C.black); d.r(13, 12, 1, 30, '#2a2a30');              // 指板
    d.r(10, 38, 8, 1, C.ivory);                                            // 駒
    d.r(13, 39, 2, 14, '#3a3a44'); d.r(12, 53, 4, 10, C.black);             // 弦・テールピース
    d.r(13, 64, 2, 12, C.silver);                                          // エンドピン
  }, { res: 2, depth: 16, z0: 0, side: (d) => { d.r(6, 4, 4, 14, F); d.r(2, 16, 12, 6, F); d.r(0, 22, 16, 41, F); d.r(7, 64, 2, 12, F); }, back: STRING_BACK(C.wood) }), scrollPart(C.wood2, 5), [0, 72, 8], 'y'),
  // 弓・指揮棒は 2 倍解像度グリッドで細く（断面 1×1 / 0.5×0.5 基本 px）
  bow: () => makePart(40, 2, 2, 1, (d) => { d.r(0, 0, 40, 1, C.wood2); d.r(2, 1, 36, 1, C.ivory); d.r(0, 0, 3, 2, C.black); }, { res: 2, depth: 2, z0: -1 }),

  // ---- 木管（2倍解像度。断面は丸く、ベルは中空）----
  // フルート 40×6：頭部管（歌口）・主管のキー・足部管。断面は丸
  flute: () => makePart(40, 6, 2, 2, (d) => {
    d.r(0, 1, 40, 4, C.silver); d.r(0, 1, 10, 4, C.silver2); d.r(36, 1, 4, 4, C.silver2); // 主管・頭部管・足部管
    d.r(5, 1, 3, 2, '#b8c0c8'); d.p(6, 2, C.black);                                        // リッププレート・歌口
    for (let x = 14; x < 36; x += 4) { d.r(x, 0, 3, 1, C.silver2); d.r(x, 5, 3, 1, C.silver2); } // キー
    d.r(12, 2, 26, 1, '#eef2f6');                                                           // ハイライト
  }, { res: 2, depth: 4, z0: -2, side: (d) => { d.r(0, 1, 4, 4, F); d.r(1, 0, 2, 6, F); }, top: (d) => { d.r(0, 0, 40, 4, F); } }),
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
    d.r(26, 5, 8, 1, '#f3d27a');                                            // ハイライト
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
    d.r(17, 18, 8, 1, '#f3d27a');
  }, { res: 2, depth: 16, z0: -4,
       side: (d) => { d.r(6, 4, 4, 22, F); d.disc(8, 19, 8, F); },
       top: (d) => { d.r(0, 6, 20, 4, F); d.r(16, 5, 4, 6, F); d.r(20, 3, 3, 10, F); d.r(23, 1, 3, 14, F); d.r(26, 0, 2, 16, F); },
       carve: (x, y, z) => { if (x < 20) return false; const R = x >= 26 ? 9 : x >= 23 ? 7 : 5; const r = R - 1.5; const dy = y - 19, dz = z - 7.5; return dy * dy + dz * dz < r * r; } }),
  // トロンボーン：本物の構造どおり 3 パーツ（2026-09-10 ユーザー指摘を反映：管は左肩の上を通って後方まで伸び、そこで U ターンしてベルへ。ベルは口の高さ）。
  //   スライド部（本体）：マウスピース → 上の内管 → 先端 → 下の内管（戻り）。pivot = マウスピース、rows 12-19
  //   ベル部：下の内管の端から横管で左へ 7.5px（頭の横）→ ネックパイプが後方（左肩の上）へ → 後端で U ターンして上へ → ベル管が前へ → ベル。
  //          ベル管は口より 1.25px 上、ベルの中心は口のすぐ上（縁はあご〜眉）。絵の x=14 がマウスピース（x<14 は後方）
  //   外管：別パーツで音程に応じて +x へ動く
  trombone: () => {
    const body = makePart(34, 20, 0, 13, (d) => {
      d.r(0, 12, 3, 2, C.silver);                                                             // マウスピース
      d.r(3, 13, 28, 1, C.gold2); d.r(3, 17, 28, 1, C.gold2);                                 // 内管（上・下。外管が伸びると露出）
      d.r(2, 16, 2, 2, C.gold);                                                               // 下の内管の端（横管への口）
    }, { res: 2, depth: 12, z0: -6, side: (d) => { d.r(4, 0, 4, 20, F); }, top: (d) => { d.r(0, 5, 32, 2, F); } });
    const bell = makePart(48, 20, 14, 13, (d) => {
      d.r(0, 16, 18, 2, C.gold);                                                              // ネックパイプ（後方へ）＋横管の端（x 16-17）
      d.r(0, 11, 2, 7, C.gold);                                                               // U ターン（後端で上へ）
      d.r(0, 11, 33, 2, C.gold);                                                              // ベル管（前へ）
      d.r(32, 10, 3, 4, C.gold); d.r(35, 9, 3, 6, C.gold); d.r(38, 8, 3, 8, C.gold); d.r(41, 6, 3, 12, C.gold); d.r(44, 6, 2, 12, C.gold2); // ベル（rows 6-17）
      d.r(16, 11, 16, 1, '#f3d27a');
    }, { res: 2, depth: 24, z0: -18,
         side: (d) => { d.disc(18, 11, 6, F); d.r(17, 11, 2, 7, F); d.r(0, 16, 24, 2, F); },
         top: (d) => {
           d.r(0, 17, 33, 2, F); d.r(16, 5, 2, 14, F);                                         // ネックパイプ・U ターン・ベル管（z 17-18）／横管（x 16-17, z 5-18）
           d.r(32, 16, 3, 4, F); d.r(35, 15, 3, 6, F); d.r(38, 13, 3, 10, F); d.r(41, 12, 5, 12, F); // ベル（中心 z 17.5）
         },
         carve: (x, y, z) => {
           if (x >= 16 && x < 18) return !((z >= 17 && z <= 18) || (y >= 16 && y <= 17));      // 横管の列：z 17-18 の管と rows 16-17 の横管だけ残す
           if (x < 34) return false;
           const R = x >= 41 ? 6 : x >= 38 ? 4 : x >= 35 ? 3 : 2; const r = R - 1.2; const dy = y - 11.5, dz = z - 17.5; return dy * dy + dz * dz < r * r; // ベルの穴
         } });
    bell.position.set(0, 0, 12 * VOX); // 絵の z=17.5 が取り付け後に奏者の左 7.5px（頭の横）になる位置
    body.add(bell);
    // 外管 26×9（rows 11-19 に相当）：上下 2 本の管・先端の U 字・支柱。pivot = 左端・マウスピースの行（本体の x=6 に置く）
    const slide = makePart(26, 9, 0, 2, (d) => {
      d.r(0, 0, 24, 2, C.gold); d.r(0, 7, 24, 2, C.gold); d.r(22, 0, 3, 9, C.gold); d.r(24, 1, 1, 7, C.gold2); // 管・U 字
      d.r(1, 0, 1, 9, C.silver);                                                                // 支柱
    }, { res: 2, depth: 4, z0: -2 });
    slide.position.set(6 * VOX, 0, 0);
    slide.userData.baseX = 6 * VOX;
    body.add(slide);
    body.userData.slide = slide;
    return body;
  },
  // チューバ 32×44：上に開く大きなベル（中空）・巻いた胴・ピストン 4 本・左へ出るマウスパイプ。pivot = 底中央
  tuba: () => makePart(32, 44, 16, 44, (d) => {
    d.r(4, 0, 24, 2, C.gold2); d.r(5, 2, 22, 4, C.gold); d.r(8, 6, 16, 4, C.gold); d.r(10, 10, 12, 4, C.gold); // ベル（上向き）・喉
    d.r(6, 14, 20, 2, C.gold); d.r(4, 16, 24, 24, C.gold); d.r(6, 40, 20, 2, C.gold); d.r(8, 42, 16, 2, C.gold2); // 胴（丸み）
    d.r(6, 22, 20, 1, C.gold2); d.r(6, 31, 20, 1, C.gold2);                                 // 管の継ぎ目
    d.r(11, 18, 10, 12, C.gold2); for (let x = 10; x <= 19; x += 3) d.r(x, 16, 2, 2, C.silver); // ピストンとボタン
    d.r(3, 25, 8, 2, C.gold); d.r(0, 24, 3, 3, C.silver);                                   // マウスパイプ・マウスピース
    d.r(6, 18, 1, 20, '#f3d27a');
  }, { res: 2, depth: 20, z0: -4,
       side: (d) => { d.r(2, 0, 16, 2, F); d.r(3, 2, 14, 4, F); d.r(5, 6, 10, 4, F); d.r(6, 10, 8, 4, F); d.r(2, 14, 16, 28, F); d.r(4, 42, 12, 2, F); },
       top: (d) => { d.disc(16, 10, 12, F); d.r(4, 4, 24, 12, F); d.r(0, 6, 6, 6, F); },
       carve: (x, y, z) => { if (y > 10) return false; const R = y < 2 ? 11 : y < 6 ? 10 : 7; const r = R - 1.5; const dx = x - 15.5, dz = z - 9.5; return dx * dx + dz * dz < r * r; } }),

  // ---- 打楽器（2倍解像度。太鼓・シンバルは上から見て丸い）----
  // ティンパニ 56×32：皮・フープ・銅の椀・脚・ペダル。pivot = 皮の中央
  timpani: () => makePart(56, 32, 28, 0, (d) => {
    d.r(4, 0, 48, 4, C.head); d.r(2, 4, 52, 2, C.silver);                                   // 皮・フープ
    d.r(2, 6, 52, 8, C.copper); d.r(5, 14, 46, 6, C.copper); d.r(10, 20, 36, 4, C.copper2); d.r(18, 24, 20, 3, C.copper2); // 椀
    d.r(8, 8, 3, 10, '#d08c50');                                                            // 艶
    d.r(10, 26, 3, 6, C.silver2); d.r(43, 26, 3, 6, C.silver2); d.r(26, 27, 4, 5, C.silver2); // 脚
    d.r(24, 30, 8, 2, C.black);                                                             // ペダル
  }, { res: 2, depth: 56, z0: 0,
       side: (d) => { d.r(4, 0, 48, 4, F); d.r(2, 4, 52, 2, F); d.r(2, 6, 52, 8, F); d.r(5, 14, 46, 6, F); d.r(10, 20, 36, 4, F); d.r(18, 24, 20, 3, F); d.r(10, 26, 3, 6, F); d.r(43, 26, 3, 6, F); d.r(26, 27, 4, 5, F); },
       top: (d) => { d.disc(28, 28, 27, F); } }),
  // スネア 32×20：皮・フープ・クロームの胴とラグ・脚
  snare: () => makePart(32, 20, 16, 0, (d) => {
    d.r(4, 0, 24, 3, C.head); d.r(2, 3, 28, 2, C.silver);
    d.r(3, 5, 26, 10, C.silver); for (let x = 5; x < 30; x += 7) d.r(x, 6, 2, 8, C.silver2); // 胴・ラグ
    d.r(2, 15, 28, 2, C.silver);
    d.r(10, 17, 2, 3, C.silver2); d.r(20, 17, 2, 3, C.silver2); d.r(15, 17, 2, 3, C.silver2);
  }, { res: 2, depth: 32, z0: 0,
       side: (d) => { d.r(4, 0, 24, 3, F); d.r(2, 3, 28, 2, F); d.r(3, 5, 26, 10, F); d.r(2, 15, 28, 2, F); d.r(10, 17, 2, 3, F); d.r(20, 17, 2, 3, F); },
       top: (d) => { d.disc(16, 16, 15, F); } }),
  // シンバル 36×8：カップ・薄い円盤（上から見て丸い）・スタンド
  cymbal: () => makePart(36, 8, 18, 0, (d) => { d.r(14, 0, 8, 1, C.gold2); d.r(12, 1, 12, 1, C.gold); d.r(0, 2, 36, 3, C.gold); d.r(2, 4, 32, 1, C.gold2); d.r(17, 5, 2, 3, C.silver2); },
    { res: 2, depth: 36, z0: -18, side: (d) => { d.r(14, 0, 8, 1, F); d.r(12, 1, 12, 1, F); d.r(0, 2, 36, 3, F); d.r(17, 5, 2, 3, F); }, top: (d) => { d.disc(18, 18, 17, F); } }),
  // マレット類（2倍解像度。頭は球）
  mallet: () => makePart(6, 28, 3, 0, (d) => { d.r(2, 0, 2, 21, C.wood2); d.disc(3, 24, 3, C.ivory); },
    { res: 2, depth: 6, z0: -3, side: (d) => { d.r(2, 0, 2, 21, F); d.disc(3, 24, 3, F); }, top: (d) => { d.disc(3, 3, 3, F); } }),
  bigmallet: () => makePart(10, 32, 5, 0, (d) => { d.r(4, 0, 2, 22, C.wood2); d.disc(5, 27, 5, C.white); d.r(3, 24, 1, 4, '#e6e6e6'); },
    { res: 2, depth: 10, z0: -5, side: (d) => { d.r(4, 0, 2, 22, F); d.disc(5, 27, 5, F); }, top: (d) => { d.disc(5, 5, 5, F); } }),
  stick: () => makePart(6, 28, 3, 0, (d) => { d.r(2, 0, 2, 26, C.wood); d.r(2, 26, 2, 2, '#c9a06a'); }, { res: 2, depth: 2, z0: -1 }),
  // シロフォン 56×28：明るい木の音板 16 枚（左が長い）・フレーム・脚。pivot = 底中央
  xylophone: () => makePart(56, 28, 28, 28, (d) => {
    d.r(6, 20, 4, 8, C.silver2); d.r(46, 20, 4, 8, C.silver2);                             // 脚
    d.r(2, 18, 52, 3, C.wood2);                                                             // フレーム
    for (let i = 0; i < 16; i++) { const h = 14 - Math.floor(i / 2); d.r(4 + i * 3, 18 - h, 2, h, i % 2 ? '#e8c98a' : '#d9b46e'); } // 音板
  }, { res: 2, depth: 20, z0: 0, side: (d) => { d.r(2, 4, 16, 14, F); d.r(0, 18, 20, 3, F); d.r(4, 21, 4, 7, F); d.r(12, 21, 4, 7, F); }, top: (d) => { d.r(2, 0, 52, 20, F); } }),
  // マリンバ 72×36：紫檀の音板 22 枚・下に共鳴管・フレーム・脚。pivot = 底中央
  marimba: () => makePart(72, 36, 36, 36, (d) => {
    d.r(6, 28, 4, 8, C.silver2); d.r(62, 28, 4, 8, C.silver2);                             // 脚
    for (let i = 0; i < 22; i++) { const len = 12 - Math.floor(i * 7 / 21); d.r(4 + i * 3, 23, 2, len, C.silver); } // 共鳴管
    d.r(2, 20, 68, 3, C.wood2);                                                             // フレーム
    for (let i = 0; i < 22; i++) { const h = 18 - Math.floor(i * 10 / 21); d.r(4 + i * 3, 20 - h, 2, h, i % 2 ? '#7a3b2e' : '#8f4636'); } // 音板
  }, { res: 2, depth: 24, z0: 0, side: (d) => { d.r(2, 2, 20, 18, F); d.r(0, 20, 24, 3, F); d.r(4, 23, 16, 12, F); d.r(4, 28, 4, 8, F); d.r(16, 28, 4, 8, F); }, top: (d) => { d.r(2, 0, 68, 24, F); } }),
  // グランカッサ 52×60：正面向きの大太鼓（白い皮・木の胴・フープ・ラグ・スタンド）。pivot = 底中央
  bassdrum: () => makePart(52, 60, 26, 60, (d) => {
    d.r(22, 48, 8, 12, C.silver2); d.r(8, 56, 36, 4, C.silver2);                            // スタンド
    d.disc(26, 26, 25, C.wood2);                                                            // 胴
    d.disc(26, 26, 21, C.head); d.ring(26, 26, 12, '#e4dcc8');                              // 皮
    d.ring(26, 26, 22, C.silver); d.ring(26, 26, 23, C.silver);                             // フープ
    for (let a = 0; a < 10; a++) { const x = 26 + Math.round(24 * Math.cos(a * Math.PI / 5)), y = 26 + Math.round(24 * Math.sin(a * Math.PI / 5)); d.r(x - 1, y - 1, 2, 2, C.gold2); } // ラグ
  }, { res: 2, depth: 16, z0: 0, side: (d) => { d.r(0, 1, 16, 50, F); d.r(6, 48, 4, 12, F); d.r(2, 56, 12, 4, F); } }),

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
  baton: () => makePart(24, 1, 0, 0, (d) => { d.r(0, 0, 24, 1, C.ivory); d.r(0, 0, 4, 1, C.black); }, { res: 2, depth: 1, z0: -0.5 }),
};

/**
 * パート名ラベル（ドット風の小さな文字板）。常にカメラを向く Sprite。
 * 小さなキャンバスに描いて最近傍拡大するので文字もドット絵風になる。
 */
export const LABEL_FONT = 'DotGothic16'; // ドットフォント（Google Fonts。index.html で読み込み）
export function nameLabel(text, color = '#ffffff') {
  const SS = 3;                                    // 高解像度で描いて縮小（縁取りを滑らかに）
  const fontPx = 12 * SS;
  const font = `${fontPx}px "${LABEL_FONT}", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width);
  const pad = 4 * SS, mark = 3 * SS;               // 余白・左端のトラック色マーク
  const w = Math.min(220 * SS, tw + pad * 2 + mark + 2 * SS), h = 18 * SS;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillRect(pad, h / 2 - mark, mark, mark * 2);            // トラック色の小さな四角
  g.lineJoin = 'round'; g.lineWidth = 3 * SS; g.strokeStyle = 'rgba(0,0,0,0.95)'; // 黒縁取り
  g.strokeText(text, pad + mark + 2 * SS, h / 2 + SS * 0.5, w - pad * 2 - mark);
  g.fillStyle = '#f4f4f4';
  g.fillText(text, pad + mark + 2 * SS, h / 2 + SS * 0.5, w - pad * 2 - mark);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set((w / SS) * 0.032, (h / SS) * 0.032, 1); // 1px ≒ 0.032 unit（以前の 0.045 より小さく）
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
