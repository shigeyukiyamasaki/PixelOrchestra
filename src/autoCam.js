/*
 * PixelOrchestra — autoCam.js
 * 最終更新: 2026-09-13 / v0.1 / 生成元: PixelOrchestra
 *
 * 自動カメラ（演奏会のカメラワーク）。2026-09-13 ユーザー指定。
 *
 * 考え方：曲を読み込んだ時に「小節ごとの主役」を先に決めてショットの一覧を作り、
 * 再生中は時刻からショットを引くだけにする。カメラ位置が時刻だけで決まるので、
 * 再生位置を戻しても同じカメラワークになり、後でオフラインに書き出しても一致する。
 * 乱数は使わず、ショット番号から決まる固定の揺らぎで変化を付ける。
 */

// ---- 判定のしきい値（すべて 0〜1 の割合）----
const SOLO_SHARE = 0.5;       // 一番強いパートが全体のこれ以上を占め、かつ他が鳴っていなければソロ
const SOUNDING_AT = 0.25;     // 「鳴っている」と数える下限（一番強いパートに対する割合）
const ENTER_AT = 0.6;         // 「入り」と見なす強さ（一番強いパートに対する割合）
const LEAD_SHARE = 0.3;       // これ以上を占めていれば、そのパートを主役にする

// ---- ショットの組み立て ----
const SAMPLES_PER_BAR = 4;    // 1 小節あたり何点で強さを測るか
const MIN_BARS = 2;           // 最短ショット長 [小節]
const MAX_BARS = 8;           // 最長ショット長 [小節]
const BASE_BARS = 4;          // 標準のショット長 [小節]（切り替えの速さ 1 のとき）
const WIDE_EVERY = 3;         // アップがこの回数続いたら引きを挟む
const COND_RATIO = 0.35;      // 全体ショットのうち、指揮者を抜く割合
const BAR_SCAN_STEP = 0.02;   // 小節の頭を探す時の刻み [s]

