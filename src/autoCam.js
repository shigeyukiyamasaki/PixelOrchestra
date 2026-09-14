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
// 1 小節あたり何点で強さを測るか。打楽器の打音は短いので、粗いと取りこぼす
// （4 点だとグランカッサが 0 と判定され、打楽器が一度も候補に入らなかった。2026-09-13 実測）
const SAMPLES_PER_BAR = 16;
const MIN_BARS = 1;           // 最短ショット長 [小節]（切り替えの速さを上げ切った時）
const MAX_BARS = 8;           // 最長ショット長 [小節]
const BASE_BARS = 4;          // 標準のショット長 [小節]（切り替えの速さ 1 のとき）
const WIDE_EVERY = 3;         // アップがこの回数続いたら引きを挟む
const COND_RATIO = 0.35;      // 全体ショットのうち、指揮者を抜く割合
const XCLOSE_RATIO = 0.3;     // 寄りのうち、超近接にする割合
const XCLOSE_EVERY = 3;       // 寄りがこの回数続いても超近接が出なければ、次は必ず超近接にする
const BAR_SCAN_STEP = 0.02;   // 小節の頭を探す時の刻み [s]

// ---- カメラの置き方（すべて world unit）----
const WIDE = { z: 13, dolly: 3, y: 9, sway: 3, yWave: 1.5, target: [0, 3, -12] };
const COND = { dist: 7, dolly: 1.2, y: 3.4, targetY: 2.4, swing: 0.4, base: 0.5 };  // swing/base は [rad]
// 候補に残す下限。「そのパート自身の曲中の最大」に対する割合で見る。
// 小節内の一番強いパートと比べると、打楽器は絶対値で金管・弦に勝てず一度も候補に入らない
// （2026-09-13 実測：上位 8 に入る小節が 24 中 1〜2）。自分比なら「今このパートは頑張っている」を拾える
const RELEVANT_AT = 0.5;
// 同じ回数だけ抜かれている候補の中での優劣に足す揺らぎ。強い順に固定すると、
// ショット数が少ない曲では強い金管・弦だけで枠が埋まり、打楽器まで回らない（2026-09-13）
const PICK_JITTER = 0.6;
const RECENT_KEEP = 4;        // 直近これだけのパートは続けて抜かない
// 奏者は 3.2 unit ほどの背丈で 2.65 unit 間隔に並ぶ。近づきすぎると周りの奏者の中に入り込んで
// 何を写しているか分からなくなるので、距離を取って高い位置から見下ろす（2026-09-13 実測して調整）
// 超近接：奏者 1 人に寄る。狙うのは顔でも足元でもなく「楽器」（2026-09-13 ユーザー指定）。
// 楽器の高さはパートごとに違う（チェロは低く、金管は高い）ので、実際の高さを受け取って使う
// yOver = 楽器からどれだけ上にカメラを置くか。minOver = 席の足元からの最低の高さ。
// 低い位置に置くと周りの楽器や奏者に埋もれる（2026-09-14 実測：チェレスタがハープの陰に隠れた）
const XCLOSE = { dist: 4.6, yOver: 1.6, minOver: 4.2, targetY: 1.9 };
const CLOSE = { dist: 8.0, y: 5.6, targetY: 2.0 };
const MID = { dist: 14.0, y: 7.6, targetY: 1.8 };
// 列沿い：円弧の接線方向にカメラを置き、同じ列の奏者が並んで見える画（2026-09-14 ユーザー提案）。
// 例：チューバのあたりからトロンボーン・トランペットが並ぶ方向を見る
const ALONG = { back: 9.0, ahead: 7.0, out: 1.2, y: 2.6, targetY: 2.2 };
const ALONG_RATIO = 0.45;     // 寄りのうち、列沿いにする割合
const DOLLY_IN = 0.17;        // ショットの間に寄る割合
const YAW = 0.45;             // 正面を外す振り幅 [rad]（±26°）
// 横顔のアングル。寄りは指揮者側（正面）からばかりになるので、たまに真横から狙う
// （2026-09-14 ユーザー指摘：木管・弦の横顔がほとんど出ない）
const PROFILE_RATIO = 0.4;    // 寄りのうち、横向きから狙う割合
const PROFILE_MIN = 1.0, PROFILE_MAX = 1.45;   // 振り角 [rad]（57〜83°）

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// ショット番号から決まる 0〜1 の値（毎回同じ。乱数の代わり）
const wobble = (n, k = 0) => {
  const x = Math.sin((n + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const swing = (n, k) => wobble(n, k) * 2 - 1;   // -1〜1

/**
 * 席（同じパートの奏者たち）の中心。world 座標 [x, y, z]。
 * y は足元の高さ（ひな壇の上なら段の高さ）。これを無視して床基準で狙うと、
 * 段の上のパートでは足元やひな壇の面ばかり映る（2026-09-14 ユーザー指摘）
 */
function seatCenter(seat) {
  const ps = seat?.positions;
  if (!ps || !ps.length) return null;
  const n = ps.length;
  return [ps.reduce((a, q) => a + q.x, 0) / n, ps.reduce((a, q) => a + (q.y || 0), 0) / n,
    ps.reduce((a, q) => a + q.z, 0) / n];
}

/** そのパートの首席（指揮者に一番近い奏者）。アップはここを狙う */
function seatLead(seat, cz) {
  const ps = seat?.positions;
  if (!ps || !ps.length) return null;
  let best = ps[0], bd = Infinity;
  for (const q of ps) { const d = q.x * q.x + (q.z - cz) * (q.z - cz); if (d < bd) { bd = d; best = q; } }
  return [best.x, best.y || 0, best.z];
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

    // そのパート自身の曲中の最大（自分比を出すため。打楽器は絶対値では金管・弦に勝てない）
    const peak = energy.map((row) => row.reduce((a, x) => Math.max(a, x), 0) || 1);
    const rel = (i, b) => energy[i][b] / peak[i];

    // 小節ごとに「主役（はっきり目立つパート）」と「一番強いパート」を出す。
    // 主役が立たない小節でも、寄りたい時は一番強いパートを抜く（2026-09-13 修正）
    const closeRatio = clamp(opt.close ?? 0.6, 0, 1);
    const subject = new Array(nBars).fill(-1);   // ソロ・入り・明確な主役（-1 = 無し）
    const loudest = new Array(nBars).fill(-1);   // 音が鳴っていれば必ず入る
    const rank = new Array(nBars);               // 強い順のパート（同じパートが続くのを避ける時の代役）
    for (let b = 0; b < nBars; b++) {
      let top = -1, topE = 0, total = 0;
      for (let i = 0; i < seats.length; i++) { total += energy[i][b]; if (energy[i][b] > topE) { topE = energy[i][b]; top = i; } }
      if (top < 0 || topE <= 0) continue;
      loudest[b] = top;
      rank[b] = seats.map((_, i) => i).filter((i) => energy[i][b] > 0);
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
      else if (share > LEAD_SHARE) subject[b] = top;                     // 明確に目立つパート
    }

    // 同じ主役が続く小節をまとめてショットにする
    const rate = clamp(opt.rate ?? 1, 0.3, 3);
    // ショットの長さは「切り替えの速さ」で決める。主役の切れ目だけで切っていた時は、
    // 主役が毎小節変わるせいで全部が最短 2 小節になり、速さが効かなかった（2026-09-13 修正）
    const targetBars = clamp(Math.round(BASE_BARS / rate), MIN_BARS, MAX_BARS);
    // アップが続いた時に挟む引きも、「アップの割合」が高いほど緩める（1 で挟まない）
    const wideEvery = closeRatio >= 0.95 ? Infinity : Math.max(2, Math.round(WIDE_EVERY / Math.max(0.2, 1 - closeRatio)));
    let closeRun = 0, xcloseRun = 0;
    const shown = new Array(seats.length).fill(0);   // これまで抜いた回数（少ない席を優先して回す）
    // セクション（弦・木管・金管・打楽器）ごとの回数も見る。席の数が多い弦や、常に強い金管に
    // 偏って、打楽器が回ってこないため（2026-09-13 ユーザー指摘）
    const fams = seats.map((st) => opt.familyOf?.(st) || 'other');
    const shownFam = {};
    const recent = [];           // 直近で抜いたパート（新しい順。同じ顔ぶれの往復を避ける）
    let lastKind = '';
    for (let b = 0; b < nBars;) {
      // 基本は「切り替えの速さ」で決まる長さ。ただし途中で新しい主役（ソロ・入り）が出たらそこで切る
      let n = Math.min(targetBars, nBars - b);
      for (let k = MIN_BARS; k < n; k++) {
        if (subject[b + k] >= 0 && subject[b + k] !== subject[b]) { n = k; break; }
      }
      const idx = this.shots.length;
      let kind;
      // まず「寄るか引くか」を割合で決め、寄ると決めた時に誰を抜くかを選ぶ。
      // こうしないと、総奏ばかりの曲で主役が立たず、割合を上げても寄れない
      if (closeRun >= wideEvery) { kind = 'wide'; closeRun = 0; }        // アップが続いたら引きを挟む
      else if (wobble(idx, 1) < closeRatio) {
        // 寄るショット。その中でアップ／中景を分ける（割合が高いほどアップ寄り）
        // 超近接は寄りの中で先に決める。close/mid に割ってから判定すると確率が半分になり、
        // アップ 0.5 では 6% しか出なかった（2026-09-13 ユーザー指摘）。
        // 確率だけだと一度も出ない曲があるので、しばらく出ていなければ必ず入れる
        if (wobble(idx, 10) < XCLOSE_RATIO || xcloseRun >= XCLOSE_EVERY) kind = 'xclose';
        else if (wobble(idx, 11) < ALONG_RATIO) kind = 'along';   // 列沿いの横アングル
        else kind = wobble(idx, 8) < closeRatio ? 'close' : 'mid';
        xcloseRun = kind === 'xclose' ? 0 : xcloseRun + 1;
        closeRun++;
      } else {
        kind = wobble(idx) < COND_RATIO ? 'cond' : 'wide';
        // 引き・指揮者が続くのを避ける：寄れるなら寄り、寄れなければ引きと指揮者を入れ替える
        if (kind === lastKind) {
          if ((subject[b] >= 0 || loudest[b] >= 0)) kind = 'mid';
          else kind = kind === 'wide' ? 'cond' : 'wide';
        }
        closeRun = 0;
      }
      // 寄る時の被写体：主役がいればその人、いなければ一番強いパート。どちらも無ければ引きに落とす。
      // 直前のショットと同じパートは避け、次に強いパートへ回す（2026-09-13 ユーザー指定）
      let who = -1;
      if (kind !== 'wide' && kind !== 'cond') {
        const cands = [];
        if (subject[b] >= 0) cands.push(subject[b]);
        for (const i of (rank[b] || [])) if (!cands.includes(i)) cands.push(i);
        // ソロ・入り（はっきりした主役）は最優先。それ以外は「これまで抜いた回数が少ない席」を優先し、
        // 同数なら強い方。強い順に選ぶだけだと上位の常連ばかりになり、チェロ等が映らなくなる
        // （2026-09-13 ユーザー指摘）
        if (subject[b] >= 0 && !recent.includes(subject[b])) who = subject[b];
        else {
          const pool = cands.filter((i) => !recent.includes(i) && rel(i, b) >= RELEVANT_AT);
          const score = (i) => rel(i, b) + wobble(idx, 30 + i) * PICK_JITTER;
          const fam = (i) => shownFam[fams[i]] || 0;
          pool.sort((x, y) => (shown[x] - shown[y]) || (fam(x) - fam(y)) || (score(y) - score(x)));
          who = pool[0];
        }
        if (who === undefined) who = cands.find((i) => i !== recent[0] && rel(i, b) >= RELEVANT_AT);
        if (who === undefined) who = cands.find((i) => i !== recent[0]);
        if (who === undefined) {
          // 他に鳴っているパートが無い（長いソロが続いている等）。人は替えられないので寄り方を替える
          who = cands[0] ?? -1;
          if (who >= 0 && who === recent[0]) kind = kind === 'mid' ? 'close' : 'mid';
        }
        if (who < 0) { kind = 'wide'; closeRun = 0; }
      }
      if (kind !== 'wide' && kind !== 'cond') { shown[who]++; shownFam[fams[who]] = (shownFam[fams[who]] || 0) + 1; recent.unshift(who); recent.length = Math.min(recent.length, RECENT_KEEP); }
      else recent.length = 0;      // 引きを挟んだら制限を解く
      lastKind = kind;
      this.shots.push({
        t0: bars[b], t1: bars[Math.min(b + n, nBars)], kind, idx,
        center: who >= 0 ? seatCenter(seats[who]) : null,
        lead: who >= 0 ? seatLead(seats[who], conductorZ) : null,
        instY: who >= 0 ? (opt.instYOf?.(seats[who]) ?? XCLOSE.targetY) : XCLOSE.targetY,
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
   * @param {{conductorZ:number, move:number, moveFreq:number}} env
   *   move = 動きの量（0〜1）、moveFreq = 動くショットの割合（0 で全部固定、1 で全部動く）
   */
  at(t, env = {}) {
    const sh = this.shotAt(t);
    if (!sh) return null;
    const p = clamp((t - sh.t0) / Math.max(0.1, sh.t1 - sh.t0), 0, 1);   // ショット内の進み具合
    const cz = env.conductorZ ?? 0;
    const n = sh.idx;
    // このショットが「動くショット」かどうかはショット番号から決まる（毎回同じ）。
    // 動きの頻度で固定ショットとの割合を決め、動きの量でその大きさを決める（2026-09-13 ユーザー指定）
    const moving = wobble(n, 7) < clamp(env.moveFreq ?? 0.6, 0, 1);
    const move = moving ? clamp(env.move ?? 0.6, 0, 1) : 0;

    if (sh.kind === 'cond') {                                            // 指揮者：奏者側から顔を見る
      // 左右どちら側からも撮る。片側だけだと背景に写るパートがいつも同じになる（2026-09-13 ユーザー指摘）
      const side = wobble(n, 9) < 0.5 ? -1 : 1;
      const a = side * (COND.base + wobble(n, 4) * COND.swing);
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
    const c = (sh.kind === 'mid' || sh.kind === 'along' ? sh.center : sh.lead) || sh.center;   // 寄りは首席 1 人、中景・列沿いはパート全体
    if (sh.kind === 'along') {
      // 円弧の接線方向に構える。半径方向（中心 → 席）に対して直角が接線
      const base = c[1] || 0;
      let rx = c[0], rz = c[2] - cz;
      const len = Math.hypot(rx, rz) || 1;
      rx /= len; rz /= len;
      const tx = -rz, tz = rx;                                   // 接線（+ 方向）
      const dir = wobble(n, 12) < 0.5 ? -1 : 1;                  // どちら向きに列を見るかは半々
      const out = ALONG.out;                                     // 少し外側に下がって列の背後から
      const d = ALONG.back * (1 + 0.12 - 0.12 * p * move);
      return {
        pos: [c[0] + rx * out - tx * dir * d, base + ALONG.y, c[2] + rz * out - tz * dir * d],
        target: [c[0] + tx * dir * ALONG.ahead, base + ALONG.targetY, c[2] + tz * dir * ALONG.ahead],
      };
    }
    const k = sh.kind === 'xclose' ? XCLOSE : sh.kind === 'close' ? CLOSE : MID;
    // 狙う高さは「その席の足元の高さ」からの相対。ひな壇の上のパートでも胸の高さを狙える。
    // 超近接だけは楽器そのもの（外接箱の中心。world の絶対値）を狙う
    const base = c[1] || 0;
    const aimY = sh.kind === 'xclose' ? clamp(sh.instY ?? (base + k.targetY), 0.8, 8) : base + k.targetY;
    // 超近接は周りの頭より上に出してから見下ろす（低いと手前の楽器・奏者に埋もれる）
    const camY = sh.kind === 'xclose'
      ? Math.max(aimY + k.yOver, base + k.minOver)
      : base + k.y + swing(n, 6) * 0.4;
    const dist = k.dist * (1 + DOLLY_IN - DOLLY_IN * p * move);          // ショットの間にゆっくり寄る
    let dx = -c[0], dz = cz - c[2];                                      // 席 → 指揮者（内向き）
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // 向き：たいていは指揮者側（正面）から少し振る。たまに真横に回り込んで横顔を狙う
    const profile = wobble(n, 13) < PROFILE_RATIO;
    const a = profile
      ? (wobble(n, 14) < 0.5 ? -1 : 1) * (PROFILE_MIN + wobble(n, 15) * (PROFILE_MAX - PROFILE_MIN))
      : swing(n, 5) * YAW;
    const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
    return {
      pos: [c[0] + rx * dist, camY, c[2] + rz * dist],
      target: [c[0], aimY, c[2]],
    };
  }
}
