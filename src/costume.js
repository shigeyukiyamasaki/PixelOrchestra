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
import { makePart, C, roundColumn, voxelPart } from './sprites.js';
import { RANDI3 } from './randi3Data.js';

/**
 * 「服は燕尾服のまま、色だけキーカラー」の置き換え表（2026-09-21 ユーザー指定）。奏者共通パーツ（袖・脚・座った脚）に直書きされた 3 色を、
 * キーカラーとその明暗に置き換える：上着 C.coat → key、ズボン・肩の陰 C.coat2 → 明るめ、布の塊感 CLOTH_DARK（persona.js）→ 暗め
 */
export function suitColors(key, shirt = null, shoe = null) {
  const c = new THREE.Color(key), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const shade = (k) => '#' + new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l * k)).getHexString();
  const map = { [C.coat]: key, [C.coat2]: shade(1.3), '#16161f': shade(0.82) };
  if (shirt) map[C.shirt] = shirt;   // 胸の白いシャツ（鎧では板金にしたい。2026-09-21）
  if (shoe) map[C.shoe] = shoe;      // 靴（戦闘用セシルは金のブーツ）
  return map;
}

const F = '#000';

// ---- 暗黒騎士セシル（FF4）：紺紫の鎧、角の付いた兜、素顔 ----
const CECIL = {
  // **戦闘用スプライトから採取**（セシル_戦闘立ち.png を等倍 16×24 に戻して抽出。2026-09-21 ユーザー指定）。
  // セシルはフィールド用・戦闘用・メニュー用で配色が大きく違う。基準は戦闘用：彩度の高い青紫・角は黄色・手は素肌・ブーツは金。
  // （メニュー用のポートレートは灰がかった藤色 #a098c8 / #707090 / #383848 に白い角。採らない）
  // 角は戦闘用では頭の右上に 1〜2px の突起として兜と同じ明青紫で描かれている。黄色でも白でもない
  LIGHT: '#9090f8', BASE: '#6060d8', MID: '#5050a8', DARK: '#202068', SHADE: '#404088', OUT: '#000000',
  EYE: '#e8e800', GOLD: '#e0a800', RED: '#f80000',   // 戦闘用の純黄 #e8e800 は角ではなく目（顔の中央・目の高さに 4px）
  SKIN: '#f88850', SKIN2: '#c87800',                                  // 手（戦闘用では素肌）
  HI: '#9090f8', LO: '#202068', BELT: '#e0a800', CAPE: '#202068',     // 鎧一式（cecil）が使う名前
  FACE: '#6060d8', FACE2: '#202068', GAUNT: '#5050a8', GAUNT2: '#202068',
};



/**
 * 面頬 24×30（2 倍解像度）。persona.headFor と同じ箱だが、**肌は一切見えない**（実物どおり顔全体が兜。2026-09-21）。
 * 上を向く面（額・顎の中央）が明るく、目の高さは窪んで暗い帯、中央に鼻筋の稜線。
 */
function cecilHead() {
  const { BASE, LIGHT, OUT, EYE, SKIN, SKIN2 } = CECIL;
  const front = (d) => {
    d.r(2, 6, 20, 12, BASE);                                // 兜の面（額から頬の下・row 17 まで）
    d.r(2, 6, 20, 3, LIGHT);                                // 額（上を向く面）
    d.r(2, 9, 20, 1, OUT);                                  // 眉の段
    d.r(11, 10, 2, 8, LIGHT);                               // 鼻筋の稜線
    // 光る目（戦闘用の純黄 #e8e800）。吊り目：外側（耳側）が高く、中央へ 2px ずつ下がる。周りに窪み・黒縁は置かない
    // 一番内側の低いブロックだけ 1px 外へ広い（2026-09-21 ユーザー指定）
    d.r(4, 12, 2, 2, EYE); d.r(6, 13, 2, 2, EYE); d.r(7, 14, 3, 2, EYE);
    d.r(18, 12, 2, 2, EYE); d.r(16, 13, 2, 2, EYE); d.r(14, 14, 3, 2, EYE);
    // 兜の下は素肌（2026-09-21 ユーザー指定：口周りを出す）
    d.r(2, 18, 20, 6, SKIN);
    d.r(3, 18, 18, 1, SKIN2);                               // 兜の縁の落ち影
    d.r(9, 20, 6, 1, SKIN2);                                // 口
    d.r(2, 22, 20, 2, SKIN2);                               // 顎（下を向く面）
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 12, 1, 5, F); };   // 箱＋鼻筋の張り出し
  const back = { [LIGHT]: BASE, [OUT]: BASE, [EYE]: BASE, [SKIN]: BASE, [SKIN2]: BASE };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'cecil|head8', side });
}

