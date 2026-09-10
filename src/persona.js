/*
 * PixelOrchestra — persona.js
 * 最終更新: 2026-09-10 / v0.1 / 生成元: PixelOrchestra
 *
 * 奏者の老若男女の書き分け。seed から決定的に「人物像（persona）」を作り、
 * 顔・髪（2 倍解像度）、上半身（燕尾服 / ドレス）、脚（ズボン / ロングスカート）、手（肌色）を描く。
 * 同じ MIDI なら座席の seed が同じなので、毎回同じ顔ぶれになる。
 */
import { makePart, C } from './sprites.js';

const F = '#000';

// ---- 決定的な乱数（mulberry32）----
function rng(seed) {
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const weighted = (r, pairs) => { const total = pairs.reduce((a, p) => a + p[1], 0); let x = r() * total; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[pairs.length - 1][0]; };

// 肌：[肌, 影]
const SKINS = [['#f4d3b3', '#dcb391'], ['#f1c9a5', '#d9a880'], ['#e3b48c', '#c8956c'], ['#d9a57c', '#bb8560']]; // 褐色（#c98f63 / #8e5b3c）は外し、少し暗い肌まで（2026-09-10 ユーザー指定）
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
  return { gender, age, skin, skin2, hair, style, glasses, beard, height, key };
}

/**
 * 頭 24×30（2 倍解像度）、pivot = 首の付け根中央 (12, 24)。rows 24-29 は首より下（ロングヘアの分）。奥行き 16。
 * 老若男女：髪型・髪色・眼鏡・ひげ・しわ・頬・口紅
 */
