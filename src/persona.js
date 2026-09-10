/*
 * PixelOrchestra — persona.js
 * 最終更新: 2026-09-10 / v0.1 / 生成元: PixelOrchestra
 *
 * 奏者の老若男女の書き分け。seed から決定的に「人物像（persona）」を作り、
 * 顔・髪（2 倍解像度）、上半身（燕尾服 / ドレス）、脚（ズボン / ロングスカート）、手（肌色）を描く。
 * 同じ MIDI なら座席の seed が同じなので、毎回同じ顔ぶれになる。
 */
import { makePart, C, roundColumn } from './sprites.js';

const F = '#000';

// ---- 決定的な乱数（mulberry32）----
function rng(seed) {
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const weighted = (r, pairs) => { const total = pairs.reduce((a, p) => a + p[1], 0); let x = r() * total; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[pairs.length - 1][0]; };

// 肌：[肌, 影]
const SKINS = [['#f2cab5', '#daa893'], ['#efbea7', '#d79c82'], ['#e1a88e', '#c6886e'], ['#d7987e', '#b97862']]; // 黄色味を減らしてピンク寄り（色相 -9°・彩度 -5%。2026-09-11 ユーザー指定） // 褐色（#c98f63 / #8e5b3c）は外し、少し暗い肌まで（2026-09-10 ユーザー指定）
// 髪色（若年〜壮年）
const HAIR_YOUNG = [['#2b1b12', 32], ['#1a1a1e', 26], ['#5a3a1e', 22], ['#8a5a30', 12], ['#6d4b31', 8]]; // 赤毛・金髪は無し（2026-09-10 ユーザー指定）
// 髪色（高齢）
const HAIR_SENIOR = [['#c9c9c9', 45], ['#e8e8e8', 35], ['#8a8a8a', 20]];

/**
 * @param {number} seed
 * @returns {{gender:'m'|'f', age:'young'|'adult'|'senior', skin:string, skin2:string, hair:string, style:string,
 *            glasses:boolean, beard:boolean, height:number, key:string}}
 */
export function makePersona(seed) {
  const r = rng(seed + 1);
  const gender = r() < 0.5 ? 'm' : 'f';
  const age = weighted(r, [['young', 25], ['adult', 50], ['senior', 25]]);
  const [skin, skin2] = pick(r, SKINS);
  const hair = weighted(r, age === 'senior' ? HAIR_SENIOR : HAIR_YOUNG);
  let style;
  if (gender === 'm') style = age === 'senior' ? weighted(r, [['bald', 40], ['short', 35], ['sidepart', 25]]) : weighted(r, [['short', 40], ['sidepart', 35], ['slick', 25]]);
  else style = age === 'senior' ? weighted(r, [['bun', 50], ['bob', 35], ['short', 15]]) : weighted(r, [['long', 35], ['bob', 25], ['ponytail', 20], ['bun', 20]]);
  const glasses = r() < (age === 'senior' ? 0.4 : 0.15);
  const beard = gender === 'm' && age !== 'young' && r() < (age === 'senior' ? 0.35 : 0.18);
  const height = (age === 'young' ? 0.95 : age === 'senior' ? 0.97 : 1.0) + (r() - 0.5) * 0.06 + (gender === 'm' ? 0.02 : -0.02);
  const key = `${gender}${age}${skin}${hair}${style}${glasses ? 'g' : ''}${beard ? 'b' : ''}`;
  return { gender, age, skin, skin2, hair, style, glasses, beard, height, key, seed };
}

/**
 * 頭 24×30（2 倍解像度）、pivot = 首の付け根中央 (12, 24)。顔は箱の前面（平ら）：幅 10px（x 2-21）・高さ 9px（rows 6-23）・奥行き 8px。
 * 髪は別パーツ hairFor()（1px 粒の立体）で、この箱の上・横・後ろに被せる（2026-09-11 ユーザー指定：顔は平面・髪は立体）。
 * 老若男女：眼鏡・ひげ・しわ・頬・口紅
 */
export function headFor(p) {
  const { skin, skin2, hair, style } = p;
  const lips = p.gender === 'f' ? '#c4605a' : skin2;
  const browW = p.gender === 'm' ? 4 : 3;
  const bald = style === 'bald';
  const front = (d) => {
    d.r(2, 6, 20, 18, skin);                                  // 顔の箱の前面（あご下端 row 23）
    d.r(2, 12, 2, 4, skin2); d.r(20, 12, 2, 4, skin2);        // 耳（横の髪で隠れる。禿げは見える）
    // 眉・目・鼻・口
    const browC = hair === '#e8e8e8' || hair === '#c9c9c9' ? '#8a8a8a' : hair;
    d.r(7, 12, browW, 1, browC); d.r(17 - browW, 12, browW, 1, browC);
    d.r(8, 14, 2, 2, C.eye); d.r(14, 14, 2, 2, C.eye);        // 目は黒だけ（ハイライト無し。2026-09-10 ユーザー指定）
    d.p(12, 17, skin2);
    d.r(10, 19, 4, 1, lips);
    if (p.age === 'young' || p.gender === 'f') { d.r(5, 17, 2, 1, '#e8a99a'); d.r(17, 17, 2, 1, '#e8a99a'); } // 頬
    if (p.age === 'senior') { d.p(7, 17, skin2); d.p(16, 17, skin2); d.r(9, 21, 1, 1, skin2); d.r(14, 21, 1, 1, skin2); if (bald || style === 'slick') d.r(8, 8, 8, 1, skin2); } // しわ
    if (p.beard) { d.r(6, 20, 12, 4, hair); d.r(7, 18, 3, 1, hair); d.r(14, 18, 3, 1, hair); d.r(10, 19, 4, 1, lips); }
    if (p.glasses) { // 眼鏡：上の縁と左右の枠だけ（下の縁は省いて目を隠さない）＋ブリッジ
      const g = '#2a2a30';
      d.r(6, 13, 6, 1, g); d.r(12, 13, 6, 1, g);
      d.r(6, 14, 1, 2, g); d.r(11, 14, 1, 2, g); d.r(12, 14, 1, 2, g); d.r(17, 14, 1, 2, g);
      d.r(2, 13, 4, 1, g); d.r(18, 13, 4, 1, g);             // つる
    }
  };
  const side = (d) => { d.r(0, 6, 16, 18, F); d.r(15, 15, 1, 3, F); }; // 箱＋鼻
  const backMap = { [C.eye]: skin, '#ffffff': skin, [lips]: skin, [skin2]: skin, '#e8a99a': skin, '#2a2a30': skin, '#8a8a8a': skin, [hair]: skin };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back: backMap, accent: `head|${p.key}`, side });
}

