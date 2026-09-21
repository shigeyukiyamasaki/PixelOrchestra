/*
 * PixelOrchestra — costume.js
 * 最終更新: 2026-09-20 / v0.1 / 生成元: PixelOrchestra
 *
 * 衣装（特定キャラの見た目）。persona.js の部位ごとの生成関数（頭・髪・胴・上着の立体・立った脚）を丸ごと差し替える。
 * 手は persona の肌色をそのまま使うので、籠手にしたい時は persona() で肌色を鎧の色に差し替える。
 * 試作（2026-09-20 ユーザー指定）：?costume=cecil で全員に着せて見る。トラックごとの割当は未実装。
 *
 * 座標の約束は persona.js と同じ：
 *   - 正面図は 2 倍解像度（res:2）のセル、pivot は頭＝首の付け根中央 / 胴＝腰の中央 / 脚＝足元中央
 *   - 立体パーツ（兜・肩当て）は res:1 の 1px 粒。carve は「体積関数 keep」で形を決め、colorOf で部位の色を塗る
 */
import { makePart, C, roundColumn } from './sprites.js';

/**
 * 「服は燕尾服のまま、色だけキーカラー」の置き換え表（2026-09-21 ユーザー指定）。奏者共通パーツ（袖・脚・座った脚）に直書きされた 3 色を、
 * キーカラーとその明暗に置き換える：上着 C.coat → key、ズボン・肩の陰 C.coat2 → 明るめ、布の塊感 CLOTH_DARK（persona.js）→ 暗め
 */
export function suitColors(key) {
  const c = new THREE.Color(key), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const shade = (k) => '#' + new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l * k)).getHexString();
  return { [C.coat]: key, [C.coat2]: shade(1.3), '#16161f': shade(0.82) };
}

const F = '#000';

// ---- 暗黒騎士セシル（FF4）：紺紫の鎧、角の付いた兜、素顔 ----
const CECIL = {
  BASE: '#2a2458',   // 鎧の地
  HI: '#4a4290',     // 上を向く面（天頂・肩当ての上・胸の稜線）
  LO: '#181440',     // 陰・下部・籠手・具足
  HORN: '#6c62b8',   // 角
  BELT: '#8a84c8',   // 帯
  CAPE: '#1a1540',   // マント
  FACE: '#efe3da', FACE2: '#c9b3a8', BROW: '#2a2040',
  GAUNT: '#1c1848', GAUNT2: '#100d2c',
};

/** 顔 24×30（2 倍解像度）：persona.headFor と同じ箱。額と側頭は兜で隠れる。太い眉・無表情 */
function cecilHead() {
  const { FACE, FACE2, BROW } = CECIL;
  const front = (d) => {
    d.r(2, 6, 20, 18, FACE);
    d.r(2, 12, 2, 4, FACE2); d.r(20, 12, 2, 4, FACE2);      // 耳（兜で隠れる）
    d.r(6, 12, 5, 1, BROW); d.r(13, 12, 5, 1, BROW);        // 太い眉
    d.r(8, 14, 2, 2, C.eye); d.r(14, 14, 2, 2, C.eye);
    d.p(12, 17, FACE2);                                     // 鼻
    d.r(10, 19, 4, 1, FACE2);                               // 口（結んだまま）
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 15, 1, 3, F); };
  const back = { [C.eye]: FACE, [FACE2]: FACE, [BROW]: FACE };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'cecil|head', side });
}

/**
 * 兜 20×22×16 px（1px 粒）。persona.hairFor の代わり。pivot = 首の付け根中央。
 * 顔の箱（x ±5, y 0-9, z ±4）の外側に殻を作る：天頂 3 段・ひさし・側頭（耳から顎まで）・後頭・首の後ろの垂れ・額の帯・頬当て。
 * 顔は x ±3・y 0.5-7 の窓から見える。角は側頭の上から外へ反りながら伸びる（左右対称）
 */