/**
 * 兜 20×22×16 px（1px 粒）。persona.hairFor の代わり。pivot = 首の付け根中央。顔の箱（x ±5, y 0-9, z ±4）の外側の殻。
 * 実物どおり（2026-09-21）：丸い天頂、顎までの側頭、**兜と同じ青紫の角が左右に 1 本ずつ、頬の高さから頭頂より上まで
 * ほぼ垂直に伸び、中ほどで外へ張り出す**。顔は覆われているので窓は無い。
 */
function cecilHelmet() {
  // 角：[y, ax の最小, ax の最大, 奥行き]。**生え際は目のすぐ上（y 6.5）、先端 y 14.5**（2026-09-21 ユーザー指定）
  // 幅 1px。上がるにつれ外へ張り出し、先で内へ戻る。段がずれる y では 2 列にして面で繋ぐ（斜めだけだと浮く）
  const HORN = [[6.5, 6.5, 6.5, 1.5], [7.5, 6.5, 7.5, 1.5], [8.5, 7.5, 7.5, 1.0], [9.5, 7.5, 8.5, 0.5],
                [10.5, 8.5, 8.5, 0.5], [11.5, 7.5, 8.5, 0.5], [12.5, 7.5, 7.5, 0.5], [13.5, 6.5, 7.5, 0.5],
                [14.5, 6.5, 6.5, 0.5]];
  const isHorn = (ax, y, z) => HORN.some(([yy, a0, a1, zz]) => y === yy && ax >= a0 && ax <= a1 && Math.abs(z) <= zz);
  const keep = (x, y, z) => {                            // px（セル中心）。z は符号付き（+ が前）
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;                 // 顔の箱の内側は空（面頬は head 側）
    if (isHorn(ax, y, z)) return true;                                        // 角
    if (b(0, 5.5, 9.5, 9.5, -4.5, 4.5) || b(0, 4.5, 10.5, 10.5, -3.5, 3.5) || b(0, 3.5, 11.5, 11.5, -2.5, 2.5)) return true; // 天頂
    if (b(0, 4.5, 9.5, 9.5, 5.5, 5.5)) return true;                            // ひさし（前へ 1px）
    if (b(5.5, 5.5, 3.5, 9.5, -4.5, 4.5)) return true;                         // 側頭（頬の段で終わる。下は素肌）
    if (b(0, 5.5, 2.5, 9.5, -4.5, -4.5)) return true;                          // 後頭
    if (b(0, 4.5, -1.5, 4.5, -5.5, -5.5)) return true;                         // 首の後ろの垂れ
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 10 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'cecilHelmet8';
  const colorOf = (cx, cy, cz) => {
    const [x, y, z] = toPx(cx, cy, cz);
    const ax = Math.abs(x);
    if (isHorn(ax, y, z)) return y >= 10 ? CECIL.LIGHT : CECIL.BASE;  // 角：戦闘用は兜と同じ青紫（先が明るい）
    if (z > 5 || y >= 10) return CECIL.LIGHT;             // ひさし・天頂の上 2 段
    if (y <= 1) return CECIL.DARK;                        // 顎の高さ
    return null;                                          // 地の色
  };
  colorOf.toString = () => 'cecilHelmetColor8';
  return makePart(20, 22, 10, 16, (d) => { d.r(0, 0, 20, 22, CECIL.BASE); }, { res: 1, depth: 16, z0: -8, accent: 'cecil|helmet8', carve, colorOf });
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


// ================= 聖剣伝説2（2026-09-21 ユーザー指定）=================
// 配色はいずれも「正面 Stance」から等倍で採取（/Volumes/SunDisk 4TB/動画編集/2.5D/聖剣伝説2/キャラ/…/*.png）。
// シートはラベル付きで Stance が正面・背面・横の 3 方向あり、その 1 枚目（正面）を基準にした。

// ---- ランディ：橙の逆立った髪、濃ピンクのヘッドバンド、青い上下、橙の靴 ----
const RANDI = {
  HAIR: '#c85820', HAIR2: '#804018', HAIR3: '#f89820',
  SKIN: '#f8b0a0', SKIN2: '#d07850', BAND: '#e828a8', BAND2: '#a01870',
  OUT: '#302820', WHITE: '#f8f8f8', COAT: '#204870', SHOE: '#f8a828',
};

/** 顔 24×30。ヘッドバンドが額を横切る。目は大きめで白のハイライト */
function randiHead() {
  const { SKIN, SKIN2, BAND, BAND2, OUT, WHITE } = RANDI;
  const front = (d) => {
    d.r(2, 6, 20, 18, SKIN);
    d.r(2, 12, 2, 4, SKIN2); d.r(20, 12, 2, 4, SKIN2);      // 耳
    d.r(2, 6, 20, 3, BAND); d.r(2, 9, 20, 1, BAND2);        // ヘッドバンド（額）
    d.r(7, 12, 3, 3, OUT); d.r(14, 12, 3, 3, OUT);          // 目
    d.r(7, 12, 1, 1, WHITE); d.r(16, 12, 1, 1, WHITE);      // ハイライト
    d.p(12, 17, SKIN2);                                     // 鼻
    d.r(10, 19, 4, 1, SKIN2);                               // 口
    d.r(4, 16, 2, 1, '#f09088'); d.r(18, 16, 2, 1, '#f09088'); // 頬
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 15, 1, 3, F); };
  const back = { [OUT]: SKIN, [WHITE]: SKIN, [SKIN2]: SKIN, [BAND]: SKIN, [BAND2]: SKIN, '#f09088': SKIN };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'randi|head', side });
}

