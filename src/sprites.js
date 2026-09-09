/*
 * PixelOrchestra — sprites.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * プログラム生成の「仮ドット絵」。本番の絵に差し替える時はここの draw 関数を
 * 画像読み込み（同じ pivot 指定）に置き換えればよい。
 * 座標系：キャンバス左上原点・y 下向き（px）。pivot はそのピクセル座標で指定する。
 */

export const PX = 0.075; // 1ピクセル = 0.075 world unit（34px の体 ≒ 2.55 unit。画面上で絵柄が読める大きさ優先）

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
  p(x, y, col) { this.r(x, y, 1, 1, col); }
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
 * ドット絵パーツを Three.js のメッシュとして生成する。
 * pivot（回転の中心）がメッシュのローカル原点に来るようジオメトリを平行移動する。
 */
export function makePart(w, h, pivotX, pivotY, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(new Pen(g));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;   // ドット絵は最近傍補間（TOOL_CRAFT_MEDIA §1-3）
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const geo = new THREE.PlaneGeometry(w * PX, h * PX);
  geo.translate((w / 2 - pivotX) * PX, (pivotY - h / 2) * PX, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.baseColor = mat.color.clone(); // 明滅は baseColor × 倍率で行う（直接代入しない）
  mesh.userData.size = { w, h };
  return mesh;
}

// ---------------- 人物パーツ ----------------

/** 体（燕尾服・立ち姿）16×34、pivot = 足元中央 */
export function body(accent = '#c03030') {
  return makePart(16, 34, 8, 34, (d) => {
    d.r(6, 5, 4, 3, C.skin);                 // 首
    d.r(3, 8, 10, 13, C.coat);               // 上着
    d.r(2, 9, 1, 8, C.coat2); d.r(13, 9, 1, 8, C.coat2); // 肩の陰
    d.r(6, 8, 4, 8, C.shirt);                // シャツ
    d.r(5, 9, 6, 2, accent);                 // 蝶ネクタイ（トラック色）
    d.r(3, 21, 4, 4, C.coat); d.r(9, 21, 4, 4, C.coat); // 燕尾
    d.r(4, 21, 3, 11, C.coat2); d.r(9, 21, 3, 11, C.coat2); // ズボン
    d.r(3, 32, 4, 2, C.shoe); d.r(9, 32, 4, 2, C.shoe);   // 靴
  });
}

/** 頭 12×12、pivot = 首の付け根中央。back=true で後ろ姿（指揮者用） */
export function head(seed = 0, back = false) {
  const hair = HAIR[seed % HAIR.length];
  return makePart(12, 12, 6, 12, (d) => {
    d.r(2, 3, 8, 9, back ? C.skin2 : C.skin);
    d.r(1, 1, 10, 4, hair);
    d.r(1, 4, 1, 3, hair); d.r(10, 4, 1, 3, hair);
    if (back) { d.r(2, 3, 8, 6, hair); return; }
    d.p(4, 7, C.eye); d.p(8, 7, C.eye);
    d.r(5, 10, 3, 1, C.skin2);
  });
}

/** 腕 5×16、pivot = 肩（上端中央）。垂らした状態で描く */
export function arm() {
  return makePart(5, 16, 2, 1, (d) => {
    d.r(1, 0, 3, 12, C.coat);
    d.r(1, 12, 3, 4, C.skin);
  });
}

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
  }),
  contrabass: () => makePart(14, 38, 7, 38, (d) => {
    d.r(6, 0, 2, 9, C.wood2); d.r(5, 0, 4, 2, C.wood2);
    d.r(3, 8, 8, 26, C.wood2); d.r(1, 11, 12, 8, C.wood2); d.r(1, 22, 12, 12, C.wood2);
    d.r(6, 9, 2, 24, C.black);
    d.r(6, 34, 2, 4, C.silver);
  }),
  bow: () => makePart(20, 2, 1, 1, (d) => { d.r(0, 0, 20, 1, C.wood2); d.r(1, 1, 18, 1, C.ivory); }),

  flute: () => makePart(20, 3, 1, 1, (d) => { d.r(0, 0, 20, 2, C.silver); for (let x = 6; x < 18; x += 3) d.p(x, 2, C.silver2); }),
  clarinet: () => makePart(4, 20, 2, 0, (d) => { d.r(1, 0, 2, 18, C.black); d.r(0, 17, 4, 3, C.black); for (let y = 4; y < 15; y += 3) d.p(3, y, C.silver); }),
  oboe: () => makePart(4, 20, 2, 0, (d) => { d.r(1, 0, 2, 18, C.wood2); d.r(0, 17, 4, 3, C.wood2); for (let y = 4; y < 15; y += 3) d.p(3, y, C.silver); }),
  bassoon: () => makePart(5, 34, 2, 34, (d) => { d.r(1, 0, 3, 34, C.wood); d.r(0, 0, 5, 3, C.wood2); d.r(3, 3, 2, 8, C.silver); for (let y = 12; y < 30; y += 4) d.p(1, y, C.silver); }),

  trumpet: () => makePart(18, 6, 0, 3, (d) => { d.r(0, 2, 12, 2, C.gold); d.r(5, 0, 1, 2, C.gold2); d.r(7, 0, 1, 2, C.gold2); d.r(9, 0, 1, 2, C.gold2); d.r(12, 1, 4, 4, C.gold); d.r(16, 0, 2, 6, C.gold2); }),
  horn: () => makePart(14, 14, 7, 7, (d) => { d.ring(6, 6, 5, C.gold); d.r(9, 8, 5, 6, C.gold); d.r(12, 7, 2, 7, C.gold2); d.r(2, 2, 2, 2, C.gold2); }),
  trombone: () => makePart(26, 6, 0, 3, (d) => { d.r(0, 2, 20, 2, C.gold); d.r(3, 0, 12, 1, C.gold2); d.r(3, 0, 1, 3, C.gold2); d.r(14, 0, 1, 3, C.gold2); d.r(20, 1, 4, 4, C.gold); d.r(24, 0, 2, 6, C.gold2); }),
  tuba: () => makePart(16, 22, 8, 22, (d) => { d.r(2, 6, 12, 16, C.gold); d.r(4, 0, 10, 6, C.gold); d.r(4, 0, 10, 2, C.gold2); d.r(5, 9, 6, 8, C.gold2); }),

  timpani: () => makePart(28, 16, 14, 0, (d) => {
    d.r(2, 0, 24, 3, C.head); d.r(1, 3, 26, 6, C.copper); d.r(3, 9, 22, 3, C.copper2); d.r(6, 12, 16, 2, C.copper2);
    d.r(6, 14, 2, 2, C.silver); d.r(20, 14, 2, 2, C.silver);
  }),
  snare: () => makePart(16, 10, 8, 0, (d) => { d.r(2, 0, 12, 2, C.head); d.r(1, 2, 14, 6, C.silver); d.r(1, 4, 14, 1, C.silver2); d.r(6, 8, 1, 2, C.silver2); d.r(9, 8, 1, 2, C.silver2); }),
  cymbal: () => makePart(18, 4, 9, 0, (d) => { d.r(0, 1, 18, 2, C.gold); d.r(7, 0, 4, 1, C.gold2); d.r(8, 3, 2, 1, C.silver2); }),
  mallet: () => makePart(3, 14, 1, 0, (d) => { d.r(1, 0, 1, 10, C.wood2); d.r(0, 10, 3, 4, C.ivory); }),
  bigmallet: () => makePart(5, 16, 2, 0, (d) => { d.r(2, 0, 1, 10, C.wood2); d.disc(2, 12, 2, C.ivory); }),
  // シロフォン：明るい木の音板が左（長）→右（短）に並ぶ。pivot = 底中央
  xylophone: () => makePart(28, 14, 14, 14, (d) => {
    d.r(3, 10, 2, 4, C.silver2); d.r(23, 10, 2, 4, C.silver2);              // 脚
    d.r(1, 9, 26, 2, C.wood2);                                               // フレーム
    for (let i = 0; i < 12; i++) { const h = 8 - Math.floor(i / 3); d.r(2 + i * 2, 9 - h, 1, h, i % 2 ? '#e8c98a' : '#d9b46e'); } // 音板
    d.r(1, 3, 26, 1, C.wood2);
  }),
  // マリンバ：濃い紫檀の音板＋下に共鳴管。pivot = 底中央
  marimba: () => makePart(36, 18, 18, 18, (d) => {
    d.r(3, 14, 2, 4, C.silver2); d.r(31, 14, 2, 4, C.silver2);              // 脚
    for (let i = 0; i < 16; i++) { const h = 7 - Math.floor(i / 4); d.r(2 + i * 2, 12, 1, h - 1, C.silver); } // 共鳴管（下向き）
    d.r(1, 11, 34, 2, C.wood2);                                              // フレーム
    for (let i = 0; i < 16; i++) { const h = 9 - Math.floor(i / 4); d.r(2 + i * 2, 11 - h, 1, h, i % 2 ? '#7a3b2e' : '#8f4636'); } // 音板
    d.r(1, 2, 34, 1, C.wood2);
  }),
  // チェレスタ：小さなアップライト型の鍵盤。奏者はこの後ろに立つ。pivot = 底中央
  celesta: () => makePart(26, 30, 13, 30, (d) => {
    d.r(2, 0, 22, 26, C.wood); d.r(3, 1, 20, 12, C.wood2);                  // 筐体・上部パネル
    d.r(1, 13, 24, 2, C.wood2);                                              // 鍵盤蓋の縁
    d.r(3, 15, 20, 3, C.white); for (let x = 4; x < 22; x += 3) d.p(x, 15, C.black); // 鍵盤
    d.r(3, 18, 20, 1, C.black);
    d.r(3, 26, 2, 4, C.wood2); d.r(21, 26, 2, 4, C.wood2);                   // 脚
    d.r(11, 27, 4, 2, C.gold2);                                              // ペダル
  }),
  // グランカッサ：正面向きの大太鼓（白い打面・木の胴・スタンド）。pivot = 底中央
  bassdrum: () => makePart(26, 30, 13, 30, (d) => {
    d.r(11, 24, 4, 6, C.silver2); d.r(4, 28, 18, 2, C.silver2);   // スタンド
    d.disc(13, 13, 12, C.wood2);                                    // 胴（外周）
    d.disc(13, 13, 10, C.head);                                     // 打面
    d.ring(13, 13, 10, C.silver);                                   // リム
    for (let a = 0; a < 8; a++) { const x = 13 + Math.round(11 * Math.cos(a * Math.PI / 4)), y = 13 + Math.round(11 * Math.sin(a * Math.PI / 4)); d.p(x, y, C.gold2); } // ラグ
  }),
  stick: () => makePart(3, 14, 1, 0, (d) => { d.r(1, 0, 1, 14, C.wood); }),

  piano: () => makePart(40, 26, 20, 26, (d) => {
    d.r(4, 0, 32, 4, C.black); d.r(6, 1, 28, 1, C.coat2);     // 蓋
    d.r(0, 4, 40, 10, C.black);
    d.r(2, 14, 36, 3, C.white); for (let x = 3; x < 38; x += 3) d.p(x, 14, C.black); // 鍵盤
    d.r(0, 17, 40, 1, C.black);
    d.r(3, 18, 2, 8, C.black); d.r(35, 18, 2, 8, C.black); d.r(19, 18, 2, 8, C.black);
  }),
  harp: () => makePart(22, 36, 11, 36, (d) => {
    d.r(2, 0, 3, 34, C.gold); d.r(1, 0, 4, 2, C.gold2);
    d.line(4, 2, 20, 12, C.gold); d.line(4, 3, 20, 13, C.gold);
    d.r(3, 26, 18, 8, C.wood); d.r(2, 34, 20, 2, C.wood2);
    for (let x = 6; x <= 19; x += 2) { const yt = 3 + Math.round((x - 4) * 0.62); d.r(x, yt, 1, 27 - yt, C.silver); }
  }),
  baton: () => makePart(12, 1, 0, 0, (d) => { d.r(0, 0, 12, 1, C.ivory); }),
};

/**
 * パート名ラベル（ドット風の小さな文字板）。常にカメラを向く Sprite。
 * 小さなキャンバスに描いて最近傍拡大するので文字もドット絵風になる。
 */
export function nameLabel(text, color = '#ffffff') {
  const font = '11px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const tw = Math.ceil(m.measureText(text).width);
  const w = Math.min(160, tw + 10), h = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = 'rgba(10, 10, 20, 0.75)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = color; g.fillRect(0, 0, 2, h);      // 左端にトラック色
  g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#f4f4f4';
  g.fillText(text, 5, h / 2 + 0.5, w - 7);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(w * 0.045, h * 0.045, 1);           // 1px ≒ 0.045 unit
  sp.renderOrder = 10;
  return sp;
}

/** 足元の光（トラック色）。AdditiveBlending・opacity は baseOpacity × 倍率で制御 */
export function glowDisc(color) {
  const geo = new THREE.CircleGeometry(1.2, 24);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.userData.baseOpacity = mat.opacity;
  return m;
}