function cecilHelmet() {
  const keep = (x, y, z) => {                            // px（セル中心）。z は符号付き（+ が前）
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;                 // 顔の箱の内側は空
    if (b(0, 5.5, 9.5, 9.5, -4.5, 4.5) || b(0, 4.5, 10.5, 10.5, -3.5, 3.5) || b(0, 3.5, 11.5, 11.5, -2.5, 2.5)) return true; // 天頂
    if (b(0, 4.5, 9.5, 9.5, 5.5, 5.5)) return true;                            // ひさし（前へ 1px）
    if (b(5.5, 5.5, 1.5, 9.5, -4.5, 4.5)) return true;                         // 側頭
    if (b(0, 5.5, 1.5, 9.5, -4.5, -4.5)) return true;                          // 後頭
    if (b(0, 4.5, -0.5, 4.5, -5.5, -5.5)) return true;                         // 首の後ろの垂れ
    if (b(0, 5.5, 7.5, 8.5, 4.5, 4.5)) return true;                            // 額の帯
    if (b(3.5, 5.5, 0.5, 6.5, 4.5, 4.5)) return true;                          // 頬当て（顔の窓は x ±3）
    // 角：側頭の上から、上へ 1 段ごとに外へ半歩ずつ
    if (b(5.5, 6.5, 9.5, 9.5, -1.5, 1.5) || b(6.5, 6.5, 10.5, 10.5, -1.5, 1.5)) return true;
    if (b(6.5, 7.5, 11.5, 11.5, -0.5, 0.5) || b(7.5, 7.5, 12.5, 12.5, -0.5, 0.5)) return true;
    if (b(7.5, 8.5, 13.5, 13.5, -0.5, 0.5) || b(8.5, 8.5, 14.5, 14.5, -0.5, 0.5)) return true;
    if (b(8.5, 9.5, 15.5, 15.5, -0.5, 0.5)) return true;
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 10 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'cecilHelmet';
  const colorOf = (cx, cy, cz) => {
    const [x, y] = toPx(cx, cy, cz);
    const ax = Math.abs(x);
    if (ax >= 6) return CECIL.HORN;                       // 角
    if (y >= 10) return CECIL.HI;                         // 天頂の上 2 段
    if (y <= 3) return CECIL.LO;                          // 頬当ての下・首の後ろ
    return null;                                          // 地の色
  };
  colorOf.toString = () => 'cecilHelmetColor';
  return makePart(20, 22, 10, 16, (d) => { d.r(0, 0, 20, 22, CECIL.BASE); }, { res: 1, depth: 16, z0: -8, accent: 'cecil|helmet', carve, colorOf });
}

/** 胴 32×42（2 倍解像度）：persona.torsoFor と同じ箱。喉当て・胸当ての稜線（V 字）・腹の段・帯。トラック色は使わない */
function cecilTorso() {
  const { BASE, HI, LO, BELT } = CECIL;
  const front = (d) => {
    d.r(12, 10, 8, 6, LO);                                  // 喉当て（首）
    d.r(6, 16, 20, 26, BASE);                               // 胴
    d.r(4, 18, 2, 16, LO); d.r(26, 18, 2, 16, LO);          // 肩の陰
    d.r(8, 17, 16, 2, HI);                                  // 胸当ての上縁
    d.r(9, 20, 4, 2, HI); d.r(19, 20, 4, 2, HI);            // 稜線（V 字、3 段）
    d.r(11, 22, 4, 2, HI); d.r(17, 22, 4, 2, HI);
    d.r(13, 24, 6, 2, HI);
    d.r(6, 29, 20, 1, LO);                                  // 腹の段
    d.r(6, 32, 20, 2, BELT); d.r(14, 32, 4, 2, LO);         // 帯と留め具
    d.r(6, 36, 20, 1, LO); d.r(6, 39, 20, 1, LO);           // 腰の段
  };
  const side = (d) => { d.r(4, 10, 6, 6, F); d.r(0, 16, 12, 12, F); d.r(2, 28, 8, 14, F); };
  const back = { [HI]: BASE, [BELT]: BASE };
  return makePart(32, 42, 16, 42, front, { res: 2, depth: 12, z0: -6, back, accent: 'cecil|torso', side });
}

/**
 * 鎧の立体パーツ 18×24×10 px（1px 粒）：persona.coatFor の代わり。pivot = 腰の中央。
 * 胴の箱（x ±5, z ±3, y 0-13）の外に張り出すもの：肩当て（4 段で外へ垂れる）・首の後ろの襟・マント（立奏のみ、腰から脛へ）
 */
function cecilArmor(standing) {
  const { BASE, HI, LO, CAPE } = CECIL;
  const PAD = 'pad', PADTOP = 'padTop', COLLAR = 'collar', MANTLE = 'cape';
  const what = (x, y, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, zz) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && az <= zz;
    if (b(4.5, 6.5, 13.5, 13.5, 2.5)) return PADTOP;                           // 肩当て（上面）
    if (b(5.5, 7.5, 12.5, 12.5, 2.5) || b(6.5, 7.5, 11.5, 11.5, 2.5) || b(7.5, 7.5, 10.5, 10.5, 1.5)) return PAD;
    if (z === -3.5 && ax <= 3.5 && y >= 13.5 && y <= 15.5) return COLLAR;      // 襟（首の後ろ）
    if (ax === 4.5 && (z === -2.5 || z === -3.5) && y >= 13.5 && y <= 14.5) return COLLAR;
    if (standing && z === -3.5 && ax <= 5.5 && y <= 12.5 && y >= -8.5) return MANTLE; // マント
    return null;
  };
  const toPx = (cx, cy, cz) => [cx - 9 + 0.5, 15 - cy - 0.5, cz - 5 + 0.5];
  const carve = (cx, cy, cz) => what(...toPx(cx, cy, cz)) === null;
  carve.toString = () => `cecilArmor(${standing})`;
  const colorOf = (cx, cy, cz) => {
    const w = what(...toPx(cx, cy, cz));
    return w === PADTOP ? HI : w === COLLAR ? LO : w === MANTLE ? CAPE : BASE;
  };
  colorOf.toString = () => `cecilArmorColor(${standing})`;
  return makePart(18, 24, 9, 15, (d) => { d.r(0, 0, 18, 24, BASE); }, { res: 1, depth: 10, z0: -5, accent: `cecil|armor|${standing}`, carve, colorOf });
}

