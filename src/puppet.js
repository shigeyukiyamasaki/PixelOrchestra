/*
 * PixelOrchestra — puppet.js
 * 最終更新: 2026-09-09 / v0.3 / 生成元: PixelOrchestra
 *
 * 2D パペット（パーツ板を pivot で回す）。全楽器が 2 関節腕＋平面 IK で動く：
 *   「手をどこに置くか」を楽器ごとに座標で決め、肩・肘の角度は IK が解く。
 * 座標系：rig 空間の px（足元中央が原点、y 上向き）。1px = PX unit。
 * 角度規約：腕の rotation.z は「垂らした向きを 0、+ で手が +x 側へ上がる」。
 */
import { PX, body, head, upperArm, foreArm, INSTRUMENT, glowDisc } from './sprites.js';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ARM_UPPER = 8, ARM_FORE = 8; // 2関節腕の長さ [px]（上腕・前腕）
const SHOULDER = { L: [-6, 30], R: [6, 30] };
const ELBOW_SIGN = { L: -1, R: +1 }; // 肘を出す側（左腕は -x、右腕は +x）

/**
 * 2関節の平面 IK。肩 S から手 T へ、上腕 L1・前腕 L2 で届く角度を返す。
 * elbowSign: 肘を出す側（+1 = +x 側、-1 = -x 側）
 * @returns {{theta1:number, theta2:number}} 上腕の垂下角、前腕の垂下角（どちらも世界＝rig 基準）
 */
function solveIK(S, T, L1, L2, elbowSign) {
  const dx = T[0] - S[0], dy = T[1] - S[1];
  const d = clamp(Math.hypot(dx, dy), 0.05, L1 + L2 - 0.05);
  const base = Math.atan2(dx, -dy);
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  let best = null;
  for (const sgn of [1, -1]) {
    const th1 = base + sgn * A;
    const ex = S[0] + L1 * Math.sin(th1), ey = S[1] - L1 * Math.cos(th1);
    const score = elbowSign * (ex - S[0]);
    if (!best || score > best.score) best = { th1, ex, ey, score };
  }
  const th2 = Math.atan2(T[0] - best.ex, -(T[1] - best.ey));
  return { theta1: best.th1, theta2: th2 };
}

// 楽器ローカル px（pivot 基準・y 上向き）→ rig px。楽器の現在の位置・回転・鏡像を反映
function instPoint(inst, lx, ly) {
  const x = inst.scale.x < 0 ? -lx : lx;
  const c = Math.cos(inst.rotation.z), s = Math.sin(inst.rotation.z);
  return [inst.position.x / PX + x * c - ly * s, inst.position.y / PX + x * s + ly * c];
}