/**
 * 髪 14×21×16 px（1px 粒）、pivot = 首の付け根中央（頭と同じ）。顔の箱（x ±5, y 0-9, z ±4）の外側に 1px の殻＋頭頂の盛りとして置く。
 * 形は carve（体積関数 keep）で決める：前髪（箱の前 z 4-5）・横（x ±5-6）・後ろ（z -5〜-4）・頭頂のドーム（y 9-12）＋髪型ごとの房・裾・付属。
 * 参考画像のスタイル（顔は平面、髪は粗い立体。2026-09-11 ユーザー指定）。房の位置は seed で左右が入れ替わる
 */
export function hairFor(p) {
  const { hair, style, gender } = p;
  const flip = p.seed % 2 ? -1 : 1;                     // 房の左右
  const box = (x, y, z, x0, x1, y0, y1, z0, z1) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  const male = gender === 'm';
  const keep = (px, y, z) => {                          // px, y, z = px（セル中心）
    const x = px * flip;                                // 以降は「flip 後」の座標で形を定義
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax <= 5 && az <= 4 && y >= 0 && y <= 9) return false;                   // 顔の箱の内側は空（面が重ならないように）
    if (style === 'bald') return box(ax, y, z, 5.5, 6, 5, 8, -5, 5) || box(ax, y, z, 0, 6, 5, 8, -5, -4.5); // 側頭部・後頭部の帯だけ
    // ---- 頭頂のドーム（3 段）----
    if (box(ax, y, az, 0, 6, 9.5, 10, 0, 5) || box(ax, y, az, 0, 5.5, 10.5, 11, 0, 4.5) || box(ax, y, az, 0, 4, 11.5, 12, 0, 3.5)) return true;
    // ---- 頭頂の房（髪型ごとに意図した段差）----
    switch (style) {
      case 'short':    if (box(x, y, z, -4.5, 0.5, 12.5, 13, 0.5, 4.5) || box(x, y, z, 1.5, 4.5, 12.5, 13, -3.5, 1.5)) return true; break; // 前左の房と中右の房
      case 'sidepart': if (box(x, y, z, -5.5, 1.5, 12.5, 13, -1.5, 5) || box(x, y, z, -6.5, -5.5, 9.5, 12, -3.5, 5)) return true; break; // 流した側が厚い
      case 'slick':    if (box(x, y, z, -3.5, 3.5, 12.5, 13, -4.5, -0.5) || box(ax, y, z, 0, 5, 6, 11, -6.5, -4.5)) return true; break;  // 後ろへ撫でつけた量感
      case 'bob':      if (box(x, y, z, -4.5, 4.5, 12.5, 13, -3.5, 1.5)) return true; break;
      case 'long':     if (box(x, y, z, -4.5, -0.5, 12.5, 13, -2.5, 2.5) || box(x, y, z, 1.5, 4.5, 12.5, 13, -1.5, 3.5)) return true; break;
      case 'ponytail': if (box(x, y, z, -3.5, 3.5, 12.5, 13, -3.5, -0.5)) return true; break;
      case 'bun':      if (box(ax, y, z, 0, 2.5, 12.5, 15, -4.5, -0.5) && !(y > 14 && (ax > 1.5 || z < -3.5 || z > -1.5))) return true; break; // お団子（角を落とす）
    }
    // ---- 横（もみあげ〜耳を覆う）と後ろ：下端は髪型で決まる ----
    if (male) { // 男性：横は耳の上まで、耳の前にもみあげ
      if (box(ax, y, z, 5.5, 6, 5, 9, -5, 5)) return true;
      if (box(ax, y, z, 5.5, 6, style === 'slick' ? 4 : 3, 5, 2.5, 4.5)) return true;         // もみあげ
      if (box(ax, y, z, 0, 6, 3, 9, -5, -4.5)) return true;                                     // 襟足
    } else if (style === 'bob') {
      const hem = z > 2 ? 2 : 1;                                                                // 裾：前は短く、横〜後ろは長く
      if (box(ax, y, z, 5.5, 6, hem, 9, -5, 5) || box(ax, y, z, 0, 6, hem, 9, -5, -4.5)) return true;
      if (box(ax, y, z, 6.5, 7, 1, 3, -5, 3) || box(ax, y, z, 0, 7, 1, 3, -6, -5.5)) return true; // 裾が外へ広がる
    } else if (style === 'long') {
      const col = Math.round(x + 7);                                                            // 裾の段差（列ごと）
      const hemSide = (z >= 0 ? -3 : -5) + (col % 2);
      const hemBack = -5 + (col % 3 === 0 ? 1 : 0);
      if (box(ax, y, z, 5.5, 6, hemSide, 9, -5, 5)) return true;
      if (box(ax, y, z, 0, 6, hemBack, 9, -5, -4.5)) return true;
      if (box(ax, y, z, 0, 6.5, -5, 6, -6, -5.5)) return true;                                  // 後ろの量感
    } else { // ポニーテール・お団子：横は耳の上まで
      if (box(ax, y, z, 5.5, 6, 4, 9, -5, 5) || box(ax, y, z, 0, 6, 4, 9, -5, -4.5)) return true;
    }
    // ---- 前髪（箱の前 1px）：房ごとに長さを変えて段々に ----
    if (z > 4 && z <= 5 && ax <= 5 && y <= 9) {
      const col = Math.floor(x + 5);                                                            // 0..9（flip 後）
      let yF;
      switch (style) {
        case 'short':    yF = [7, 6, 6, 7, 6, 6, 7, 6, 7, 7][col]; break;
        case 'sidepart': yF = col < 6 ? [5, 5, 6, 6, 7, 8][col] : 9; break;                     // 左に流す（右は額が出る）
        case 'slick':    yF = 9; break;                                                         // 前髪なし（撫でつけ）
        case 'bob':      yF = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6][col]; break;                       // ぱっつん
        case 'long':     yF = [6, 6, 7, 6, 8, 8, 6, 7, 6, 6][col]; break;                       // 真ん中で分ける
        case 'ponytail': yF = [7, 7, 8, 7, 7, 8, 7, 7, 8, 7][col]; break;
        case 'bun':      yF = col < 2 || col > 7 ? 7 : 9; break;                                // 両端の後れ毛だけ
        default:         yF = 7;
      }
      return y >= yF;
    }
    // ---- 付属：ポニーテール（後ろへ垂れる束）----
    if (style === 'ponytail') {
      if (box(ax, y, z, 0, 2, 7, 8, -6, -5)) return true;                                       // 結び目
      if (box(ax, y, z, 0, 1.5, 2, 7, -7, -5.5) || box(ax, y, z, 0, 1, 0, 2, -7, -6)) return true; // 束（先が細い）
    }
    return false;
  };
  const carve = (cx, cy, cz) => !keep(cx - 7 + 0.5, 16 - cy - 0.5, cz - 8 + 0.5);
  carve.toString = () => `hair(${style},${gender},${flip})`;
  // 二色：房単位（2px 幅）で少し暗い粒を混ぜる（髪の塊感）。人物ごとに違う
  const h3 = (x, y, z) => { let n = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (p.seed * 2654435761), 1) >>> 0; n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const dark = '#' + [1, 3, 5].map((i) => Math.round(parseInt(hair.slice(i, i + 2), 16) * 0.82).toString(16).padStart(2, '0')).join('');
  const colorOf = (cx, cy, cz) => (h3(Math.floor(cx / 2) + 100, cy + 100, Math.floor(cz / 2) + 100) < 0.22 ? dark : null);
  colorOf.toString = () => `hairColor(${p.seed})`;
  return makePart(14, 21, 7, 16, (d) => { d.r(0, 0, 14, 21, hair); }, { res: 1, depth: 16, z0: -8, accent: `hair|${p.key}|${p.seed}`, carve, colorOf });
}