/** 髪 20×21×16（1px 粒）：大きく盛った橙の髪。頭頂から後ろへ膨らみ、左右と後ろに跳ねた房 */
function randiHair() {
  const keep = (x, y, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;     // 顔の箱の内側は空
    if (b(0, 6.5, 9.5, 10.5, -5.5, 5.5)) return true;             // 天頂（大きい）
    if (b(0, 5.5, 11.5, 11.5, -5.5, 4.5) || b(0, 4.5, 12.5, 12.5, -4.5, 3.5)) return true;
    if (b(5.5, 6.5, 5.5, 9.5, -5.5, 5.5)) return true;            // 側頭（耳の上まで）
    if (b(0, 6.5, 5.5, 9.5, -5.5, -4.5)) return true;             // 後頭
    if (b(0, 5.5, 6.5, 9.5, -6.5, -5.5)) return true;             // 後ろの量感
    // 跳ねた房：右上・左上・後ろ上
    if (b(6.5, 7.5, 11.5, 12.5, 0.5, 3.5) || b(7.5, 8.5, 12.5, 13.5, 1.5, 3.5)) return true;
    if (b(5.5, 6.5, 12.5, 13.5, -4.5, -1.5) || b(0, 2.5, 13.5, 14.5, -3.5, -0.5)) return true;
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 10 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'randiHair';
  const colorOf = (cx, cy, cz) => {
    const [x, y] = toPx(cx, cy, cz);
    if (y >= 12) return RANDI.HAIR3;                              // 先の房は明るい
    return ((cx * 3 + cy * 5 + cz) % 4 === 0) ? RANDI.HAIR2 : null;  // 塊感
  };
  colorOf.toString = () => 'randiHairColor';
  return makePart(20, 21, 10, 16, (d) => { d.r(0, 0, 20, 21, RANDI.HAIR); }, { res: 1, depth: 16, z0: -8, accent: 'randi|hair', carve, colorOf });
}

// ---- プリム：金橙の大きな髪に緑の飾り、青い目、マゼンタのドレス ----
const PRIMM = {
  HAIR: '#d87800', HAIR2: '#a05838', HAIR3: '#f0a820',
  SKIN: '#f8d8a8', SKIN2: '#d88058', EYE: '#005870', OUT: '#483830', WHITE: '#f0f0f0',
  DRESS: '#a02870', DRESS2: '#e850b8', GEM: '#50a868', GEM2: '#98e8a8',
};

/** 顔 24×30。青い目、前髪が額を覆う */
function primmHead() {
  const { SKIN, SKIN2, EYE, OUT, WHITE } = PRIMM;
  const front = (d) => {
    d.r(2, 6, 20, 18, SKIN);
    d.r(2, 12, 2, 4, SKIN2); d.r(20, 12, 2, 4, SKIN2);      // 耳
    d.r(6, 11, 5, 1, OUT); d.r(13, 11, 5, 1, OUT);          // まつ毛の線
    d.r(7, 12, 3, 3, EYE); d.r(14, 12, 3, 3, EYE);          // 青い目
    d.r(7, 12, 1, 1, WHITE); d.r(16, 12, 1, 1, WHITE);      // ハイライト
    d.p(12, 17, SKIN2);                                     // 鼻
    d.r(10, 19, 4, 1, '#c85868');                           // 口
    d.r(4, 16, 2, 1, '#f0b0a0'); d.r(18, 16, 2, 1, '#f0b0a0'); // 頬
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 15, 1, 3, F); };
  const back = { [OUT]: SKIN, [EYE]: SKIN, [WHITE]: SKIN, [SKIN2]: SKIN, '#c85868': SKIN, '#f0b0a0': SKIN };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'primm|head', side });
}