/** 立った脚 32×26（2 倍解像度）：persona.legsStandingFor（男性）と同じ箱。腰当て・具足・膝当て・靴 */
function cecilLegs() {
  const { BASE, HI, LO } = CECIL;
  const front = (d) => {
    d.r(6, 0, 8, 6, BASE); d.r(18, 0, 8, 6, BASE);          // 腰当て（燕尾の位置）
    d.r(6, 5, 8, 1, LO); d.r(18, 5, 8, 1, LO);
    d.r(8, 0, 6, 22, LO); d.r(18, 0, 6, 22, LO);            // 具足
    d.r(8, 9, 6, 1, HI); d.r(18, 9, 6, 1, HI);              // 膝当て（上縁だけ明るく）
    d.r(8, 10, 6, 3, BASE); d.r(18, 10, 6, 3, BASE);
    d.r(6, 22, 8, 4, C.shoe); d.r(18, 22, 8, 4, C.shoe);    // 靴
  };
  const side = (d) => { d.r(2, 0, 8, 22, F); d.r(0, 22, 12, 4, F); };
  const legL = roundColumn(11, 6, 3.2, 2.6, 8, 21), legR = roundColumn(21, 6, 3.2, 2.6, 8, 21);
  const carve = (x, y, z) => (x < 16 ? legL(x, y, z) : legR(x, y, z));
  return makePart(32, 26, 16, 26, front, { res: 2, depth: 12, z0: -6, accent: 'cecil|legs', side, carve });
}

// ---- 賢者テラ（FF4）：小柄な老人、丸眼鏡、白い太眉と長い白ひげ、禿げ頭の周りに白髪、青紫のローブ ----
const TELLA = {
  ROBE: '#3c3a92', ROBE2: '#2c2a70', TRIM: '#d6d0f2', SASH: '#c9a24a', KNOT: '#a8823a',
  HAIR: '#ececec', HAIR2: '#cfcfcf', SKIN: '#efd9c8', SKIN2: '#d2b49e', FRAME: '#2a2a30', LENS: '#9fd8f0', SHOE: '#4a3020',
};