/**
 * 上半身 32×42（2 倍解像度）、pivot = 腰の中央 (16, 42)。男性：燕尾服＋白シャツ＋蝶ネクタイ（トラック色）。女性：黒のドレス＋腰の帯（トラック色）
 */
export function torsoFor(p, accent = '#c03030') {
  const { skin } = p;
  const front = (d) => {
    d.r(12, 10, 8, 6, skin);                               // 首
    d.r(6, 16, 20, 26, C.coat);                            // 上着 / ドレス
    d.r(4, 18, 2, 16, C.coat2); d.r(26, 18, 2, 16, C.coat2); // 肩の陰
    if (p.gender === 'm') {
      d.r(12, 16, 8, 16, C.shirt);                         // シャツ
      d.r(9, 16, 3, 6, C.coat2); d.r(20, 16, 3, 6, C.coat2); // 襟（ラペル）
      d.r(10, 18, 12, 4, accent); d.r(15, 18, 2, 4, '#3a1a1a'); // 蝶ネクタイ
    } else {
      d.r(13, 16, 6, 4, skin); d.r(14, 20, 4, 2, skin);    // 襟ぐり（V ネック）
      d.r(6, 32, 20, 3, accent);                           // 腰の帯（トラック色）
      d.r(14, 22, 4, 3, accent);                           // 胸のブローチ
    }
  };
  const side = (d) => { d.r(4, 10, 6, 6, F); d.r(0, 16, 12, 12, F); d.r(2, 28, 8, 14, F); };
  const back = { [C.shirt]: C.coat, [accent.toLowerCase()]: C.coat, '#3a1a1a': C.coat, [C.coat2]: C.coat2 };
  return makePart(32, 42, 16, 42, front, { res: 2, depth: 12, z0: -6, back, accent: `torso|${p.gender}|${accent}|${skin}`, side });
}