/**
 * 髪 18×30×16（1px 粒）。**背面 Stance で確認したとおり、長いポニーテールを背中へ垂らす**（2026-09-21 ユーザー指摘）。
 * 正面 Stance だけ見ていた第 1 版では見落としていた。前髪は額を覆い、頭頂の中央と結び目に緑の飾り。
 * 尻尾は z -5.5〜-4.5（胴は z ±3 なので当たらない）に置き、腰の高さ（頭のローカル座標で y -12.5）まで垂らす
 */
function primmHair() {
  const tailW = (y) => (y >= -2 ? 3.5 : y >= -8 ? 2.5 : 1.5);   // 上は広く、先へ細る
  const isTail = (ax, y, z) => z >= -5.5 && z <= -4.5 && y <= 9.5 && y >= -12.5 && ax <= tailW(y);
  const keep = (x, y, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;
    if (isTail(ax, y, z)) return true;                            // ポニーテール
    if (b(0, 6.5, 9.5, 10.5, -5.5, 5.5)) return true;             // 天頂
    if (b(0, 5.5, 11.5, 11.5, -4.5, 4.5) || b(0, 3.5, 12.5, 12.5, -3.5, 3.5)) return true;
    if (b(0, 1.5, 13.5, 14.5, -1.5, 1.5)) return true;            // 頭頂の飾り（緑）
    if (b(5.5, 6.5, 2.5, 9.5, -5.5, 5.5)) return true;            // 側頭（頬まで下ろす）
    if (b(0, 6.5, 2.5, 9.5, -5.5, -4.5)) return true;             // 後頭
    if (b(0, 6.5, 3.5, 9.5, -6.5, -5.5)) return true;             // 後ろの量感
    if (b(0, 5.5, 7.5, 9.5, 4.5, 5.5)) return true;               // 前髪（額を覆う）
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 9 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'primmHair2';
  const colorOf = (cx, cy, cz) => {
    const [x, y, z] = toPx(cx, cy, cz);
    const ax = Math.abs(x);
    if (y >= 13) return ((cx + cz) % 2 ? PRIMM.GEM : PRIMM.GEM2);          // 頭頂の飾り
    if (isTail(ax, y, z) && y >= 6.5 && y <= 8.5) return PRIMM.GEM;        // 結び目（緑）
    if (isTail(ax, y, z) && ax <= 0.5) return PRIMM.HAIR3;                 // 尻尾の中央に明るい筋
    return ((cx * 3 + cy * 5 + cz) % 4 === 0) ? PRIMM.HAIR2 : (y >= 11 ? PRIMM.HAIR3 : null);
  };
  colorOf.toString = () => 'primmHairColor2';
  return makePart(18, 30, 9, 16, (d) => { d.r(0, 0, 18, 30, PRIMM.HAIR); }, { res: 1, depth: 16, z0: -8, accent: 'primm|hair2', carve, colorOf });
}

// ---- ポポイ：赤桃の巨大な髪、左右に淡い丸い房、緑の服。小柄 ----
const POPOI = {
  HAIR: '#a83040', HAIR2: '#901818', HAIR3: '#d05868',
  TUFT: '#f8b0f0', TUFT2: '#f8f8f8',
  SKIN: '#e89078', SKIN2: '#d08870', OUT: '#383028', WHITE: '#f8f8f8',
  TOP: '#207858', TOP2: '#50b068',
};

/** 顔 24×30。小さな顔に大きな目 */
function popoiHead() {
  const { SKIN, SKIN2, OUT, WHITE } = POPOI;
  const front = (d) => {
    d.r(2, 6, 20, 18, SKIN);
    d.r(2, 12, 2, 4, SKIN2); d.r(20, 12, 2, 4, SKIN2);      // 耳
    d.r(6, 11, 4, 5, WHITE); d.r(14, 11, 4, 5, WHITE);      // 大きな目（白目）
    d.r(7, 12, 3, 3, OUT); d.r(15, 12, 3, 3, OUT);          // 瞳
    d.p(12, 18, SKIN2);                                     // 鼻
    d.r(10, 20, 4, 1, SKIN2);                               // 口
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 16, 1, 3, F); };
  const back = { [OUT]: SKIN, [WHITE]: SKIN, [SKIN2]: SKIN };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back, accent: 'popoi|head', side });
}