/** 顔 24×30（2 倍解像度）。顔の箱は persona.headFor と同じ。ひげは顎（row 23）の下 6 行（rows 24-29）へ垂れる：そこだけ前面の 1.5px 厚 */
function tellaHead() {
  const { HAIR, HAIR2, SKIN, SKIN2, FRAME, LENS } = TELLA;
  const front = (d) => {
    d.r(2, 6, 20, 18, SKIN);
    d.r(2, 12, 2, 4, SKIN2); d.r(20, 12, 2, 4, SKIN2);      // 耳
    d.r(8, 8, 8, 1, SKIN2);                                 // 額のしわ（禿げなので見える）
    d.r(6, 11, 5, 2, HAIR); d.r(13, 11, 5, 2, HAIR);        // 白い太眉
    d.p(12, 17, SKIN2);                                     // 鼻
    d.p(7, 17, SKIN2); d.p(16, 17, SKIN2);                  // 目尻のしわ
    // 丸眼鏡：透けない水色のレンズ（目は描かない。2026-09-20 ユーザー指定）＋上下の縁と左右の枠＋ブリッジ＋つる
    d.r(7, 14, 4, 2, LENS); d.r(13, 14, 4, 2, LENS);
    d.r(7, 13, 4, 1, FRAME); d.r(13, 13, 4, 1, FRAME);
    d.r(7, 16, 4, 1, FRAME); d.r(13, 16, 4, 1, FRAME);
    d.r(6, 14, 1, 2, FRAME); d.r(11, 14, 1, 2, FRAME); d.r(12, 14, 1, 2, FRAME); d.r(17, 14, 1, 2, FRAME);
    d.r(2, 14, 4, 1, FRAME); d.r(18, 14, 4, 1, FRAME);
    // ひげ：口ひげ → 顎いっぱい → 先細りに垂れる。縦の筋で毛並み
    d.r(7, 18, 3, 1, HAIR); d.r(14, 18, 3, 1, HAIR);        // 口ひげ
    d.r(6, 19, 12, 5, HAIR);                                // 顎（rows 19-23）
    d.r(7, 24, 10, 3, HAIR); d.r(9, 27, 6, 2, HAIR); d.r(11, 29, 2, 1, HAIR);
    for (const x of [8, 11, 14]) { d.r(x, 20, 1, 4, HAIR2); }
    d.r(9, 25, 1, 3, HAIR2); d.r(13, 25, 1, 3, HAIR2);
    d.r(10, 21, 4, 1, SKIN2);                               // 口（ひげの中）
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 15, 1, 3, F); d.r(13, 24, 3, 6, F); };   // 顎の下のひげは前面だけ
  const back = { [LENS]: SKIN, [SKIN2]: SKIN, [FRAME]: SKIN, [HAIR]: SKIN, [HAIR2]: SKIN };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'tella|head2', side });
}

/**
 * 白髪 22×21×16 px（1px 粒）。額が広い（頭頂の前 1/3 は地肌、髪は後ろへ行くほど高い）。
 * 側頭は顎から頭頂まで髪で覆い、元のドット絵のように左右 2 房ずつ：上の房は側頭の上端から、下の房は耳の高さから、
 * J 字に（根元は寝かせて外へ、先へ行くほど立ち上がる）太く伸びる（根元は奥行き 3 セル、先端は 1 セル。2026-09-21 ユーザー指定：2 房・横に広く・丸みを）
 */