// ---------------- 楽器バリアント別の設定 ----------------
// inst: { pos:[px,py,z], rot, mirror }  held: { L/R: item }
// 家族ごとの「手の置き方」は下の update 関数群を参照。値はすべて rig px。
const VARIANT = {
  // 弦：bow = { contact: 弓と弦の接点, world: 正面から見た弓の角度, sMin/sMax: 接点→手元の距離 }, leftHand: 左手の位置, vib: ビブラートの方向
  violin:     { inst: { pos: [-5, 28, 0.03], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [-3.2, 28.9], world: 2.3, sMin: 3, sMax: 17 }, leftHand: [-9.0, 27.2] },
  viola:      { inst: { pos: [-5, 28, 0.03], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [-3.2, 28.9], world: 2.3, sMin: 3, sMax: 17 }, leftHand: [-9.5, 25.8] },
  cello:      { inst: { pos: [2, 2, 0.02], rot: 0 }, held: { R: 'bow' }, bow: { contact: [2.5, 19], world: 2.95, sMin: 2, sMax: 10 }, leftHand: [1.5, 29], vib: [0, 1] },
  contrabass: { inst: { pos: [3, 0, 0.02], rot: 0 }, held: { R: 'bow' }, bow: { contact: [3.5, 19], world: 2.95, sMin: 2, sMax: 9 }, leftHand: [3, 32], vib: [0, 1] },
  // 木管・金管：hands = 楽器ローカル px（pivot 基準・y 上向き）。楽器が動くと手が追従する
  flute:      { inst: { pos: [-1, 35, 0.03], rot: -0.15 }, hands: { L: [6, -1], R: [13, -1] }, kind: 'flute' },
  oboe:       { inst: { pos: [0, 35, 0.03], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed' },
  clarinet:   { inst: { pos: [0, 35, 0.03], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed' },
  bassoon:    { inst: { pos: [4, 4, 0.03], rot: 0.35 }, hands: { L: [0.5, 24], R: [0.5, 16] }, kind: 'bassoon' },
  trumpet:    { inst: { pos: [1, 36, 0.03], rot: -0.15 }, hands: { L: [6, -1], R: [8, 1] }, kind: 'bell' },
  horn:       { inst: { pos: [2, 24, 0.03], rot: 0 }, hands: { L: [-3, 2], R: [5, -4] }, kind: 'horn' },
  trombone:   { inst: { pos: [1, 36, 0.03], rot: -0.1 }, hands: { L: [4, -1], R: [10, 0] }, kind: 'bell', slide: true },
  tuba:       { inst: { pos: [3, 6, 0.03], rot: 0 }, hands: { L: [-2, 12], R: [4, 14] }, kind: 'tuba' },
  // 打楽器：strike = { L/R: { hit: 打つ時の手, rest: 構えの手, head: マレットが向く打点 } }
  timpani:    { inst: { pos: [0, 15, 0.06], rot: 0 }, held: { L: 'mallet', R: 'mallet' },
                strike: { L: { hit: [-6, 24], rest: [-12, 32], head: [-6, 14] }, R: { hit: [6, 24], rest: [12, 32], head: [6, 14] } } },
  bassdrum:   { inst: { pos: [-4, 0, 0.06], rot: 0 }, held: { R: 'bigmallet' }, singleArm: 'R',
                strike: { R: { hit: [4, 22], rest: [13, 31], head: [-2, 15] } }, fixedHand: { L: [-12, 22] } },
  snare:      { inst: { pos: [0, 17, 0.06], rot: 0 }, held: { L: 'stick', R: 'stick' },
                strike: { L: { hit: [-3, 25], rest: [-9, 32], head: [-3, 18] }, R: { hit: [3, 25], rest: [9, 32], head: [3, 18] } } },
  cymbal:     { held: { L: 'cymbal', R: 'cymbal' }, heldAngle: { L: Math.PI, R: 0 },
                strike: { L: { hit: [-2, 27], rest: [-12, 31] }, R: { hit: [2, 27], rest: [12, 31] } } },
  xylophone:  { inst: { pos: [0, 8, 0.06], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, pitchSpread: 9,
                strike: { L: { hit: [-3, 22], rest: [-7, 29], head: [-3, 15] }, R: { hit: [3, 22], rest: [7, 29], head: [3, 15] } } },
  marimba:    { inst: { pos: [0, 6, 0.06], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, pitchSpread: 13,
                strike: { L: { hit: [-3, 21], rest: [-7, 28], head: [-3, 14] }, R: { hit: [3, 21], rest: [7, 28], head: [3, 14] } } },
  // 鍵盤：keys = 手を置く高さ、spread = 音程で左右に動く幅、gap = 両手の間隔
  piano:      { inst: { pos: [0, 0, 0.08], rot: 0 }, keys: { y: 14, spread: 12, gap: 4 } },
  celesta:    { inst: { pos: [0, 0, 0.08], rot: 0 }, keys: { y: 16, spread: 7, gap: 3 } },
  harp:       { inst: { pos: [-9, 0, 0.05], rot: 0 }, harp: true },
  conductor:  { held: { R: 'baton' } },
};

export class Puppet {
  /**
   * @param {object} o { family, variant, color, seed, isConductor }
   */
  constructor(o) {
    this.family = o.isConductor ? 'conductor' : o.family;
    this.variant = o.isConductor ? 'conductor' : o.variant;
    this.cfg = VARIANT[this.variant] || VARIANT.violin;
    this.seed = o.seed || 0;
    this.phase = (this.seed * 1.618) % 6.283;          // 個体差（揺れの位相）
    this.scaleVar = 0.9 + ((this.seed * 7) % 5) * 0.05; // 個体差（振り幅）
    this.delay = 0;

    this.root = new THREE.Group();    // ステージ位置（足元の光はここに付ける：傾けない）
    this.group = new THREE.Group();   // ビルボード回転（常にカメラ正対）
    this.rig = new THREE.Group();     // 体の揺れ・上下動
    this.root.add(this.group);
    this.group.add(this.rig);

    this.body = body(o.color || '#c03030');
    this.rig.add(this.body);

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 33 * PX, 0.01);
    this.head = head(this.seed, !!o.isConductor);
    this.headPivot.add(this.head);
    this.rig.add(this.headPivot);

    // 2関節腕（肩 → 上腕 → 肘 → 前腕＋手）
    this.arm = {}; this.fore = {}; this.held = {}; this.hand = {};
    for (const side of ['L', 'R']) {
      const a = new THREE.Group(); a.position.set(SHOULDER[side][0] * PX, SHOULDER[side][1] * PX, 0.04);
      const f = new THREE.Group(); f.position.set(0, -ARM_UPPER * PX, 0.005);
      a.add(upperArm(), f); f.add(foreArm());
      this.rig.add(a);
      this.arm[side] = a; this.fore[side] = f;
      this.hand[side] = [SHOULDER[side][0], SHOULDER[side][1] - ARM_UPPER - ARM_FORE]; // 現在の手の位置（垂らした状態）
      const item = this.cfg.held?.[side];
      if (item) {
        const m = INSTRUMENT[item]();
        m.position.set(0, -ARM_FORE * PX, 0.01);
        f.add(m);
        this.held[side] = m;
      }
    }

    // 楽器（体に取り付け）
    if (this.cfg.inst && INSTRUMENT[this.variant]) {
      const m = INSTRUMENT[this.variant]();
      const [px, py, z] = this.cfg.inst.pos;
      m.position.set(px * PX, py * PX, z);
      m.rotation.z = this.cfg.inst.rot;
      if (this.cfg.inst.mirror) m.scale.x = -1;
      m.userData.baseRot = this.cfg.inst.rot;
      this.inst = m;
      this.rig.add(m);
    }

    // 状態
    this.bowPos = this.cfg.bow ? (this.cfg.bow.sMin + this.cfg.bow.sMax) / 2 : 0;
    this.bowDir = 1; this.bowFrom = this.bowPos; this.bowTo = this.bowPos; this.bowDur = 0.1; this.lift = 2.5;
    this.lastOnsetIndex = -1; this._lift = 0; this._breath = 0; this._slide = 0;

    this.glow = glowDisc(o.color || '#ffffff');
    this.glow.position.y = 0.01;
    this.root.add(this.glow);
  }

  /** カメラに正対する（ビルボード）。足元を軸に傾くので見下ろしても潰れない */
  faceCamera(cam) {
    this.group.quaternion.copy(cam.quaternion);
  }

  // ---- 手の配置：目標へ滑らかに寄せてから IK（rate が大きいほど即応。Infinity で即時）----
  setHand(side, target, dt, rate = 30) {
    const cur = this.hand[side];
    if (rate === Infinity) { cur[0] = target[0]; cur[1] = target[1]; }
    else { cur[0] = approach(cur[0], target[0], rate, dt); cur[1] = approach(cur[1], target[1], rate, dt); }
    const ik = solveIK(SHOULDER[side], cur, ARM_UPPER, ARM_FORE, ELBOW_SIGN[side]);
    this.arm[side].rotation.z = ik.theta1;
    this.fore[side].rotation.z = ik.theta2 - ik.theta1;
    return ik;
  }
  // 手に持った物の向きを世界角で指定（物のスプライトは +x 向きが基準。down=true なら -y 向きが基準）
  aimHeld(side, worldAngle, ik, down = false) {
    const m = this.held[side];
    if (!m) return;
    m.rotation.z = worldAngle - ik.theta2 + (down ? Math.PI / 2 : 0);
  }

  /**
   * @param {object} st  engine.trackState() の戻り値（指揮者は energy=globalEnergy）
   * @param {object} ctx { t, dt, beat:{beat,beatInBar,beatPhase,beatsPerBar}, settings, globalEnergy }
   */
  update(st, ctx) {
    const { t, dt, beat, settings } = ctx;
    const energy = st.energy;

    // 共通：呼吸と拍に同期した体の揺れ
    this.rig.scale.set(1, 1 + 0.012 * Math.sin(t * 1.6 + this.phase), 1);
    const swayAmt = Math.sin(Math.PI * beat.beat + this.phase) * 0.07 * (0.25 + 0.75 * energy) * settings.sway;
    this.rig.rotation.z = swayAmt;
    this.headPivot.rotation.z = swayAmt * 0.6;
    this.rig.position.y = 0;

    switch (this.family) {
      case 'strings': this._strings(st, ctx); break;
      case 'woodwind': this._wind(st, ctx); break;
      case 'brass': this._wind(st, ctx); break;
      case 'percussion': this._percussion(st, ctx); break;
      case 'keyboard': this._keyboard(st, ctx); break;
      case 'conductor': this._conductor(st, ctx); break;
    }

    // 足元の光：baseOpacity × エネルギー × 濃度
    this.glow.visible = settings.showGlow;
    this.glow.material.opacity = this.glow.userData.baseOpacity * clamp(energy, 0, 1) * (settings.glowIntensity ?? 1);
  }

  // ---- 弦：弓の接点を固定し、手元が弓の上を滑る。ノートごとに上げ弓/下げ弓を交互、前のストロークの終点から続ける。
  //      休符では弓を弦から離し、次の音の直前に着弦する ----
  _strings(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy } = st;
    const cfg = this.cfg, bow = cfg.bow;
    if (onset && onset.index !== this.lastOnsetIndex) { // 新しいノート：ストロークの方向と長さ
      this.lastOnsetIndex = onset.index;
      const range = bow.sMax - bow.sMin;
      const len = clamp(onset.duration * range * 1.1, range * 0.18, range) * (0.55 + 0.45 * onset.velocity) * this.scaleVar;
      let dir = -this.bowDir;
      let target = this.bowPos + dir * len;
      if (target > bow.sMax || target < bow.sMin) { dir = -dir; target = clamp(this.bowPos + dir * len, bow.sMin, bow.sMax); }
      this.bowDir = dir; this.bowFrom = this.bowPos; this.bowTo = target;
      this.bowDur = Math.max(onset.duration, 0.1);
    }
    let s = this.bowPos;
    if (onset) {
      if (age < this.bowDur) {
        const p = clamp(age / this.bowDur, 0, 1);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        s = this.bowFrom + (this.bowTo - this.bowFrom) * e;
      } else s = this.bowTo;
    }
    this.bowPos = s;
    let lift = 0; // 弓を弦から離す（休符）／着弦へ向かう（予備動作）
    if (!active.length && age > 0.5) lift = 2.5;
    if (next && !active.length && toNext < 0.25) lift = 2.5 * (toNext / 0.25);
    this.lift = approach(this.lift, lift, 14, dt);

    const a = bow.world;
    const d = [Math.cos(a), Math.sin(a)];      // 弓の向き（手元→先端）
    const n = [Math.sin(a), -Math.cos(a)];     // 弓に垂直（弦から離れる向き）
    const C = bow.contact;
    const handR = [C[0] - d[0] * s + n[0] * this.lift, C[1] - d[1] * s + n[1] * this.lift];
    const ikR = this.setHand('R', handR, dt, Infinity);
    this.aimHeld('R', a, ikR);

    // 左手：指板の位置。長い音ではビブラート（弦に沿って 5.5Hz）
    const vibAxis = cfg.vib || n;
    const vib = active.length && onset && onset.duration > 0.2 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * t + this.phase) : 0;
    this.setHand('L', [cfg.leftHand[0] + vibAxis[0] * vib, cfg.leftHand[1] + vibAxis[1] * vib], dt, 20);

    this.rig.scale.y *= 1 - 0.025 * energy; // 前傾
    this.headPivot.rotation.z += -0.1 * energy;
  }

  // ---- 管楽器（木管・金管）：両手は楽器上の点に置き、楽器の動きに追従。息継ぎ→アタック→ベル/角度の変化 ----
  _wind(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy, pitchNorm } = st;
    const cfg = this.cfg, inst = this.inst;
    // 息継ぎ：フレーズの直前に肩が上がり（0.35 秒前から）、アタックで落ちる
    let breath = 0;
    if (next && !active.length && toNext < 0.35) breath = 1 - toNext / 0.35;
    this._breath = approach(this._breath, breath, 12, dt);
    const attack = onset ? Math.exp(-age * 9) * onset.velocity : 0;
    this.rig.position.y = (0.5 * this._breath - 0.9 * attack) * PX;
    this.rig.scale.x = 1 + 0.05 * this._breath + 0.05 * energy;

    // 楽器の角度・位置（種類別）
    let lift = 0;
    if (onset) { const sustain = age < onset.duration ? 1 : Math.exp(-(age - onset.duration) * 5); lift = (0.08 + 0.3 * onset.velocity) * sustain * this.scaleVar; }
    this._lift = approach(this._lift, lift, 18, dt);
    if (inst) {
      const base = inst.userData.baseRot;
      switch (cfg.kind) {
        case 'flute':   inst.rotation.z = approach(inst.rotation.z, base + (-0.15 + 0.3 * pitchNorm) * (0.3 + 0.7 * energy), 8, dt); break;
        case 'reed':    inst.rotation.z = approach(inst.rotation.z, base - 0.3 * energy - 0.15 * this._lift, 8, dt); break; // ベルが持ち上がる
        case 'bassoon': inst.rotation.z = approach(inst.rotation.z, base + 0.12 * energy, 8, dt); break;
        case 'bell':    inst.rotation.z = base + this._lift; break;           // トランペット/トロンボーン：ベルが上がる
        case 'horn':    inst.rotation.z = base - 0.4 * this._lift; break;
        case 'tuba':    inst.rotation.z = base + 0.1 * this._lift; break;
      }
    }
    // 手：楽器ローカル点 → rig 座標。指の動き（音の変わり目で少し動く）、トロンボーンは音程でスライド
    const finger = onset ? (((onset.index * 7) % 3) - 1) * 0.6 * Math.exp(-age * 7) : 0;
    if (cfg.slide) this._slide = approach(this._slide, (1 - pitchNorm) * 6, 10, dt);
    for (const side of ['L', 'R']) {
      const h = cfg.hands[side];
      let lx = h[0], ly = h[1];
      if (side === 'R') { lx += (cfg.slide ? this._slide : 0); ly += finger * 0.3; }
      else { lx += finger * 0.3; }
      const p = inst ? instPoint(inst, lx, ly) : [SHOULDER[side][0], 20];
      this.setHand(side, p, dt, 25);
    }
    this.headPivot.rotation.z += -0.1 * energy + 0.08 * this._breath; // 息継ぎで少し上を向く
  }

  // ---- 打楽器：構え位置→打点。直前に振りかぶり、打った瞬間に打点、戻る。マレットは打面を向く ----
  _percussion(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const cfg = this.cfg;
    const armOf = (n) => (cfg.singleArm ? cfg.singleArm : (n.index % 2 ? 'L' : 'R'));
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const spread = cfg.pitchSpread || 0; // 鍵盤打楽器：音程で叩く位置が横に動く（次の音へ向かって移動）
    for (const side of ['L', 'R']) {
      const sp = cfg.strike?.[side];
      if (!sp) { if (cfg.fixedHand?.[side]) this.setHand(side, cfg.fixedHand[side], dt, 10); continue; }
      let s = 0, ant = 0, vel = 0.5, pn = pitchNorm;
      if (onset && armOf(onset) === side) { vel = onset.velocity; s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 14); }
      if (next && armOf(next) === side && toNext < 0.25) { ant = (1 - toNext / 0.25) * 0.5 * next.velocity; vel = Math.max(vel, next.velocity); if (spread) pn = normOf(next); }
      const dx = spread ? (pn - 0.5) * 2 * spread : 0;
      const rest = [sp.rest[0] + dx, sp.rest[1] + 3 * vel];       // 強いほど高く構える
      const hit = [sp.hit[0] + dx, sp.hit[1]];
      const target = [lerp(rest[0], hit[0], s) + (rest[0] - hit[0]) * ant * 0.6, lerp(rest[1], hit[1], s) + (rest[1] - hit[1]) * ant * 0.6];
      const ik = this.setHand(side, target, dt, s > 0.5 ? Infinity : 22);
      if (sp.head) { // マレットは打点を向く
        const h = this.hand[side];
        const headPt = [sp.head[0] + dx, sp.head[1]];
        this.aimHeld(side, Math.atan2(headPt[1] - h[1], headPt[0] - h[0]), ik, true);
      } else if (cfg.heldAngle) { // シンバル：縦に構える
        this.aimHeld(side, cfg.heldAngle[side], ik);
      }
    }
    if (this.inst) { // 打面の明滅：baseColor × 倍率
      const flash = onset ? 1 + 0.8 * Math.exp(-age * 10) * onset.velocity : 1;
      this.inst.material.color.copy(this.inst.userData.baseColor).multiplyScalar(flash);
    }
    this.headPivot.rotation.z += -0.06 * st.energy;
  }

  // ---- 鍵盤/ハープ：音程で手の位置、押鍵で手首が沈む／弦をはじく ----
  _keyboard(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const cfg = this.cfg;
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const armOf = (n) => (normOf(n) < 0.5 ? 'L' : 'R');
    for (const side of ['L', 'R']) {
      let s = 0, ant = 0, pn = pitchNorm;
      if (onset && armOf(onset) === side) { s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 12); }
      if (next && armOf(next) === side && toNext < 0.15) { ant = 1 - toNext / 0.15; pn = normOf(next); }
      const sign = side === 'L' ? -1 : 1;
      if (cfg.keys) { // ピアノ/チェレスタ：鍵盤の上。音程で左右、押鍵で 1.5px 沈む、直前に 1px 浮く
        const x = (pn - 0.5) * 2 * cfg.keys.spread + sign * cfg.keys.gap;
        const y = cfg.keys.y + 3 - 1.5 * s + 1.0 * ant;
        this.setHand(side, [x, y], dt, s > 0.5 ? Infinity : 14);
      } else { // ハープ：高い音ほど短い弦（右側）。はじくと手が弦から 1.5px 離れる
        const x = -13 + pn * 11 + sign * 2;
        const y = side === 'L' ? 25 : 18;
        this.setHand(side, [x + 1.5 * s, y + 0.5 * ant], dt, s > 0.5 ? Infinity : 14);
      }
    }
    this.headPivot.rotation.z += -0.06 * st.energy;
  }

  // ---- 指揮者：拍子に応じた振り図形（4拍子：下→内→外→上）。イクタスで跳ね、強いほど大きく ----
  _conductor(st, { beat, dt, settings }) {
    const g = st.energy; // = globalEnergy
    const n = beat.beatsPerBar || 4;
    const C = [7, 30]; // 右手の振りの中心（rig px）
    const P4 = [[0, -7], [-6, -4], [8, -3], [1, 6]];
    const P3 = [[0, -7], [8, -3], [1, 6]];
    const P2 = [[0, -7], [1, 6]];
    const pts = n === 4 ? P4 : n === 3 ? P3 : n === 2 ? P2 : Array.from({ length: n }, (_, i) => (i % 2 ? [1, 6] : [0, -7]));
    const b = beat.beatInBar % pts.length, ph = beat.beatPhase;
    const amp = (0.45 + 0.55 * g) * (0.5 + 0.5 * settings.sway); // 揺れスライダーは指揮の大きさにも少し効く
    const from = pts[b], to = pts[(b + 1) % pts.length];
    const e = ph * ph;                                              // 次の拍点へ加速して到着（イクタス）
    const bounce = ph < 0.3 ? Math.sin(Math.PI * ph / 0.3) * 2.5 : 0; // 到着直後の跳ね
    const px = lerp(from[0], to[0], e), py = lerp(from[1], to[1], e) + bounce;
    const ikR = this.setHand('R', [C[0] + px * amp, C[1] + py * amp], dt, Infinity);
    // 指揮棒は前腕の延長よりやや上向き
    this.aimHeld('R', Math.atan2(-Math.cos(ikR.theta2), Math.sin(ikR.theta2)) + 0.25, ikR);
    // 左手：強い時は鏡像で同調、弱い時は胸の前で控える
    const mirror = [-C[0] - px * amp * 0.7, C[1] + py * amp * 0.6];
    const restL = [-5, 24];
    const w = clamp((g - 0.25) / 0.5, 0, 1);
    this.setHand('L', [lerp(restL[0], mirror[0], w), lerp(restL[1], mirror[1], w)], dt, 18);
    const nod = ph < 0.15 ? (1 - ph / 0.15) * 0.15 * g : 0;
    this.headPivot.rotation.z += -nod;
    this.rig.rotation.z = Math.sin(Math.PI * beat.beat * 0.5) * 0.06 * (0.3 + 0.7 * g) * settings.sway;
    this.rig.position.y = -0.02 * (1 - ph) * g;
  }
}