/**
 * 髪 22×30×16：顔の周りを丸く包む巨大な髪＋左右に淡い丸い房。
 * **背面 Stance で確認したとおり、後ろ髪は腰のあたりまで背中を覆う大きな塊**（2026-09-21）。
 * 第 1 版は顎の下までしか無かった（プリムのポニーテールと同じ、正面だけ見た見落とし）
 */
function popoiHair() {
  // 左右の丸い房。実物では**頭の上の外側の角**に、白い芯＋淡い桃の縁で描かれている
  // （正面 Stance の x1-4 / x15-18・行 1-5）。2026-09-21 ユーザー指摘：低く外すぎて髪に埋もれていたので上げて大きくした
  const tuftD = (ax, y, z) => Math.hypot(ax - 7.0, y - 10.5, z / 1.3);
  const tuft = (ax, y, z) => tuftD(ax, y, z) <= 2.6;
  const keep = (x, y, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    const b = (x0, x1, y0, y1, z0, z1) => ax >= x0 && ax <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;
    if (tuft(ax, y, z)) return true;                              // 左右の丸い房（頭の上の外側の角）
    if (b(0, 6.5, 9.5, 11.5, -5.5, 5.5)) return true;             // 天頂（厚い）
    if (b(0, 5.5, 12.5, 12.5, -4.5, 4.5)) return true;
    if (b(5.5, 6.5, -5.5, 9.5, -5.5, 5.5)) return true;           // 側頭（肩より下まで垂れる）
    if (b(0, 6.5, 0.5, 9.5, -6.5, -4.5)) return true;             // 後頭（頭の高さは厚く）
    // 後ろ髪：腰のあたりまで背中を覆う。下へ行くほど少し細る（胴は z ±3、椅子の背は z -6 付近なので -5.5〜-4.5 に置く）
    if (z >= -5.5 && z <= -4.5 && y <= 0.5 && y >= -11.5 && ax <= (y >= -5 ? 6.5 : y >= -9 ? 5.5 : 4.5)) return true;
    if (b(0, 5.5, 8.5, 9.5, 4.5, 5.5)) return true;               // 前髪
    return false;
  };
  const toPx = (cx, cy, cz) => [cx - 11 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5];
  const carve = (cx, cy, cz) => !keep(...toPx(cx, cy, cz));
  carve.toString = () => 'popoiHair4';
  const colorOf = (cx, cy, cz) => {
    const [x, y, z] = toPx(cx, cy, cz);
    const ax = Math.abs(x);
    if (tuft(ax, y, z)) return tuftD(ax, y, z) > 2.35 ? POPOI.TUFT : POPOI.TUFT2;  // 実物は白が主で淡桃は縁だけ
    if (y >= 11) return POPOI.HAIR3;
    return ((cx * 3 + cy * 5 + cz) % 4 === 0) ? POPOI.HAIR2 : null;
  };
  colorOf.toString = () => 'popoiHairColor4';
  return makePart(22, 30, 11, 16, (d) => { d.r(0, 0, 22, 30, POPOI.HAIR); }, { res: 1, depth: 16, z0: -8, accent: 'popoi|hair4', carve, colorOf });
}

