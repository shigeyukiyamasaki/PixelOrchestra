/*
 * PixelOrchestra — puppet.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * 2D パペット（パーツ板を pivot で回す）と、楽器ファミリー別の動きテンプレート。
 * 角度の向き：arm の rotation.z が +θ のとき、垂らした手が画面右（+x）側へ上がる。
 */
import { PX, body, head, arm, upperArm, foreArm, INSTRUMENT, glowDisc } from './sprites.js';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ARM_UPPER = 8, ARM_FORE = 8; // 2関節腕の長さ [px]（上腕・前腕）

/**
 * 2関節の平面 IK（rig 座標・px）。肩 S から手 T へ、上腕 L1・前腕 L2 で届く角度を返す。
 * 角度は「腕を垂らした向きを 0、+で手が +x 側へ上がる」規約（rotation.z にそのまま入る）。
 * elbowSign: 肘を出す側（+1 = +x 側、-1 = -x 側）
 */
function solveIK(S, T, L1, L2, elbowSign) {
  const dx = T[0] - S[0], dy = T[1] - S[1];
  const d = clamp(Math.hypot(dx, dy), 0.05, L1 + L2 - 0.05);
  const base = Math.atan2(dx, -dy);                     // S→T の垂下角
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  let best = null;
  for (const sgn of [1, -1]) {
    const th1 = base + sgn * A;
    const ex = S[0] + L1 * Math.sin(th1), ey = S[1] - L1 * Math.cos(th1);
    const score = elbowSign * (ex - S[0]);
    if (!best || score > best.score) best = { th1, ex, ey, score };
  }
  const th2 = Math.atan2(T[0] - best.ex, -(T[1] - best.ey)); // 前腕の垂下角（世界）
  return { theta1: best.th1, theta2: th2 };
}

