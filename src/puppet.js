/*
 * PixelOrchestra — puppet.js
 * 最終更新: 2026-09-09 / v0.4 / 生成元: PixelOrchestra
 *
 * パペット（体・頭・2関節腕・楽器・手持ち物）。腕は 3D の 2 関節 IK で動く：
 *   「手をどこに置くか」を楽器ごとに座標で決め、肩・肘の向きは IK が解く。
 * 座標系：rig 空間の px（足元中央が原点、x 右・y 上・z 前＝指揮者側）。1px = PX unit。
 * 2D 板モード（flat）では従来の平面の姿勢（z=0・楽器は z 回転のみ）、ボクセルでは 3D 姿勢（p3）を使う。
 */
import { PX, body, head, upperArm, foreArm, foreArmNoHand, hand, shoulderPad, wristBall, INSTRUMENT, glowDisc, PART_STYLE, torsoSeated, legsStanding, thigh, shin, shoe, legsSeatedSprite, chair, applyWoodVariation, recolorParts, HARP_LEAN_CELLS } from './sprites.js';
import { makePersona, headFor, hairFor, torsoFor, coatFor, legsStandingFor, skirtSeated, handFor } from './persona.js';
import { COSTUMES, suitColors } from './costume.js';

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const deg2rad = (d) => (d * Math.PI) / 180;
// 2 関節腕の長さ [px]。上腕 10・前腕 7.5・手 4（2026-09-10 ユーザー指示で 8/6/4 から約 20% 延長：頭が大きく楽器が 1.25 倍なので口元・指板・ピストンが届く範囲の端に来ていた）
const ARM_UPPER = 10, FORE_NOHAND = 7.5, HAND_LEN = 4;
const HAND_GRIP = 2;   // 握りの点（棒が拳を貫く位置）は手首から 2px 先＝掌の中心（2026-09-22 ユーザー指摘：棒が拳の中に無かった）
const ARM_FORE = FORE_NOHAND + HAND_LEN; // 手首なし版（2D 板・非使用）の前腕＋手
// 肩の位置：上着の上端の角（x=±5.5, y=25.5）。以前の (±6, 30) は体の外側かつ上で、腕が胴から離れて見えた（2026-09-09 修正）
const SHOULDER = { L: [-5.5, 25.5, 0], R: [5.5, 25.5, 0] };
// 肩関節（鎖骨）：胸の中心 (0, 25.5) から肩までを 1 本の骨として、腕が届かない時だけ目標の方へ回す（最大 SHOULDER_MAX）。
// 胴体と腕のつなぎとして可動域を広げる装置（2026-09-10 ユーザー提案）
const CLAVICLE_LEN = 5.5;
const SHOULDER_MAX = 0.75; // rad ≈ 43°
// 楽器の大きさ（体との比率）。弦・木管・金管は実物に近い比率まで大きく（2026-09-10 ユーザー指定）。
// 打楽器・鍵盤・ハープは配置と手の座標がリグ基準なのでそのまま
const INST_SCALE = { strings: 1.25, woodwind: 1.25, brass: 1.25 };
const WOOD_INSTRUMENTS = new Set(['violin1', 'violin2', 'viola', 'cello', 'contrabass', 'marimba', 'xylophone', 'oboe', 'clarinet', 'bassoon', 'harp']); // 木目の個体差を付ける楽器
// 楽器ごとの倍率（ファミリーの既定を上書き）。基準は「実物の 1.25 倍」（2026-09-11 ユーザー確定。1px ≈ 4cm、指揮者 42.5px = 170cm で実測して揃えた）：
//   弦：バイオリン/ヴィオラは 1.25 のまま、チェロ 1.25（絵の胴が横に太いので 1.4 だと大きく見える。2026-09-11）、コントラバス 1.3（実物 185cm。1.5 だと胴が体を隠すので幅基準で妥協）。木管：フルート 1.05・ピッコロ/オーボエ 1.0・クラリネット 1.05・ファゴット 1.25 のまま
//   金管：ホルン 1.25 のまま・トランペット 0.9・トロンボーン 1.6（実物 120cm）・チューバ 1.35。鍵盤：ハープ 1.5（実物 175cm）・ピアノ 1.17・チェレスタ 1.2
//   打楽器（打点が rig 座標なので別途調整が要る）は据え置き：グランカッサ 1.5（ユーザー指定）
// 楽器ごとの奏者の身長倍率（楽器は同じ大きさのまま。コントラバス奏者は少し背が高い。2026-09-11 ユーザー指定）
const PLAYER_TALL = { contrabass: 1.08 };
// 動きのテンプレート（叩く＝percussion／弾く＝keyboard）は分類ではなく楽器で決める（2026-09-23：分類「鍵盤打楽器」に
// 叩く楽器と弾く楽器が混ざったため）。ここに無い楽器は分類（strings / woodwind / brass / percussion）がそのままテンプレート
const MOTION_OF = { xylophone: 'percussion', marimba: 'percussion', glocken: 'percussion', vibraphone: 'percussion', tubularbells: 'percussion',
                    piano: 'keyboard', celesta: 'keyboard', harp: 'keyboard' };
const HARP_HEAD_ROLL = 18 * Math.PI / 180;   // 2026-09-24 ユーザー指定で 12° → 18°
// ハープ奏者の体だけを回す角度（+ で奏者の左へ。2026-09-24 ユーザー指定：左手が奥の弦に届く余裕を作る）。ハープは床に対して動かさない
// ハープを右肩の動きに合わせて台座の底を軸に傾ける倍率（1 = 共鳴胴の上端が肩と同じだけ動く。0 で傾けない。2026-09-24 ユーザー指定）
const HARP_LEAN_GAIN = 1;
const HARP_TURN = -5 * Math.PI / 180;   // 2026-09-24 ユーザー指定で −10° → 0° → −5°（少しハープの方へ）
const HARP_STRING_Z = 2.75;   // ハープの弦の面の奥行き [楽器ローカル px]（sprites.js の harpCell：弦は z 5 のセル。変えたら揃える）
const PERC_UP = [0, 1, 0]; // 鍵盤・ハープの手の甲の向きヒント（真上）
// 棒を持つ打楽器の手の甲は**外側**（体から離れる向き）。実際の構えがそうなっている（2026-09-22 ユーザー指定）。
// 真上にしていたので、甲が上を向いて小指だけで握っているように見えていた
const STICK_UP = { L: [-1, 0, 0], R: [1, 0, 0] };
const STICK_HAND_DIR = [0, -1, 0];   // 棒を持つ手の指先の向き＝真下（拳を地面へ。2026-09-22 ユーザー指定）
// 棒を持つ手の手首の曲がりの上限（前腕の延長からの角度）。拳を真下へ向けたいが、前腕がほぼ水平なので
// そのままだと手首で 90° 折れ、拳が前腕の端からぶら下がって「手首が外れた」ように見えた（2026-09-23 ユーザー指摘）。
// 真下の方へ曲げるのはこの角度まで。人の手首が無理なく曲がる範囲
const STICK_WRIST_MAX = deg2rad(40);
// 棒を握る持ち物。**合わせシンバル（紐で持つ）は含めない**：棒用の握り・甲の向きを当てると手が崩れる（2026-09-22 ユーザー指摘）
const GRIP_ITEMS = new Set(['stick', 'mallet', 'keymallet', 'bigmallet']);
// ティンパニ 0.78・グランカッサ 1.5 → 1.4（2026-09-23 ユーザー指定：ひな壇に対して大きいので小さく）。
// どちらも打点（p3.strike の hit/rest/head）は触っていない：拡縮の原点（p3.pos）が打面の高さにあるので打面はほとんど動かない
const INST_SCALE_VARIANT = { contrabass: 1.3, cello: 1.25, piccolo: 1.0, flute: 1.05, oboe: 1.0, clarinet: 1.05, trumpet: 0.9, trombone: 1.6, tuba: 1.35, harp: 1.5, piano: 1.17, celesta: 1.2, bassdrum: 1.4, timpani: 0.78 }; // グランカッサは 1.5 倍（2026-09-10 ユーザー指定）。奏者側の打面は pivot の x に固定なので打点は変わらない // コントラバスは体との比率上 1.1（1.25 だと上部が頭の高さまで来て体にめり込む）
const HEAD_Y_PX = 29.5; // 頭の付け根（首の上端 29 に少し食い込ませる）
const SPINE_Y = 13;     // 腰の高さ（座面の高さ・上半身の回転軸）
// リグの座標系は「正面（+z）を向いたキャラを鏡で見た向き」で定義されている（R = ローカル +x）。
// 本人の右手は forward×up = -x なので、rig 全体を x 反転して右利きにする（2026-09-09 ユーザー指摘：全員左利きだった）
const MIRROR = -1;
// 肘を出す向きのヒント（rig 空間）。平面モードでは面内（z=0）に保つ
const POLE = { L: [-1, -0.5, -0.35], R: [1, -0.5, -0.35] };
const POLE_FLAT = { L: [-1, -0.3, 0], R: [1, -0.3, 0] };

// ---- ベクトル・回転の小道具（THREE を使う。使い回しのテンポラリ）----
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();
const _mUp = new THREE.Matrix4();   // rig → upper の変換（床に固定した鍵盤の手の位置。_keyboard）
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const v3 = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2] || 0);

/**
 * 「ボーンの軸（ローカル -y）を dir に向け、ローカル +z をなるべく rig +z に保つ」回転
 * （腕・手持ち物のスプライトは pivot から -y 方向に伸び、+z が正面）
 */
function quatFromBoneDir(dir, out, up = null) {
  const y = _a.copy(dir).normalize().negate();   // local -y → dir
  const zHint = up ? _b.set(up[0], up[1], up[2]) : _b.set(0, 0, 1); // up = ローカル +z（手の甲側）を向けたい向きのヒント（省略時は rig の前）
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
  _a.set(lx * inst.scale.x, ly * inst.scale.y, lz * inst.scale.z).applyQuaternion(inst.quaternion); // 鏡像（scale.x<0）と拡大を反映
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
// 弦: bow = { contact: 弓と弦の接点（楽器ローカル px・pivot 基準・y 上）, world: 正面から見た弓の角度(2D), sMin/sMax = 接点から手元までの距離の範囲 [px]（弓は 26px） }, leftHand: 楽器ローカル px
const VIOLIN_AXIS = [-0.55, -0.32, 0.77];   // あごから渦巻きへ（左・下・前）
const VIOLIN_UP = [0.15, 0.9, 0.35];        // 弦の面の法線（上・やや前）
const VIOLIN_Q = quatFromAxes(VIOLIN_AXIS, VIOLIN_UP, '-x'); // 鏡像スプライトなので渦巻きはローカル -x
const VIOLIN_BOW = (() => { const b = new THREE.Vector3().crossVectors(v3(VIOLIN_UP), v3(VIOLIN_AXIS)).normalize(); if (b.x > 0) b.negate(); return [b.x, b.y, b.z]; })(); // 手元→先端（右手から左へ）
// 長い休みで楽器を下ろす（2026-09-12 ユーザー指定）。REST_GAP 秒以上の休みで下ろし、次の音の REST_LEAD 秒前に構え直す
// 音が止んですぐには下ろさず、REST_HOLD 秒そのまま構えて待つ
const REST_GAP = 4.0, REST_LEAD = 1.5, REST_HOLD = 1.0;
// あご楽器の下ろし：膝の上に水平に置く（渦巻きは体の左前、表板は上）
const VIOLIN_REST_Q = quatFromAxes([-0.85, -0.1, 0.5], [0, 1, 0], '-x');
const CELLO_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0.25)); // 約 29° 後ろへ寝かせて上部を胸に寄りかからせ、14° 左へ倒してネックを頭の横に出す（下側は右足側・前へ。2026-09-11 ユーザー指定）
// チェロ系の弓の向き・弦から離れる向きは楽器の姿勢から：弓は楽器のローカル -x（右手→左）、弦の面の法線はローカル +z（正面）
const CELLO_BOW = (() => { const v = new THREE.Vector3(-1, 0, 0).applyQuaternion(CELLO_Q); return [v.x, v.y, v.z]; })();
const CELLO_UP = (() => { const v = new THREE.Vector3(0, 0, 1).applyQuaternion(CELLO_Q); return [v.x, v.y, v.z]; })();
// コントラバスは立奏。体の左に立て、表板を右前へ約 34° 向け（Euler y=0.6）、上部を奏者側へ浅く寄りかからせる（x=-0.15）。
// 顔が楽器に隠れないよう体の左へずらす（2026-09-10 ユーザー指定：実際の構えのように横へ・角度をつける）。
// 位置・角度は楽器の輪郭が胴・頭・脚（前面 z=3/4/2）に入り込まない組み合わせを数値探索で選んだ（tools/ 相当の一時スクリプト）
// 約 19° 後傾（弦の軸で実測。-0.8 では 34° で寝かせすぎ、と 2026-09-16 ユーザー指摘）。
// 向き（y）は -0.1：+0.3 だと表板の x 軸が奏者側へ向き、弓が手前へ引かれて右手が体の前に出なかった（手首 z 1〜2px）。
// -0.1 なら弓が表板に沿って横に走り、右手は体の前（z 8〜9px）で左右 13px 動く
const BASS_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, -0.1, 0.15));
const BASS_BOW = (() => { const v = new THREE.Vector3(-1, 0, 0).applyQuaternion(BASS_Q); return [v.x, v.y, v.z]; })();
const BASS_UP = (() => { const v = new THREE.Vector3(0, 0, 1).applyQuaternion(BASS_Q); return [v.x, v.y, v.z]; })();
const FWD = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)); // スプライトの +x を前方（+z）へ
// グランカッサ：打面を左右向きにしてから（y -90°：絵の正面＝手前の打面が奏者側 +x を向き、胴は pos.x から -x へ 8px）、
// 上部を奏者から遠い側（-x）へ 0.15 rad 傾ける（z 軸まわり、ワールド順）
// 銅鑼：絵の正面（面、+z）を奏者の右（rig +x ＝ 体を回す前の正面＝客席側）へ向ける y 軸 90° 回転。首は右へ 90° ひねって指揮者を見る（2026-09-19）
const GONG_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
const GONG_HEAD_YAW = Math.PI / 2;   // 符号は実測で確認（-π/2 だと指揮者と逆を向いた）
// スネアの打ち方（手の座標）。ハイハットも同じ腕の形で叩くので共有する（2026-09-19 ユーザー指定）
const VARIANT_SNARE_STRIKE = { L: { hit: [-3, 25], rest: [-9, 32], head: [-5, 18] }, R: { hit: [3, 25], rest: [9, 32], head: [5, 18] } };   // 2D 板も同じく左右に開く
// 手（hit / rest）は**打面より上**に置く。以前は打面より 1〜2px 下にあり、スティックが手から上向きに伸びて
// 「拳から棒が生えている」形になっていた（2026-09-22 ユーザー指摘。実測でも先端が打面の 6px 上で止まっていた）。
// ハイハット・サスシンは設置高をスネアに合わせた（打面 ≒ 16.5）ので、3 種で同じ値を使える。
//   hit  19.5 … 打面の 3px 上。肩（25.5）より十分下で、肘が自然に曲がる
//   rest 23   … 構えは打点の 3.5px 上。以前 25.5 にしたら肩の高さまで上がって不自然だった
//   head 16.5 … 打面。手からの距離 10.8px ≒ スティックの長さ 11px なので先端がちょうど届く
// z は体から 6px 前へ出した（2026-09-22 ユーザー指摘：肘を鋭角に曲げすぎ）。
// 肩は z 0、腕は肩から指先まで 21.5px。手が z 9 だと肩との距離 11px で肘が 61°（畳みすぎ）。
// z 15 にすると距離 16.3px・肘 98° になり、自然に構えられる
//   head の x は ±4。±1（ほぼ中央）だと左右のバチが打面上でぶつかりそうに見える（2026-09-22 ユーザー指摘）
const VARIANT_SNARE_STRIKE3 = { L: { hit: [-7.5, 19.5, 15], rest: [-8.5, 23, 14], head: [-4, 16.5, 21] }, R: { hit: [7.5, 19.5, 15], rest: [8.5, 23, 14], head: [4, 16.5, 21] } };
const BASSDRUM_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.15));