/**
 * 六面図から起こした独立の 1 体（2026-09-21 ユーザー指定：奏者のスタイルは一旦無視して試す）。
 *
 * 形＝前面図 × 側面図 × **上面図**の交差（visual hull）。上面図を足したことで頭の断面が丸くなる
 * （前面×側面だけだと断面が必ず長方形になり、髪が板になっていた）。
 *
 * ただし**腕の奥行きはどの図にも写っていない**（側面図では腕が胴に隠れ、上面図では髪に隠れる）。
 * 2026-09-21：距離変換で推定しようとしたが断面が菱形になり顔まで歪んだので撤回し、
 * 代わりに**腕・脚だけ奥行きを手で決める**。下の 4 つの定数がその指定で、ここを変えれば太さが変わる。
 */
const R3_TORSO_X = [5, 13];   // 胴の左右の範囲（これより外は腕）
const R3_ARM_Y = 19;          // ここから下が体（これより上は頭・髪で、上面図に任せる）
const R3_LEG_Y = 34;          // ここから下が脚
const R3_ARM_DEPTH = 5;       // 腕の奥行き（セル）。前面図での腕の幅とほぼ同じにすると丸い棒になる
const R3_LEG_DEPTH = 6;       // 脚の奥行き（セル）
// 側面の色を塗る時、前後の端から何セルぶんは前面図・背面図の色を回り込ませるか（2026-09-21 ユーザー指摘）。
// 参考シートの側面図には顔の横顔（目）が描かれていて、箱型の頭の側面にそれが丸ごと貼られると
// 「正面にも側面にも目がある」状態になる。実物の目は頭の前寄りなので、端は正面の色で包む
const R3_WRAP = 4;

export function randi3Data() {
  const { w, h, depth, palette, front, back, left, right, top } = RANDI3;
  const has = (g, i, j) => g[i][j] !== '.';
  const idx = (x, y, z) => (z * h + y) * w + x;
  const solid = new Uint8Array(w * h * depth);

  for (let y = 0; y < h; y++) {
    const zs = [];
    for (let z = 0; z < depth; z++) if (has(left, y, z) || has(right, y, z)) zs.push(z);
    if (!zs.length) continue;
    const z0 = zs[0], z1 = zs[zs.length - 1], cz = (z0 + z1) / 2;
    for (let x = 0; x < w; x++) {
      if (!has(front, y, x)) continue;
      // 腕・脚だけ、側面図より薄い奥行きに絞る（どの図にも写っていないので手で決める）
      let lo = z0, hi = z1;
      const limb = y >= R3_LEG_Y ? R3_LEG_DEPTH
                 : (y >= R3_ARM_Y && (x < R3_TORSO_X[0] || x > R3_TORSO_X[1])) ? R3_ARM_DEPTH : 0;
      if (limb) {
        lo = Math.max(z0, Math.round(cz - (limb - 1) / 2));
        hi = Math.min(z1, lo + limb - 1);
      }
      for (let z = lo; z <= hi; z++) {
        if (top[z][x] !== '#') continue;        // 上面図で外に出る所は落とす（頭が丸くなる）
        solid[idx(x, y, z)] = 1;
      }
    }
  }

  // 色：その面が**どちらを向いて露出しているか**で決める（距離で決めると正面に側面図の色が乗る）
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= depth) ? 0 : solid[idx(x, y, z)];
  // 柱ごとの前端・後端（側面の色を塗る時、端は正面・背面の色で包む）
  const zHi = new Int16Array(w * h).fill(-1), zLo = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let z = depth - 1; z >= 0; z--) if (solid[idx(x, y, z)]) { zHi[y * w + x] = z; break; }
    for (let z = 0; z < depth; z++) if (solid[idx(x, y, z)]) { zLo[y * w + x] = z; break; }
  }
  const layers = [];
  for (let z = 0; z < depth; z++) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        if (!solid[idx(x, y, z)]) { row += '.'; continue; }
        let ch = '.';
        if (!at(x, y, z + 1)) ch = front[y][x];                      // 前を向いた面
        if (ch === '.' && !at(x, y, z - 1)) ch = back[y][x];         // 後ろを向いた面
        if (ch === '.' && (!at(x + 1, y, z) || !at(x - 1, y, z))) {  // 左右を向いた面
          const hi = zHi[y * w + x], lo = zLo[y * w + x];
          if (hi - z < R3_WRAP) ch = front[y][x];                    // 前寄りは正面の色で包む
          else if (z - lo < R3_WRAP) ch = back[y][x];                // 後ろ寄りは背面の色で包む
          else ch = !at(x + 1, y, z) ? left[y][z] : right[y][z];     // 中ほどだけ側面図
          if (ch === '.') ch = !at(x + 1, y, z) ? left[y][z] : right[y][z];
        }
        if (ch === '.') ch = front[y][x];
        if (ch === '.') ch = back[y][x];
        if (ch === '.') ch = left[y][z] !== '.' ? left[y][z] : right[y][z];
        row += ch === '.' ? '.' : ch;
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return { res: 1, w, h, depth, z0: -depth / 2, pivotX: w / 2, pivotY: h, palette, back: null, layers };
}

