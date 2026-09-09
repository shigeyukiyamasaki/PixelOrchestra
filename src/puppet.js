/*
 * PixelOrchestra — puppet.js
 * 最終更新: 2026-09-09 / v0.4 / 生成元: PixelOrchestra
 *
 * パペット（体・頭・2関節腕・楽器・手持ち物）。腕は 3D の 2 関節 IK で動く：
 *   「手をどこに置くか」を楽器ごとに座標で決め、肩・肘の向きは IK が解く。
 * 座標系：rig 空間の px（足元中央が原点、x 右・y 上・z 前＝指揮者側）。1px = PX unit。
 * 2D 板モード（flat）では従来の平面の姿勢（z=0・楽器は z 回転のみ）、ボクセルでは 3D 姿勢（p3）を使う。
 */
import { PX, body, head, upperArm, foreArm, foreArmNoHand, hand, INSTRUMENT, glowDisc, PART_STYLE, torsoSeated, thigh, shin, shoe, legsSeatedSprite, chair } from './sprites.js';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ARM_UPPER = 8, ARM_FORE = 8; // 2関節腕の長さ [px]（上腕・前腕＋手）
const FORE_NOHAND = 6, HAND_LEN = 4; // 手首あり版：前腕 6 ＋ 手 4（合計は同じ）
// 肩の位置：上着の上端の角（x=±5.5, y=25.5）。以前の (±6, 30) は体の外側かつ上で、腕が胴から離れて見えた（2026-09-09 修正）
const SHOULDER = { L: [-5.5, 25.5, 0], R: [5.5, 25.5, 0] };
const HEAD_Y_PX = 29.5; // 頭の付け根（首の上端 29 に少し食い込ませる）
const SPINE_Y = 13;     // 腰の高さ（座面の高さ・上半身の回転軸）
// リグの座標系は「正面（+z）を向いたキャラを鏡で見た向き」で定義されている（R = ローカル +x）。
// 本人の右手は forward×up = -x なので、rig 全体を x 反転して右利きにする（2026-09-09 ユーザー指摘：全員左利きだった）
const MIRROR = -1;
// 肘を出す向きのヒント（rig 空間）。平面モードでは面内（z=0）に保つ
const POLE = { L: [-1, -0.5, -0.35], R: [1, -0.5, -0.35] };
const POLE_FLAT = { L: [-1, -0.3, 0], R: [1, -0.3, 0] };

// ---- ベクトル・回転の小道具（THREE を使う。使い回しのテンポラリ）----
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const v3 = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2] || 0);

/**
 * 「ボーンの軸（ローカル -y）を dir に向け、ローカル +z をなるべく rig +z に保つ」回転
 * （腕・手持ち物のスプライトは pivot から -y 方向に伸び、+z が正面）
 */
function quatFromBoneDir(dir, out) {
  const y = _a.copy(dir).normalize().negate();   // local -y → dir
  const zHint = _b.set(0, 0, 1);
  let z = _c.copy(zHint).addScaledVector(y, -zHint.dot(y));
  if (z.lengthSq() < 1e-6) z = _c.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}
/** 「ローカル +x を dir に向け、+z をなるべく rig +z に保つ」回転（弓・指揮棒など +x 向きの物） */
function quatFromXDir(dir, out) {
  const x = _a.copy(dir).normalize();
  const zHint = _b.set(0, 0, 1);
  let z = _c.copy(zHint).addScaledVector(x, -zHint.dot(x));
  if (z.lengthSq() < 1e-6) z = _c.set(0, 1, 0).addScaledVector(x, -x.y);
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/**
 * 3D の 2 関節 IK。肩 S から手 T へ、上腕 L1・前腕 L2。pole = 肘を出す向きのヒント。
 * @returns {{q1: Quaternion(上腕・rig基準), q2: Quaternion(前腕・rig基準)}}
 */
function solveIK3(S, T, L1, L2, pole) {
  const s = v3(S), t = v3(T);
  const u = t.clone().sub(s);
  const d = clamp(u.length(), 0.05, L1 + L2 - 0.05);
  u.normalize();
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const p = v3(pole); p.addScaledVector(u, -p.dot(u));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(u, u.y);
  p.normalize();
  const eDir = u.clone().multiplyScalar(Math.cos(A)).addScaledVector(p, Math.sin(A));
  const E = s.clone().addScaledVector(eDir, L1);
  const target = s.clone().addScaledVector(u, d);
  const fDir = target.sub(E);
  if (fDir.lengthSq() < 1e-8) fDir.copy(eDir); else fDir.normalize();
  const q1 = quatFromBoneDir(eDir, new THREE.Quaternion());
  const q2 = quatFromBoneDir(fDir, new THREE.Quaternion());
  return { q1, q2 };
}

// 楽器ローカル px（pivot 基準・y 上向き・z 前）→ rig px。楽器の現在の位置・回転・鏡像を反映
function instPoint(inst, lx, ly, lz = 0) {
  _a.set(inst.scale.x < 0 ? -lx : lx, ly, lz).applyQuaternion(inst.quaternion);
  return [inst.position.x / PX + _a.x, inst.position.y / PX + _a.y, inst.position.z / PX + _a.z];
}
// 2 つのベクトル（楽器の軸 D と天面法線 N）から楽器の回転を作る。axisLocal = 軸に対応するローカル軸（+x / -x / +y / -y）
function quatFromAxes(D, N, axisLocal = '+x') {
  const d = v3(D).normalize();
  const n = v3(N).addScaledVector(d, -v3(N).dot(d)).normalize();
  let x, y, z;
  if (axisLocal === '+x' || axisLocal === '-x') {
    x = axisLocal === '+x' ? d : d.clone().negate(); z = n; y = new THREE.Vector3().crossVectors(z, x);
  } else {
    y = axisLocal === '+y' ? d : d.clone().negate(); z = n; x = new THREE.Vector3().crossVectors(y, z);
  }
  _m.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

// ---------------- 楽器バリアント別の設定 ----------------
// inst: { pos:[px,py,z], rot(2D の z 回転), mirror }。p3: 3D 姿勢の上書き { pos, quat | rot3, hands, bowDir, liftDir, strike, keys ... }
// 弦: bow = { contact: 弓と弦の接点（楽器ローカル px・pivot 基準・y 上）, world: 正面から見た弓の角度(2D), sMin/sMax }, leftHand: 楽器ローカル px
const VIOLIN_AXIS = [-0.55, -0.32, 0.77];   // あごから渦巻きへ（左・下・前）
const VIOLIN_UP = [0.15, 0.9, 0.35];        // 弦の面の法線（上・やや前）
const VIOLIN_Q = quatFromAxes(VIOLIN_AXIS, VIOLIN_UP, '-x'); // 鏡像スプライトなので渦巻きはローカル -x
const VIOLIN_BOW = (() => { const b = new THREE.Vector3().crossVectors(v3(VIOLIN_UP), v3(VIOLIN_AXIS)).normalize(); if (b.x > 0) b.negate(); return [b.x, b.y, b.z]; })(); // 手元→先端（右手から左へ）
const CELLO_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.28, 0, 0.08)); // 上を奏者側へ傾ける
// チェロ系の弓の向き・弦から離れる向きは楽器の姿勢から：弓は楽器のローカル -x（右手→左）、弦の面の法線はローカル +z（正面）
const CELLO_BOW = (() => { const v = new THREE.Vector3(-1, 0, 0).applyQuaternion(CELLO_Q); return [v.x, v.y, v.z]; })();
const CELLO_UP = (() => { const v = new THREE.Vector3(0, 0, 1).applyQuaternion(CELLO_Q); return [v.x, v.y, v.z]; })();
const FWD = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)); // スプライトの +x を前方（+z）へ

