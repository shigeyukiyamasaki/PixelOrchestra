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
 */
export function makePart(w, h, pivotX, pivotY, draw, opts = {}) {
  const res = opts.res ?? 1;
  if (PART_STYLE === 'sprite') return makePartSprite(w, h, pivotX, pivotY, draw, res);
  const depth = opts.depth ?? 2, z0 = opts.z0 ?? 0;
  const key = opts.key || `${draw.toString()}|${(opts.side || '').toString()}|${w},${h},${pivotX},${pivotY},${depth},${z0},${res}|${opts.accent || ''}`;
  let geo = partCache.get(key);
  if (!geo) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    draw(new Pen(g));
    let sideImg = null;
    if (opts.side) {
      const sc = document.createElement('canvas');
      sc.width = depth; sc.height = h;
      const sg = sc.getContext('2d');
      opts.side(new Pen(sg));
      sideImg = sg.getImageData(0, 0, depth, h);
    }
    // グリッド単位 → ボクセル単位（res:1 は 2 倍に拡大）
    const cell = res === 1 ? PX : VOX;
    geo = voxelize(g.getImageData(0, 0, w, h), w, h, pivotX, pivotY, depth, z0, opts.back || null, cell, sideImg);
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
  const cell = res === 1 ? PX : VOX;
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
function voxelize(img, w, h, pivotX, pivotY, depth, z0, back, cell = PX, sideImg = null) {
  const d = img.data;
  const filledFront = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const sd = sideImg ? sideImg.data : null;
  const filledSide = (z, y) => !sd || (z >= 0 && z < depth && y >= 0 && y < h && sd[(y * depth + z) * 4 + 3] > 127);
  // 3 次元の占有：正面図 AND 側面図。z は 0..depth-1（0 = 背面側）
  const filled = (x, y, z) => filledFront(x, y) && filledSide(z, y);
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
/** 前腕＋手 5×10、pivot = 肘（上端中央） */
export function foreArm() {
  return makePart(5, 10, 2, 1, (d) => { d.r(1, 0, 3, 6, C.coat); d.r(1, 6, 3, 4, C.skin); }, { depth: 3, z0: -1.5 });
}

/** 腕 5×16、pivot = 肩（上端中央）。垂らした状態で描く */
export function arm() {
  return makePart(5, 16, 2, 1, (d) => {
    d.r(1, 0, 3, 12, C.coat);
    d.r(1, 12, 3, 4, C.skin);
  });
}

// ---------------- 楽器の側面図（形だけ。色は正面図の行の色が使われる）----------------
// キャンバスは 幅 = 奥行き（左が背面・右が正面）、高さ = 正面図と同じ
const F = '#000';
const SIDE = {
  cello:      (d) => { d.r(2, 0, 2, 7, F); d.r(1, 6, 4, 3, F); d.r(0, 9, 6, 15, F); d.r(1, 24, 4, 2, F); d.r(3, 26, 1, 4, F); },
  contrabass: (d) => { d.r(3, 0, 2, 9, F); d.r(1, 8, 6, 4, F); d.r(0, 12, 8, 20, F); d.r(1, 32, 6, 2, F); d.r(4, 34, 1, 4, F); },
  timpani:    (d) => { d.r(0, 0, 16, 3, F); d.r(1, 3, 14, 6, F); d.r(3, 9, 10, 3, F); d.r(5, 12, 6, 2, F); d.r(6, 14, 4, 2, F); }, // 椀型
  bassdrum:   (d) => { d.r(0, 0, 8, 26, F); d.r(3, 24, 2, 6, F); },                                      // 薄い円筒＋スタンド
  snare:      (d) => { d.r(0, 0, 12, 8, F); d.r(5, 8, 2, 2, F); },
  cymbal:     (d) => { d.r(7, 0, 4, 1, F); d.r(1, 1, 16, 2, F); d.r(7, 3, 4, 1, F); },                     // 円盤（奥行き方向に丸い）
  xylophone:  (d) => { d.r(0, 3, 10, 7, F); d.r(0, 9, 10, 2, F); d.r(4, 10, 2, 4, F); },
  marimba:    (d) => { d.r(0, 2, 12, 10, F); d.r(3, 12, 6, 5, F); d.r(5, 14, 2, 4, F); },
  piano:      (d) => { d.r(0, 0, 22, 4, F); d.r(0, 4, 30, 10, F); d.r(25, 14, 5, 4, F); d.r(1, 18, 2, 8, F); d.r(27, 18, 2, 8, F); }, // 蓋は後方、鍵盤は前
  celesta:    (d) => { d.r(0, 0, 8, 26, F); d.r(7, 13, 3, 5, F); d.r(1, 26, 2, 4, F); d.r(5, 26, 2, 4, F); },
  harp:       (d) => { d.r(2, 0, 2, 26, F); d.r(0, 26, 6, 10, F); },                                       // 弦・柱は薄く、共鳴胴だけ厚い
  horn:       (d) => { d.r(2, 0, 4, 2, F); d.r(0, 2, 8, 10, F); d.r(2, 12, 4, 2, F); },                     // 丸いベル
  tuba:       (d) => { d.r(0, 0, 10, 6, F); d.r(1, 6, 8, 16, F); },
};

// ---------------- 楽器パーツ ----------------
// それぞれ [mesh] を返す。pivot は「体に取り付ける点」または「手に持つ点」。

export const INSTRUMENT = {
  violin: () => makePart(14, 8, 7, 4, (d) => {
    d.r(3, 1, 6, 6, C.wood); d.r(2, 2, 8, 4, C.wood); d.r(1, 3, 2, 2, C.wood);
    d.r(9, 3, 5, 1, C.wood2); d.p(13, 2, C.wood2);
    d.r(4, 3, 5, 1, C.black);
  }),
  viola: () => makePart(16, 9, 8, 4, (d) => {
    d.r(3, 1, 7, 7, C.wood2); d.r(2, 2, 9, 5, C.wood2); d.r(1, 3, 2, 3, C.wood2);
    d.r(10, 4, 6, 1, C.wood); d.p(15, 3, C.wood);
    d.r(4, 4, 6, 1, C.black);
  }),
  cello: () => makePart(12, 30, 6, 30, (d) => {
    d.r(5, 0, 2, 7, C.wood2); d.r(4, 0, 4, 2, C.wood2);   // ネック・渦巻き
    d.r(3, 6, 6, 20, C.wood); d.r(1, 9, 10, 6, C.wood); d.r(1, 18, 10, 8, C.wood);
    d.r(5, 7, 2, 18, C.black);                            // 弦
    d.r(5, 26, 2, 4, C.silver);                           // エンドピン
  }, { depth: 6, side: SIDE.cello }),
  contrabass: () => makePart(14, 38, 7, 38, (d) => {
    d.r(6, 0, 2, 9, C.wood2); d.r(5, 0, 4, 2, C.wood2);
    d.r(3, 8, 8, 26, C.wood2); d.r(1, 11, 12, 8, C.wood2); d.r(1, 22, 12, 12, C.wood2);
    d.r(6, 9, 2, 24, C.black);
    d.r(6, 34, 2, 4, C.silver);
  }, { depth: 8, side: SIDE.contrabass }),
  bow: () => makePart(20, 2, 1, 1, (d) => { d.r(0, 0, 20, 1, C.wood2); d.r(1, 1, 18, 1, C.ivory); }),

  flute: () => makePart(20, 3, 1, 1, (d) => { d.r(0, 0, 20, 2, C.silver); for (let x = 6; x < 18; x += 3) d.p(x, 2, C.silver2); }),
  clarinet: () => makePart(4, 20, 2, 0, (d) => { d.r(1, 0, 2, 18, C.black); d.r(0, 17, 4, 3, C.black); for (let y = 4; y < 15; y += 3) d.p(3, y, C.silver); }, { depth: 3 }),
  oboe: () => makePart(4, 20, 2, 0, (d) => { d.r(1, 0, 2, 18, C.wood2); d.r(0, 17, 4, 3, C.wood2); for (let y = 4; y < 15; y += 3) d.p(3, y, C.silver); }, { depth: 3 }),
  bassoon: () => makePart(5, 34, 2, 34, (d) => { d.r(1, 0, 3, 34, C.wood); d.r(0, 0, 5, 3, C.wood2); d.r(3, 3, 2, 8, C.silver); for (let y = 12; y < 30; y += 4) d.p(1, y, C.silver); }, { depth: 4 }),

  trumpet: () => makePart(18, 6, 0, 3, (d) => { d.r(0, 2, 12, 2, C.gold); d.r(5, 0, 1, 2, C.gold2); d.r(7, 0, 1, 2, C.gold2); d.r(9, 0, 1, 2, C.gold2); d.r(12, 1, 4, 4, C.gold); d.r(16, 0, 2, 6, C.gold2); }, { depth: 4 }),
  horn: () => makePart(14, 14, 7, 7, (d) => { d.ring(6, 6, 5, C.gold); d.r(9, 8, 5, 6, C.gold); d.r(12, 7, 2, 7, C.gold2); d.r(2, 2, 2, 2, C.gold2); }, { depth: 8, z0: -2, side: SIDE.horn }),
  trombone: () => makePart(26, 6, 0, 3, (d) => { d.r(0, 2, 20, 2, C.gold); d.r(3, 0, 12, 1, C.gold2); d.r(3, 0, 1, 3, C.gold2); d.r(14, 0, 1, 3, C.gold2); d.r(20, 1, 4, 4, C.gold); d.r(24, 0, 2, 6, C.gold2); }, { depth: 4 }),
  tuba: () => makePart(16, 22, 8, 22, (d) => { d.r(2, 6, 12, 16, C.gold); d.r(4, 0, 10, 6, C.gold); d.r(4, 0, 10, 2, C.gold2); d.r(5, 9, 6, 8, C.gold2); }, { depth: 10, z0: -2, side: SIDE.tuba }),

  timpani: () => makePart(28, 16, 14, 0, (d) => {
    d.r(2, 0, 24, 3, C.head); d.r(1, 3, 26, 6, C.copper); d.r(3, 9, 22, 3, C.copper2); d.r(6, 12, 16, 2, C.copper2);
    d.r(6, 14, 2, 2, C.silver); d.r(20, 14, 2, 2, C.silver);
  }, { depth: 16, side: SIDE.timpani }),
  snare: () => makePart(16, 10, 8, 0, (d) => { d.r(2, 0, 12, 2, C.head); d.r(1, 2, 14, 6, C.silver); d.r(1, 4, 14, 1, C.silver2); d.r(6, 8, 1, 2, C.silver2); d.r(9, 8, 1, 2, C.silver2); }, { depth: 12, side: SIDE.snare }),
  cymbal: () => makePart(18, 4, 9, 0, (d) => { d.r(0, 1, 18, 2, C.gold); d.r(7, 0, 4, 1, C.gold2); d.r(8, 3, 2, 1, C.silver2); }, { depth: 18, z0: -9, side: SIDE.cymbal }),
  mallet: () => makePart(3, 14, 1, 0, (d) => { d.r(1, 0, 1, 10, C.wood2); d.r(0, 10, 3, 4, C.ivory); }),
  bigmallet: () => makePart(5, 16, 2, 0, (d) => { d.r(2, 0, 1, 10, C.wood2); d.disc(2, 12, 2, C.ivory); }),
  // シロフォン：明るい木の音板が左（長）→右（短）に並ぶ。pivot = 底中央
  xylophone: () => makePart(28, 14, 14, 14, (d) => {
    d.r(3, 10, 2, 4, C.silver2); d.r(23, 10, 2, 4, C.silver2);              // 脚
    d.r(1, 9, 26, 2, C.wood2);                                               // フレーム
    for (let i = 0; i < 12; i++) { const h = 8 - Math.floor(i / 3); d.r(2 + i * 2, 9 - h, 1, h, i % 2 ? '#e8c98a' : '#d9b46e'); } // 音板
    d.r(1, 3, 26, 1, C.wood2);
  }, { depth: 10, side: SIDE.xylophone }),
  // マリンバ：濃い紫檀の音板＋下に共鳴管。pivot = 底中央
  marimba: () => makePart(36, 18, 18, 18, (d) => {
    d.r(3, 14, 2, 4, C.silver2); d.r(31, 14, 2, 4, C.silver2);              // 脚
    for (let i = 0; i < 16; i++) { const h = 7 - Math.floor(i / 4); d.r(2 + i * 2, 12, 1, h - 1, C.silver); } // 共鳴管（下向き）
    d.r(1, 11, 34, 2, C.wood2);                                              // フレーム
    for (let i = 0; i < 16; i++) { const h = 9 - Math.floor(i / 4); d.r(2 + i * 2, 11 - h, 1, h, i % 2 ? '#7a3b2e' : '#8f4636'); } // 音板
    d.r(1, 2, 34, 1, C.wood2);
  }, { depth: 12, side: SIDE.marimba }),
  // チェレスタ：小さなアップライト型の鍵盤。奏者はこの後ろに立つ。pivot = 底中央
  celesta: () => makePart(26, 30, 13, 30, (d) => {
    d.r(2, 0, 22, 26, C.wood); d.r(3, 1, 20, 12, C.wood2);                  // 筐体・上部パネル
    d.r(1, 13, 24, 2, C.wood2);                                              // 鍵盤蓋の縁
    d.r(3, 15, 20, 3, C.white); for (let x = 4; x < 22; x += 3) d.p(x, 15, C.black); // 鍵盤
    d.r(3, 18, 20, 1, C.black);
    d.r(3, 26, 2, 4, C.wood2); d.r(21, 26, 2, 4, C.wood2);                   // 脚
    d.r(11, 27, 4, 2, C.gold2);                                              // ペダル
  }, { depth: 10, side: SIDE.celesta }),
  // グランカッサ：正面向きの大太鼓（白い打面・木の胴・スタンド）。pivot = 底中央
  bassdrum: () => makePart(26, 30, 13, 30, (d) => {
    d.r(11, 24, 4, 6, C.silver2); d.r(4, 28, 18, 2, C.silver2);   // スタンド
    d.disc(13, 13, 12, C.wood2);                                    // 胴（外周）
    d.disc(13, 13, 10, C.head);                                     // 打面
    d.ring(13, 13, 10, C.silver);                                   // リム
    for (let a = 0; a < 8; a++) { const x = 13 + Math.round(11 * Math.cos(a * Math.PI / 4)), y = 13 + Math.round(11 * Math.sin(a * Math.PI / 4)); d.p(x, y, C.gold2); } // ラグ
  }, { depth: 8, side: SIDE.bassdrum }),
  stick: () => makePart(3, 14, 1, 0, (d) => { d.r(1, 0, 1, 14, C.wood); }),

  piano: () => makePart(40, 26, 20, 26, (d) => {
    d.r(4, 0, 32, 4, C.black); d.r(6, 1, 28, 1, C.coat2);     // 蓋
    d.r(0, 4, 40, 10, C.black);
    d.r(2, 14, 36, 3, C.white); for (let x = 3; x < 38; x += 3) d.p(x, 14, C.black); // 鍵盤
    d.r(0, 17, 40, 1, C.black);
    d.r(3, 18, 2, 8, C.black); d.r(35, 18, 2, 8, C.black); d.r(19, 18, 2, 8, C.black);
  }, { depth: 30, side: SIDE.piano }),
  harp: () => makePart(22, 36, 11, 36, (d) => {
    d.r(2, 0, 3, 34, C.gold); d.r(1, 0, 4, 2, C.gold2);
    d.line(4, 2, 20, 12, C.gold); d.line(4, 3, 20, 13, C.gold);
    d.r(3, 26, 18, 8, C.wood); d.r(2, 34, 20, 2, C.wood2);
    for (let x = 6; x <= 19; x += 2) { const yt = 3 + Math.round((x - 4) * 0.62); d.r(x, yt, 1, 27 - yt, C.silver); }
  }, { depth: 6, side: SIDE.harp }),
  baton: () => makePart(12, 1, 0, 0, (d) => { d.r(0, 0, 12, 1, C.ivory); }),
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