export function headFor(p) {
  const { skin, skin2, hair, style } = p;
  const lips = p.gender === 'f' ? '#c4605a' : skin2;
  const browW = p.gender === 'm' ? 4 : 3;
  const bald = style === 'bald';
  const front = (d) => {
    // 顔（あご下端 row 23）
    d.r(4, 6, 16, 18, skin);
    d.p(4, 6, null); d.p(19, 6, null); d.p(4, 23, null); d.p(19, 23, null);
    d.r(5, 22, 1, 2, skin2); d.r(18, 22, 1, 2, skin2);
    // 頭頂：髪または地肌（bald）
    if (bald) { d.r(4, 2, 16, 4, skin); d.r(5, 1, 14, 1, skin); d.r(6, 0, 12, 1, skin); }
    else { d.r(2, 2, 20, 8, hair); d.r(3, 1, 18, 1, hair); d.r(4, 0, 16, 1, hair); }
    // 髪型
    switch (style) {
      case 'short':    d.r(2, 10, 2, 4, hair); d.r(20, 10, 2, 4, hair); break;
      case 'sidepart': d.r(2, 10, 2, 4, hair); d.r(20, 10, 2, 4, hair); d.r(11, 10, 9, 2, hair); d.r(14, 12, 6, 1, hair); break;
      case 'slick':    d.r(2, 9, 20, 1, hair); break;
      case 'bald':     d.r(2, 8, 3, 7, hair); d.r(19, 8, 3, 7, hair); d.r(2, 7, 20, 1, hair); break; // 側頭部だけ
      case 'bob':      d.r(2, 10, 3, 11, hair); d.r(19, 10, 3, 11, hair); d.r(4, 10, 16, 2, hair); d.r(5, 12, 4, 1, hair); break;
      case 'long':     d.r(1, 10, 4, 20, hair); d.r(19, 10, 4, 20, hair); d.r(4, 10, 6, 2, hair); d.r(14, 10, 6, 2, hair); break;
      case 'ponytail': d.r(2, 10, 2, 5, hair); d.r(20, 10, 2, 5, hair); d.r(4, 10, 16, 1, hair); break;
      case 'bun':      d.r(2, 10, 2, 5, hair); d.r(20, 10, 2, 5, hair); d.r(8, 0, 8, 2, hair); d.r(7, 1, 10, 1, hair); break;
    }
    // 耳
    d.r(2, 12, 2, 4, skin); d.r(20, 12, 2, 4, skin); d.p(2, 14, skin2); d.p(21, 14, skin2);
    // 眉・目・鼻・口
    d.r(7, 12, browW, 1, hair === '#e8e8e8' || hair === '#c9c9c9' ? '#8a8a8a' : hair); d.r(17 - browW, 12, browW, 1, hair === '#e8e8e8' || hair === '#c9c9c9' ? '#8a8a8a' : hair);
    d.r(8, 14, 2, 2, C.eye); d.r(14, 14, 2, 2, C.eye); // 目は黒だけ（ハイライト無し。2026-09-10 ユーザー指定）
    d.p(12, 17, skin2);
    d.r(10, 19, 4, 1, lips);
    if (p.age === 'young' || p.gender === 'f') { d.p(6, 17, '#e8a99a'); d.p(17, 17, '#e8a99a'); }
    if (p.age === 'senior') { d.p(7, 17, skin2); d.p(16, 17, skin2); d.r(9, 21, 1, 1, skin2); d.r(14, 21, 1, 1, skin2); if (bald || style === 'slick') d.r(8, 8, 8, 1, skin2); } // しわ
    if (p.beard) { d.r(6, 20, 12, 4, hair); d.r(7, 18, 3, 1, hair); d.r(14, 18, 3, 1, hair); d.r(10, 19, 4, 1, lips); }
    if (p.glasses) { // 眼鏡：上の縁と左右の枠だけ（下の縁は省いて目を隠さない）＋ブリッジ
      const g = '#2a2a30';
      d.r(6, 13, 6, 1, g); d.r(12, 13, 6, 1, g);
      d.r(6, 14, 1, 2, g); d.r(11, 14, 1, 2, g); d.r(12, 14, 1, 2, g); d.r(17, 14, 1, 2, g);
      d.p(2, 13, g); d.p(3, 13, g); d.p(20, 13, g); d.p(21, 13, g); // つる
    }
  };
  // 側面図（幅 16 = 奥行き、右端が正面）：後頭部は丸く、鼻が少し出る。髪型で後ろの形が変わる
  const side = (d) => {
    d.r(3, 0, 10, 1, F); d.r(1, 1, 13, 1, F); d.r(0, 2, 15, 8, F);
    d.r(1, 10, 14, 10, F); d.r(2, 20, 12, 2, F); d.r(4, 22, 9, 2, F);
    d.r(15, 15, 1, 3, F);                                   // 鼻
    d.r(0, 10, 2, 6, F);                                    // 後頭部
    if (style === 'long') d.r(0, 10, 4, 20, F);             // 後ろに垂れる髪
    if (style === 'bob') d.r(0, 10, 3, 11, F);
    if (style === 'ponytail') d.r(0, 6, 3, 16, F);          // 束ねた髪が後ろへ
    if (style === 'bun') d.r(1, 0, 5, 6, F);                // お団子（後頭部の上）
  };
  const backMap = bald ? { [C.eye]: skin, '#ffffff': skin, [lips]: skin, [skin2]: skin }
                       : { [skin]: hair, [skin2]: hair, [C.eye]: hair, '#ffffff': hair, [lips]: hair, '#e8a99a': hair, '#2a2a30': hair, '#8a8a8a': hair };
  // 丸み：頭部（rows 0-23）を超楕円（3 乗）で削って角を落とす。鼻・耳は中央付近なので残る。首より下の髪は削らない
  const carve = (x, y, z) => {
    if (y >= 24) return false;
    const dx = (x + 0.5 - 12) / 12.6, dy = (y + 0.5 - 12) / 12.6, dz = (z + 0.5 - 8) / 8.8;
    // 上下左右は 3 乗（角丸の四角）、前後は 2 乗（顔の面と後頭部が丸く膨らむ。2026-09-10 ユーザー指定）
    return Math.abs(dx) ** 3 + Math.abs(dy) ** 3 + dz * dz > 1;
  };
  // 頭の後ろ半分（z < 8）は、額〜あご（rows 10-23）の列でも髪色にする（角を丸めた側面に額の肌が出て禿げて見えるのを防ぐ。2026-09-10 ユーザー指摘）。
  // 耳（x 2-3 / 20-21, rows 12-15）とあご下（rows ≥ 20 の中央）は肌のまま。薄毛は側頭部の帯（rows 8-15）だけ髪
  const colorOf = (x, y, z) => {
    if (y >= 24) return null;
    if (!bald && (x <= 5 || x >= 18) && y >= 10 && y <= 11) return hair; // こめかみ：前後どこでも髪（生え際）
    if (z >= 8) return null;
    const ear = (x <= 3 || x >= 20) && y >= 12 && y <= 15;
    if (ear) return null;
    if (bald) return y >= 8 && y <= 15 ? hair : null;
    if (y >= 10 && y <= 19) return hair;
    if (y >= 20 && (x <= 5 || x >= 18)) return hair;   // あごの横（うなじ側）
    return null;
  };
  return makePart(24, 30, 12, 24, front, { res: 2, depth: 16, z0: -8, back: backMap, accent: `head|${p.key}`, side, carve, colorOf });
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
  return makePart(32, 26, 16, 26, front, { res: 2, depth: 12, z0: -6, accent: `legs|${p.gender}`, side });
}

/** 座った女性のスカート：腰の上（太ももを覆う）＋膝から床へ垂れる前面。基本 px で配置（puppet 側で thigh と同じ位置に置く） */
export function skirtSeated() {
  const hip = makePart(16, 4, 8, 4, (d) => { d.r(0, 0, 16, 4, C.coat); }, { depth: 10, z0: 0, accent: 'skirtHip' });     // y 12..16, z 0..10
  const front = makePart(16, 12, 8, 12, (d) => { d.r(0, 0, 16, 12, C.coat); }, { depth: 2, z0: 0, accent: 'skirtFront' }); // 膝から床へ
  return { hip, front };
}

/** 手 5×5、pivot = 手首（上端中央）。-y が指先。肌色は人物ごと */
export function handFor(p) {
  return makePart(5, 5, 2, 1, (d) => { d.r(1, 0, 3, 4, p.skin); d.r(1, 3, 3, 1, p.skin2); }, { depth: 3, z0: -1.5, accent: `hand|${p.skin}` });
}