function tellaHair() {
  const keep = (x, y, z) => {
    const ax = Math.abs(x);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && Math.abs(z) <= 4 && y >= 0 && y <= 9) return false;         // 顔の箱の内側は空
    if (b(5.5, 5.5, 1.5, 9.5, -4.5, 3.5)) return true;                         // 側頭（顎から頭頂まで）
    if (b(5.5, 5.5, 2.5, 4.5, 4.5, 4.5)) return true;                          // もみあげ
    if (b(0, 5.5, 1.5, 9.5, -4.5, -4.5)) return true;                          // 後頭
    if (b(0, 4.5, 2.5, 7.5, -5.5, -5.5)) return true;                          // 後ろの量感
    // 頭頂：額を広く空け、後ろへ行くほど高く盛る
    if (b(0, 5.5, 9.5, 9.5, -4.5, 1.5)) return true;
    if (b(0, 4.5, 10.5, 10.5, -4.5, 0.5)) return true;
    if (b(0, 3.5, 11.5, 11.5, -3.5, -0.5)) return true;
    if (b(0, 1.5, 12.5, 12.5, -2.5, -1.5)) return true;                        // 上の小さな房
    // 房は J 字：根元は寝かせて外へ（角度が浅い）、先へ行くほど立ち上がる（2026-09-21 ユーザー指定：直線でなく丸みを）。
    // 列（ax）ごとに y の範囲を持つ。根元 2 列は縦 5 セル・奥行き 7 セルで太く、3 列目は縦 4、4 列目は縦 4・奥行き 3、先端 2 列は奥行き 1 セルに絞り、頂点を削って短くする。先端の列は縦 3 セル（2026-09-21 ユーザー指定：根元を太く・頂点を削る）
    const tuft = (y0, cols) => cols.some(([x0, dy0, dy1, zz], i) => ax === x0 && y >= y0 + dy0 && y <= y0 + dy1 && Math.abs(z) <= zz);
    // 上の房：側頭の上端（y 8.5）から。水平 3 列 → 半歩 → 2 → 3 で先端は頭頂より高い
    if (tuft(8.5, [[5.5, -2, 2, 3.5], [6.5, -2, 2, 2.5], [7.5, -1, 2, 2.5], [8.5, 0, 3, 1.5], [9.5, 1, 4, 0.5], [10.5, 3, 5, 0.5]])) return true;
    // 下の房：耳の高さ（y 2.5）から。同じ曲線で、先端は上の房より低い
    if (tuft(2.5, [[5.5, -2, 2, 3.5], [6.5, -2, 2, 2.5], [7.5, -1, 2, 2.5], [8.5, 0, 3, 1.5], [9.5, 1, 4, 0.5], [10.5, 3, 5, 0.5]])) return true;
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 11 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'tellaHair14';
  const colorOf = (cx, cy, cz) => ((cx + cy * 3 + cz * 7) % 5 === 0 ? TELLA.HAIR2 : null);   // 毛の塊感（少し暗い粒）
  colorOf.toString = () => 'tellaHairColor';
  return makePart(22, 21, 11, 16, (d) => { d.r(0, 0, 22, 21, TELLA.HAIR); }, { res: 1, depth: 16, z0: -8, accent: 'tella|hair14', carve, colorOf });
}

/** 胴 32×42（2 倍解像度）：ローブ。V 字の薄紫の襟、金の帯と結び目。トラック色は使わない */
function tellaTorso() {
  const { ROBE, ROBE2, TRIM, SASH, KNOT, SKIN } = TELLA;
  const front = (d) => {
    d.r(12, 10, 8, 6, SKIN);                                // 首
    d.r(6, 16, 20, 26, ROBE);
    d.r(4, 18, 2, 16, ROBE2); d.r(26, 18, 2, 16, ROBE2);    // 肩の陰
    d.r(8, 16, 3, 2, TRIM); d.r(21, 16, 3, 2, TRIM);        // V 字の襟（肩から胸の中央へ）
    d.r(10, 18, 2, 2, TRIM); d.r(20, 18, 2, 2, TRIM);
    d.r(12, 20, 2, 2, TRIM); d.r(18, 20, 2, 2, TRIM);
    d.r(14, 22, 4, 2, TRIM);
    d.r(6, 31, 20, 3, SASH); d.r(14, 31, 4, 3, KNOT);       // 帯と結び目
    d.r(15, 34, 2, 8, ROBE2);                               // 前の合わせ目
  };
  const side = (d) => { d.r(4, 10, 6, 6, F); d.r(0, 16, 12, 12, F); d.r(2, 28, 8, 14, F); };
  const back = { [TRIM]: ROBE, [SASH]: ROBE, [KNOT]: ROBE, [ROBE2]: ROBE2 };
  return makePart(32, 42, 16, 42, front, { res: 2, depth: 12, z0: -6, back, accent: 'tella|torso', side });
}

/** ローブの立体パーツ 14×24×10 px（1px 粒）：首の後ろに垂れたフードだけ（座奏・立奏で同じ） */
function tellaHood() {
  const what = (x, y, z) => {
    const ax = Math.abs(x);
    if (z === -3.5 && ax <= 4.5 && y >= 11.5 && y <= 15.5) return 'hood';
    if (z === -4.5 && ax <= 3.5 && y >= 11.5 && y <= 14.5) return 'hood';
    return null;
  };
  const toPx = (cx, cy, cz) => [cx - 7 + 0.5, 15 - cy - 0.5, cz - 5 + 0.5];
  const carve = (cx, cy, cz) => what(...toPx(cx, cy, cz)) === null;
  carve.toString = () => 'tellaHood';
  const colorOf = (cx, cy, cz) => { const [, y] = toPx(cx, cy, cz); return y >= 15 ? TELLA.ROBE : TELLA.ROBE2; };   // 上縁だけ明るく
  colorOf.toString = () => 'tellaHoodColor';
  return makePart(14, 24, 7, 15, (d) => { d.r(0, 0, 14, 24, TELLA.ROBE2); }, { res: 1, depth: 10, z0: -5, accent: 'tella|hood', carve, colorOf });
}

