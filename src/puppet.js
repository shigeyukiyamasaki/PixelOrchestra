/*
 * PixelOrchestra — puppet.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * 2D パペット（パーツ板を pivot で回す）と、楽器ファミリー別の動きテンプレート。
 * 角度の向き：arm の rotation.z が +θ のとき、垂らした手が画面右（+x）側へ上がる。
 */
import { PX, body, head, arm, INSTRUMENT, glowDisc } from './sprites.js';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 楽器バリアント別の取り付け設定
// inst: { parent, pos:[px, py, z], rot, mirror }  held: { armL/armR: { name, rot } }
// restL / restR: 待機時の腕角度 [rad]
const VARIANT = {
  violin:     { inst: { parent: 'rig', pos: [-2, 29, 0.03], rot: 0.35, mirror: true }, held: { armR: { name: 'bow' } }, restL: -2.3, restR: 0.8, bowWorld: 2.6 },
  viola:      { inst: { parent: 'rig', pos: [-2, 29, 0.03], rot: 0.35, mirror: true }, held: { armR: { name: 'bow' } }, restL: -2.3, restR: 0.8, bowWorld: 2.6 },
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
    this.armL.add(arm()); this.armR.add(arm());
    this.rig.add(this.armL, this.armR);
    this.armL.rotation.z = this.cfg.restL;
    this.armR.rotation.z = this.cfg.restR;

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
      case 'strings': this._strings(st, ctx); break;
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