// 楽器バリアント別の取り付け設定
// inst: { parent, pos:[px, py, z], rot, mirror }  held: { armL/armR: { name, rot } }
// restL / restR: 待機時の腕角度 [rad]
const VARIANT = {
  // IK 弦：contact = 弓と弦の接点（駒の位置）、leftHand = 左手の位置（ネック）、sMin/sMax = 接点から弓の手元までの距離の範囲 [px]
  // bowWorld は正面から見た弓の角度。楽器の軸（左下向き）に対して垂直が理想だが、奥行きの遠近を正面図で近似して少し寝かせている
  violin:     { inst: { parent: 'rig', pos: [-5, 28, 0.03], rot: 0.45, mirror: true }, ik: true, bowWorld: 2.3, contact: [-3.2, 28.9], leftHand: [-9.0, 27.2], sMin: 3, sMax: 17 },
  viola:      { inst: { parent: 'rig', pos: [-5, 28, 0.03], rot: 0.45, mirror: true }, ik: true, bowWorld: 2.3, contact: [-3.2, 28.9], leftHand: [-9.5, 25.8], sMin: 3, sMax: 17 },
  cello:      { inst: { parent: 'rig', pos: [2, 0, 0.02], rot: 0 }, held: { armR: { name: 'bow' } }, restL: -0.9, restR: 1.15, bowWorld: 3.05 },
  contrabass: { inst: { parent: 'rig', pos: [3, 0, 0.02], rot: 0 }, held: { armR: { name: 'bow' } }, restL: -0.8, restR: 1.15, bowWorld: 3.05 },
  flute:      { inst: { parent: 'rig', pos: [-1, 35, 0.03], rot: -0.15 }, restL: 1.4, restR: 1.9 },
  clarinet:   { inst: { parent: 'rig', pos: [0, 35, 0.03], rot: -0.1 }, restL: 0.55, restR: -0.45 },
  oboe:       { inst: { parent: 'rig', pos: [0, 35, 0.03], rot: -0.1 }, restL: 0.55, restR: -0.45 },
  bassoon:    { inst: { parent: 'rig', pos: [4, 4, 0.03], rot: 0.35 }, restL: 0.6, restR: -0.4 },
  trumpet:    { inst: { parent: 'rig', pos: [1, 36, 0.03], rot: -0.15 }, restL: 1.6, restR: 2.1 },
  horn:       { inst: { parent: 'rig', pos: [2, 24, 0.03], rot: 0 }, restL: -0.7, restR: 0.7 },
  trombone:   { inst: { parent: 'rig', pos: [1, 36, 0.03], rot: -0.1 }, restL: 1.6, restR: 1.9 },
  tuba:       { inst: { parent: 'rig', pos: [3, 6, 0.03], rot: 0 }, restL: -0.5, restR: 0.9 },
  timpani:    { inst: { parent: 'rig', pos: [0, 15, 0.06], rot: 0 }, held: { armL: { name: 'mallet' }, armR: { name: 'mallet' } }, restL: -2.0, restR: 2.0, hitL: -0.6, hitR: 0.6 },
  bassdrum:   { inst: { parent: 'rig', pos: [-4, 0, 0.06], rot: 0 }, held: { armR: { name: 'bigmallet' } }, restL: -0.5, restR: 1.9, hitL: -0.5, hitR: 0.9, singleArm: 'R' },
  xylophone:  { inst: { parent: 'rig', pos: [0, 8, 0.06], rot: 0 }, held: { armL: { name: 'mallet' }, armR: { name: 'mallet' } }, restL: -1.3, restR: 1.3, hitL: -0.75, hitR: 0.75, pitchShift: true },
  marimba:    { inst: { parent: 'rig', pos: [0, 6, 0.06], rot: 0 }, held: { armL: { name: 'mallet' }, armR: { name: 'mallet' } }, restL: -1.3, restR: 1.3, hitL: -0.7, hitR: 0.7, pitchShift: true },
  celesta:    { inst: { parent: 'rig', pos: [0, 0, 0.08], rot: 0 }, restL: -0.35, restR: 0.35, hitL: -0.1, hitR: 0.1, pitchShift: true },
  snare:      { inst: { parent: 'rig', pos: [0, 17, 0.06], rot: 0 }, held: { armL: { name: 'stick' }, armR: { name: 'stick' } }, restL: -1.6, restR: 1.6, hitL: -0.5, hitR: 0.5 },
  cymbal:     { held: { armL: { name: 'cymbal', rot: 1.57 }, armR: { name: 'cymbal', rot: -1.57 } }, restL: -1.9, restR: 1.9, hitL: -0.4, hitR: 0.4 },
  piano:      { inst: { parent: 'rig', pos: [0, 0, 0.08], rot: 0 }, restL: -0.35, restR: 0.35, hitL: -0.1, hitR: 0.1, pitchShift: true },
  harp:       { inst: { parent: 'rig', pos: [-9, 0, 0.05], rot: 0 }, restL: -1.4, restR: -0.9, hitL: -1.2, hitR: -0.7 },
  conductor:  { held: { armR: { name: 'baton', rot: 0.3 } }, restL: -2.1, restR: 2.1, hitL: -1.0, hitR: 0.9 },
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
    this.armState = { L: 0, R: 0 };

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

    this.armL = new THREE.Group(); this.armL.position.set(-6 * PX, 30 * PX, 0.04);
    this.armR = new THREE.Group(); this.armR.position.set(6 * PX, 30 * PX, 0.04);
    this.rig.add(this.armL, this.armR);
    if (this.cfg.ik) { // 2関節腕（上腕 → 肘に前腕）
      this.foreL = new THREE.Group(); this.foreL.position.set(0, -ARM_UPPER * PX, 0.005);
      this.foreR = new THREE.Group(); this.foreR.position.set(0, -ARM_UPPER * PX, 0.005);
      this.armL.add(upperArm(), this.foreL); this.armR.add(upperArm(), this.foreR);
      this.foreL.add(foreArm()); this.foreR.add(foreArm());
      // 弓は前腕の手の位置に持つ
      const bow = INSTRUMENT.bow();
      bow.position.set(0, -ARM_FORE * PX, 0.01);
      this.foreR.add(bow);
      this.bow = bow;
      this.bowPos = (this.cfg.sMin + this.cfg.sMax) / 2; // 弓の現在位置（接点から手元までの距離 px）
      this.bowDir = 1; this.bowFrom = this.bowPos; this.bowTo = this.bowPos; this.bowDur = 0.1; this.lift = 2.5; this.lastOnsetIndex = -1;
    } else {
      this.armL.add(arm()); this.armR.add(arm());
      this.armL.rotation.z = this.cfg.restL;
      this.armR.rotation.z = this.cfg.restR;
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
    // 手持ち物（腕の先に取り付け）
    this.held = {};
    for (const side of ['armL', 'armR']) {
      const h = this.cfg.held?.[side];
      if (!h) continue;
      const m = INSTRUMENT[h.name]();
      m.position.set(0, -14 * PX, 0.01);
      m.rotation.z = h.rot || 0;
      this[side].add(m);
      this.held[side] = m;
    }

    this.glow = glowDisc(o.color || '#ffffff');
    this.glow.position.y = 0.01;
    this.root.add(this.glow);
  }

  /** カメラに正対する（ビルボード）。足元を軸に傾くので見下ろしても潰れない */
  faceCamera(cam) {
    this.group.quaternion.copy(cam.quaternion);
  }

  /**
   * @param {object} st  engine.trackState() の戻り値（指揮者は energy=globalEnergy）
   * @param {object} ctx { t, dt, beat:{beat,beatInBar,beatPhase}, settings:{sway}, globalEnergy }
   */
  update(st, ctx) {
    const { t, dt, beat, settings } = ctx;
    const energy = st.energy;
    const sway = settings.sway;

    // 共通：呼吸と拍に同期した体の揺れ
    this.rig.scale.y = 1 + 0.012 * Math.sin(t * 1.6 + this.phase);
    const swayAmt = Math.sin(Math.PI * beat.beat + this.phase) * 0.07 * (0.25 + 0.75 * energy) * sway;
    this.rig.rotation.z = swayAmt;
    this.headPivot.rotation.z = swayAmt * 0.6;
    this.rig.position.y = 0;

    switch (this.family) {
      case 'strings': this.cfg.ik ? this._stringsIK(st, ctx) : this._strings(st, ctx); break;
      case 'woodwind': this._woodwind(st, ctx); break;
      case 'brass': this._brass(st, ctx); break;
      case 'percussion': this._percussion(st, ctx); break;
      case 'keyboard': this._keyboard(st, ctx); break;
      case 'conductor': this._conductor(st, ctx); break;
    }

    // 足元の光：baseOpacity × エネルギー
    this.glow.visible = settings.showGlow;
    this.glow.material.opacity = this.glow.userData.baseOpacity * clamp(energy, 0, 1);
  }

  // ---- 弦：弓のストローク（ノートごとに往復、velocity で振り幅、長さでゆっくり）----
  _strings(st, { t, dt }) {
    const { onset, age } = st;
    const cfg = this.cfg;
    const cur = this.armR.rotation.z;
    if (onset && age < onset.duration + 0.8) {
      const dir = onset.index % 2 ? 1 : -1;
      const amp = (0.15 + 0.45 * onset.velocity) * this.scaleVar;
      const dur = Math.max(onset.duration, 0.12);
      const p = Math.min(1, age / dur);
      const e = 1 - Math.pow(1 - p, 2);
      this.armR.rotation.z = approach(cur, cfg.restR + dir * amp * (2 * e - 1), 30, dt);
    } else {
      this.armR.rotation.z = approach(cur, cfg.restR, 4, dt);
    }
    // 弓は世界角度を一定に保つ（腕が回っても弓の向きは変えない）
    if (this.held.armR) this.held.armR.rotation.z = cfg.bowWorld - this.armR.rotation.z;
    // 左手ビブラート
    const vib = st.active.length ? 0.05 * Math.sin(t * 30 + this.phase) : 0;
    this.armL.rotation.z = approach(this.armL.rotation.z, cfg.restL + vib, 20, dt);
    this.headPivot.rotation.z += -0.08 * st.energy;
  }

  // ---- 弦（IK 版）：弓の接点を固定し、手元が弓の上を滑る。ノートごとに上げ弓/下げ弓を交互、
  //      前のストロークの終点から続ける（実際の運弓と同じ）。休符では弓を弦から離し、次の音の直前に着弦する ----
  _stringsIK(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy } = st;
    const cfg = this.cfg;
    // 新しいノート：ストロークの方向と長さを決める（長い音ほど弓を多く使う、強いほど多く使う）
    if (onset && onset.index !== this.lastOnsetIndex) {
      this.lastOnsetIndex = onset.index;
      const range = cfg.sMax - cfg.sMin;
      const len = clamp(onset.duration * 18, 2.5, range) * (0.55 + 0.45 * onset.velocity) * this.scaleVar;
      let dir = -this.bowDir;
      let target = this.bowPos + dir * len;
      if (target > cfg.sMax || target < cfg.sMin) { dir = -dir; target = clamp(this.bowPos + dir * len, cfg.sMin, cfg.sMax); }
      this.bowDir = dir; this.bowFrom = this.bowPos; this.bowTo = target;
      this.bowDur = Math.max(onset.duration, 0.1);
    }
    // 弓の進行（イーズイン・アウト）
    let s = this.bowPos;
    if (onset) {
      if (age < this.bowDur) {
        const p = clamp(age / this.bowDur, 0, 1);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        s = this.bowFrom + (this.bowTo - this.bowFrom) * e;
      } else s = this.bowTo;
    }
    this.bowPos = s;
    // 弓を弦から離す：休符中は離し、次の音の 0.25 秒前から着弦へ向かう（予備動作）
    let lift = 0;
    const resting = !active.length && age > 0.5;
    if (resting) lift = 2.5;
    if (next && !active.length && toNext < 0.25) lift = 2.5 * (toNext / 0.25);
    this.lift = approach(this.lift, lift, 14, dt);

    const a = cfg.bowWorld;
    const d = [Math.cos(a), Math.sin(a)];        // 弓の向き（手元→先端）
    const n = [Math.sin(a), -Math.cos(a)];       // 弓に垂直（弦から離れる向き）
    const C = cfg.contact;
    const handR = [C[0] - d[0] * s + n[0] * this.lift, C[1] - d[1] * s + n[1] * this.lift];
    const S_R = [6, 30], S_L = [-6, 30];
    const ikR = solveIK(S_R, handR, ARM_UPPER, ARM_FORE, +1);
    this.armR.rotation.z = ikR.theta1;
    this.foreR.rotation.z = ikR.theta2 - ikR.theta1;
    this.bow.rotation.z = a - ikR.theta2;        // 弓は世界角度を保つ

    // 左手：ネックの位置。長い音ではビブラート（弦に沿って 5.5Hz）
    const vib = active.length && onset && onset.duration > 0.2 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * t + this.phase) : 0;
    const handL = [cfg.leftHand[0] + n[0] * vib, cfg.leftHand[1] + n[1] * vib];
    const ikL = solveIK(S_L, handL, ARM_UPPER, ARM_FORE, -1);
    this.armL.rotation.z = ikL.theta1;
    this.foreL.rotation.z = ikL.theta2 - ikL.theta1;

    // 前傾（強いほど楽器に入り込む）と頭の傾き
    this.rig.scale.y *= 1 - 0.025 * energy;
    this.headPivot.rotation.z += -0.1 * energy;
  }

  // ---- 木管：アタックで沈み込み、指の動き、音程で楽器の角度 ----
  _woodwind(st, { t, dt }) {
    const { onset, age, energy, pitchNorm } = st;
    const cfg = this.cfg;
    const bob = onset ? Math.exp(-age * 9) * 0.07 * onset.velocity : 0;
    this.rig.position.y = -bob;
    const finger = onset ? (((onset.index * 7) % 3) - 1) * 0.08 * Math.exp(-age * 7) : 0;
    this.armL.rotation.z = cfg.restL + finger;
    this.armR.rotation.z = cfg.restR - finger * 0.5;
    if (this.inst) {
      const base = this.inst.userData.baseRot;
      let target = base;
      if (this.variant === 'flute') target = base + (-0.15 + 0.3 * pitchNorm) * (0.3 + 0.7 * energy);
      else if (this.variant === 'bassoon') target = base + 0.12 * energy;
      else target = base - 0.3 * energy;   // クラリネット/オーボエ：ベルが持ち上がる
      this.inst.rotation.z = approach(this.inst.rotation.z, target, 8, dt);
    }
    this.headPivot.rotation.z += -0.1 * energy;
  }

  // ---- 金管：吹いている間ベルが上がる、体が膨らむ ----
  _brass(st, { dt }) {
    const { onset, age, energy } = st;
    const cfg = this.cfg;
    let lift = 0;
    if (onset) {
      const sustain = age < onset.duration ? 1 : Math.exp(-(age - onset.duration) * 5);
      lift = (0.08 + 0.3 * onset.velocity) * sustain * this.scaleVar;
    }
    this._lift = approach(this._lift || 0, lift, 18, dt);
    const L = this._lift;
    if (this.inst) {
      const base = this.inst.userData.baseRot;
      if (this.variant === 'horn') this.inst.rotation.z = base - 0.4 * L;
      else if (this.variant === 'tuba') this.inst.rotation.z = base + 0.1 * L;
      else this.inst.rotation.z = base + L;
    }
    this.armL.rotation.z = cfg.restL + L * 0.6;
    this.armR.rotation.z = cfg.restR + L * 0.6;
    this.rig.scale.x = 1 + 0.06 * energy;
    this.rig.position.y = -0.03 * L;
  }

  // ---- 打楽器：ノートごとに左右交互に振り下ろす（直前に振りかぶる）----
  _strike(side, s, ant, vel) {
    const cfg = this.cfg;
    const rest = side === 'L' ? cfg.restL : cfg.restR;
    const hit = side === 'L' ? cfg.hitL : cfg.hitR;
    const sign = side === 'L' ? -1 : 1;
    const restEff = rest + sign * (0.25 * vel + ant);
    return restEff + (hit - restEff) * s;
  }
  _percussion(st, { dt }) {
    const { onset, next, age, toNext } = st;
    // 通常は左右交互。singleArm 指定（バスドラム等）は片手のみで叩く
    const armOf = (n) => (this.cfg.singleArm ? this.cfg.singleArm : (n.index % 2 ? 'L' : 'R'));
    for (const side of ['L', 'R']) {
      let s = 0, ant = 0, vel = 0.5;
      if (onset && armOf(onset) === side) {
        vel = onset.velocity;
        s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 14);
      }
      if (next && armOf(next) === side && toNext < 0.25) {
        ant = (1 - toNext / 0.25) * 0.35 * next.velocity;
        vel = next.velocity;
      }
      const target = this._strike(side, s, ant, vel);
      const armObj = side === 'L' ? this.armL : this.armR;
      armObj.rotation.z = s > 0.5 ? target : approach(armObj.rotation.z, target, 25, dt);
    }
    if (this.inst) { // 打面の明滅：baseColor × 倍率
      const flash = onset ? 1 + 0.8 * Math.exp(-age * 10) * onset.velocity : 1;
      this.inst.material.color.copy(this.inst.userData.baseColor).multiplyScalar(flash);
    }
    if (this.cfg.pitchShift) this._shiftArmsByPitch(st.pitchNorm, dt); // 鍵盤打楽器：音程で叩く位置が左右に動く
  }

  // 音程に応じて両腕の付け根を左右にずらす（ピアノ・鍵盤打楽器）
  _shiftArmsByPitch(pitchNorm, dt) {
    const shift = (pitchNorm - 0.5) * 12 * PX;
    this.armL.position.x = approach(this.armL.position.x, -6 * PX + shift, 10, dt);
    this.armR.position.x = approach(this.armR.position.x, 6 * PX + shift, 10, dt);
  }

  // ---- 鍵盤/ハープ：音程で左右の手を使い分け、押鍵/はじき ----
  _keyboard(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const armOf = (n, tr) => ((n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60)) < 0.5 ? 'L' : 'R');
    for (const side of ['L', 'R']) {
      let s = 0, ant = 0, vel = 0.5;
      if (onset && armOf(onset, st.track) === side) { vel = onset.velocity; s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 12); }
      if (next && armOf(next, st.track) === side && toNext < 0.15) { ant = (1 - toNext / 0.15) * 0.12; }
      const cfg = this.cfg;
      const rest = side === 'L' ? cfg.restL : cfg.restR;
      const hit = side === 'L' ? cfg.hitL : cfg.hitR;
      const sign = side === 'L' ? -1 : 1;
      const target = rest + sign * ant * 0.5 + (hit - rest) * s * (0.5 + 0.5 * vel);
      const armObj = side === 'L' ? this.armL : this.armR;
      armObj.rotation.z = s > 0.5 ? target : approach(armObj.rotation.z, target, 20, dt);
    }
    if (this.cfg.pitchShift) this._shiftArmsByPitch(pitchNorm, dt); // 音程で手の位置を左右にずらす
    this.headPivot.rotation.z += -0.06 * st.energy;
  }

  // ---- 指揮者：拍で振る（イクタスで最下点→跳ね上がり→次の拍へ沈む）----
  _conductor(st, { beat, dt, settings }) {
    const g = st.energy; // = globalEnergy
    const cfg = this.cfg;
    const ph = beat.beatPhase;
    const u = ph < 0.1 ? ph / 0.1 : 1 - Math.pow((ph - 0.1) / 0.9, 2); // 0=最下点
    const amp = (0.35 + 0.65 * g) * (beat.beatInBar === 0 ? 1.2 : 1);
    const targetR = cfg.hitR + (cfg.restR - cfg.hitR) * clamp(u * amp, 0, 1.1);
    const targetL = cfg.hitL + (cfg.restL - cfg.hitL) * clamp(u * amp * 0.6 + 0.1, 0, 1.1);
    this.armR.rotation.z = approach(this.armR.rotation.z, targetR, 40, dt);
    this.armL.rotation.z = approach(this.armL.rotation.z, targetL, 30, dt);
    const nod = ph < 0.15 ? (1 - ph / 0.15) * 0.15 * g : 0;
    this.headPivot.rotation.z += -nod;
    this.rig.rotation.z = Math.sin(Math.PI * beat.beat * 0.5) * 0.06 * (0.3 + 0.7 * g) * settings.sway;
    this.rig.position.y = -0.02 * (1 - u) * g;
  }
}