const VARIANT = {
  violin:     { chin: true, spine: true, gaze: true, inst: { pos: [-5, 28, 4], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [-2, 0], world: 2.3, sMin: 3, sMax: 17 }, leftHand: [4, 1],
                p3: { pos: [-6, 27, 6], quat: VIOLIN_Q, bowDir: VIOLIN_BOW, liftDir: VIOLIN_UP, sMin: 3, sMax: 14, vib: VIOLIN_AXIS, contactZ: 2.5, leftHandZ: 2.5 } },
  viola:      { chin: true, spine: true, gaze: true, inst: { pos: [-5, 28, 4], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [-2, 0], world: 2.3, sMin: 3, sMax: 17 }, leftHand: [5, 0],
                p3: { pos: [-6, 27, 6], quat: VIOLIN_Q, bowDir: VIOLIN_BOW, liftDir: VIOLIN_UP, sMin: 3, sMax: 14, vib: VIOLIN_AXIS, contactZ: 2.5, leftHandZ: 2.5 } },
  cello:      { spine: true, gaze: true, inst: { pos: [2, 2, 4], rot: 0 }, held: { R: 'bow' }, bow: { contact: [0.5, 12], world: 2.95, sMin: 2, sMax: 10 }, leftHand: [-0.5, 24], vib: [0, 1, 0], // 駒は高解像度の絵の row 36（基本 y=12）
                p3: { pos: [0.5, 1, 10], quat: CELLO_Q, bowDir: CELLO_BOW, liftDir: CELLO_UP, sMin: 2, sMax: 10, vib: [0, 1, 0], contactZ: 6.6, leftHandZ: 6.6 } }, // 膝の間・前方。上部は胸に寄りかかる
  contrabass: { spine: true, gaze: true, inst: { pos: [3, 0, 4], rot: 0 }, held: { R: 'bow' }, bow: { contact: [0.5, 19], world: 2.95, sMin: 2, sMax: 9 }, leftHand: [0, 32], vib: [0, 1, 0],
                p3: { pos: [2, 0, 8], quat: CELLO_Q, bowDir: CELLO_BOW, liftDir: CELLO_UP, sMin: 2, sMax: 9, vib: [0, 1, 0], contactZ: 8.6, leftHandZ: 8.6 } }, // 立奏。体の前に立てかける
  // 木管・金管：hands = 楽器ローカル px。p3.rot3 = 3D の姿勢（Euler）
  // 吹き口の高さ ≒ 32（頭の付け根 29.5 + 2.5）
  // handDirs = 手首→指先の向き（楽器ローカル）。フルートは下から抱えて指は上へ、縦笛は左右から、金管は上から／横から
  flute:      { inst: { pos: [-1, 31.5, 4], rot: -0.15 }, hands: { L: [6, -1], R: [13, -1] }, kind: 'flute', handDirs: { L: [0, 1, 0], R: [0, 1, 0] }, gazeDown: 0.05,
                p3: { pos: [-1, 31.5, 5], rot3: [0, -0.35, -0.15], hands: { L: [6, -1, 1], R: [13, -1, 1] } } },
  oboe:       { inst: { pos: [0, 31.5, 4], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.15,
                p3: { pos: [0, 31.5, 5], rot3: [-0.75, 0, 0], hands: { L: [-1.5, -7, 1], R: [1.5, -13, 1] } } },
  clarinet:   { inst: { pos: [0, 31.5, 4], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.15,
                p3: { pos: [0, 31.5, 5], rot3: [-0.75, 0, 0], hands: { L: [-1.5, -7, 1], R: [1.5, -13, 1] } } },
  bassoon:    { inst: { pos: [4, 0.5, 4], rot: 0.35 }, hands: { L: [0.5, 24], R: [0.5, 16] }, kind: 'bassoon', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.1,
                p3: { pos: [5, 0, 8], rot3: [-0.35, 0, 0.35], hands: { L: [-1.5, 24, 0], R: [1.5, 16, 0] } } },
  trumpet:    { inst: { pos: [1, 32.5, 4], rot: -0.15 }, hands: { L: [6, -1], R: [8, 1] }, kind: 'bell', handDirs: { L: [0, 0, -1], R: [0, -1, 0] }, gazeDown: 0.0,
                p3: { pos: [0.5, 32.5, 3], quat: FWD, hands: { L: [6, -1, 1.5], R: [8, 1, -1.5] } } },
  horn:       { inst: { pos: [2, 24, 4], rot: 0 }, hands: { L: [-3, 2], R: [5, -4] }, kind: 'horn', handDirs: { L: [0, -1, 0], R: [1, 0, 0] }, gazeDown: 0.05,
                p3: { pos: [3, 24, 4], rot3: [0, 0.8, 0], hands: { L: [-3, 2, 1], R: [5, -4, -1] } } },
  trombone:   { inst: { pos: [1, 32.5, 4], rot: -0.1 }, hands: { L: [4, -1], R: [10, 0] }, kind: 'bell', slide: true, handDirs: { L: [0, 0, -1], R: [0, 0, 1] }, gazeDown: 0.0,
                p3: { pos: [0.5, 32.5, 3], quat: FWD, hands: { L: [4, -1, 1.5], R: [10, 0, -1.5] } } },
  tuba:       { inst: { pos: [3, 6, 4], rot: 0 }, hands: { L: [-2, 12], R: [4, 14] }, kind: 'tuba', handDirs: { L: [0, 0, -1], R: [0, -1, 0] }, gazeDown: 0.05,
                p3: { pos: [3, 6, 6], rot3: [0, 0.3, 0], hands: { L: [-2, 12, 2], R: [4, 14, 2] } } },
  // 打楽器：strike = { L/R: { hit, rest, head } }（rig px）。p3.strike は 3D（手は楽器の上へ前方に伸びる）
  timpani:    { inst: { pos: [0, 15, 4], rot: 0 }, held: { L: 'mallet', R: 'mallet' },
                strike: { L: { hit: [-6, 24], rest: [-12, 32], head: [-6, 14] }, R: { hit: [6, 24], rest: [12, 32], head: [6, 14] } },
                p3: { strike: { L: { hit: [-6, 24, 10], rest: [-12, 32, 4], head: [-6, 15, 12] }, R: { hit: [6, 24, 10], rest: [12, 32, 4], head: [6, 15, 12] } } } },
  bassdrum:   { inst: { pos: [-4, 0, 4], rot: 0 }, held: { R: 'bigmallet' }, singleArm: 'R',
                strike: { R: { hit: [4, 22], rest: [13, 31], head: [-2, 15] } }, fixedHand: { L: [-12, 22] },
                p3: { strike: { R: { hit: [5, 22, 2], rest: [13, 31, -2], head: [-2, 15, 3] } }, fixedHand: { L: [-13, 22, 2] } } },
  snare:      { inst: { pos: [0, 17, 4], rot: 0 }, held: { L: 'stick', R: 'stick' },
                strike: { L: { hit: [-3, 25], rest: [-9, 32], head: [-3, 18] }, R: { hit: [3, 25], rest: [9, 32], head: [3, 18] } },
                p3: { strike: { L: { hit: [-3, 25, 7], rest: [-9, 32, 3], head: [-3, 18, 9] }, R: { hit: [3, 25, 7], rest: [9, 32, 3], head: [3, 18, 9] } } } },
  cymbal:     { held: { L: 'cymbal', R: 'cymbal' }, heldAngle: { L: 0, R: Math.PI }, // 円盤の面（ローカル -y）を内側（±x）へ向ける
                strike: { L: { hit: [-2, 27], rest: [-12, 31] }, R: { hit: [2, 27], rest: [12, 31] } },
                p3: { strike: { L: { hit: [-2, 27, 6], rest: [-12, 31, 2] }, R: { hit: [2, 27, 6], rest: [12, 31, 2] } } } },
  xylophone:  { inst: { pos: [0, 8, 4], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, pitchSpread: 9,
                strike: { L: { hit: [-3, 22], rest: [-7, 29], head: [-3, 15] }, R: { hit: [3, 22], rest: [7, 29], head: [3, 15] } },
                p3: { strike: { L: { hit: [-3, 22, 7], rest: [-7, 29, 3], head: [-3, 15, 9] }, R: { hit: [3, 22, 7], rest: [7, 29, 3], head: [3, 15, 9] } } } },
  marimba:    { inst: { pos: [0, 6, 4], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, pitchSpread: 13,
                strike: { L: { hit: [-3, 21], rest: [-7, 28], head: [-3, 14] }, R: { hit: [3, 21], rest: [7, 28], head: [3, 14] } },
                p3: { strike: { L: { hit: [-3, 21, 8], rest: [-7, 28, 3], head: [-3, 14, 10] }, R: { hit: [3, 21, 8], rest: [7, 28, 3], head: [3, 14, 10] } } } },
  // 鍵盤：keys = 手を置く高さ、spread = 音程で左右に動く幅、gap = 両手の間隔。p3 では鍵盤を奏者側に向け、手は前へ
  piano:      { inst: { pos: [0, 0, 4], rot: 0 }, keys: { y: 14, spread: 12, gap: 4 },
                p3: { pos: [0, 0, 36], rot3: [0, Math.PI, 0], keys: { y: 14, spread: 12, gap: 4, z: 8 } } },
  celesta:    { inst: { pos: [0, 0, 4], rot: 0 }, keys: { y: 16, spread: 7, gap: 3 },
                p3: { pos: [0, 0, 14], rot3: [0, Math.PI, 0], keys: { y: 16, spread: 7, gap: 3, z: 6 } } },
  harp:       { inst: { pos: [-9, 0, 4], rot: 0 }, harp: true,
                p3: { pos: [-8, 0, 6], rot3: [0, -0.9, 0.15], harp: true } },
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
    this.style = PART_STYLE;              // 生成時の絵の方式（'voxel' | 'sprite'）
    this.flat = this.style === 'sprite';  // 板モードは平面の姿勢
    this.p3 = (!this.flat && this.cfg.p3) ? this.cfg.p3 : null;

    this.root = new THREE.Group();    // ステージ位置（足元の光はここに付ける：傾けない）
    this.group = new THREE.Group();   // 向き（指揮者 or カメラ）
    this.rig = new THREE.Group();     // 体の揺れ・上下動
    this.root.add(this.group);
    this.group.add(this.rig);
    // 腰（背骨 1 関節）：上半身・頭・腕・楽器はこの下にぶら下がる。pivot は腰（y=13）。関節拡張の試作（バイオリン系のみ回す）
    this.spine = new THREE.Group();
    this.spine.position.set(0, SPINE_Y * PX, 0);
    this.rig.add(this.spine);
    this.upper = new THREE.Group();   // spine の子。座標は rig と同じ px で書けるよう -SPINE_Y 戻す
    this.upper.position.set(0, -SPINE_Y * PX, 0);
    this.spine.add(this.upper);
    this.hasWrist = this.cfg.wrist !== false; // 手首は全員（2026-09-10 全セクションへ展開）

    // 座る／立つ：打楽器と指揮者以外は椅子に座る（2026-09-09 ユーザー指定）。上半身の高さは立ち姿と同じにし、脚だけ差し替える
    this.seated = !o.isConductor && this.family !== 'percussion' && this.variant !== 'contrabass'; // コントラバスは立奏（2026-09-10）
    if (this.seated) {
      this.body = torsoSeated(o.color || '#c03030');
      this.body.position.y = 13 * PX;           // 腰＝座面の高さ
      this.upper.add(this.body);
      const ch = chair(); ch.position.set(0, 0, -6 * PX); this.rig.add(ch); // 座面は z -6..+6、背もたれは後ろ
      if (this.flat) {
        const legs = legsSeatedSprite(); legs.position.set(0, 0, 1 * PX); this.rig.add(legs);
      } else {
        for (const sx of [-3.5, 3.5]) {
          const t = thigh(); t.position.set(sx * PX, 12 * PX, 0); this.rig.add(t);           // 太もも：腰から前へ
          const sh = shin(); sh.position.set(sx * PX, 0, 8 * PX); this.rig.add(sh);          // すね：太ももの先から床へ
          const so = shoe(); so.position.set(sx * PX, 0, 8 * PX); this.rig.add(so);          // 靴：前へ
        }
      }
    } else {
      this.body = body(o.color || '#c03030');
      this.upper.add(this.body);
    }

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, HEAD_Y_PX * PX, 0);
    this.head = head(this.seed, false);
    this.headPivot.add(this.head);
    this.upper.add(this.headPivot);

    // 2関節腕（肩 → 上腕 → 肘 → 前腕＋手）。手首ありなら 肘 → 前腕 → 手首 → 手 の 3 関節
    this.arm = {}; this.fore = {}; this.held = {}; this.hand = {}; this.foreQ = {}; this.handGrp = {}; this.handQ = {};
    for (const side of ['L', 'R']) {
      const a = new THREE.Group(); a.position.set(SHOULDER[side][0] * PX, SHOULDER[side][1] * PX, (this.flat ? 3 : 0) * PX);
      const f = new THREE.Group(); f.position.set(0, -ARM_UPPER * PX, 0);
      a.add(upperArm(), f);
      this.upper.add(a);
      this.arm[side] = a; this.fore[side] = f;
      this.hand[side] = [SHOULDER[side][0], SHOULDER[side][1] - ARM_UPPER - ARM_FORE, this.flat ? 3 : 0];
      this.foreQ[side] = new THREE.Quaternion(); this.handQ[side] = new THREE.Quaternion();
      let holder = f, holdY = -ARM_FORE;
      if (this.hasWrist) {
        f.add(foreArmNoHand());
        const h = new THREE.Group(); h.position.set(0, -FORE_NOHAND * PX, 0);
        h.add(hand()); f.add(h);
        this.handGrp[side] = h; holder = h; holdY = -HAND_LEN + 1; // 手持ち物は指の位置
      } else {
        f.add(foreArm());
      }
      const item = this.cfg.held?.[side];
      if (item) {
        const m = INSTRUMENT[item]();
        m.position.set(0, holdY * PX, (this.flat ? 3 : 2) * PX); // 手持ち物は手の少し前
        holder.add(m);
        this.held[side] = m;
      }
    }

    // 楽器（体に取り付け）
    if (this.cfg.inst && INSTRUMENT[this.variant]) {
      const m = INSTRUMENT[this.variant]();
      const pos = (this.p3 && this.p3.pos) || this.cfg.inst.pos;
      m.position.set(pos[0] * PX, pos[1] * PX, pos[2] * PX);
      if (this.p3 && this.p3.quat) m.quaternion.copy(this.p3.quat);
      else if (this.p3 && this.p3.rot3) m.quaternion.setFromEuler(new THREE.Euler(...this.p3.rot3));
      else m.quaternion.setFromEuler(new THREE.Euler(0, 0, this.cfg.inst.rot));
      if (this.cfg.inst.mirror) m.scale.x = -1;
      m.userData.baseQ = m.quaternion.clone();
      this.inst = m;
      this.upper.add(m);
    }

    // 状態
    const bow = this.cfg.bow;
    const sMin = this.p3?.sMin ?? bow?.sMin ?? 0, sMax = this.p3?.sMax ?? bow?.sMax ?? 0;
    this.bowPos = (sMin + sMax) / 2;
    this.bowDir = 1; this.bowFrom = this.bowPos; this.bowTo = this.bowPos; this.bowDur = 0.1; this.lift = 2.5;
    this.lastOnsetIndex = -1; this._lift = 0; this._breath = 0; this._slide = 0; this._tilt = 0;

    this.glow = glowDisc(o.color || '#ffffff');
    this.glow.position.y = 0.01;
    this.root.add(this.glow);
  }

  /** カメラの方を向く。2D の板は完全に正対（見下ろしても潰れない）、立体は水平回転のみ */
  faceCamera(cam) {
    if (this.flat) { this.group.quaternion.copy(cam.quaternion); return; }
    const yaw = Math.atan2(cam.position.x - this.root.position.x, cam.position.z - this.root.position.z);
    this.group.rotation.set(0, yaw, 0);
  }
  /** 向きを固定：指定の点（指揮者）の方を向く。指揮者自身は楽団（-z）の方を向く */
  faceToward(px, pz) {
    const yaw = this.family === 'conductor' ? Math.PI : Math.atan2(px - this.root.position.x, pz - this.root.position.z);
    this.group.rotation.set(0, yaw, 0);
  }

  // ---- 手の配置：目標へ滑らかに寄せてから 3D IK（rate が大きいほど即応。Infinity で即時）----
  // handDir（rig 空間）を渡すと手首あり：手首＝目標 − handDir×手の長さ、前腕は手首へ、手は handDir を向く
  setHand(side, target, dt, rate = 30, handDir = null) {
    const cur = this.hand[side];
    const tz = this.flat ? 3 : (target[2] ?? 0);
    if (rate === Infinity) { cur[0] = target[0]; cur[1] = target[1]; cur[2] = tz; }
    else { cur[0] = approach(cur[0], target[0], rate, dt); cur[1] = approach(cur[1], target[1], rate, dt); cur[2] = approach(cur[2], tz, rate, dt); }
    const S = [SHOULDER[side][0], SHOULDER[side][1], this.flat ? 3 : 0];
    let goal = cur, fore = ARM_FORE;
    if (this.hasWrist) {
      fore = FORE_NOHAND;
      let hd = handDir ? v3(handDir) : null;
      if (!hd || hd.lengthSq() < 1e-6) { hd = v3([cur[0] - S[0], cur[1] - S[1], cur[2] - S[2]]); } // 指定なし：腕の延長
      hd.normalize();
      if (this.flat) hd.z = 0;
      goal = [cur[0] - hd.x * HAND_LEN, cur[1] - hd.y * HAND_LEN, cur[2] - hd.z * HAND_LEN]; // 手首の位置
      this._handDir = hd;
    }
    const ik = solveIK3(S, goal, ARM_UPPER, fore, this.flat ? POLE_FLAT[side] : POLE[side]);
    this.arm[side].quaternion.copy(ik.q1);
    this.fore[side].quaternion.copy(ik.q1).invert().multiply(ik.q2); // 前腕は上腕の子：ローカル回転 = q1⁻¹ · q2
    this.foreQ[side].copy(ik.q2);
    if (this.hasWrist) { // 手：手首から目標へ向く（rig 基準の回転 → 前腕の子としてのローカル回転）
      const qh = quatFromBoneDir(this._handDir, new THREE.Quaternion());
      this.handGrp[side].quaternion.copy(ik.q2).invert().multiply(qh);
      this.handQ[side].copy(qh);
    } else this.handQ[side].copy(ik.q2);
    return ik;
  }
  /** 手に持った物の向き（rig 空間の方向ベクトル）。primary: 'x'（弓・指揮棒）| 'ny'（マレット：-y が先端） */
  aimHeldDir(side, dir, primary = 'x') {
    const m = this.held[side];
    if (!m) return;
    const q = primary === 'x' ? quatFromXDir(v3(dir), _q) : quatFromBoneDir(v3(dir), _q);
    m.quaternion.copy(this.handQ[side]).invert().multiply(q); // 手持ち物の親（手 or 前腕）の回転を打ち消す
  }
  /** 楽器の動的な回転（ローカル軸まわり）を基準姿勢に加える */
  instRotate(axis, angle) {
    if (!this.inst) return;
    _q2.setFromAxisAngle(_a.set(axis[0], axis[1], axis[2]), angle);
    this.inst.quaternion.copy(this.inst.userData.baseQ).multiply(_q2);
  }

  /**
   * 腰の前傾と視線（全セクション共通）。lean = 前傾 [rad]、gazeDown/gazeYaw = 演奏中に見る方向、
   * 休符中と出だしの 1 秒前は指揮者（正面）を見る
   */
  _spineGaze(st, dt, lean, gazeDown = 0.1, gazeYaw = 0) {
    this._lean = approach(this._lean ?? 0, lean, 6, dt);
    if (this.flat) this.spine.scale.y *= 1 - 0.15 * this._lean; else this.spine.rotation.x += this._lean;
    if (this.flat) return;
    const { active, age, next, toNext } = st;
    const wantConductor = (!active.length && (age > 0.5 || (next && toNext < 1.0)));
    this._gaze = approach(this._gaze ?? 0, wantConductor ? 0 : 1, 4, dt);
    this.headPivot.rotation.y += gazeYaw * this._gaze;
    this.headPivot.rotation.x += gazeDown * this._gaze;
  }

  /**
   * @param {object} st  engine.trackState() の戻り値（指揮者は energy=globalEnergy）
   * @param {object} ctx { t, dt, beat:{beat,beatInBar,beatPhase,beatsPerBar}, settings, globalEnergy }
   */
  update(stRaw, ctx) {
    const { t, dt, beat, settings } = ctx;
    const energy = stRaw.energy;
    // 「強弱の反応」スライダー：前傾・楽器の角度・膨らみなど、強さ（velocity/CC）で動く量の倍率。揺れと足元の光には掛けない
    const st = { ...stRaw, energy: clamp(energy * (settings.dynResponse ?? 1), 0, 1.5) };

    // 共通：呼吸と拍に同期した体の揺れ
    // 揺れ・呼吸・上下動は腰（spine）から上だけ。下半身と椅子は動かない（2026-09-09 ユーザー指定）
    this.rig.scale.set(MIRROR, 1, 1);
    const swayAmt = Math.sin(Math.PI * beat.beat + this.phase) * 0.07 * (0.25 + 0.75 * energy) * settings.sway;
    this.spine.rotation.set(0, 0, swayAmt);
    this.spine.scale.set(1, 1 + 0.012 * Math.sin(t * 1.6 + this.phase), 1);
    this.spine.position.y = SPINE_Y * PX;
    this.headPivot.rotation.z = swayAmt * 0.6;
    this.headPivot.rotation.y = 0;
    this.headPivot.rotation.x = 0;

    switch (this.family) {
      case 'strings': this._strings(st, ctx); break;
      case 'woodwind': this._wind(st, ctx); break;
      case 'brass': this._wind(st, ctx); break;
      case 'percussion': this._percussion(st, ctx); break;
      case 'keyboard': this._keyboard(st, ctx); break;
      case 'conductor': this._conductor(st, ctx); break;
    }

    // 足元の光：baseOpacity × エネルギー × 濃度。指揮者だけは拍で明滅（小節頭は強く、拍の頭で光って減衰）
    this.glow.visible = settings.showGlow;
    let level = clamp(energy, 0, 1);
    if (this.family === 'conductor') {
      const accent = beat.beatInBar === 0 ? 1.0 : 0.55;
      level = (0.08 + accent * Math.exp(-beat.beatPhase * 5)) * (0.5 + 0.5 * clamp(energy, 0, 1));
    }
    this.glow.material.opacity = this.glow.userData.baseOpacity * level * (settings.glowIntensity ?? 1);
  }

  // ---- 弦：弓の接点を固定し、手元が弓の上を滑る。ノートごとに上げ弓/下げ弓を交互、前のストロークの終点から続ける。
  //      休符では弓を弦から離し、次の音の直前に着弦する ----
  _strings(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy } = st;
    const cfg = this.cfg, bow = cfg.bow, p3 = this.p3;
    const sMin = p3?.sMin ?? bow.sMin, sMax = p3?.sMax ?? bow.sMax;
    if (onset && onset.index !== this.lastOnsetIndex) { // 新しいノート：ストロークの方向と長さ
      this.lastOnsetIndex = onset.index;
      const range = sMax - sMin;
      const len = clamp(onset.duration * range * 1.1, range * 0.18, range) * (0.55 + 0.45 * onset.velocity) * this.scaleVar;
      let dir = -this.bowDir;
      let target = this.bowPos + dir * len;
      if (target > sMax || target < sMin) { dir = -dir; target = clamp(this.bowPos + dir * len, sMin, sMax); }
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

    // 接点（駒）と弓の向き・弦から離れる向き（2D は平面、3D は楽器の姿勢から）
    const C = instPoint(this.inst, bow.contact[0], bow.contact[1], p3?.contactZ ?? 0); // 3D では弦のある正面側
    let d, n;
    if (p3) { d = p3.bowDir; n = p3.liftDir; }
    else { const a = bow.world; d = [Math.cos(a), Math.sin(a), 0]; n = [Math.sin(a), -Math.cos(a), 0]; }
    const handR = [C[0] - d[0] * s + n[0] * this.lift, C[1] - d[1] * s + n[1] * this.lift, C[2] - d[2] * s + n[2] * this.lift];
    // 手首あり：右手は弓の上に被さる（手首→指先の向き ≒ 弦の面の法線の逆＋弓の進行方向へ少し）。左手は指板の下から弦を押さえる（法線方向）
    const rightHandDir = this.hasWrist ? [-n[0] + d[0] * 0.3 * this.bowDir, -n[1] + d[1] * 0.3 * this.bowDir, -n[2] + d[2] * 0.3 * this.bowDir] : null;
    this.setHand('R', handR, dt, Infinity, rightHandDir);
    this.aimHeldDir('R', d, 'x');

    // 左手：指板の位置。長い音ではビブラート（弦に沿って 5.5Hz）
    const L = instPoint(this.inst, cfg.leftHand[0], cfg.leftHand[1], p3?.leftHandZ ?? 0);
    const vibAxis = p3?.vib || cfg.vib || n;
    const vib = active.length && onset && onset.duration > 0.2 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * t + this.phase) : 0;
    this.setHand('L', [L[0] + vibAxis[0] * vib, L[1] + vibAxis[1] * vib, L[2] + (vibAxis[2] || 0) * vib], dt, 20, this.hasWrist ? [n[0] * 0.8 + d[0] * 0.2, n[1] * 0.8 + d[1] * 0.2, n[2] * 0.8 + d[2] * 0.2] : null);

    // 腰：強いほど前傾（楽器へ入り込む）、弓の進行方向へわずかに傾く。視線：弾いている間は楽器の方（あご楽器は左下、チェロ系は下）
    this.spine.rotation.z += MIRROR * 0.03 * this.bowDir * clamp(energy, 0, 1);
    this._spineGaze(st, dt, 0.16 * energy, cfg.chin ? 0.12 : 0.25, cfg.chin ? MIRROR * -0.35 : 0);
    if (cfg.chin) { // あごで楽器を挟む：首を楽器側（ローカル -x）へ傾げ、少し下を向き、頭がわずかに下がる
      this.headPivot.rotation.z += 0.32 + 0.08 * energy;
      if (!this.flat) this.headPivot.rotation.x += 0.18;
      this.headPivot.position.y = (HEAD_Y_PX - 0.8) * PX;
    } else {
      this.headPivot.rotation.z += -0.1 * energy;
    }
  }

  // ---- 管楽器（木管・金管）：両手は楽器上の点に置き、楽器の動きに追従。息継ぎ→アタック→ベル/角度の変化 ----
  _wind(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy, pitchNorm } = st;
    const cfg = this.cfg, inst = this.inst, p3 = this.p3;
    // 息継ぎ：フレーズの直前に肩が上がり（0.35 秒前から）、アタックで落ちる
    let breath = 0;
    if (next && !active.length && toNext < 0.35) breath = 1 - toNext / 0.35;
    this._breath = approach(this._breath, breath, 12, dt);
    const attack = onset ? Math.exp(-age * 9) * onset.velocity : 0;
    this.spine.position.y = (SPINE_Y + 0.5 * this._breath - 0.9 * attack) * PX;
    this.spine.scale.x = 1 + 0.05 * this._breath + 0.05 * energy;

    // 楽器の角度（種類別）。回転はスプライト面内（ローカル z 軸）。3D 姿勢でもローカル z 回転で「ベルが上がる」になる
    let lift = 0;
    if (onset) { const sustain = age < onset.duration ? 1 : Math.exp(-(age - onset.duration) * 5); lift = (0.08 + 0.3 * onset.velocity) * sustain * this.scaleVar; }
    this._lift = approach(this._lift, lift, 18, dt);
    if (inst) {
      let target = 0;
      switch (cfg.kind) {
        case 'flute':   target = (-0.15 + 0.3 * pitchNorm) * (0.3 + 0.7 * energy); break;
        case 'reed':    target = -0.3 * energy - 0.15 * this._lift; break;   // ベルが持ち上がる
        case 'bassoon': target = 0.12 * energy; break;
        case 'bell':    target = this._lift; break;                            // トランペット/トロンボーン：ベルが上がる
        case 'horn':    target = -0.4 * this._lift; break;
        case 'tuba':    target = 0.1 * this._lift; break;
      }
      this._tilt = (cfg.kind === 'bell' || cfg.kind === 'horn' || cfg.kind === 'tuba') ? target : approach(this._tilt, target, 8, dt);
      // reed の 3D 姿勢では「ベルを前へ上げる」＝ローカル x 軸まわり
      const axis = (p3 && cfg.kind === 'reed') ? [1, 0, 0] : [0, 0, 1];
      this.instRotate(axis, this._tilt);
    }
    // 手：楽器ローカル点 → rig 座標。指の動き（音の変わり目で少し動く）、トロンボーンは音程でスライド
    const finger = onset ? (((onset.index * 7) % 3) - 1) * 0.6 * Math.exp(-age * 7) : 0;
    if (cfg.slide) this._slide = approach(this._slide, (1 - pitchNorm) * 6, 10, dt);
    const hands = p3?.hands || cfg.hands;
    for (const side of ['L', 'R']) {
      const h = hands[side];
      let lx = h[0], ly = h[1], lz = h[2] || 0;
      if (side === 'R') { lx += (cfg.slide ? this._slide : 0); ly += finger * 0.3; }
      else { lx += finger * 0.3; }
      const p = inst ? instPoint(inst, lx, ly, lz) : [SHOULDER[side][0], 20, 0];
      let hd = null;
      if (inst && cfg.handDirs) { // 手首→指先の向き：楽器ローカル → rig（鏡像スプライトなら x を反転）
        const d0 = cfg.handDirs[side];
        _b.set(inst.scale.x < 0 ? -d0[0] : d0[0], d0[1], d0[2]).applyQuaternion(inst.quaternion);
        hd = [_b.x, _b.y, _b.z];
      }
      this.setHand(side, p, dt, 25, hd);
    }
    this.headPivot.rotation.z += -0.1 * energy + 0.08 * this._breath; // 息継ぎで少し上を向く
    this._spineGaze(st, dt, 0.1 * energy - 0.06 * this._breath, cfg.gazeDown ?? 0.05, 0); // 息継ぎで少し反り、吹くと前傾
  }

  // ---- 打楽器：構え位置→打点。直前に振りかぶり、打った瞬間に打点、戻る。マレットは打面を向く ----
  _percussion(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const cfg = this.cfg, p3 = this.p3;
    const strike = p3?.strike || cfg.strike;
    const fixedHand = p3?.fixedHand || cfg.fixedHand;
    const armOf = (n) => (cfg.singleArm ? cfg.singleArm : (n.index % 2 ? 'L' : 'R'));
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const spread = cfg.pitchSpread || 0; // 鍵盤打楽器：音程で叩く位置が横に動く（次の音へ向かって移動）
    for (const side of ['L', 'R']) {
      const sp = strike?.[side];
      if (!sp) { if (fixedHand?.[side]) this.setHand(side, fixedHand[side], dt, 10); continue; }
      let s = 0, ant = 0, vel = 0.5, pn = pitchNorm;
      if (onset && armOf(onset) === side) { vel = onset.velocity; s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 14); }
      if (next && armOf(next) === side && toNext < 0.25) { ant = (1 - toNext / 0.25) * 0.5 * next.velocity; vel = Math.max(vel, next.velocity); if (spread) pn = normOf(next); }
      const dx = spread ? (pn - 0.5) * 2 * spread : 0;
      const rest = [sp.rest[0] + dx, sp.rest[1] + 3 * vel, sp.rest[2] || 0];       // 強いほど高く構える
      const hit = [sp.hit[0] + dx, sp.hit[1], sp.hit[2] || 0];
      const target = [0, 1, 2].map((i) => lerp(rest[i], hit[i], s) + (rest[i] - hit[i]) * ant * 0.6);
      // 手首：マレットは打点を向き、手首はそれより少し起きる（振りかぶりで返し、打つ瞬間に伸びる）
      let aim = null;
      if (sp.head) { const headPt = [sp.head[0] + dx, sp.head[1], sp.head[2] || 0]; aim = [headPt[0] - target[0], headPt[1] - target[1], headPt[2] - target[2]]; }
      else if (cfg.heldAngle) aim = [Math.cos(cfg.heldAngle[side]), Math.sin(cfg.heldAngle[side]), 0];
      let hd = null;
      if (aim) { const a = v3(aim).normalize(); const w = 0.55 - 0.35 * s; hd = [a.x, a.y * (1 - w) + w * -0.2, a.z]; } // 打つ瞬間ほどマレットと一直線に
      this.setHand(side, target, dt, s > 0.5 ? Infinity : 22, hd);
      if (aim) this.aimHeldDir(side, aim, 'ny');
      this._strikeMax = Math.max(this._strikeMax ?? 0, s);
    }
    const sNow = this._strikeMax ?? 0; this._strikeMax = 0;
    this._spineGaze(st, dt, 0.06 * st.energy + 0.05 * sNow, 0.25, 0); // 打つ時に少し前へ、視線は打面
    if (this.inst) { // 打面の明滅：baseColor × 倍率
      const flash = onset ? 1 + 0.8 * Math.exp(-age * 10) * onset.velocity : 1;
      this.inst.material.color.copy(this.inst.userData.baseColor).multiplyScalar(flash);
    }
    this.headPivot.rotation.z += -0.06 * st.energy;
  }

  // ---- 鍵盤/ハープ：音程で手の位置、押鍵で手首が沈む／弦をはじく ----
  _keyboard(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const cfg = this.cfg, p3 = this.p3;
    const keys = p3?.keys || cfg.keys;
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const armOf = (n) => (normOf(n) < 0.5 ? 'L' : 'R');
    for (const side of ['L', 'R']) {
      let s = 0, ant = 0, pn = pitchNorm;
      if (onset && armOf(onset) === side) { s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 12); }
      if (next && armOf(next) === side && toNext < 0.15) { ant = 1 - toNext / 0.15; pn = normOf(next); }
      const sign = side === 'L' ? -1 : 1;
      if (keys) { // ピアノ/チェレスタ：鍵盤の上。音程で左右、押鍵で 1.5px 沈む、直前に 1px 浮く。指は鍵盤へ（前方・やや下）
        const x = (pn - 0.5) * 2 * keys.spread + sign * keys.gap;
        const y = keys.y + 3 - 1.5 * s + 1.0 * ant;
        this.setHand(side, [x, y, keys.z ?? 0], dt, s > 0.5 ? Infinity : 14, [0, -0.4 - 0.3 * s, 1]);
      } else { // ハープ：高い音ほど短い弦（右側）。はじくと手が弦から 1.5px 離れる。座標は楽器ローカル（pivot 基準）。指は弦へ
        const lx = -4 + pn * 11 + sign * 2;
        const ly = side === 'L' ? 25 : 18;
        const p = this.inst ? instPoint(this.inst, lx + 1.5 * s, ly + 0.5 * ant, this.flat ? 0 : sign * 1.5) : [lx - 9, ly, 0];
        let hd = null;
        if (this.inst && !this.flat) { _b.set(0, 0, -sign).applyQuaternion(this.inst.quaternion); hd = [_b.x, _b.y, _b.z]; }
        this.setHand(side, p, dt, s > 0.5 ? Infinity : 14, hd);
      }
    }
    this.headPivot.rotation.z += -0.06 * st.energy;
    this._spineGaze(st, dt, 0.1 * st.energy, keys ? 0.3 : 0.15, keys ? 0 : MIRROR * -0.25); // 鍵盤を見る／ハープの弦を見る
  }

  // ---- 指揮者：拍子に応じた振り図形（4拍子：下→内→外→上）。イクタスで跳ね、強いほど大きく ----
  _conductor(st, { beat, dt, settings }) {
    const g = st.energy; // = globalEnergy
    const n = beat.beatsPerBar || 4;
    const C = this.flat ? [7, 30, 3] : [6, 25, 10]; // 右手の振りの中心（rig px）。3D では胸の高さ・体の前で振る（顔の前に手が来ないように）
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
    this.setHand('R', [C[0] + px * amp, C[1] + py * amp, C[2]], dt, Infinity);
    // 指揮棒：肘→手首の延長線上（前腕の -y 方向）。2D 板は面内なので少し上向きに補正
    _a.set(0, -1, 0).applyQuaternion(this.foreQ.R);
    if (this.flat) _a.y += 0.35;
    this.aimHeldDir('R', [_a.x, _a.y, _a.z], 'x');
    // 左手：強い時は鏡像で同調、弱い時は胸の前で控える
    const mirror = [-C[0] - px * amp * 0.7, C[1] + py * amp * 0.6, C[2]];
    const restL = this.flat ? [-5, 24, 3] : [-5, 22, 7];
    const w = clamp((g - 0.25) / 0.5, 0, 1);
    this.setHand('L', [lerp(restL[0], mirror[0], w), lerp(restL[1], mirror[1], w), lerp(restL[2], mirror[2], w)], dt, 18);
    const nod = ph < 0.15 ? (1 - ph / 0.15) * 0.15 * g : 0;
    this.headPivot.rotation.z += -nod;
    this._leanC = approach(this._leanC ?? 0, 0.12 * g, 5, dt);
    if (!this.flat) this.spine.rotation.x += this._leanC; // 盛り上がるほど楽団へ身を乗り出す
    this.spine.rotation.z = Math.sin(Math.PI * beat.beat * 0.5) * 0.06 * (0.3 + 0.7 * g) * settings.sway;
    this.spine.position.y = (SPINE_Y - 0.3 * (1 - ph) * g) * PX;
  }
}