/** 立った脚 32×26（2 倍解像度）：足首までのローブ（女性のロングスカートと同じ形）。縦のひだ、裾の薄紫、茶の靴 */
function tellaLegs() {
  const { ROBE, ROBE2, TRIM, SHOE } = TELLA;
  const front = (d) => {
    d.r(6, 0, 20, 22, ROBE); d.r(5, 12, 22, 10, ROBE);
    for (const x of [10, 15, 21]) d.r(x, 2, 1, 19, ROBE2);   // ひだ
    d.r(5, 21, 22, 1, TRIM);                                // 裾
    d.r(6, 22, 8, 4, SHOE); d.r(18, 22, 8, 4, SHOE);
  };
  const side = (d) => { d.r(1, 0, 10, 12, F); d.r(0, 12, 12, 10, F); d.r(0, 22, 12, 4, F); };
  return makePart(32, 26, 16, 26, front, { res: 2, depth: 12, z0: -6, accent: 'tella|legs', side });
}

/** 座ったローブの裾：persona.skirtSeated と同じ 2 部品（腰の上・膝から床）をローブの色で */
function tellaSkirt() {
  const { ROBE, ROBE2, TRIM } = TELLA;
  const hip = makePart(32, 8, 16, 8, (d) => { d.r(0, 0, 32, 8, ROBE); d.r(0, 0, 32, 1, ROBE2); }, { res: 2, depth: 20, z0: 0, accent: 'tella|skirtHip' });
  const front = makePart(32, 24, 16, 24, (d) => { d.r(0, 0, 32, 24, ROBE); for (let x = 4; x < 32; x += 7) d.r(x, 2, 1, 22, ROBE2); d.r(0, 23, 32, 1, TRIM); }, { res: 2, depth: 4, z0: 0, accent: 'tella|skirtFront' });
  return { hip, front };
}

/** 衣装ごとの部位の生成関数。persona(p) は手（肌色）や体型のために persona を差し替える。skirt があれば座奏で裾（ロングスカートと同じ仕組み）を付ける */
export const COSTUMES = {
  cecil: {
    persona: (p) => ({ ...p, gender: 'm', age: 'adult', skin: CECIL.GAUNT, skin2: CECIL.GAUNT2, hair: CECIL.LO, style: 'short',
                       glasses: false, beard: false, build: 1.0, height: 1.02, key: 'cecil' }),   // 手は籠手。体型は固定
    head: () => cecilHead(),
    hair: () => cecilHelmet(),
    torso: () => cecilTorso(),
    coat: (p, accent, standing) => cecilArmor(standing),
    legs: () => cecilLegs(),
  },
  tella: {
    persona: (p) => ({ ...p, gender: 'm', age: 'senior', skin: TELLA.SKIN, skin2: TELLA.SKIN2, hair: TELLA.HAIR, style: 'bald',
                       glasses: true, beard: true, build: 0.95, height: 0.94, key: 'tella' }),   // 小柄な老人
    head: () => tellaHead(),
    hair: () => tellaHair(),
    torso: () => tellaTorso(),
    coat: () => tellaHood(),
    legs: () => tellaLegs(),
    skirt: () => tellaSkirt(),
  },
  // 顔と髪だけテラ、服は燕尾服のまま色だけ紫（もう一案。2026-09-21 ユーザー指定）
  'tella-suit': {
    persona: (p) => ({ ...p, gender: 'm', age: 'senior', skin: TELLA.SKIN, skin2: TELLA.SKIN2, hair: TELLA.HAIR, style: 'bald',
                       glasses: true, beard: true, build: 0.95, height: 0.94, key: 'tella' }),
    head: () => tellaHead(),
    hair: () => tellaHair(),
    suit: '#6b3fa6',
  },
};