/** 立った脚 32×26（2 倍解像度）、pivot = 足元中央。男性：燕尾＋ズボン、女性：ロングスカート */
export function legsStandingFor(p) {
  const front = (d) => {
    if (p.gender === 'm') {
      d.r(6, 0, 8, 8, C.coat); d.r(18, 0, 8, 8, C.coat);     // 燕尾
      d.r(8, 0, 6, 22, C.coat2); d.r(18, 0, 6, 22, C.coat2); // ズボン
    } else {
      d.r(6, 0, 20, 22, C.coat); d.r(5, 12, 22, 10, C.coat);   // ロングスカート（裾広がり）
    }
    d.r(6, 22, 8, 4, C.shoe); d.r(18, 22, 8, 4, C.shoe);     // 靴
  };
  const side = p.gender === 'm' ? (d) => { d.r(2, 0, 8, 22, F); d.r(0, 22, 12, 4, F); } : (d) => { d.r(1, 0, 10, 12, F); d.r(0, 12, 12, 10, F); d.r(0, 22, 12, 4, F); };
  // 男性のズボンは断面を円に（腰 r3.2 → 足首 r2.6。燕尾がかかる上 8 行は削らない。2026-09-11）。左右の脚の中心 x = 11, 21、z 中心 6
  const legL = roundColumn(11, 6, 3.2, 2.6, 8, 21), legR = roundColumn(21, 6, 3.2, 2.6, 8, 21);
  const carve = p.gender === 'm' ? (x, y, z) => (x < 16 ? legL(x, y, z) : legR(x, y, z)) : null;
  return makePart(32, 26, 16, 26, front, { res: 2, depth: 12, z0: -6, accent: `legs|${p.gender}`, side, carve });
}