// ---- 画面で編集したボクセル（assets/voxel/<キー>.json）による差し替え（2026-09-21 ユーザー指定）----
// 髪型などの細部は言葉で伝えるのが難しいので、編集画面（/edit.html）で直接いじって保存し、ここで読み替える。
// キーは「部位」ごと。同じ部位を使う衣装（cecil と cecil-suit 等）はまとめて変わる
const VOXELS = {};
export function setVoxelOverrides(map) {
  for (const k of Object.keys(VOXELS)) delete VOXELS[k];
  Object.assign(VOXELS, map || {});
}
export function hasVoxelOverride(key) { return !!VOXELS[key]; }

/** 編集できる部位の一覧（編集画面のプルダウン）。make は手続き的に作る元の形 */
export const PARTS = {
  cecilHead:   { label: 'セシル：面頬',   make: () => cecilHead() },
  cecilHelmet: { label: 'セシル：兜',     make: () => cecilHelmet() },
  tellaHead:   { label: 'テラ：顔',       make: () => tellaHead() },
  tellaHair:   { label: 'テラ：髪',       make: () => tellaHair() },
  randiHead:   { label: 'ランディ：顔',   make: () => randiHead() },
  randiHair:   { label: 'ランディ：髪',   make: () => randiHair() },
  primmHead:   { label: 'プリム：顔',     make: () => primmHead() },
  primmHair:   { label: 'プリム：髪',     make: () => primmHair() },
  popoiHead:   { label: 'ポポイ：顔',     make: () => popoiHead() },
  popoiHair:   { label: 'ポポイ：髪',     make: () => popoiHair() },
  // 三面図から起こした 1 体（部位ではなく全身）。手続き的な形が無いので bake() を持つ
  randi3:      { label: 'ランディ（三面図・全身）', bake: () => randi3Data(),
                 make: () => voxelPart(randi3Data(), 'randi3') },
};

/** 部位を作る。編集済みのボクセルがあればそちらを使う */
export function part(key) {
  const v = VOXELS[key];
  return v ? voxelPart(v, key + '|' + (v.rev || 0)) : PARTS[key].make();
}