const VARIANT = {
  // contactZ = 駒の上の弦の高さ、leftHandZ = 指板の表面＋弦（楽器ローカル px、表板の厚みは絵の depth から）。指先はここに置く
  violin1:    { chin: true, spine: true, gaze: true, inst: { pos: [-5, 28, 4], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [0, 0], world: 2.3, sMin: 3, sMax: 22 }, leftHand: [4, 0.3], // 弓の接点は胴の上端（ネック側）と駒の中間（2026-09-11 ユーザー指定）
                p3: { pos: [-6, 25.5, 8], quat: VIOLIN_Q, bowDir: VIOLIN_BOW, liftDir: VIOLIN_UP, sMin: 3, sMax: 21, vib: VIOLIN_AXIS, contactZ: 2.3, leftHandZ: 1.9 },   // 指板が別パーツ（+0.5px）になったので 1.4 → 1.9（2026-09-16）
                rest: { pos: [-2, 14, 12], quat: VIOLIN_REST_Q, bowHand: [8, 12, 9], bowAim: [-1, -0.06, 0.3] } }, // z 6→8：首にめり込んで見えるので前へ。y 27→25.5：あご側を肩に乗せる（2026-09-11）。弓は太ももに沿わせる（2026-09-13）
  viola:      { chin: true, spine: true, gaze: true, inst: { pos: [-5, 28, 4], rot: 0.45, mirror: true }, held: { R: 'bow' }, bow: { contact: [0.25, 0], world: 2.3, sMin: 3, sMax: 22 }, leftHand: [5, 0],
                p3: { pos: [-6, 25.5, 8], quat: VIOLIN_Q, bowDir: VIOLIN_BOW, liftDir: VIOLIN_UP, sMin: 3, sMax: 21, vib: VIOLIN_AXIS, contactZ: 2.5, leftHandZ: 2.1 },   // 同上 1.6 → 2.1
                rest: { pos: [-2, 14, 12], quat: VIOLIN_REST_Q, bowHand: [8, 12, 9], bowAim: [-1, -0.06, 0.3] } },
  cello:      { spine: true, gaze: true, floorStand: true, inst: { pos: [2, 2, 4], rot: 0 }, held: { R: 'bow' }, bow: { contact: [0.5, 18.25], world: 2.95, sMin: 2, sMax: 16 }, leftHand: [-0.5, 24], vib: [0, 1, 0], // 弓の接点は胴の上端 row 14 と駒 row 33 の中間 row 23.5（基本 y=18.25）
                // y -0.76：原点（裏板の面）を支点に後傾するとピンの足（厚みの中央）が持ち上がるので、その分下げて接地させる（頂点で計測。2026-09-16）
                p3: { pos: [0, -0.76, 18], quat: CELLO_Q, bowDir: CELLO_BOW, liftDir: CELLO_UP, sMin: 2, sMax: 16, vib: [0, 1, 0], contactZ: 5.2, leftHandZ: 5.0 }, legSpread: 6.5,   // leftHandZ：ネックを表板側へ寄せ（3.5 → 4.5）、指板の厚み分で 5.0（2026-09-16）
                rest: { bowHand: [9, 13, 9], leftHand: [-6, 15, 9] } }, // エンドピンは足より前、上部は胸。膝を開いて挟む。体の左（向かって右）へ 4.5 ずらす（2026-09-10 ユーザー指定）
  contrabass: { spine: true, gaze: true, floorStand: true, inst: { pos: [3, 0, 4], rot: 0 }, held: { R: 'bow' }, pole: { R: [0.6, -0.6, 0.5] }, /* 右肘は外・下・前（真下だと肘が体の後ろ z -0.6 に落ちる。2026-09-16 ユーザー指定）。[0.3,-0.4,1] のように前へ出しすぎると IK が 2 解を行き来して腕が毎フレーム 2〜9px 跳ねる（チラつき）。この向きなら 0.2px */ bow: { contact: [0.5, 19], world: 2.95, sMin: 5, sMax: 15 }, leftHand: [0, 32], // 弓の接点は指板の末端（y 17.5）より少し上（y 19）。駒（y 15）のすぐ上だと近すぎる、とのユーザー指定（2026-09-16）。以前は、弓を持つ手が指板に重なった。手は弦から 5px 以上離す（2026-09-16 ユーザー指摘） vib: [0, 1, 0], // 左手はネック（胴の上端 row 16 = y 30 より上）を持つ。胴を腕が貫通していたため（2026-09-16 ユーザー指摘）
                // 楽器は 1.3 倍（一度 1.2 に下げたが、姿勢が決まったので元に戻した）・エンドピン短縮・胴の厚み 2/3・19° 後傾。
                // 体のすぐ左（x -5）・前（z 18）。前に出すほど左腕が胴を避けやすい：1.3 倍だと z 13 で腕が胴の上部を通り（24 点）、
                // z 16 で静止時 0 点、強奏の前のめり（12°）中も 0 にするには z 18（2026-09-16 数値探索）。左手はネックの下寄り（y 30。29 以下は肘が胴の上端に入る）。横に離すと「右手が遠い／横にズレすぎ」（ユーザー指摘）
                // y -0.56：原点（裏板の面）を支点に後傾するとピンの足（厚みの中央）が持ち上がるので、その分下げて接地させる（頂点で計測。2026-09-16）
                p3: { pos: [-5, -0.56, 18], quat: BASS_Q, bowDir: BASS_BOW, liftDir: BASS_UP, sMin: 5, sMax: 15, vib: [0, 1, 0], contactZ: 5.7, leftHandZ: 5.5 },   // 胴の厚み 9 セル（4.5px）：駒の上の弦 4.5+1.2、指板の表面 4.5+0.5+0.5（2026-09-16）
                rest: { bowHand: [9, 16, 8], leftHand: [-9, 19, 5] } }, // 立奏。体の左に寝かせて構える。休みの左手は胴の肩に添える
  // 木管・金管：hands = 楽器ローカル px。p3.rot3 = 3D の姿勢（Euler）
  // 吹き口の高さ ≒ 32（頭の付け根 29.5 + 2.5）
  // handDirs = 手首→指先の向き（楽器ローカル）。フルートは下から抱えて指は上へ、縦笛は左右から、金管は上から／横から
  // フルート／ピッコロ：右手は管の後ろ（奏者側）から回し、指先を管の前上のキーに置く（親指が下、手首が奏者側。クラリネットを横に向けた持ち方。2026-09-11 ユーザー指摘）。左手は下から支える（従来どおり。ユーザー確認）
  flute:      { inst: { pos: [-1, 31.5, 4], rot: -0.15 }, hands: { L: [6, 0.3], R: [13, 1.3] }, kind: 'flute', handDirs: { L: [0, 1, 0], R: [0, 0.5, 1] }, gazeDown: 0.05, pole: { R: [0, -1, 0] }, // 右肘は真横でなく斜め下へ（2026-09-11）
                p3: { pos: [-1, 31.5, 5], rot3: [0, -0.35, -0.15], hands: { L: [6, 0.3, 0.6], R: [13, 1.3, 0.8] } },
                rest: { pos: [-12, 15.5, 10], rot3: [0, 0, 0] } }, // 休みは太ももの上に横に置く（2026-09-16 ユーザー指定）。pivot は頭部管側なので左へ寄せて中央に
  // ピッコロ：フルートと同じ構え。管が短いので手の間隔は狭い
  piccolo:    { inst: { pos: [-1, 31.5, 4], rot: -0.15 }, hands: { L: [4, 0.3], R: [8, 1.3] }, kind: 'flute', handDirs: { L: [0, 1, 0], R: [0, 0.5, 1] }, gazeDown: 0.05, pole: { R: [0, -1, 0] },
                p3: { pos: [-1, 31.5, 5], rot3: [0, -0.35, -0.15], hands: { L: [4, 0.3, 0.6], R: [8, 1.3, 0.8] } },
                rest: { pos: [-6, 15.5, 10], rot3: [0, 0, 0] } }, // 太ももの上に横に（2026-09-16 ユーザー指定）
  oboe:       { inst: { pos: [0, 31.5, 4], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.15,
                p3: { pos: [0, 31.5, 5], rot3: [-0.5, 0, 0], hands: { L: [0.5, -7, 1.2], R: [-0.5, -12, 1.2] } },
                rest: { pos: [-13, 15.5, 10], rot3: [0, 0, Math.PI / 2] } }, // 休みは太ももの上に横に（クラリネットと同じ。2026-09-16 ユーザー指定）
  clarinet:   { inst: { pos: [0, 31.5, 4], rot: -0.1 }, hands: { L: [0.5, -7], R: [0.5, -13] }, kind: 'reed', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.15,
                p3: { pos: [0, 31.5, 5], rot3: [-0.5, 0, 0], hands: { L: [0.5, -7, 1.2], R: [-0.5, -12, 1.2] } },
                rest: { pos: [-13, 15.5, 10], rot3: [0, 0, Math.PI / 2] } }, // 休みは太ももの上に横に（2026-09-16 ユーザー指定）。縦の絵を z 回りに 90° 倒し、マウスピース側（pivot）を左端に
  bassoon:    { inst: { pos: [4, 0.5, 4], rot: 0.35 }, hands: { L: [0.5, 24], R: [0.5, 16] }, kind: 'bassoon', handDirs: { L: [1, 0, 0], R: [-1, 0, 0] }, gazeDown: 0.1,
                // 体の右前に置き、上部を左へ倒す。ベルは頭より上、ボーカル（別パーツ）が口の左横へ届く。位置・傾きは胴・頭に入り込まない組み合わせを数値探索で選定（2026-09-10）
                p3: { pos: [6, 1.5, 15], rot3: [-0.15, 0, 0.35], hands: { L: [0.5, 22, 2.2], R: [1, 13, 2.2] } },
                rest: { pos: [8, 0, 13], rot3: [-0.1, 0, 0.55] } }, // 指先は管の前面（z 2）で手が楽器に重なる（2026-09-11）
  // トランペット：右手の指先はピストンの頂（ly=3）、手首はその後ろ下のリードパイプ高さ（左手の手首より上）。上腕は前へ出し、肘で曲げる（pole=前。2026-09-10 ユーザー指定）
  trumpet:    { inst: { pos: [1, 32.5, 4], rot: -0.15 }, hands: { L: [6, -1], R: [8, 3] }, kind: 'bell', handDirs: { L: [0, 0, -1], R: [0.7, 0.7, 0] }, gazeDown: 0.0, pole: { R: [0.2, 0.1, 1] },
                p3: { pos: [0.5, 32.5, 3], quat: FWD, hands: { L: [6, -1, 1.5], R: [8, 3, -1.5] } },
                rest: { pos: [2, 13, 9], rot3: [0, 0, -1.2] } },
  horn:       { inst: { pos: [2, 24, 4], rot: 0 }, hands: { L: [-3, 2], R: [5, -4] }, kind: 'horn', handDirs: { L: [0, -1, 0], R: [1, 0, 0] }, gazeDown: 0.05,
                p3: { pos: [3, 24, 4], rot3: [0, 0.8, 0], hands: { L: [-3, 2, 1], R: [5, -4, -1] } },
                rest: { pos: [3, 12, 10], rot3: [0.5, 0.8, 0] } },
  // トロンボーン：左手はベル部とスライド部をつなぐ支柱（マウスピース寄り・左）、右手は外管の支柱（スライドと一緒に動く）
  trombone:   { inst: { pos: [1, 32.5, 4], rot: -0.1 }, hands: { L: [3, 3], R: [5, 0] }, kind: 'bell', slide: true, handDirs: { L: [0, 0, -1], R: [0, 0, 1] }, gazeDown: 0.0,
                // 肘は真下＋わずかに外（内向きすぎると脇が閉じすぎる）。左右で腕の曲がり方が違うので効き方も違い、値は非対称になる。
                // 実測：肩 L-5.5 / R+5.5 に対し 肘 L-6.5 / R+5.5（2026-09-12 ユーザー指定）
                pole: { L: [-0.12, -1, 0], R: [0.8, -1, 0] }, tiltBias: -0.25, // tiltBias：楽器を下げて構える
                p3: { pos: [0.5, 32.5, 3], quat: FWD, hands: { L: [2, -1.09, 1.39], R: [3.5, -1.09, 1.39] }, // 左手＝内管の支柱、右手＝外管の支柱。
                // どちらも銀のバーの中心。スライド部は -60° ロールしているので絵の行数をそのまま y に使えず、
                // 中心（y -3.5 セル・z -0.5 セル）を回して求めた値（2026-09-12）
                rest: { pos: [1, 14, 8], rot3: [0, 0, -1.15] } } }, // 右手はロール後の上の外管（右へ 0.8）
  tuba:       { inst: { pos: [3, 6, 4], rot: 0 }, hands: { L: [-2, 12], R: [4, 14] }, kind: 'tuba', handDirs: { L: [0, 0, -1], R: [0, -1, 0] }, gazeDown: 0.05,
                p3: { pos: [3, 6, 6], rot3: [0, 0.3, 0], hands: { L: [-2, 12, 2], R: [4, 14, 2] } },
                rest: { pos: [5, 2, 10], rot3: [0.25, 0.3, 0] } },
  // 打楽器：strike = { L/R: { hit, rest, head } }（rig px）。p3.strike は 3D（手は楽器の上へ前方に伸びる）
  // 打楽器の hit/rest は手の先端（マレットの握り）。手首はその 4px 手前なので、握りを z 10〜12 に置いて手首を体の前 6〜8px に出す（2026-09-10）
  timpani:    { floorStand: true, inst: { pos: [0, 15, 14], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, roll: { byArt: true, rate: 6, from: 0.12 },   // ロールはキースイッチの奏法で（2026-09-23）
                strike: { L: { hit: [-6, 24], rest: [-12, 32], head: [-6, 14] }, R: { hit: [6, 24], rest: [12, 32], head: [6, 14] } },
                // hit = 手（体の近く・腰の高さ）、head = 先端が当たる点（皮の手前側）。マレット（10px）は皮に対して約 30° の浅い角度
                p3: { pos: [0, 15, 14], strike: { L: { hit: [-7, 18.5, 17], rest: [-9, 22, 14], head: [-6, 15.5, 25] }, R: { hit: [7, 18.5, 17], rest: [9, 22, 14], head: [6, 15.5, 25] } } } },   // 手は打面（15.7）の上へ（2026-09-22） // 構えは打点より 6 上・3 手前（大きく振り上げる） // 握り z 11（手首 ≒ 7）。手首は握りより 1.5 上・4 手前に来るので、握りは肘（≒21）より 4〜5 下に置く。マレットは水平
  // グランカッサ：打面は横向き（左右を向く）で、上部を奏者から遠い側へ 17° 傾ける（手前の打面が奏者の方を向く。実際の据え置き台）。
  // 奏者のすぐ左前に置き、右手はマレットを左向きに水平に構えて胸の前で横に振る（マレットの頭が手前の打面に当たる）。
  // 視線は左の打面へ（2026-09-10 ユーザー指定：左に配置・右手で打つ。傾きの向きと貫通を修正）
  bassdrum:   { floorStand: true, inst: { pos: [-4, 0, 4], rot: 0 }, held: { R: 'bigmallet' }, singleArm: 'R', gazeYaw: MIRROR * -0.5,
                strike: { R: { hit: [4, 22], rest: [13, 28], head: [-2, 15] } }, fixedHand: { L: [-12, 22] },
                // 手前の打面は x≈-8（下）〜-10.5（高さ 20）。hit = 手（左腰の前）、head = マレットの頭の中心（半径 2.5 なので打面の 2.5px 手前）。
                // 柄（11px）は打面と平行に前上がりで、横に振って頭の側面で打つ
                p3: { pos: [-8, 0, 7], quat: BASSDRUM_Q, strike: { R: { hit: [-4, 17, 7], rest: [5, 19, 8], head: [-8, 24, 10], restAim: [0, 0.15, 1], wind: 1.4 } }, fixedHand: { L: [-9, 20, 10] } } }, // 構え：マレットは真前（打面を向かない）。振りかぶりで手も右へ大きく（wind 1.4）、打つ瞬間に打面へ // 柄は打面と平行に立てて持ち（頭が上）、横に振る。手首は体の前 6px。左手は打面の上縁に添える
  snare:      { floorStand: true, inst: { pos: [0, 17, 14], rot: 0 }, held: { L: 'stick', R: 'stick' },
                strike: VARIANT_SNARE_STRIKE,
                // hit = 手（腰の前）、head = 先端（皮の中央寄り）。スティック（11px）は皮とほぼ平行（約 15° 下向き）
                p3: { pos: [0, 17, 14], strike: VARIANT_SNARE_STRIKE3 } }, // 握りは肩幅より外（肘を張る）、先端は打面の中央（z 16）に集まる。手首 ≒ z 6・肘より下
  cymbal:     { held: { L: 'cymbal', R: 'cymbal' }, heldAngle: { L: 0, R: Math.PI }, bothArms: true, flourish: true, // 円盤の面（ローカル -y）を内側（±x）へ向ける。両手同時に中央で合わせ、強い音では腕を大きく回す（2026-09-11）
                strike: { L: { hit: [-2, 30], rest: [-12, 26] }, R: { hit: [2, 30], rest: [12, 26] } },
                p3: { strike: { L: { hit: [-2, 25, 15], rest: [-9, 19, 13] }, R: { hit: [2, 25, 15], rest: [9, 19, 13] } } } }, // 合わせるのは肩の高さ（顔を挟まない）、構え・振りかぶりはその下（2026-09-12 ユーザー指定：実際は低い位置から高い位置で合わせる）
  // ハイハット（2026-09-19 ユーザー指定：スネアのように両手にスティックを持って叩く）。置き場所・大きさはスネアと同じで、上のシンバルの表が y 17。
  // 腕の形（握り・構え・スティックの向き）はスネアとまったく同じ（2026-09-19 ユーザー指定）。上のシンバルの表（y 17）はスネアの皮と同じ高さで、
  // 握り（x ±7.5, z 9）は上から見てシンバルの円（半径 8）の外なので貫通しない。先端はスネアと同じく中心（カップ）に当たる
  hihat:      { floorStand: true, inst: { pos: [0, 16.5, 14], rot: 0 }, held: { L: 'stick', R: 'stick' },   // 打面をスネアに揃える（2026-09-22）
                strike: VARIANT_SNARE_STRIKE,
                p3: { pos: [0, 16.5, 14], strike: VARIANT_SNARE_STRIKE3 } },
  // サスペンデッドシンバル（2026-09-19 ユーザー指定）：置き場所・高さはスネアと同じ（表 y 17）、腕の形（握り・構え）もスネアと同じ。持つのはロール用のマレット。
  // 先端はスネアのように中央へ集めず、左右の縁寄り（中心 (0, 17) から横に約 6px）へ向ける。握り（x ±7.5, z 9）はシンバルの円（中心 z 17・半径 9）の外。
  // roll：0.5 秒以上の音はロール（左右交互）。振り上げの高さは音の始めほど小さく、終わりに向けて構えの高さまで大きくする（クレッシェンド込みの音源に合わせる）
  suscymbal:  { floorStand: true, inst: { pos: [0, 16.5, 14], rot: 0 }, held: { L: 'mallet', R: 'mallet' }, roll: { minDur: 0.5, rate: 6, from: 0.12 },   // 同上
                strike: VARIANT_SNARE_STRIKE,
                p3: { pos: [0, 16.5, 14], strike: { L: { ...VARIANT_SNARE_STRIKE3.L, head: [-6.5, 16.5, 21] }, R: { ...VARIANT_SNARE_STRIKE3.R, head: [6.5, 16.5, 21] } } } },
  // 銅鑼（2026-09-19 ユーザー指定。ユーザー提供の写真どおり）：奏者は体ごと左へ 90° 回って銅鑼に向き、顔だけ首をひねって指揮者へ向け続ける（bodyYaw / headYaw）。
  // 銅鑼は奏者の前・少し左に吊り、面は奏者の右（＝体を回す前の正面＝客席側）へ向ける。奏者はその手前（客席側）に立ち、客席側の面を打つ。
  // （面を左右に向けると正面のカメラから円盤が縦の線にしか見えないので、面は客席向き）
  // 以下は体を回した後の rig 座標（+z = 銅鑼の方、+x = 客席側）。円盤の中心は (-7, 24, 25)・半径 13.5、客席側の面は x -6.5。
  // 腕を自然に伸ばして肘を軽く曲げた形になるよう、銅鑼を体から離してある（2026-09-19 ユーザー指定。近いと肘が深く折れた）：
  // 肘の角度は「肩から手首までの距離」で決まる（上腕 10・前腕 7.5。手首は握りの 4px 手前）。打つ時の握りは肩（5.5, 25.5, 0）から約 21px、構えは約 20px。
  // 打つ点は面の中心の 6px 下（2026-09-23 ユーザー指定で 2 回に分けて下げ、構えも同じだけ下ろした。
  // 握りは肩からの距離が伸びすぎないよう（約 21px を保つ）z を手前へ寄せた）。
  // さらに肘を曲げるため、銅鑼ごと 3px 奏者へ寄せた（z 28 → 25。手・打点も同じだけ。肩から握りまで約 18.5px）：マレットの頭（半径 2.5）の中心が面の 2.5 手前（x -4）。握りから頭の中心まで 8.5px（マレットの長さ）。
  // 手前の柱（z 12）と床の足は奏者の足より前。構えのマレットは面と平行・水平（前へ向ける）。
  // 左手は手前の柱（x -7・z 9〜10）を肩より少し上で握る（2026-09-23 ユーザー指定。以前は円盤の縁に添えていて、銅鑼を触っているように見えた）
  gong:       { inst: { pos: [-7, 0, 25], rot: 0 }, held: { R: 'bigmallet' }, singleArm: 'R', bodyYaw: Math.PI / 2, headYaw: GONG_HEAD_YAW,
                strike: { R: { hit: [-1.5, 23], rest: [3, 22], head: [-4, 24] } }, fixedHand: { L: [-6, 31.8] },
                p3: { quat: GONG_Q, strike: { R: { hit: [-1.5, 17, 14.9], rest: [11, 19, 16], head: [-4, 18, 23.2], restAim: [0, 0.1, 1], wind: 1.6, arc: true } }, fixedHand: { L: [-7, 30, 9.5] } } },
                // 構えは打点から肩を中心に客席側へ約 35°・少し上へ回した所（肩からの距離は打点とほぼ同じ 20〜21px）。振りかぶりはさらに外・上へ回り、肩から腕全体で振り下ろす
  // チューブラーベル（2026-09-19 ユーザー指定）：奏者の前（管の面は z 14、奏者側の表面 z 13.5）に立て、右手のハンマー 1 本で管の頭（キャップ、y 30）を叩く。
  // 音程で右手が管の前を左右に動く（管は x -11〜+11 に 12 本。低音が左）。ハンマーの頭（半径 1.5）の中心が表面の 1.5 手前（z 12）・キャップのすぐ下（y 29.5）に当たり、
  // 握りはそこから 8px（マレットの長さ）手前下の胸の前（z 4.8）。構えでは手を少し引く。左手は体の横に下ろす
  tubularbells: { floorStand: true, inst: { pos: [0, 0, 14], rot: 0 }, held: { R: 'mallet' }, singleArm: 'R', pitchSpread: 11,
                strike: { R: { hit: [0, 26], rest: [0, 24], head: [0, 30] } }, fixedHand: { L: [-8, 12] },
                p3: { pos: [0, 0, 14], strike: { R: { hit: [0, 25.5, 4.8], rest: [0, 25, 1.5], head: [0, 29.5, 12] } }, fixedHand: { L: [-8, 12, 3] } } },
  xylophone:  { floorStand: true, inst: { pos: [0, 0, 14], rot: 0 }, held: { L: 'keymallet', R: 'keymallet' }, pitchSpread: 9,
                strike: { L: { hit: [-3, 18], rest: [-7, 25], head: [-3, 11] }, R: { hit: [3, 18], rest: [7, 25], head: [3, 11] } },
                p3: { pos: [0, 0, 14], strike: { L: { hit: [-5, 18, 14], rest: [-6, 20, 14], head: [-3, 14.5, 21.5] }, R: { hit: [5, 18, 14], rest: [6, 20, 14], head: [3, 14.5, 21.5] } } } },   // 打面 16px に合わせて -4（2026-09-22） // 握り z 8（手首 ≒ 5）
  // グロッケン（2026-09-23）：シロフォンと同じ構え・叩き方。楽器が小さいので打点（head の z）は短い音板にも乗る 21。
  // 音程の幅（pitchSpread）は 5：マレットの頭の x は ±3 ± pitchSpread なので -8〜8 に収まる（音板は x -9〜8。7 だと両端で 1〜2px はみ出した）
  glocken:    { floorStand: true, inst: { pos: [0, 0, 14], rot: 0 }, held: { L: 'keymallet', R: 'keymallet' }, pitchSpread: 5,
                strike: { L: { hit: [-3, 18], rest: [-7, 25], head: [-3, 11] }, R: { hit: [3, 18], rest: [7, 25], head: [3, 11] } },
                p3: { pos: [0, 0, 14], strike: { L: { hit: [-5, 18, 14], rest: [-6, 20, 14], head: [-3, 14.5, 21] }, R: { hit: [5, 18, 14], rest: [6, 20, 14], head: [3, 14.5, 21] } } } },   // head z 19.5 → 21（同上）
  marimba:    { floorStand: true, inst: { pos: [0, 0, 14], rot: 0 }, held: { L: 'keymallet', R: 'keymallet' }, pitchSpread: 13,
                strike: { L: { hit: [-3, 14], rest: [-7, 21], head: [-3, 7] }, R: { hit: [3, 14], rest: [7, 21], head: [3, 7] } },
                p3: { pos: [0, 0, 14], strike: { L: { hit: [-5, 18, 14], rest: [-6, 20, 14], head: [-3, 15, 23.5] }, R: { hit: [5, 18, 14], rest: [6, 20, 14], head: [3, 15, 23.5] } } } },   // head z 22 → 23.5：低音の音板を伸ばして高音側の音板も奥へ下がった（2026-09-23）   // 打面 16px に合わせて -7（2026-09-22）
  // ビブラフォン（2026-09-23）：マリンバと同じ構え・叩き方。打点（head の z）は一番短い音板（奥行き z 12〜23 セル）にも乗る 21.5。
  // 音程の幅は 8：マレットの頭の x は ±3 ± 8 ＝ -11〜11（音板は x -12〜11）
  vibraphone: { floorStand: true, inst: { pos: [0, 0, 14], rot: 0 }, held: { L: 'keymallet', R: 'keymallet' }, pitchSpread: 8,
                strike: { L: { hit: [-3, 14], rest: [-7, 21], head: [-3, 7] }, R: { hit: [3, 14], rest: [7, 21], head: [3, 7] } },
                p3: { pos: [0, 0, 14], strike: { L: { hit: [-5, 18, 14], rest: [-6, 20, 14], head: [-3, 15, 21.5] }, R: { hit: [5, 18, 14], rest: [6, 20, 14], head: [3, 15, 21.5] } } } },
  // 鍵盤：keys = 手を置く高さ、spread = 音程で左右に動く幅、gap = 両手の間隔。p3 では鍵盤を奏者側に向け、手は前へ
  // ピアノは横向き（2026-09-24 ユーザー指定）：オーケストラの中のピアノは 1st バイオリンの後ろで、協奏曲と同じく奏者は壁側（外側）に座り、
  // しっぽは舞台の中央へ向く。客席から見て真横から、指揮者の方へ sideYaw だけ振る（奏者の向きは舞台基準。faceToward で計算）。
  // 首は体と指揮者の方向の差だけひねって指揮者を見る。bodyYaw は席が決まる前（配置の幅を測る時）の見込み：真横 90° − 振り 30° − 席の方位 ≈45°。
  // 縦向き（胴が指揮者へ伸びる）だと前後に 6.5 も要り、1st バイオリンの後ろに収まらなかった
  piano:      { inst: { pos: [0, 0, 4], rot: 0 }, keys: { y: 14, spread: 12, gap: 4 }, sideYaw: Math.PI / 6, bodyYaw: Math.PI / 12,
                p3: { pos: [0, 0, 43], rot3: [0, Math.PI, 0], keys: { y: 16.4, spread: 14, gap: 4, z: 10 } } }, // 1.17 倍：奥行き 30px×1.17 で鍵盤の縁が z≈8。鍵盤の高さ・音域幅も 1.17 倍、手は z 10（肘が畳まれないように前へ）
  celesta:    { inst: { pos: [0, 0, 4], rot: 0 }, keys: { y: 16, spread: 7, gap: 3 },
                p3: { pos: [0, 0, 20], rot3: [0, Math.PI, 0], keys: { y: 19.2, spread: 8.4, gap: 3, z: 10 } } }, // 1.2 倍：奥行き 10px×1.2 で鍵盤の縁が z≈8、手は z 10
  // ハープ：柱を前、短い弦（高音）を体側にして胸の前に置き、上部を奏者側へ少し倒す（y 回転を +0.7 に反転して右手が体を横切らないように。2026-09-10）
  // headRoll：首を横に倒す角度 [rad]（2026-09-24 ユーザー指定：奏者と向かい合った側から見て右＝奏者の左へ 12°。符号は画面で確認）
  // turn：奏者の体だけを回す（bodyYaw と同じ量だけ首を戻して顔は指揮者へ、楽器は逆に回して床に対してそのまま）
  // headFixed：首を振らない（2026-09-24 ユーザー指定）。向きは headYaw（turn の打ち消し）＋ headRoll に固定し、上半身の揺れ・前かがみも首で打ち消す
  harp:       { inst: { pos: [-9, 0, 4], rot: 0 }, harp: true, headRoll: HARP_HEAD_ROLL, turn: HARP_TURN, headFixed: true,
                // 向き（2026-09-24 ユーザー指定）：実物どおり共鳴胴の上端を右肩に寄りかけ、柱は正面の先（前 2.0）。
                // 弦の面は体の正面の面に対して約 72°（以前は rot3 y 0.7 で約 41°、共鳴胴の上端が右へ 1.27 離れていた）。
                // 弦の面は右肩のすぐ左を通す（楽器の奥行きで 4 セル奏者の左へ。右肩が弦の右手側に来る）：面が右肩の上を通ると、
                // 弦の右側からはじく右腕が肩の直後で面を横切り、共鳴胴にめり込んでいた
                // 奏者との距離（2026-09-24 ユーザー指定：少し空ける）：正面へ 2px（z 15.89 → 17.89）。2.5px では左手が奥の弦に届かない瞬間があった
                // 傾き・位置（2026-09-24 ユーザー指定）：10° 寝かせた分を戻し、奏者側へ 4px 引き寄せた（共鳴胴を伸ばして右肩にかけるため）。
                // 台座の一番低い角が床に着く高さ（y −0.63。台座の横幅を狭くした時・柱を外へ 2 セル移した時に、床に着いていた角が無くなって浮いたので下げた）。
                // 奏者をハープに対して左へ 5px ずらした（x −5.56 → −0.56。2026-09-24 ユーザー指定）
                p3: { pos: [-0.56, -0.63, 13.89], rot3: [-0.12, 1.26, 0], harp: true } },
  conductor:  { held: { R: 'baton' } },
};
VARIANT.violin2 = VARIANT.violin1; // 2nd バイオリンは 1st と同じ構え（2026-09-12）
VARIANT.violin = VARIANT.violin1;  // 旧データ（楽器の割当が 'violin' で保存されている場合）

export class Puppet {
  /**
   * @param {object} o { family, variant, color, seed, isConductor }
   */
  constructor(o) {
    this.family = o.isConductor ? 'conductor' : o.family;
    this.motion = o.isConductor ? 'conductor' : (MOTION_OF[o.variant] ?? o.family);   // 動きのテンプレート（MOTION_OF）
    this.variant = o.isConductor ? 'conductor' : o.variant;
    this.cfg = VARIANT[this.variant] || VARIANT.violin;
    this.seed = o.seed || 0;
    this.persona = makePersona(this.seed);             // 老若男女（seed から決定的。2026-09-10）
    const K = (o.costume && COSTUMES[o.costume]) || null; // 衣装（特定キャラの見た目。試作 ?costume=cecil。2026-09-20 ユーザー指定）
    if (K) this.persona = K.persona(this.persona);    // 手の色・体型は衣装側で決める
    const suit = K?.suit ? suitColors(K.suit, K.shirt, K.shoe) : null;
    // 首だけ鎧の色に。胴は rig ごと塗るので効くが、手は塗っていないので素肌のまま残る（2026-09-21）
    if (suit && K?.neck) suit[this.persona.skin] = K.neck;  // 服は燕尾服のまま色だけキーカラー（2026-09-21 ユーザー指定）
    const tint = (m) => (suit ? recolorParts(m, suit) : m);
    const accentCol = K?.tie || o.color || '#c03030';   // 蝶ネクタイ・帯の色。衣装が tie を持てばトラック色より優先（2026-09-21）
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
    this.seated = !o.isConductor && this.motion !== 'percussion' && this.variant !== 'contrabass'; // コントラバスは立奏（2026-09-10）
    const P = this.persona;
    if (this.seated) {
      this.body = this.flat ? torsoSeated(o.color || '#c03030') : (K?.torso || torsoFor)(P, accentCol);
      this.body.position.y = 13 * PX;           // 腰＝座面の高さ
      this.upper.add(this.body);
      if (!this.flat) { const coat = (K?.coat || coatFor)(P, accentCol, false); coat.position.y = 13 * PX; this.upper.add(coat); this.body.scale.set(P.build, 1, P.build); coat.scale.set(P.build, 1, P.build); } // 上着の立体（ラペル・襟・ネクタイ／ベルト）。体型は胴と上着の横幅・厚み
      const ch = chair(); ch.position.set(0, 0, -6 * PX); this.rig.add(ch); // 座面は z -6..+6、背もたれは後ろ
      if (this.flat) {
        const legs = legsSeatedSprite(); legs.position.set(0, 0, 1 * PX); this.rig.add(legs);
      } else {
        const spread = this.cfg.legSpread ?? 3.5; // 膝の開き（チェロは楽器を挟むので広く）
        for (const sx of [-spread, spread]) {
          const t = thigh(); t.position.set(sx * PX, 12 * PX, 0); this.rig.add(t);           // 太もも：腰から前へ
          const sh = shin(); sh.position.set(sx * PX, 0, 8 * PX); this.rig.add(sh);          // すね：太ももの先から床へ
          const so = shoe(); so.position.set(sx * PX, 0, 8 * PX); this.rig.add(so);          // 靴：前へ
        }
        if (P.gender === 'f' || K?.skirt) { // ロングスカート：腰の上を覆い、膝から床へ垂れる（衣装のローブも同じ仕組み）
          const sk = (K?.skirt || skirtSeated)();
          sk.hip.position.set(0, 12 * PX, 0); this.rig.add(sk.hip);
          sk.front.position.set(0, 0, 10 * PX); this.rig.add(sk.front);
        }
      }
    } else if (this.flat) {
      this.body = body(o.color || '#c03030');
      this.upper.add(this.body);
    } else {
      // 立奏（打楽器・コントラバス・指揮者）：腰から上を spine の下に、脚は rig に直付け。揺れ・呼吸は上半身だけ（2026-09-10 ユーザー指定）
      this.body = (K?.torso || torsoFor)(P, accentCol);
      this.body.position.y = 13 * PX;
      this.upper.add(this.body);
      const coat = (K?.coat || coatFor)(P, accentCol, true); coat.position.y = 13 * PX; this.upper.add(coat); // 上着の立体（燕尾つき）
      this.body.scale.set(P.build, 1, P.build); coat.scale.set(P.build, 1, P.build);                          // 体型
      this.rig.add((K?.legs || legsStandingFor)(P));
    }
    if (!this.flat) this.group.scale.setScalar(P.height * (PLAYER_TALL[this.variant] ?? 1)); // 身長の個体差（楽器・腕ごと相似）＋楽器別の身長倍率

    // 服の塗り替えは**頭を付ける前**に。頭・髪は衣装が自前の色で描くので塗ってはいけない
    // （顔に出した素肌まで neck の色で塗り替えてしまう。2026-09-21）
    if (suit) recolorParts(this.rig, suit);   // 胴・上着・脚・座った脚。腕は下で作るたびに塗る

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, HEAD_Y_PX * PX, 0);
    this.head = this.flat ? head(this.seed, false) : (K?.head || headFor)(P);
    this.headPivot.add(this.head);
    if (!this.flat) { this.hair = (K?.hair || hairFor)(P); this.headPivot.add(this.hair); } // 髪は別パーツ（顔は平面、髪は立体。2026-09-11）
    this.upper.add(this.headPivot);

    // 2関節腕（肩 → 上腕 → 肘 → 前腕＋手）。手首ありなら 肘 → 前腕 → 手首 → 手 の 3 関節
    this.arm = {}; this.fore = {}; this.held = {}; this.hand = {}; this.foreQ = {}; this.handGrp = {}; this.handQ = {};
    this.fingers = {};   // 管楽器だけ：指 4 本の Mesh（人差し指 → 小指）。運指の動きに使う（2026-09-16 ユーザー指定）
    const withFingers = !this.flat && (this.family === 'woodwind' || this.family === 'brass');
    for (const side of ['L', 'R']) {
      const a = new THREE.Group(); a.position.set(SHOULDER[side][0] * PX, SHOULDER[side][1] * PX, (this.flat ? 3 : 0) * PX);
      const f = new THREE.Group(); f.position.set(0, -ARM_UPPER * PX, 0);
      a.add(tint(upperArm()), f);
      if (!this.flat) a.add(tint(shoulderPad())); // 肩関節の球：肩が前に出ても胴と腕の間が空かない
      this.upper.add(a);
      this.arm[side] = a; this.fore[side] = f;
      this.hand[side] = [SHOULDER[side][0], SHOULDER[side][1] - ARM_UPPER - ARM_FORE, this.flat ? 3 : 0];
      this.foreQ[side] = new THREE.Quaternion(); this.handQ[side] = new THREE.Quaternion();
      let holder = f, holdY = -ARM_FORE;
      if (this.hasWrist) {
        f.add(tint(foreArmNoHand()));
        const h = new THREE.Group(); h.position.set(0, -FORE_NOHAND * PX, 0);
        const hm = this.flat ? hand() : handFor(P, side, { fingers: withFingers, grip: GRIP_ITEMS.has(this.cfg.held?.[side]) });
        h.add(hm); f.add(h);
        if (!this.flat && GRIP_ITEMS.has(this.cfg.held?.[side])) h.add(wristBall(P.skin)); // 手首の関節の球：曲がった所の角が割れて見えない（棒を握る手。2026-09-23）
        this.fingers[side] = hm.userData?.fingers || null;
        this.handGrp[side] = h; holder = h; holdY = -HAND_LEN; // 手持ち物は指先＝手の目標位置
      } else {
        f.add(tint(foreArm()));
      }
      const item = this.cfg.held?.[side];
      if (item) {
        const m = INSTRUMENT[item]();
        m.position.set(0, holdY * PX, (this.flat ? 3 : 0) * PX); // 2D 板では手の少し前（重ね順）。3D では手の軸上
        holder.add(m);
        this.held[side] = m;
      }
    }

    // 楽器（体に取り付け）
    if (this.cfg.inst && INSTRUMENT[this.variant]) {
      const m = INSTRUMENT[this.variant]();
      if (!this.flat && WOOD_INSTRUMENTS.has(this.variant)) applyWoodVariation(m, this.seed); // ニスの個体差＋木目の区画（2026-09-11）
      const pos = (this.p3 && this.p3.pos) || this.cfg.inst.pos;
      m.position.set(pos[0] * PX, pos[1] * PX, pos[2] * PX);
      if (this.p3 && this.p3.quat) m.quaternion.copy(this.p3.quat);
      else if (this.p3 && this.p3.rot3) m.quaternion.setFromEuler(new THREE.Euler(...this.p3.rot3));
      else m.quaternion.setFromEuler(new THREE.Euler(0, 0, this.cfg.inst.rot));
      // turn：体を回した分だけ楽器を rig の中で逆に回す（rig は x が鏡像なので、rig 内の +θ 回転が体の +θ をちょうど打ち消す）
      const turn = !this.flat && this.cfg.turn;
      if (turn) {
        const c = Math.cos(turn), sn = Math.sin(turn), x = m.position.x, z = m.position.z;
        m.position.set(c * x + sn * z, m.position.y, -sn * x + c * z);
        m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
      }
      const sc = (INST_SCALE_VARIANT[this.variant] ?? INST_SCALE[this.family] ?? 1) / (PLAYER_TALL[this.variant] ?? 1); // 奏者を大きくする分、楽器は相殺して同じ大きさに
      m.scale.set(this.cfg.inst.mirror ? -sc : sc, sc, sc);
      m.userData.baseQ = m.quaternion.clone();
      m.userData.restPos = m.position.clone(); m.userData.restQ = m.quaternion.clone();   // 構えの位置・向き（_harpLean の基準）
      this.inst = m;
      // 床に置く楽器は床に固定：上半身（揺れ・呼吸・前かがみ）ではなく rig に付ける。止まっている時は upper と rig の座標が一致するので位置・向きはそのまま。
      // 鍵盤（ピアノ/チェレスタ。2026-09-24 ユーザー指定：前かがみでピアノごと最大 7° 傾き、手前が床に 0.3 沈んでいた）と、
      // 打楽器のうち楽器を床に置く・吊るもの（手に持つ合わせシンバルは inst が無いので対象外。2026-09-24 ユーザー指定：4〜10° 傾いていた）。
      // チェロ・コントラバスの floorStand は体と一緒に傾ける楽器なので対象外（_standOnFloor で位置だけ床に留める）
      // ハープも床に固定（2026-09-24 ユーザー指定）
      this.instFixed = !this.flat && (!!this.cfg.keys || !!this.cfg.harp || this.motion === 'percussion');
      (this.instFixed ? this.rig : this.upper).add(m);
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
    // 影：体・楽器・椅子は影を落とすが、受けない（床・ひな壇だけが受ける）。楽器や頭の影が胸に落ちて服が黒く潰れ、細かい面ではノイズに見えるため（2026-09-11 ユーザー指定）
    if (!this.flat) this.root.traverse((m) => { if (m.isMesh && m !== this.glow) { m.castShadow = true; m.receiveShadow = false; } });
  }

  /**
   * 楽器を含む横方向の占有範囲 [unit]（root 基準、+x = 奏者の左）。配置の間隔決めに使う。
   * update() 前でも正しい鏡像（rig.scale.x = MIRROR）で測る
   */
  measureFootprint() {
    this.rig.scale.set(MIRROR, 1, 1);
    this.group.rotation.set(0, this._bodyYaw(), 0);   // 体ごと横を向く楽器（銅鑼）は、その向きで楽器の幅を測る
    this.root.updateMatrixWorld(true);
    let minX = -0.55, maxX = 0.55; // 体の幅（±7px）
    // 奥行きは胴の箱から測る（+z = 奏者の前＝指揮者側）。楽器が前に出ている分を知るため（2026-09-23 ユーザー指定）
    let minZ = 0, maxZ = 0;
    if (this.body) {
      const bb = new THREE.Box3().setFromObject(this.body);
      if (Number.isFinite(bb.min.z)) { minZ = bb.min.z; maxZ = bb.max.z; }
    }
    if (this.inst) {
      const box = new THREE.Box3().setFromObject(this.inst);
      if (Number.isFinite(box.min.x)) { minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x); }
      if (Number.isFinite(box.min.z)) { minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z); }
    }
    return { minX, maxX, minZ, maxZ };
  }
  /** カメラの方を向く。2D の板は完全に正対（見下ろしても潰れない）、立体は水平回転のみ */
  faceCamera(cam) {
    if (this.flat) { this.group.quaternion.copy(cam.quaternion); return; }
    const yaw = Math.atan2(cam.position.x - this.root.position.x, cam.position.z - this.root.position.z);
    this.group.rotation.set(0, yaw + this._bodyYaw(), 0);
  }
  /** 向きを固定：指定の点（指揮者）の方を向く。指揮者自身は楽団（-z）の方を向く */
  faceToward(px, pz) {
    const yaw = this.family === 'conductor' ? Math.PI : Math.atan2(px - this.root.position.x, pz - this.root.position.z);
    // sideYaw（ピアノ）：舞台基準で「客席から見て真横・中央向き」から指揮者の方へ sideYaw 振る。指揮者の方向との差を体の上乗せにする
    const sy = this.cfg.sideYaw;
    if (sy != null && !this.flat) {
      const side = this.root.position.x < 0 ? Math.PI / 2 : -Math.PI / 2;   // +x へ向く＝yaw +90°（左側の席は中央 = +x）
      const diff = Math.atan2(Math.sin(yaw - side), Math.cos(yaw - side));
      this._sideRel = side + Math.sign(diff) * Math.min(Math.abs(diff), sy) - yaw;
    }
    this.group.rotation.set(0, yaw + this._bodyYaw(), 0);
  }
  /** 体の向きの上乗せ [rad]（+ で奏者の左へ回る）。楽器の設定 bodyYaw。ボクセルのみ（2D の板は正対のまま）。2026-09-19 ユーザー指定：銅鑼の奏者は真横を向く。
   *  sideYaw の楽器は faceToward で求めた値（席が決まる前は bodyYaw を見込みとして使う） */
  _bodyYaw() { return this.flat ? 0 : (this._sideRel ?? this.cfg.bodyYaw ?? this.cfg.turn ?? 0); }
  /** 首のひねり [rad]。sideYaw の楽器は体の上乗せと同じ量（符号の決まりは銅鑼と同じ）で、顔を指揮者へ戻す */
  _headYaw() { return this.cfg.sideYaw != null ? this._bodyYaw() : (this.cfg.headYaw ?? this.cfg.turn ?? 0); }   // turn：体を回した分だけ首を戻す
  /** 床に固定した楽器（instFixed）の手：rig の座標で決めた目標を、このフレームの腰の曲がり・揺れの逆をかけて上半身（upper）の座標に直す。
   *  _rigToUpperBegin() をこのフレームの前かがみ（_spineGaze）の後に 1 回呼んでから使う */
  _rigToUpperBegin() { this.spine.updateMatrix(); this.upper.updateMatrix(); _mUp.multiplyMatrices(this.spine.matrix, this.upper.matrix).invert(); }
  _rigToUpper(p) { _a.set(p[0] * PX, p[1] * PX, (p[2] ?? 0) * PX).applyMatrix4(_mUp); return [_a.x / PX, _a.y / PX, _a.z / PX]; }
  /** ハープ：右肩が構えの位置から動いた分だけ、共鳴胴の上端がついていくよう、台座の底の中心を軸に傾ける（2026-09-24 ユーザー指定）。
   *  楽器は rig に付いている（instFixed）ので、ここで毎フレーム構えの位置・向きから置き直す。台座は床から離れない */
  _harpLean() {
    const inst = this.inst, ud = inst?.userData;
    if (!ud?.restQ || !HARP_LEAN_GAIN) return;
    const c = PX / 2, L = HARP_LEAN_CELLS;   // res:2 の 1 セル = PX/2（楽器ローカル）
    const loc = (p) => _c.set((p[0] - L.W / 2) * c * inst.scale.x, (L.H - p[1]) * c * inst.scale.y, p[2] * c * inst.scale.z).applyQuaternion(ud.restQ).add(ud.restPos);
    const P = loc(L.pivot).clone(), T = loc(L.top).clone();
    // 右肩：upper の座標（構えでは rig と一致）→ 腰の曲がり・揺れを掛けた rig の座標
    this.spine.updateMatrix(); this.upper.updateMatrix();
    const S0 = SHOULDER.R;
    _d.set(S0[0] * PX, S0[1] * PX, S0[2] * PX).applyMatrix4(this.upper.matrix).applyMatrix4(this.spine.matrix);
    _d.sub(_a.set(S0[0] * PX, S0[1] * PX, S0[2] * PX)).multiplyScalar(HARP_LEAN_GAIN);   // 肩の動き
    const from = _a.copy(T).sub(P).normalize(), to = _b.copy(T).add(_d).sub(P).normalize();
    _q.setFromUnitVectors(from, to);
    inst.quaternion.copy(ud.restQ).premultiply(_q);
    inst.position.copy(ud.restPos).sub(P).applyQuaternion(_q).add(P);
  }
  /** 向き（マレットの狙いなど）は回転だけ掛ける */
  _rigToUpperDir(d) { _b.set(d[0], d[1], d[2] ?? 0).transformDirection(_mUp).multiplyScalar(Math.hypot(d[0], d[1], d[2] ?? 0)); return [_b.x, _b.y, _b.z]; }

  // ---- 手の配置：目標へ滑らかに寄せてから 3D IK（rate が大きいほど即応。Infinity で即時）----
  // handDir（rig 空間）を渡すと手首あり：手首＝目標 − handDir×手の長さ、前腕は手首へ、手は handDir を向く
  /**
   * 手を目標へ運ぶ。
   * handDir … **手首の位置**を決める向き（指先の目標から HAND_LEN 手前が手首）。腕の線はこれで決まる
   * handFace … **拳の向き**（指先が向く先）。省略時は handDir と同じ。
   *   人間の手首は前腕と独立に曲がるが、この rig には手首の関節が無く handDir 一本で
   *   「手首の位置」と「拳の向き」の両方を決めていた。拳を下に向けると手首まで持ち上がり、
   *   肘から手首へ上り坂ができる（2026-09-22 ユーザー指摘）。2 つに分けて解決する
   * handUp … 甲の向きのヒント（ねじれ）
   * maxBend … 手首の曲がりの上限 [rad]（handFace と併用）。拳を handFace へ向けるのは前腕の延長からこの角度まで
   */
  setHand(side, target, dt, rate = 30, handDir = null, pole = null, handUp = null, handFace = null, maxBend = null) {
    const cur = this.hand[side];
    const tz = this.flat ? 3 : (target[2] ?? 0);
    if (rate === Infinity) { cur[0] = target[0]; cur[1] = target[1]; cur[2] = tz; }
    else { cur[0] = approach(cur[0], target[0], rate, dt); cur[1] = approach(cur[1], target[1], rate, dt); cur[2] = approach(cur[2], tz, rate, dt); }
    const S0 = [SHOULDER[side][0], SHOULDER[side][1], this.flat ? 3 : 0];
    let goal = cur, fore = ARM_FORE;
    if (this.hasWrist) {
      fore = FORE_NOHAND;
      let hd = handDir ? v3(handDir) : null;
      if (!hd || hd.lengthSq() < 1e-6) { hd = v3([cur[0] - S0[0], cur[1] - S0[1], cur[2] - S0[2]]); } // 指定なし：腕の延長
      hd.normalize();
      if (this.flat) hd.z = 0;
      this._handDir = hd;
      let hf = handFace ? v3(handFace) : null;                 // 拳の向き（省略時は手首と同じ向き）
      if (hf && hf.lengthSq() > 1e-6) { hf.normalize(); if (this.flat) hf.z = 0; this._handFace = hf; }
      else this._handFace = hd;
      // 手首の位置。拳の向きを別に指定した時（棒を握る手）は、target を「握りの点」とみなして
      // 拳の向きに HAND_GRIP だけ戻した所を手首にする。こうしないと持ち物が拳から離れて浮く
      // （持ち物は target の位置に置かれるため。2026-09-22 ユーザー指摘：スティックを握れていない）
      const back = handFace ? [this._handFace, HAND_GRIP] : [hd, HAND_LEN];
      goal = [cur[0] - back[0].x * back[1], cur[1] - back[0].y * back[1], cur[2] - back[0].z * back[1]];
      // 手首の曲がりを maxBend までに抑える。前腕の向きは手首の位置で決まり、手首の位置は拳の向きで決まる循環なので、
      // IK を 2 回回して収束させる（1 回目：拳を目標の向きにした時の前腕 → 拳をそこから maxBend まで → 手首を置き直す）
      if (handFace && maxBend != null && !this.flat) {
        const want = this._handFace.clone();
        for (let it = 0; it < 2; it++) {
          const S1 = this._shoulder(side, S0, goal, ARM_UPPER + fore - 0.05);
          const fd = new THREE.Vector3(0, -1, 0).applyQuaternion(solveIK3(S1, goal, ARM_UPPER, fore, pole || POLE[side]).q2); // 前腕の向き（肘→手首）
          let hf2 = want;
          if (fd.angleTo(want) > maxBend) { const ax = new THREE.Vector3().crossVectors(fd, want); if (ax.lengthSq() > 1e-8) hf2 = fd.applyAxisAngle(ax.normalize(), maxBend); }
          this._handFace = hf2.clone();
          goal = [cur[0] - hf2.x * HAND_GRIP, cur[1] - hf2.y * HAND_GRIP, cur[2] - hf2.z * HAND_GRIP];
        }
      }
    }
    const S = this._shoulder(side, S0, goal, ARM_UPPER + fore - 0.05); // 肩関節：届かない時だけ肩を目標側へ出す
    this.arm[side].position.set(S[0] * PX, S[1] * PX, S[2] * PX);
    const ik = solveIK3(S, goal, ARM_UPPER, fore, this.flat ? POLE_FLAT[side] : (pole || POLE[side])); // pole = 肘を出す向き（楽器別に上書き可）
    this.arm[side].quaternion.copy(ik.q1);
    this.fore[side].quaternion.copy(ik.q1).invert().multiply(ik.q2); // 前腕は上腕の子：ローカル回転 = q1⁻¹ · q2
    this.foreQ[side].copy(ik.q2);
    if (this.hasWrist) { // 手：手首から目標へ向く（rig 基準の回転 → 前腕の子としてのローカル回転）。handUp があれば手の甲の向きをそれに合わせる（管の角度に手の角度を合わせる）
      const qh = quatFromBoneDir(this._handFace, new THREE.Quaternion(), handUp);
      this.handGrp[side].quaternion.copy(ik.q2).invert().multiply(qh);
      this.handQ[side].copy(qh);
      // 腕が届かない時（IK が肩→手首の距離で頭打ち）でも、手持ち物は目標位置（弦の上・打点）に置く：
      // 実際の手首位置を求め、目標との差を手のローカル座標で補正する
      const item = this.held[side];
      if (item) {
        const reach = ARM_UPPER + fore - 0.05;
        const dx = goal[0] - S[0], dy = goal[1] - S[1], dz = goal[2] - S[2];
        const dist = Math.hypot(dx, dy, dz);
        const k = dist > reach ? reach / dist : 1;
        const wrist = [S[0] + dx * k, S[1] + dy * k, S[2] + dz * k];
        _a.set(cur[0] - wrist[0], cur[1] - wrist[1], cur[2] - wrist[2]).applyQuaternion(_q.copy(qh).invert());
        item.position.set(_a.x * PX, _a.y * PX, _a.z * PX + (this.flat ? 3 : 0) * PX); // z を落としていたバグを修正
      }
    } else this.handQ[side].copy(ik.q2);
    return ik;
  }
  /**
   * 肩関節。胸の中心 C=(0, 肩の高さ) から肩 S0 への鎖骨を、手首の目標 goal が腕の長さ reach を超える時だけ goal の方へ回す。
   * 回す角度は「ちょうど届く最小」を二分探索で求め、SHOULDER_MAX で頭打ち。届く範囲なら S0 のまま
   * @returns {number[]} 肩の位置（rig px）
   */
  _shoulder(side, S0, goal, reach) {
    if (this.flat) return S0;
    const dist0 = Math.hypot(goal[0] - S0[0], goal[1] - S0[1], goal[2] - S0[2]);
    if (dist0 <= reach) return S0;
    const C = [0, S0[1], S0[2]];
    const a0 = _a.set(S0[0] - C[0], 0, 0).normalize();
    const g = _b.set(goal[0] - C[0], goal[1] - C[1], goal[2] - C[2]);
    if (g.lengthSq() < 1e-6) return S0;
    g.normalize();
    const full = Math.min(a0.angleTo(g), SHOULDER_MAX);
    const axis = _c.crossVectors(a0, g);
    if (axis.lengthSq() < 1e-6) return S0;
    axis.normalize();
    const at = (t) => { const d = _d.copy(a0).applyAxisAngle(axis, t); return [C[0] + d.x * CLAVICLE_LEN, C[1] + d.y * CLAVICLE_LEN, C[2] + d.z * CLAVICLE_LEN]; };
    const reaches = (S) => Math.hypot(goal[0] - S[0], goal[1] - S[1], goal[2] - S[2]) <= reach;
    if (!reaches(at(full))) return at(full);
    let lo = 0, hi = full;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (reaches(at(mid))) hi = mid; else lo = mid; }
    return at(hi);
  }
  /** 手に持った物の向き（rig 空間の方向ベクトル）。primary: 'x'（弓・指揮棒）| 'ny'（マレット：-y が先端） */
  aimHeldDir(side, dir, primary = 'x', up = null) {
    const m = this.held[side];
    if (!m) return;
    const q = primary === 'x' ? quatFromXDir(v3(dir), _q) : quatFromBoneDir(v3(dir), _q, up);
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
    this.headPivot.rotation.y += gazeYaw * this._gaze + this._headYaw();   // headYaw：体を横に向けた楽器（銅鑼）で、首をひねって顔を指揮者へ向け続ける（2026-09-19 ユーザー指定）
    // 前傾しても顔は起こす（腰の前傾を首で打ち消す）。gazeDown は「楽器を見る」分だけ足す
    this.headPivot.rotation.x += -this._lean * 0.9 + gazeDown * this._gaze;
  }

  /**
   * @param {object} st  engine.trackState() の戻り値（指揮者は energy=globalEnergy）
   * @param {object} ctx { t, dt, beat:{beat,beatInBar,beatPhase,beatsPerBar}, settings, globalEnergy }
   */
  update(stRaw, ctx) {
    const { t, dt, beat, settings } = ctx;
    const energy = stRaw.energy;
    // エネルギー包絡線はアタック 0 ms・半減期 130 ms のノコギリ波なので、そのまま姿勢に掛けると
    // スローテンポで 1 音ごとに体がピクつく（2026-09-15 ユーザー指摘）。
    // 姿勢（前傾・膨らみ・頭の角度・体の傾き）は拍の長さに応じた時定数で均した「遅い」エネルギーで動かし、
    // 速いエネルギーは音の頭の小さな反応（うなずき・弓圧・ストロークの長さ・足元の光）にだけ使う。
    // 「反応の速さ」スライダー（dynSpeed）で時定数を調整できる（1 = 拍の半分。大きいほど速く追いつく）
    const beatSec = 60 / Math.max(20, ctx.bpm || 120);
    const tau = clamp((beatSec * 0.5) / (settings.dynSpeed ?? 1), 0.06, 1.0);
    this._slowE = approach(this._slowE ?? energy, energy, 1 / tau, dt);
    // 「強弱の反応」スライダー：前傾・楽器の角度・膨らみなど、強さ（velocity/CC）で動く量の倍率。揺れと足元の光には掛けない
    // 上限は「強弱の反応」スライダーの最大値（3）に合わせる。1.5 で頭打ちだと 1.5 より上げても何も変わらなかった（2026-09-12 修正）
    const dyn = settings.dynResponse ?? 1;
    const st = { ...stRaw, energy: clamp(energy * dyn, 0, 3),
      posture: clamp(this._slowE * dyn, 0, 3),
      nextEnergy: clamp((stRaw.nextEnergy ?? 0) * dyn, 0, 3) };

    // 共通：呼吸と拍に同期した体の揺れ
    // 揺れ・呼吸・上下動は腰（spine）から上だけ。下半身と椅子は動かない（2026-09-09 ユーザー指定）
    this.rig.scale.set(MIRROR, 1, 1);
    const swayAmt = Math.sin(Math.PI * beat.beat + this.phase) * 0.07 * (0.25 + 0.75 * this._slowE) * settings.sway;
    this.spine.rotation.set(0, 0, swayAmt);
    this.spine.scale.set(1, 1 + 0.012 * Math.sin(t * 1.6 + this.phase), 1);
    this.spine.position.y = SPINE_Y * PX;
    this.headPivot.rotation.z = swayAmt * 0.6;
    this.headPivot.rotation.y = 0;
    this.headPivot.rotation.x = 0;

    // エンドピンで床に立てる楽器（チェロ・コントラバス）は、上半身が傾いても床に立ったままにする
    if (this.cfg.floorStand && this.inst && this.p3?.pos && !this.instFixed) this._standOnFloor();

    // 長い休みでは楽器を下ろす（構え ⇄ 下ろしを補間）。手は楽器に付いて動く（2026-09-12 ユーザー指定）
    this._restPose(st, dt, t);

    switch (this.motion) {
      case 'strings': this._strings(st, ctx); break;
      case 'woodwind': this._wind(st, ctx); break;
      case 'brass': this._wind(st, ctx); break;
      case 'percussion': this._percussion(st, ctx); break;
      case 'keyboard': this._keyboard(st, ctx); break;
      case 'conductor': this._conductor(st, ctx); break;
    }

    // アタックの明滅：発音した瞬間だけ楽器を明るくする（持続は足元の光が示すので不要。2026-09-12 ユーザー指定）
    this._attackFlash(st, settings);
    this._instSwing(st, ctx.dt);
    // 次フレームの _standOnFloor 用に、今フレームの上半身の回転・位置を控える
    (this._spineQPrev ??= new THREE.Quaternion()).copy(this.spine.quaternion);
    (this._spinePosPrev ??= new THREE.Vector3()).copy(this.spine.position);

    // 足元の光：baseOpacity × エネルギー × 濃度。指揮者だけは拍で明滅（小節頭は強く、拍の頭で光って減衰）
    this.glow.visible = settings.showGlow;
    let level = clamp(energy, 0, 1);
    if (this.family === 'conductor') {
      const accent = beat.beatInBar === 0 ? 1.0 : 0.55;
      level = (0.08 + accent * Math.exp(-beat.beatPhase * 5)) * (0.5 + 0.5 * clamp(energy, 0, 1));
    }
    this.glow.material.opacity = this.glow.userData.baseOpacity * level * (settings.glowIntensity ?? 1);
  }

  /**
   * 長い休みで楽器を下ろす。0 = 構え、1 = 下ろし。
   * 休み（前の音の終わり〜次の音）が REST_GAP 秒以上あり、音が止んで REST_HOLD 秒経ち、次の音まで REST_LEAD 秒より前なら下ろす。
   * cfg.rest.pos/quat|rot3 があれば楽器の姿勢を補間（手は instPoint で追従）。
   * チェロ・コントラバスのように楽器を動かさないものは cfg.rest.bowHand / leftHand で手だけ下ろす
   */
  /**
   * 床に立てる楽器（チェロ・コントラバス）は、上半身が前のめりになっても「ピンの先」が床から動かないようにする。
   * 楽器は upper（spine の子）の下にあるので、そのままだと腰を支点に回って胴が床に沈む（2026-09-16 ユーザー指摘）。
   * 実物は体にもたれているので、体と一緒に傾きつつ、ピンの先を支点に回る。それを再現するため、
   * 向きは upper に任せたまま（体と一緒に傾く）、位置だけ「ピンの先（楽器の原点）が rig 空間の P0 に留まる」よう
   * 前フレームの spine の回転 R と位置で upper ローカルへ逆変換する（1 フレーム遅れ。傾きは滑らかなので実害なし）。
   * 楽器を完全に固定する案は、前のめりで肩だけ前へ出て左腕が胴を横切るため不採用
   */
  _standOnFloor() {
    const inst = this.inst, P0 = this.p3.pos;
    const R = this._spineQPrev || this.spine.quaternion, sp = this._spinePosPrev || this.spine.position;
    const Rinv = _q.copy(R).invert();
    // rig 空間の点 P0 → spine ローカル（spine の原点＝腰）→ upper ローカル（upper は腰から -SPINE_Y ずれている）
    _a.set(P0[0] * PX - sp.x, P0[1] * PX - sp.y, P0[2] * PX - sp.z).applyQuaternion(Rinv);
    inst.position.set(_a.x, _a.y + SPINE_Y * PX, _a.z);
  }

  _restPose(st, dt, t) {
    const cfg = this.cfg, rest = cfg.rest;
    if (!rest || this.flat) { this._rest = 0; return; }
    const first = this._rest == null; // 最初のフレーム：出だしから出番が遠いなら、構えずに下ろした状態で始める
    const { onset, next, active, toNext } = st;
    const gap = next ? (onset ? next.time - onset.end : Infinity) : Infinity; // この休みの長さ
    const lead = next ? toNext : Infinity;                                     // 次の音までの残り（最後の音の後は無限）
    // 音が止んだ時刻を控えて、そこから REST_HOLD 秒経つまでは構えたまま待つ（シークで巻き戻った時は取り直す）
    if (active.length) this._silentAt = null;
    else if (this._silentAt == null || this._silentAt > t) this._silentAt = first ? t - REST_HOLD : t;
    // まだ 1 音も鳴らしていない（曲の頭・空振りの間）は「音が止んだ直後」ではないので待たない：出番の REST_LEAD 秒前まで下ろしたまま。
    // 以前は頭に戻すと音が止んだ扱いで REST_HOLD 秒構えて待つので、全員がいったん構えていた（2026-09-23 ユーザー指定）
    const held = !onset ? Infinity : this._silentAt == null ? 0 : t - this._silentAt;
    const want = (!active.length && held >= REST_HOLD && gap >= REST_GAP && lead > REST_LEAD) ? 1 : 0;
    this._rest = first ? want : approach(this._rest, want, 2.2, dt); // 出だしは補間せず即その姿勢
    const r = this._rest;
    const inst = this.inst;
    if (!inst || !rest.pos) return;
    const up = this.p3?.pos || cfg.inst.pos;
    inst.position.set(
      (up[0] + (rest.pos[0] - up[0]) * r) * PX,
      (up[1] + (rest.pos[1] - up[1]) * r) * PX,
      (up[2] + (rest.pos[2] - up[2]) * r) * PX,
    );
    if (!inst.userData.upQ) { // 構えの姿勢（初回に控える）
      inst.userData.upQ = inst.userData.baseQ.clone();
      inst.userData.restQ = rest.quat ? rest.quat.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(...rest.rot3));
    }
    inst.userData.baseQ.copy(inst.userData.upQ).slerp(inst.userData.restQ, r);
    inst.quaternion.copy(inst.userData.baseQ);
  }

  /**
   * アタックの明滅：発音した瞬間に楽器を明るくし、時定数 100ms で元へ戻す。
   * 強さは energy（CC 追従・「強弱の反応」スライダー込み）を 1 で頭打ちにしたもの × 「楽器のフラッシュ」スライダー。
   * 光は自己発光（material.emissive）で出す：照明の無い真っ暗な中でも光る（足元の光と同じ。2026-09-17 ユーザー指定）。
   * emissive は sprites.js でボクセルの色が掛かるので、絵の色のまま光る。板（2D）の時は従来どおり color × 倍率。
   * 楽器を持たない指揮者は対象外。楽器が手持ち（シンバル等）なら held を明滅させる
   */
  _attackFlash(st, settings) {
    if (this.family === 'conductor') return;
    const { onset, age } = st;
    const amt = 0.8 * (settings?.instFlash ?? 1);   // 「楽器のフラッシュ」スライダー（1 で従来の +80%。2026-09-17 ユーザー指定）
    const k = onset ? 1 + amt * Math.exp(-age * 10) * clamp(st.energy, 0, 1) : 1;
    if (k === this._flashK) return; // 1 のまま（休符中）は毎フレーム触らない
    this._flashK = k;
    const apply = (o) => o && o.traverse((m) => {
      if (!m.isMesh || !m.userData.baseColor) return;
      if (m.material.emissive) m.material.emissive.setScalar(k - 1);
      else m.material.color.copy(m.userData.baseColor).multiplyScalar(k);
    });
    if (this.inst) apply(this.inst);
    else { apply(this.held?.L); apply(this.held?.R); }
  }

  /**
   * 吊られた部分の揺れ（銅鑼の円盤と紐。2026-09-19 ユーザー指定）：楽器の userData.swing を x 軸まわりの減衰振り子で揺らす。
   * 打った瞬間に勢い（角速度）を足す：強さ 1 で振れ幅 約 10°。+ 回転で円盤の下が面（絵の +z）の裏側へ振れる＝マレットに押される向き。
   * 1 往復 約 1.4 秒、2〜3 秒で止まる。続けて打つと足し合わさる。シーク等で dt が飛んでも暴れないよう細かく刻んで積分する
   */
  _instSwing(st, dt) {
    const sw = this.inst?.userData.swing;
    if (!sw || !(dt > 0)) return;
    const W = 2 * Math.PI / 1.4, DAMP = 1.2;               // 固有角振動数 [rad/s]・減衰 [1/s]（振れ幅は約 2.5 秒で 1/20）
    const { onset, age } = st;
    if (onset && onset !== this._swingOnset && age < 0.1) { // 新しい音の打った瞬間
      this._swingOnset = onset;
      // 減衰で最初の山は勢いの 7 割ほどになるので、14° 相当の勢いを足して最初の振れを約 10° にする（強さ 1 のとき。2026-09-19 ユーザー指定で 5° から倍に）
      this._swingW = (this._swingW ?? 0) + deg2rad(14) * W * clamp(onset.velocity ?? 0.5, 0, 1);
    }
    let th = this._swingTh ?? 0, w = this._swingW ?? 0;
    const n = Math.min(60, Math.ceil(Math.min(dt, 1) / (1 / 120)));
    const h = Math.min(dt, 1) / n;
    for (let i = 0; i < n; i++) { w += (-W * W * th - 2 * DAMP * w) * h; th += w * h; }
    if (Math.abs(th) < 1e-5 && Math.abs(w) < 1e-5) { th = 0; w = 0; }
    this._swingTh = th; this._swingW = w;
    sw.rotation.x = th;
  }

  /** 下ろし中の手の位置：構えの位置 p と下ろしの位置 to を補間（rig px） */
  _restHand(p, to) {
    const r = this._rest ?? 0;
    if (!to || r <= 0) return p;
    return [p[0] + (to[0] - p[0]) * r, p[1] + (to[1] - p[1]) * r, (p[2] ?? 0) + ((to[2] ?? 0) - (p[2] ?? 0)) * r];
  }

  // ---- 弦：弓の接点を固定し、手元が弓の上を滑る。ノートごとに上げ弓/下げ弓を交互、前のストロークの終点から続ける。
  //      休符では弓を弦から離し、次の音の直前に着弦する ----
  _strings(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy, posture } = st;
    const cfg = this.cfg, bow = cfg.bow, p3 = this.p3;
    const sMin = p3?.sMin ?? bow.sMin, sMax = p3?.sMax ?? bow.sMax;
    if (onset && onset.index !== this.lastOnsetIndex) { // 新しいノート：ストロークの方向と長さ
      this.lastOnsetIndex = onset.index;
      const range = sMax - sMin;
      // ストロークの長さは velocity ではなく energy で決める（2026-09-12 ユーザー指定）。
      // velocity を固定して CC で表情を付けるトラック（1st Vn の CC11 等）では velocity では変化せず、
      // 「強弱の反応」スライダーも velocity には掛からないので効かなかった。energy なら両方に乗る。
      // 弓が長く動けば上体の傾き（sNorm）も自動的に大きくなる
      const len = clamp(onset.duration * range * 1.3, range * 0.2, range) * (0.55 + 0.45 * clamp(energy, 0, 3)) * this.scaleVar; // 弓 26px に合わせてストロークも長く（2026-09-10）
      // 弓の向きは「同じリズムを弾いている奏者」で揃える（2026-09-14 ユーザー指定）。
      // 実際の演奏でも、弓使いは首席が決めてセクションをまたいで揃えるのが普通で、
      // 同じリズムならハモっていても（音程が違っても）揃える。リズムが別なら自然に分かれる。
      // キーは「開始時刻｜音の長さ」。演奏のゆらぎを吸収するため、時刻は 30ms・長さは 50ms 刻みに丸める。
      // 振り幅の個体差（scaleVar）と後列の遅れで各自が別々に折り返すと向きが混ざるので、
      // 最初に到達した奏者が決めた向きを、同じリズムの全員で使う
      let dir;
      const sync = this.bowSync;
      const key = `${Math.round(onset.time / 0.03)}|${Math.round(onset.duration / 0.05)}`;
      const decided = sync?.dirOf.get(key);
      if (decided !== undefined) dir = decided;
      else {
        // 反転の基準は「そのリズム集団の前回の向き」。各自の前回の向きを基準にすると、
        // 音符ごとに最初に決める奏者が変わった時に反転が打ち消し合い、向きが固まる（2026-09-14 実測）
        dir = -(sync?.lastDir ?? this.bowDir);
        const t0 = this.bowPos + dir * len;
        if (t0 > sMax || t0 < sMin) dir = -dir;                 // 端に当たったら折り返す
        if (sync) {
          sync.dirOf.set(key, dir);
          sync.lastDir = dir;
          if (sync.dirOf.size > 64) sync.dirOf.delete(sync.dirOf.keys().next().value);   // 直近だけ覚える
        }
      }
      const target = clamp(this.bowPos + dir * len, sMin, sMax);
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
    // 弓圧：強く弾くほど弓を弦へ押し付ける（lift の逆向き）。押し付けた反動で上体が沈む（2026-09-12 ユーザー指定）。
    // energy を直接使うと音の頭で跳ぶので rate 6（≒170 ms）で均す。楽器を下ろしている間は掛けない
    const wantPress = active.length ? clamp(energy, 0, 3) * (1 - (this._rest ?? 0)) : 0;
    this._press = approach(this._press ?? 0, wantPress, 6, dt);
    const nOff = this.lift - 0.3 * this._press; // 弦から離す（+）／弦へ押し込む（−）

    // 接点（駒）と弓の向き・弦から離れる向き（2D は平面、3D は楽器の姿勢から）
    const C = instPoint(this.inst, bow.contact[0], bow.contact[1], p3?.contactZ ?? 0); // 3D では弦のある正面側
    let d, n;
    if (p3) { d = p3.bowDir; n = p3.liftDir; }
    else { const a = bow.world; d = [Math.cos(a), Math.sin(a), 0]; n = [Math.sin(a), -Math.cos(a), 0]; }
    const handR = [C[0] - d[0] * s + n[0] * nOff, C[1] - d[1] * s + n[1] * nOff, C[2] - d[2] * s + n[2] * nOff];
    // 手首あり：右手は前腕と一直線で、弓は手に対して直角に握る（実際の持ち方。2026-09-11 ユーザー確定 A）。
    // 手の向き＝前フレームの前腕の向き（肘→手首）から弓の方向 d の成分を除いたもの（弓と常に直角、前腕の延長に沿う。1 フレーム遅れで収束）。甲は弦の面の法線側（手のひらが弓に被さる）
    let rightHandDir = null;
    if (this.hasWrist) {
      const a = new THREE.Vector3(0, -1, 0).applyQuaternion(this.foreQ.R);
      a.addScaledVector(v3(d), -a.dot(v3(d)));
      if (a.lengthSq() < 1e-4) a.set(-n[0], -n[1], -n[2]);
      a.normalize();
      // 前フレームの前腕 → 手の向き → 手首の位置 → IK → 前腕、の循環なので、肘の向き（pole）によっては
      // 2 つの解を毎フレーム行き来して腕がチラつく（コントラバスで肘を前に出した時。2026-09-16 ユーザー指摘）。
      // 手の向きを時定数 ≒ 50 ms で均して循環を切る
      if (!this._rhDir) this._rhDir = a.clone();
      else { this._rhDir.lerp(a, 1 - Math.exp(-20 * dt)); if (this._rhDir.lengthSq() < 1e-6) this._rhDir.copy(a); this._rhDir.normalize(); }
      rightHandDir = [this._rhDir.x, this._rhDir.y, this._rhDir.z];
    }
    this.setHand('R', this._restHand(handR, cfg.rest?.bowHand), dt, Infinity, rightHandDir, cfg.pole?.R, this.hasWrist ? n : null); // pole：肘の向き（コントラバスは肘を外・上に出して前腕を弓と直角に）
    // 下ろしている間の弓の向き。既定は下へ垂らす。
    // あご楽器は太ももに沿わせて置く（cfg.rest.bowAim。2026-09-13 ユーザー指定）
    const rr = this._rest ?? 0;
    const rd = cfg.rest?.bowAim || [0.25, -1.0, 0];
    this.aimHeldDir('R', rr > 0 ? [d[0] * (1 - rr) + rd[0] * rr, d[1] * (1 - rr) + rd[1] * rr, d[2] * (1 - rr) + rd[2] * rr] : d, 'x');

    // 左手：指板の位置。長い音ではビブラート（弦に沿って 5.5Hz）
    const L = instPoint(this.inst, cfg.leftHand[0], cfg.leftHand[1], p3?.leftHandZ ?? 0);
    const vibAxis = p3?.vib || cfg.vib || n;
    // ビブラート。setHand の追従（rate）が 5.5Hz を半分まで削るので、振幅と追従の両方を上げる（2026-09-12 ユーザー指定）
    const vib = active.length && onset && onset.duration > 0.2 ? 0.8 * Math.sin(2 * Math.PI * 5.5 * t + this.phase) : 0;
    // 左手の向き（手首→指先）：
    //   あご楽器（バイオリン/ヴィオラ）：手首はネックの内側（体側・下）にあり、指はネックの下から回り込んで上（弦の面の法線方向）へ伸びる。肘は楽器の下で脇を閉める（2026-09-11 ユーザー指摘）
    //   チェロ/コントラバス：指は弦を上から押さえる（下向き＋弦の面へ少し＋弓元側へ少し）。手首は指板の上
    //   あご楽器の指の向き：手首はネックの内側（体側）の下にあり、指は内側から外側（弓の先の向き d）へ、弦の面の法線 n の分だけ持ち上がって弦に乗る（2026-09-11 ユーザー指摘：手首は内側から）
    //   チェロ/コントラバスの指の向き：手首はネックの外側（奏者の左）にあり、指は弦を横切って内側へ（-d）、少し下がりながら指板に押し付ける（-n）。手のひらは指板に向く（甲＝n）。2026-09-11 ユーザー指摘（手が浮いていた）
    const lhd = !this.hasWrist ? null : cfg.chin ? [0.7 * d[0] + 0.7 * n[0], 0.7 * d[1] + 0.7 * n[1], 0.7 * d[2] + 0.7 * n[2]] : [-0.85 * d[0] - 0.2 * n[0], -0.85 * d[1] - 0.2 * n[1] - 0.3, -0.85 * d[2] - 0.2 * n[2]];
    // 手の甲の向き：指はネックを横切って弦に乗り、4 本の指はネックに沿って並ぶ（手の幅＝ネックの軸）。手のひらはネックの内側から当たるので、
    // 甲はネックの外側＝弓の進行方向 d（軸にも弦の法線にも直交）。ネックと手が直交しないように（2026-09-11 ユーザー指摘）
    const lup = cfg.chin ? [n[0] - d[0], n[1] - d[1], n[2] - d[2]] : n; // あご楽器：甲は上・内側（手のひらはネックへ）。チェロ系：甲は弦の面の法線（手が指板に平らに乗る）
    this.setHand('L', this._restHand([L[0] + vibAxis[0] * vib, L[1] + vibAxis[1] * vib, L[2] + (vibAxis[2] || 0) * vib], cfg.rest?.leftHand), dt, 35, lhd, cfg.chin ? [0.6, -1, -0.2] : null, lup);

    // 腰：強いほど前傾（楽器へ入り込む）、弓の進行方向へわずかに傾く。視線：弾いている間は楽器の方（あご楽器は左下、チェロ系は下）
    // 弓の進行方向への傾きは「上げ弓/下げ弓の符号」ではなく「弓が今どこを通っているか」で作る。
    // 符号だと音が変わる 1 フレームで上体が反転してワープして見えた（2026-09-12 ユーザー指摘）。
    // bowPos はストローク中を連続的に動くので、この形なら段差が原理的に出ず、上体の揺れが弓と同期する
    const sNorm = clamp((this.bowPos - (sMin + sMax) / 2) / ((sMax - sMin) / 2 || 1), -1, 1);
    this.spine.rotation.z += MIRROR * 0.06 * sNorm * posture; // 0.03 だと弓の可動域を使い切らないぶん振れ幅が半減したので倍に（2026-09-12 ユーザー指定）
    this.spine.position.y -= 0.4 * this._press * PX; // 弓を押し付けた分だけ腰が沈む（強奏で体重が乗る）
    // 弦：前傾しても顔は指揮者を見る角度に保つ（2026-09-10 ユーザー指定）。あご楽器は首を楽器側へ傾げるだけ、チェロ系はごく浅く下を見る
    this._spineGaze(st, dt, 0.16 * posture, cfg.chin ? 0.0 : 0.06, cfg.chin ? MIRROR * -0.25 : 0);
    if (cfg.chin) { // あごで楽器を挟む：首を楽器側（ローカル -x）へ傾げ、頭がわずかに下がる（下ろしている間は解く）
      const k = 1 - (this._rest ?? 0);
      this.headPivot.rotation.z += (0.32 + 0.08 * posture) * k;
      this.headPivot.position.y = (HEAD_Y_PX - 0.8 * k) * PX;
    } else {
      this.headPivot.rotation.z += -0.1 * posture;
    }
  }

  // ---- 管楽器（木管・金管）：両手は楽器上の点に置き、楽器の動きに追従。息継ぎ→アタック→ベル/角度の変化 ----
  _wind(st, { t, dt }) {
    const { onset, next, age, toNext, active, energy, posture, pitchNorm } = st;
    const cfg = this.cfg, inst = this.inst, p3 = this.p3;
    // 息継ぎ：フレーズの直前に肩が上がり（0.35 秒前から）、アタックで落ちる
    // 息継ぎの深さは次の音の強さで変える（強いフレーズの前ほど深く吸う。2026-09-12 ユーザー指定）。
    // next.velocity ではなく nextEnergy を使うので、velocity 固定＋CC のトラックでも効き「強弱の反応」スライダーにも乗る
    let breath = 0;
    if (next && !active.length && toNext < 0.35) breath = (1 - toNext / 0.35) * (0.7 + 0.7 * clamp(st.nextEnergy ?? 0.43, 0, 3)); // 標準的な強さ（0.43）で従来と同じ深さ、強い音の前はより深く
    this._breath = approach(this._breath, breath, 12, dt);
    const attack = onset ? Math.exp(-age * 9) * onset.velocity : 0;
    this.spine.position.y = (SPINE_Y + 0.5 * this._breath - 0.9 * attack) * PX;
    this.spine.scale.x = 1 + 0.05 * this._breath + 0.05 * posture;

    // 楽器の角度（種類別）。回転はスプライト面内（ローカル z 軸）。3D 姿勢でもローカル z 回転で「ベルが上がる」になる
    let lift = 0;
    if (onset) { const sustain = age < onset.duration ? 1 : Math.exp(-(age - onset.duration) * 5); lift = (0.08 + 0.3 * onset.velocity) * sustain * this.scaleVar; }
    this._lift = approach(this._lift, lift, 18, dt);
    if (inst) {
      let target = 0;
      switch (cfg.kind) {
        case 'flute':   target = (-0.15 + 0.3 * pitchNorm) * (0.3 + 0.7 * posture); break;
        case 'reed':    target = -0.3 * posture - 0.15 * this._lift; break;   // ベルが持ち上がる
        case 'bassoon': target = 0.12 * posture; break;
        case 'bell':    target = (cfg.tiltBias ?? 0) + this._lift; break;      // トランペット/トロンボーン：ベルが上がる（tiltBias で構えの角度を下げる）
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
    if (cfg.slide) {
      // 高い音ほど手前（1 ポジション側）、低い音ほど伸ばす [基本 px]。
      // 伸ばす側は腕の長さで頭打ちなので、手前に引く側をマイナスまで引いて差を稼ぐ（2026-09-12 ユーザー指定）
      // 左手をスライドの手元へ移した分、引き切った時に右手と重ならないよう range を前へずらす（2026-09-12）
      this._slide = approach(this._slide, 0.5 + (1 - pitchNorm) * 8.5, 10, dt);
      const sl = inst?.userData.slide;
      if (sl) sl.position.x = sl.userData.baseX + this._slide * PX; // 外管も一緒に動かす（右手と同じ量）
    }
    const hands = p3?.hands || cfg.hands;
    for (const side of ['L', 'R']) {
      const h = hands[side];
      let lx = h[0], ly = h[1], lz = h[2] || 0;
      if (side === 'R') { lx += (cfg.slide ? this._slide : 0); ly += finger * 0.3; }
      else { lx += finger * 0.3; }
      const p = inst ? instPoint(inst, lx, ly, lz) : [SHOULDER[side][0], 20, 0];
      let hd = null, up = null;
      if (inst && cfg.handDirs) { // 手首→指先の向き：楽器ローカル → rig（鏡像スプライトなら x を反転）
        const d0 = cfg.handDirs[side];
        _b.set(inst.scale.x < 0 ? -d0[0] : d0[0], d0[1], d0[2]).applyQuaternion(inst.quaternion);
        hd = [_b.x, _b.y, _b.z];
        _b.set(0, 0, 1).applyQuaternion(inst.quaternion); // 管の前面の法線：手の甲をこちらへ向け、管の傾きに手の角度を合わせる（2026-09-11 ユーザー指定）
        if (Math.abs(_b.x * hd[0] + _b.y * hd[1] + _b.z * hd[2]) > 0.85) _b.set(0, 1, 0).applyQuaternion(inst.quaternion); // 指の向きと平行だと甲の向きが不定になり手首が回る → 管の上方向を使う（トロンボーン/ピッコロの右手）
        up = [_b.x, _b.y, _b.z];
      }
      this.setHand(side, p, dt, 25, hd, cfg.pole?.[side], up); // pole：肘を出す向き（rig 座標）
    }
    this.headPivot.rotation.z += -0.1 * posture + 0.08 * this._breath; // 息継ぎで少し上を向く
    this._spineGaze(st, dt, 0.1 * posture - 0.06 * this._breath, cfg.gazeDown ?? 0.05, 0); // 息継ぎで少し反り、吹くと前傾
    this._fingers(st, dt);
  }

  // ---- 指（管楽器）：簡易運指。音の頭で指が動く（2026-09-16 ユーザー指定） ----
  // 木管：低い音ほど多くの穴を塞ぐので、音域内の位置（pitchNorm）で「下りる指の本数」を決める。
  //       順番は左手（人差し指→薬指）→ 右手（人差し指→小指）の 7 本。左手の小指は使わない
  // 金管：ピストン／ロータリー 3 本。倍音列の同じ位置なら同じ運指なので、音番号を 7 で割った余りで
  //       実物の組み合わせ（開放・2・1・1+2・2+3・1+3・1+2+3）を割り当てる。トロンボーンはスライドなので指は握ったまま
  // 動き：下りる = 0、持ち上げる = 手の甲側へ 40°。音の頭（80 ms）は下りている指を少し深く押す（同じ音の連打でも動く）
  _fingers(st, dt) {
    const L = this.fingers.L, R = this.fingers.R;
    if (!L && !R) return;
    const { onset, age, active, pitchNorm } = st;
    const cfg = this.cfg;
    const playing = active.length > 0;
    const UP = -0.7, REST = -0.25, PRESS = 0.12;
    const down = { L: [true, true, true, true], R: [true, true, true, true] };
    if (this.family === 'brass') {
      const valveHand = cfg.kind === 'horn' ? 'L' : cfg.slide ? null : 'R';
      if (valveHand && onset) {
        const combo = [[], [1], [0], [0, 1], [1, 2], [0, 2], [0, 1, 2]][((onset.midi % 7) + 7) % 7];
        for (let i = 0; i < 3; i++) down[valveHand][i] = combo.includes(i);
        down[valveHand][3] = true;   // 小指は管に掛けたまま
      }
    } else {
      const n = playing ? Math.round((1 - clamp(pitchNorm ?? 0.5, 0, 1)) * 7) : 0;
      const order = [['L', 0], ['L', 1], ['L', 2], ['R', 0], ['R', 1], ['R', 2], ['R', 3]];
      for (let i = 0; i < order.length; i++) { const [sd, k] = order[i]; down[sd][k] = i < n; }
      down.L[3] = true;
    }
    const press = onset && age < 0.08 ? PRESS * (1 - age / 0.08) : 0;
    for (const side of ['L', 'R']) {
      const list = this.fingers[side];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const target = !playing ? REST : down[side][i] ? press : UP;
        list[i].rotation.x = approach(list[i].rotation.x, target, 30, dt);
      }
    }
  }

  // ---- 打楽器：構え位置→打点。直前に振りかぶり、打った瞬間に打点、戻る。マレットは打面を向く ----
  _percussion(st, { dt, settings }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    // 振りかぶり・構えの高さ・シンバルの回しは velocity 由来なので、そのままでは「強弱の反応」スライダーが効かない。
    // ここでスライダーを掛ける（上限 2：これ以上構えを高くすると腕が届かなくなる）。2026-09-12 ユーザー指定
    const vScale = (x) => clamp(x * (settings?.dynResponse ?? 1), 0, 2);
    const cfg = this.cfg, p3 = this.p3;
    const strike = p3?.strike || cfg.strike;
    const fixedHand = p3?.fixedHand || cfg.fixedHand;
    const armOf = (n) => (cfg.singleArm ? cfg.singleArm : (n.index % 2 ? 'L' : 'R'));
    const both = !!cfg.bothArms; // シンバル：両手を同時に中央で合わせる（2026-09-11 ユーザー指定）
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const spread = cfg.pitchSpread || 0; // 鍵盤打楽器：音程で叩く位置が横に動く（次の音へ向かって移動）
    // ロール（サスペンデッドシンバル。2026-09-19 ユーザー指定）：長い音の間、左右交互に叩き続ける。
    // 音源がクレッシェンド込みの収録なので、振り上げは音の始めほど小さく（roll.from）、終わりに向けて構えの高さまで大きくする
    // ティンパニ（roll.byArt。2026-09-23 ユーザー指定）は音の長さではなくキースイッチの奏法（note.art）でロールにする：
    //   cresc（D0〜F0）＝サスシンと同じく音の進み具合で大きく、roll（C#0）＝その時刻の CC1 で大きさを決める（CC1 が無ければ velocity）
    let roll = null;
    if (cfg.roll && onset) {
      const tNow = onset.time + age;
      const byArt = cfg.roll.byArt;
      const n = st.active.filter((a) => (byArt ? a.art === 'roll' || a.art === 'cresc' : a.end - a.time >= cfg.roll.minDur)).sort((a, b) => b.time - a.time)[0];
      if (n) {
        const p = clamp((tNow - n.time) / (n.end - n.time), 0, 1);
        const k = n.art === 'roll' ? clamp(st.rollCC ?? n.velocity, 0, 1) : p;
        roll = { a: lerp(cfg.roll.from, 1, k), ph: tNow * cfg.roll.rate };   // a ＝ 振り上げの高さ（構えと打点の間の割合）
      }
    }
    // 床に固定した楽器：前かがみを手より先に決め（打つ強さは前のフレームの値。なめらかに追うので差は見えない）、手の目標を上半身の座標に直す
    const fixed = this.instFixed;
    if (fixed) {
      this._spineGaze(st, dt, 0.06 * st.posture + 0.05 * (this._strikePrev ?? 0), 0.25, cfg.gazeYaw ?? 0);
      this._rigToUpperBegin();
    }
    const U = (p) => (fixed && p ? this._rigToUpper(p) : p), UD = (d) => (fixed && d ? this._rigToUpperDir(d) : d);
    for (const side of ['L', 'R']) {
      const sp = strike?.[side];
      if (!sp) { if (fixedHand?.[side]) this.setHand(side, U(fixedHand[side]), dt, 10); continue; }
      let s = 0, ant = 0, vel = 0.5, pn = pitchNorm;
      if (onset && (both || armOf(onset) === side)) { vel = vScale(onset.velocity); s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 14); }
      if (next && (both || armOf(next) === side) && toNext < 0.25) { ant = (1 - toNext / 0.25) * 0.5 * vScale(next.velocity); vel = Math.max(vel, vScale(next.velocity)); if (spread) pn = normOf(next); }
      if (roll) { // 左右は半周期ずらす。打つ瞬間だけ鋭く s → 1（cos の 4 乗）
        s = Math.pow(Math.max(0, Math.cos(2 * Math.PI * (roll.ph + (side === 'L' ? 0 : 0.5)))), 4);
        ant = 0; vel = onset ? vScale(onset.velocity) : vel;
      }
      const dx = spread ? (pn - 0.5) * 2 * spread : 0;
      const rest = [sp.rest[0] + dx, sp.rest[1] + 2 * vel, sp.rest[2] || 0];       // 強いほど高く構える（構えは肩より下が基本。2026-09-10 ユーザー指摘）
      const hit = [sp.hit[0] + dx, sp.hit[1], sp.hit[2] || 0];
      if (roll) { const a = roll.a; for (let i = 0; i < 3; i++) rest[i] = hit[i] + (rest[i] - hit[i]) * a; } // 振り上げの高さ＝構えと打点の間を a の割合
      let target = [0, 1, 2].map((i) => lerp(rest[i], hit[i], s) + (rest[i] - hit[i]) * ant * (sp.wind ?? 0.6)); // wind = 振りかぶりの大きさ
      // arc：肩から腕全体で振る（銅鑼。2026-09-19 ユーザー指定：直線で寄せると肘から先だけで叩いて見えた）。
      // 手は肩を中心に「構え → 打点」の角度を回り、肩からの距離は構えと打点の間で変えるだけ（肘の角度がほぼ一定）。
      // u = 1 で打点、0 で構え、負で振りかぶり（構えの先へ同じ弧を回る）
      if (sp.arc) {
        const S = SHOULDER[side], u = s - ant * (sp.wind ?? 0.6);
        const a = v3([rest[0] - S[0], rest[1] - S[1], rest[2] - S[2]]), b = v3([hit[0] - S[0], hit[1] - S[1], hit[2] - S[2]]);
        const la = a.length(), lb = b.length(); a.normalize(); b.normalize();
        const axis = new THREE.Vector3().crossVectors(a, b);
        if (axis.lengthSq() > 1e-8) {
          const th = Math.acos(clamp(a.dot(b), -1, 1));
          const d = a.applyAxisAngle(axis.normalize(), th * u).multiplyScalar(lerp(la, lb, clamp(u, 0, 1)));
          target = [S[0] + d.x, S[1] + d.y, S[2] + d.z];
        }
      }
      // シンバルの大きな一打：合わせた後に両手を上に上げて大きく腕を回す（強さに応じた振り幅、約 0.9 秒で構えへ戻る。2026-09-11 ユーザー指定）
      if (both && onset && cfg.flourish) {
        // ここだけスライダーを掛けない：掛けると弱い音でも回してしまい「強い音の時だけ大きく回す」という作りが崩れる（2026-09-12）
        const amp = clamp((onset.velocity - 0.3) / 0.5, 0, 1);                   // 弱い音（vel < 0.3）では回さず、0.8 以上で最大
        const T = 0.9, pf = (age - 0.05) / T;
        if (amp > 0 && pf > 0 && pf < 1) {
          // 円を描いて構えへ戻す（2026-09-12 ユーザー指定）。横に sin・縦に 1-cos を使い、角度を 1 周させる。
          // 同じ sin を両軸に使うと往路と復路が同じ線をなぞり、頂点から直線的に戻ってしまう。
          // 回す向きは「外回し」＝体の内側を上がって外側を下りる（内回しは不自然。2026-09-12 ユーザー指摘）
          const sign = side === 'L' ? -1 : 1, th = pf * Math.PI * 2;
          const rx = 3 * amp, ry = 9 * amp; // 縦長の円（頂点は 2*ry = 18px 上）。横は広げすぎると左右の手が交差する
          const ox = -sign * rx * Math.sin(th), oy = ry * (1 - Math.cos(th));
          target = [lerp(hit[0], rest[0], pf) + ox, lerp(hit[1], rest[1], pf) + oy, lerp(hit[2], rest[2], pf) - amp * (1 - Math.cos(th))];
        }
      }
      // 手首：マレットは打点を向き、手首はそれより少し起きる（振りかぶりで返し、打つ瞬間に伸びる）
      let aim = null;
      if (sp.head) {
        // 先端の高さは 3 段階（2026-09-22 ユーザー指摘で 2 回直した）。
        //   構え（s=0, ant=0）… 1.9 倍 ＝ 先端が手とほぼ同じ高さ＝水平に構える
        //                        （0 にすると打面を狙って真下に垂れ、1.9 倍を常時掛けるとずっと上向きになる）
        //   振りかぶり（ant→1）… 3 倍まで上がる＝先端が手より上
        //   打つ瞬間（s=1）　　… 0 ＝ 先端が打面へ
        const liftTip = (1 - s) * Math.max(0, rest[1] - hit[1]) * (1.9 + 1.1 * clamp(ant, 0, 1));
        const headPt = [sp.head[0] + dx, sp.head[1] + liftTip, sp.head[2] || 0];
        aim = [headPt[0] - target[0], headPt[1] - target[1], headPt[2] - target[2]];
        if (sp.restAim) { // 構えではマレットを restAim（真前）に向け、振りかぶり(ant)で打面から離れる側へ振り、打つ瞬間(s)に打面へ（グランカッサ。2026-09-10 ユーザー指定）
          const h = v3(aim).normalize();
          const a = v3(sp.restAim).normalize().addScaledVector(h, -ant * 1.2).normalize().lerp(h, s).normalize();
          aim = [a.x, a.y, a.z];
        }
      }
      else if (cfg.heldAngle) aim = [Math.cos(cfg.heldAngle[side]), Math.sin(cfg.heldAngle[side]), 0];
      if (GRIP_ITEMS.has(cfg.held?.[side])) {
        // 棒（スティック・マレット）を握る手。
        // 手首の位置は aim（打点の方向）＝**肘 → 前腕 → スティックが一直線**。拳の向きだけ真下（地面の方）。
        // handDir と handFace を分けているのがポイント：一本にすると、拳を下に向けた瞬間に
        // 手首の位置まで持ち上がって肘から上り坂になる（2026-09-22 ユーザー指摘）
        this.setHand(side, U(target), dt, s > 0.5 ? Infinity : 22, UD(aim), null, STICK_UP[side], STICK_HAND_DIR, STICK_WRIST_MAX);
        if (aim) this.aimHeldDir(side, UD(aim), 'ny', STICK_UP[side]);
      } else {
        // 合わせシンバルなど、棒以外を持つ手は従来どおり（甲は真上・手は持ち物の向きに寄る）。
        // 棒用の扱いを当てたら手が崩れた（2026-09-22 ユーザー指摘）
        let hd = null;
        if (aim) { const a = v3(aim).normalize(); const w = 0.55 - 0.35 * s; hd = [a.x, a.y * (1 - w) + w * -0.2, a.z]; }
        this.setHand(side, U(target), dt, s > 0.5 ? Infinity : 22, UD(hd), null, PERC_UP);
        if (aim) this.aimHeldDir(side, UD(aim), 'ny', PERC_UP);
      }
      this._strikeMax = Math.max(this._strikeMax ?? 0, s);
    }
    const sNow = this._strikeMax ?? 0; this._strikeMax = 0; this._strikePrev = sNow;
    if (!fixed) this._spineGaze(st, dt, 0.06 * st.posture + 0.05 * sNow, 0.25, cfg.gazeYaw ?? 0); // 打つ時に少し前へ、視線は打面
    this.headPivot.rotation.z += -0.06 * st.posture;
  }

  // ---- 鍵盤/ハープ：音程で手の位置、押鍵で手首が沈む／弦をはじく ----
  _keyboard(st, { dt }) {
    const { onset, next, age, toNext, pitchNorm } = st;
    const cfg = this.cfg, p3 = this.p3;
    const keys = p3?.keys || cfg.keys;
    const tr = st.track;
    const normOf = (n) => (n.midi - (tr?.minPitch ?? 60)) / Math.max(1, (tr?.maxPitch ?? 72) - (tr?.minPitch ?? 60));
    const armOf = (n) => (normOf(n) < 0.5 ? 'L' : 'R');
    // 前かがみ・視線は手より先に決める（床に固定した鍵盤では、このフレームの腰の曲がりで手の目標を上半身の座標に直すため）
    this._spineGaze(st, dt, 0.1 * st.posture, keys ? 0.3 : 0.15, keys ? 0 : MIRROR * -0.25); // 鍵盤を見る／ハープの弦を見る
    if (cfg.harp && this.instFixed) this._harpLean();
    if (this.instFixed) this._rigToUpperBegin();
    for (const side of ['L', 'R']) {
      let s = 0, ant = 0, pn = pitchNorm;
      if (onset && armOf(onset) === side) { s = age < 0.03 ? 1 : Math.exp(-(age - 0.03) * 12); }
      if (next && armOf(next) === side && toNext < 0.15) { ant = 1 - toNext / 0.15; pn = normOf(next); }
      const sign = side === 'L' ? -1 : 1;
      if (keys) { // ピアノ/チェレスタ：鍵盤の上。音程で左右、押鍵で 1.5px 沈む、直前に 1px 浮く。指は鍵盤へ（前方・やや下）
        const x = (pn - 0.5) * 2 * keys.spread + sign * keys.gap;
        const y = keys.y + 3 - 1.5 * s + 1.0 * ant;
        let tgt = [x, y, keys.z ?? 0];
        // 床に固定した鍵盤：目標は rig の座標（楽器と同じ）なので、腰の曲がり・揺れの逆をかけて上半身の座標に直す。手は鍵盤の上に留まる
        if (this.instFixed) tgt = this._rigToUpper(tgt);
        this.setHand(side, tgt, dt, s > 0.5 ? Infinity : 14, [0, -0.4 - 0.3 * s, 1], null, PERC_UP); // 甲は真上（指の向きが前向きなので、前向きのヒントだと不定になり手首が裏返る。2026-09-11）
      } else { // ハープ：高い音ほど短い弦（右側）。はじくと手が弦から 1.5px 離れる。座標は楽器ローカル（pivot 基準）。指は弦へ
        // 左手は奥（柱側の長い弦）から中ほど、右手は手前（体側の短い弦）だけ（2026-09-24 ユーザー指定：右手が奥まで触ると腕がハープにめり込む）。
        // どちらの手で弾くかは音域の下半分＝左・上半分＝右（armOf）なので、pn もそれぞれの半分を端から端へ割り当てる。
        // 右手の右端（3.5px ＋はじく 1.5px）は、右手の高さで共鳴胴の縁（≈5.5px）と、奏者側で下へ凹んだネックに当たらない範囲（2026-09-24）
        const lx = side === 'L' ? -6 + clamp(pn * 2, 0, 1) * 7 : 1.5 + clamp((pn - 0.5) * 2, 0, 1) * 2;
        // 胸の高さ（肩の高さだと肘が折り畳まれる）。右手は 19：共鳴胴を伸ばして右肩にかけた後（2026-09-24 ユーザー指定で弾く弦を上へ）。
        // 16 → 19 で肘の角度はほぼ同じ（56〜89°）で、毎回届く。左手は 17：ネックの凹みを柱寄りにした時に 19 だと手がネックに当たった
        const ly = side === 'L' ? 17 : 19;
        // 奥行き：弦の面（sprites.js の harpCell で弦は z 5 のセル＝中心 2.75px）の両側 0.5px。以前は 0 を中心に ±1.5px で、
        // 弦から見て左手は 4.25px 手前で届かず、右手は弦を越えていた（2026-09-24 ユーザー指摘）
        let p = this.inst ? instPoint(this.inst, lx + 1.5 * s, ly + 0.5 * ant, this.flat ? 0 : HARP_STRING_Z + sign * 0.5) : [lx - 9, ly, 0];
        let hd = null;
        if (this.inst && !this.flat) { _b.set(0, 0, -sign).applyQuaternion(this.inst.quaternion); hd = [_b.x, _b.y, _b.z]; }
        if (this.instFixed) { p = this._rigToUpper(p); if (hd) hd = this._rigToUpperDir(hd); }   // 床に固定：instPoint は rig の座標になるので上半身の座標へ
        this.setHand(side, p, dt, s > 0.5 ? Infinity : 14, hd, null, PERC_UP); // ハープも甲は真上
      }
    }
    this.headPivot.rotation.z += -0.06 * st.posture + (cfg.headRoll ?? 0);   // headRoll：首を横に倒す（ハープ）
    // headFixed：揺れ・うなずき・視線の動きを捨て、上半身（spine）の回転の逆をかけて頭の向きを rig に対して一定にする
    if (cfg.headFixed && !this.flat) {
      _q.setFromEuler(new THREE.Euler(0, this._headYaw(), cfg.headRoll ?? 0));
      this.headPivot.quaternion.copy(this.spine.quaternion).invert().multiply(_q);
    }
  }

  // ---- 指揮者：拍子に応じた振り図形（4拍子：下→内→外→上）。イクタスで跳ね、強いほど大きく ----
  _conductor(st, { beat, dt, settings, bpm }) {
    const g = st.posture;   // 振り幅・身の乗り出し・左手の同調は均した方（= globalEnergy を拍の長さで均したもの）
    const gAcc = st.energy; // 拍のうなずきだけ速い方
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
    // 右手：前フレームの前腕の向き（肘→手首）に沿わせ、手の甲の向きも前腕のねじれに合わせる（手首が回らない）。
    // 指揮棒は手に固定（手の -y 方向＝指先の延長に +x を向ける定数回転）。2026-09-11 ユーザー指摘（手首がくるくる回っていた）
    const fdir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.foreQ.R);
    const fup = new THREE.Vector3(0, 0, 1).applyQuaternion(this.foreQ.R);
    this.setHand('R', [C[0] + px * amp, C[1] + py * amp, C[2]], dt, Infinity, this.flat ? null : [fdir.x, fdir.y, fdir.z], null, this.flat ? null : [fup.x, fup.y, fup.z]);
    const baton = this.held.R;
    if (baton) {
      if (this.flat) { _a.set(0, -1, 0).applyQuaternion(this.foreQ.R); _a.y += 0.35; this.aimHeldDir('R', [_a.x, _a.y, _a.z], 'x'); }
      else if (!baton.userData.fixed) { baton.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2); baton.userData.fixed = true; }
    }
    // 左手：強い時は鏡像で同調、弱い時は胸の前で控える
    const mirror = [-C[0] - px * amp * 0.7, C[1] + py * amp * 0.6, C[2]];
    const restL = this.flat ? [-5, 24, 3] : [-5, 22, 7];
    const w = clamp((g - 0.25) / 0.5, 0, 1);
    // 左手も右手と同じく、前フレームの前腕の向きに手を沿わせ、手の甲の向きも前腕に合わせる。
    // 向きの指定なしだと「手の甲を rig の前へ」が既定になるが、指揮者の左手は体の前（+z）へ伸びていて
    // 手の向きとほぼ平行になるため、基準が潰れて手首がくるくる回っていた（2026-09-16 ユーザー指摘。
    // 計測：手のロールが 6 秒で 1029°、前腕は 102°）
    const fdirL = new THREE.Vector3(0, -1, 0).applyQuaternion(this.foreQ.L);
    const fupL = new THREE.Vector3(0, 0, 1).applyQuaternion(this.foreQ.L);
    this.setHand('L', [lerp(restL[0], mirror[0], w), lerp(restL[1], mirror[1], w), lerp(restL[2], mirror[2], w)], dt, 18,
      this.flat ? null : [fdirL.x, fdirL.y, fdirL.z], null, this.flat ? null : [fupL.x, fupL.y, fupL.z]);
    // 拍のうなずき：以前は拍の頭で 0 → 最大へ「瞬間に」跳ねてから直線で戻していたので、毎拍ピクついた
    // （2026-09-15 ユーザー指摘）。60 ms で沈み 180 ms で戻る連続した山にする（時間は秒で決め、
    // 速い拍では拍の 6 割に収める）。大きさは「強弱の反応」を上げても 1.5 で頭打ち（首が跳ねすぎないように）
    const beatSec = 60 / Math.max(20, bpm || 120);
    const k = Math.min(1, (0.6 * beatSec) / 0.24);
    const rise = 0.06 * k, fall = 0.18 * k, phSec = ph * beatSec;
    let nod = 0;
    if (phSec < rise) nod = Math.sin((phSec / rise) * Math.PI / 2);
    else if (phSec < rise + fall) nod = Math.cos(((phSec - rise) / fall) * Math.PI / 2);
    this.headPivot.rotation.z += -0.15 * clamp(gAcc, 0, 1.5) * nod;
    this._leanC = approach(this._leanC ?? 0, 0.12 * g, 5, dt);
    if (!this.flat) this.spine.rotation.x += this._leanC; // 盛り上がるほど楽団へ身を乗り出す
    this.spine.rotation.z = Math.sin(Math.PI * beat.beat * 0.5) * 0.06 * (0.3 + 0.7 * g) * settings.sway;
    // 体の沈み：以前は (1 - ph) で拍の頭に段差があった。拍の頭で速く沈み（10%）、拍の残りでなだらかに戻す
    const dipLen = 0.1;
    const dip = ph < dipLen ? Math.sin((ph / dipLen) * Math.PI / 2) : Math.cos(((ph - dipLen) / (1 - dipLen)) * Math.PI / 2);
    this.spine.position.y = (SPINE_Y - 0.3 * dip * g) * PX;
  }
}