/** 座った女性のスカート：腰の上（太ももを覆う）＋膝から床へ垂れる前面。基本 px で配置（puppet 側で thigh と同じ位置に置く） */
export function skirtSeated() { // 2 倍解像度（2026-09-10）。寸法は従来どおり（腰 16×4×10、前面 16×12×2 [px]）。前面にひだの縦線
  const hip = makePart(32, 8, 16, 8, (d) => { d.r(0, 0, 32, 8, C.coat); d.r(0, 0, 32, 1, C.coat2); }, { res: 2, depth: 20, z0: 0, accent: 'skirtHip' });     // y 12..16, z 0..10
  const front = makePart(32, 24, 16, 24, (d) => { d.r(0, 0, 32, 24, C.coat); for (let x = 4; x < 32; x += 7) d.r(x, 2, 1, 22, C.coat2); }, { res: 2, depth: 4, z0: 0, accent: 'skirtFront' }); // 膝から床へ
  return { hip, front };
}

/**
 * 手 12×12（2 倍解像度）、pivot = 手首（上端中央 (6,2)）。-y が指先、長さ 8 セル = 4px（HAND_LEN と同じ）。
 * 掌 3.5px 幅・厚み 2px、指 4 本は先端側 3 セルで分かれ（中指・薬指が長い）厚みは掌の半分、親指は体の内側（R は -x、L は +x）。
 * 肌色は人物ごと（2026-09-10 解像度アップ）
 */
export function handFor(p, side = 'R') {
  const tx = side === 'R' ? 1 : 10; // 親指の x（内側）
  return makePart(12, 12, 6, 2, (d) => {
    d.r(4, 2, 5, 1, p.skin);                                   // 手首側は少し細い
    d.r(3, 3, 7, 5, p.skin);                                   // 掌
    d.r(tx + (side === 'R' ? 1 : 0), 3, 1, 4, p.skin); d.r(tx, 4, 1, 3, p.skin); d.p(tx, 6, p.skin2); // 親指（斜めに出る）
    for (let i = 0; i < 4; i++) { const x = 3 + i * 2, tip = (i === 1 || i === 2) ? 10 : 9; d.r(x, 8, 1, tip - 8, p.skin); d.p(x, tip, p.skin2); } // 指 4 本
    d.r(3, 7, 7, 1, p.skin2);                                  // 指の付け根（関節の線）
  }, { res: 2, depth: 4, z0: -2, accent: `hand|${p.skin}|${side}`,
       side: (d) => { d.r(0, 2, 4, 6, F); d.r(1, 8, 2, 4, F); } }); // (z, y)：掌は 4 セル厚、指は 2 セル厚
}