// ---- カメラの置き方（すべて world unit）----
const WIDE = { z: 13, dolly: 3, y: 9, sway: 3, yWave: 1.5, target: [0, 3, -12] };
const COND = { dist: 7, dolly: 1.2, y: 3.4, targetY: 2.4, swing: 0.4, base: 0.5 };  // swing/base は [rad]
// 奏者は 3.2 unit ほどの背丈で 2.65 unit 間隔に並ぶ。近づきすぎると周りの奏者の中に入り込んで
// 何を写しているか分からなくなるので、距離を取って高い位置から見下ろす（2026-09-13 実測して調整）
const CLOSE = { dist: 8.0, y: 5.6, targetY: 2.0 };
const MID = { dist: 14.0, y: 7.6, targetY: 1.8 };
const DOLLY_IN = 0.17;        // ショットの間に寄る割合
const YAW = 0.45;             // 正面を外す振り幅 [rad]（±26°）

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// ショット番号から決まる 0〜1 の値（毎回同じ。乱数の代わり）
const wobble = (n, k = 0) => {
  const x = Math.sin((n + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const swing = (n, k) => wobble(n, k) * 2 - 1;   // -1〜1

/** 席（同じパートの奏者たち）の中心。world 座標 [x, 0, z] */
function seatCenter(seat) {
  const ps = seat?.positions;
  if (!ps || !ps.length) return null;
  const n = ps.length;
  return [ps.reduce((a, q) => a + q.x, 0) / n, 0, ps.reduce((a, q) => a + q.z, 0) / n];
}

/** そのパートの首席（指揮者に一番近い奏者）。アップはここを狙う */
function seatLead(seat, cz) {
  const ps = seat?.positions;
  if (!ps || !ps.length) return null;
  let best = ps[0], bd = Infinity;
  for (const q of ps) { const d = q.x * q.x + (q.z - cz) * (q.z - cz); if (d < bd) { bd = d; best = q; } }
  return [best.x, 0, best.z];
}

export class AutoCamera {
  constructor() { this.shots = []; }

  /**
   * ショットの一覧を作る。曲・座席・設定が変わった時だけ呼ぶ（重いので毎フレームは呼ばない）
   * @param {object} engine MidiEngine
   * @param {Array<{track:object, positions:Array<{x,y,z}>}>} seats layoutSeats() の戻り値
   * @param {{rate:number, close:number}} opt rate = 切り替えの速さ、close = アップの割合
   */
  build(engine, seats, opt = {}, conductorZ = 0) {
    this.shots = [];
    if (!engine || !seats || !seats.length || !(engine.duration > 0)) return;
    const bars = this._barTimes(engine);
    if (bars.length < 2) return;
    const nBars = bars.length - 1;

    // 小節ごとに、各パートの強さを測る（鳴っていない小節は 0）
    const energy = seats.map(() => new Array(nBars).fill(0));
    for (let b = 0; b < nBars; b++) {
      const t0 = bars[b], step = (bars[b + 1] - t0) / SAMPLES_PER_BAR;
      seats.forEach((seat, i) => {
        let e = 0;
        for (let k = 0; k < SAMPLES_PER_BAR; k++) {
          const st = engine.trackState(seat.track, t0 + step * (k + 0.5));
          if (st.active.length) e = Math.max(e, Math.max(0.05, st.energy));
        }
        energy[i][b] = e;
      });
    }

    // 小節ごとの主役を決める（-1 = 全体）
    const subject = new Array(nBars).fill(-1);
    for (let b = 0; b < nBars; b++) {
      let top = -1, topE = 0, total = 0;
      for (let i = 0; i < seats.length; i++) { total += energy[i][b]; if (energy[i][b] > topE) { topE = energy[i][b]; top = i; } }
      if (top < 0 || topE <= 0) continue;
      let sounding = 0, entered = -1;
      for (let i = 0; i < seats.length; i++) {
        if (energy[i][b] > topE * SOUNDING_AT) sounding++;
        // 入り：直前 2 小節休んでいたパートが、それなりの強さで入ってきた
        if (entered < 0 && b >= 2 && energy[i][b] > topE * ENTER_AT
            && energy[i][b - 1] === 0 && energy[i][b - 2] === 0) entered = i;
      }
      const share = topE / total;
      if (sounding === 1 && share > SOLO_SHARE) subject[b] = top;        // ソロ
      else if (entered >= 0) subject[b] = entered;                       // 入り
      else if (share > LEAD_SHARE) subject[b] = top;                     // 一番強いパート
    }

    // 同じ主役が続く小節をまとめてショットにする
    const rate = clamp(opt.rate ?? 1, 0.3, 3);
    const maxBars = clamp(Math.round(BASE_BARS / rate), MIN_BARS, MAX_BARS);
    const closeRatio = clamp(opt.close ?? 0.6, 0, 1);
    let closeRun = 0;
    for (let b = 0; b < nBars;) {
      let n = 1;
      while (b + n < nBars && subject[b + n] === subject[b] && n < maxBars) n++;
      if (n < MIN_BARS) n = Math.min(MIN_BARS, nBars - b);               // 短すぎるショットは作らない
      const idx = this.shots.length;
      const who = subject[b];
      let kind;
      if (who < 0) { kind = wobble(idx) < COND_RATIO ? 'cond' : 'wide'; closeRun = 0; }
      else if (closeRun >= WIDE_EVERY) { kind = 'wide'; closeRun = 0; }  // アップが続いたら引きを挟む
      else { kind = wobble(idx, 1) < closeRatio ? 'close' : 'mid'; closeRun++; }
      this.shots.push({
        t0: bars[b], t1: bars[Math.min(b + n, nBars)], kind, idx,
        center: who >= 0 ? seatCenter(seats[who]) : null,
        lead: who >= 0 ? seatLead(seats[who], conductorZ) : null,
        name: who >= 0 ? seats[who].track?.name : '全体',
      });
      b += n;
    }
  }

  /** 小節の頭の時刻 [s] を並べる。曲中で拍子が変わっても追従する */
  _barTimes(engine) {
    const out = [0];
    let prev = engine.beatAt(0).beatInBar;
    for (let t = BAR_SCAN_STEP; t < engine.duration; t += BAR_SCAN_STEP) {
      const b = engine.beatAt(t).beatInBar;
      if (b === 0 && prev !== 0) out.push(t);
      prev = b;
    }
    out.push(engine.duration);
    return out;
  }

  /** 時刻 t のショット（無ければ null）。デバッグ表示にも使う */
  shotAt(t) {
    const shots = this.shots;
    if (!shots.length) return null;
    let lo = 0, hi = shots.length - 1, k = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (shots[m].t0 <= t) { k = m; lo = m + 1; } else hi = m - 1; }
    return shots[k];
  }

  /**
   * 時刻 t のカメラ。{ pos:[x,y,z], target:[x,y,z] }（ショットが無ければ null）
   * @param {number} t 再生位置 [s]
   * @param {{conductorZ:number, move:number}} env move = 動きの量（0〜1）
   */
  at(t, env = {}) {
    const sh = this.shotAt(t);
    if (!sh) return null;
    const p = clamp((t - sh.t0) / Math.max(0.1, sh.t1 - sh.t0), 0, 1);   // ショット内の進み具合
    const move = clamp(env.move ?? 0.6, 0, 1);
    const cz = env.conductorZ ?? 0;
    const n = sh.idx;

    if (sh.kind === 'cond') {                                            // 指揮者：奏者側から顔を見る
      const a = COND.base + swing(n, 4) * COND.swing;
      const d = COND.dist - COND.dolly * p * move;
      return { pos: [Math.sin(a) * d, COND.y, cz - Math.cos(a) * d], target: [0, COND.targetY, cz] };
    }
    if (sh.kind === 'wide' || !sh.center) {                              // 引き：正面から全景
      return {
        pos: [swing(n, 2) * WIDE.sway * move, WIDE.y + swing(n, 3) * WIDE.yWave, WIDE.z - WIDE.dolly * p * move],
        target: WIDE.target,
      };
    }
    // 奏者：席の位置から、指揮者側（内側）の斜め上に置いて見下ろす。
    // アップは首席 1 人、中景はパート全体の中心を狙う
    const k = sh.kind === 'close' ? CLOSE : MID;
    const c = (sh.kind === 'close' ? sh.lead : sh.center) || sh.center;
    const dist = k.dist * (1 + DOLLY_IN - DOLLY_IN * p * move);          // ショットの間にゆっくり寄る
    let dx = -c[0], dz = cz - c[2];                                      // 席 → 指揮者（内向き）
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const a = swing(n, 5) * YAW;                                         // 正面を外して斜めから
    const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
    return {
      pos: [c[0] + rx * dist, k.y + swing(n, 6) * 0.4, c[2] + rz * dist],
      target: [c[0], k.targetY, c[2]],
    };
  }
}