/** 衣装ごとの部位の生成関数。persona(p) は手（肌色）や体型のために persona を差し替える。skirt があれば座奏で裾（ロングスカートと同じ仕組み）を付ける */
export const COSTUMES = {
  cecil: {
    persona: (p) => ({ ...p, gender: 'm', age: 'adult', skin: CECIL.GAUNT, skin2: CECIL.GAUNT2, hair: CECIL.LO, style: 'short',
                       glasses: false, beard: false, build: 1.0, height: 1.02, key: 'cecil' }),   // 手は籠手。体型は固定
    head: () => part('cecilHead'),
    hair: () => part('cecilHelmet'),
    torso: () => cecilTorso(),
    coat: (p, accent, standing) => cecilArmor(standing),
    legs: () => cecilLegs(),
  },
  tella: {
    persona: (p) => ({ ...p, gender: 'm', age: 'senior', skin: TELLA.SKIN, skin2: TELLA.SKIN2, hair: TELLA.HAIR, style: 'bald',
                       glasses: true, beard: true, build: 0.95, height: 0.94, key: 'tella' }),   // 小柄な老人
    head: () => part('tellaHead'),
    hair: () => part('tellaHair'),
    torso: () => tellaTorso(),
    coat: () => tellaHood(),
    legs: () => tellaLegs(),
    skirt: () => tellaSkirt(),
  },
  // 聖剣伝説2（2026-09-21 ユーザー指定）。いずれも顔と髪だけ作り、服は色だけ
  randi: {
    persona: (p) => ({ ...p, gender: 'm', age: 'young', skin: RANDI.SKIN, skin2: RANDI.SKIN2, hair: RANDI.HAIR, style: 'short',
                       glasses: false, beard: false, build: 0.95, height: 0.97, key: 'randi' }),
    head: () => part('randiHead'),
    hair: () => part('randiHair'),
    suit: RANDI.COAT,         // 青い上下
    tie: RANDI.BAND,          // 濃ピンクの襷
    shoe: RANDI.SHOE,         // 橙の靴
  },
  primm: {
    persona: (p) => ({ ...p, gender: 'f', age: 'young', skin: PRIMM.SKIN, skin2: PRIMM.SKIN2, hair: PRIMM.HAIR, style: 'long',
                       glasses: false, beard: false, build: 0.95, height: 0.96, key: 'primm' }),   // 女性＝ドレスとロングスカート
    head: () => part('primmHead'),
    hair: () => part('primmHair'),
    suit: PRIMM.DRESS,        // マゼンタのドレス
    tie: PRIMM.GEM,           // 緑の飾り（腰の帯・ブローチ）
  },
  popoi: {
    persona: (p) => ({ ...p, gender: 'm', age: 'young', skin: POPOI.SKIN, skin2: POPOI.SKIN2, hair: POPOI.HAIR, style: 'short',
                       glasses: false, beard: false, build: 0.95, height: 0.82, key: 'popoi' }),   // 小柄
    head: () => part('popoiHead'),
    hair: () => part('popoiHair'),
    suit: POPOI.TOP,          // 緑の服
    tie: POPOI.TUFT,          // 淡いピンクの差し色
    shoe: POPOI.TUFT,
  },
  // 兜だけセシル、服は燕尾服のまま色だけ紺紫（採用方式。2026-09-21 ユーザー指定）
  'cecil-suit': {
    persona: (p) => ({ ...p, gender: 'm', age: 'adult', skin: CECIL.SKIN, skin2: CECIL.SKIN2, hair: CECIL.LO, style: 'short',
                       glasses: false, beard: false, build: 1.05, height: 1.02, key: 'cecil' }),   // 戦闘用は手が素肌
    head: () => part('cecilHead'),
    hair: () => part('cecilHelmet'),
    suit: CECIL.MID,          // 上着＝青紫。ズボン・肩の陰は自動で一段明るく
    shirt: CECIL.DARK,        // 胸は白いシャツでなく板金
    tie: CECIL.GOLD,          // 喉元の金
    shoe: CECIL.GOLD,         // 戦闘用は金のブーツ
    neck: CECIL.DARK,         // 首は喉当て（手は素肌のまま）
  },
  // 顔と髪だけテラ、服は燕尾服のまま色だけ紫（もう一案。2026-09-21 ユーザー指定）
  'tella-suit': {
    persona: (p) => ({ ...p, gender: 'm', age: 'senior', skin: TELLA.SKIN, skin2: TELLA.SKIN2, hair: TELLA.HAIR, style: 'bald',
                       glasses: true, beard: true, build: 0.95, height: 0.94, key: 'tella' }),
    head: () => part('tellaHead'),
    hair: () => part('tellaHair'),
    suit: '#6b3fa6',
  },
};
