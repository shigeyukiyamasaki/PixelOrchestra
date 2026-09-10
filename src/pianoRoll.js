/*
 * PixelOrchestra — pianoRoll.js
 * 最終更新: 2026-09-09 / v0.2 / 生成元: PixelOrchestra
 *
 * 滝型ピアノロール（ノートは円筒。2026-09-11）。2 モード：
 *   overhead: 各奏者（トラック）の真上からノートが降ってきて足元で着弾する（既定。体は貫通）
 *   wall:     後方の壁を上から下へ流れる（横軸 = 音程・全トラック共通）
 * どちらも InstancedMesh 1つで全ノートを描く。
 */
import { WALL_Z, WALL_WIDTH, WALL_HEIGHT, WALL_BASE_Y } from './stage.js';
import { PX } from './sprites.js';

const FLASH_SEC = 0.12;       // 着弾後に明るく光る時間
export const HEAD_Y = 52 * PX; // パート名ラベルの高さ（体 34px + 頭 12px + 余白）
export const LAND_Y = 0.02;    // 着弾の高さ＝足元（床のすぐ上）。ノートは奏者の体を貫通して足元で発音し、足元の光と同期する（2026-09-10 ユーザー指定）
// 頭上ロールの見える高さ [unit] と半音あたりの幅 [unit] は UI スライダーから毎フレーム渡される（update の opts）
const DEFAULT_OVERHEAD_HEIGHT = 7;
const DEFAULT_SEMITONE_W = 0.22;
const COLUMN_EXTRA_MAX = 5;   // 列幅の上限 = 奏者の並び幅 + これ [unit]。超える音域は半音幅を詰めて収める

// グロー用のぼけた板（中心が明るく縁へ向かって透明）。ノートの形に沿った矩形のぼかし
let _haloTex = null;
function haloTexture() {
  if (_haloTex) return _haloTex;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = Math.abs(x + 0.5 - N / 2) / (N / 2), dy = Math.abs(y + 0.5 - N / 2) / (N / 2); // 0..1
    const d = Math.max(dx, dy);                        // 矩形距離（ノートの形に沿う）
    const a = Math.pow(Math.max(0, 1 - d), 2);         // 中心 1 → 縁 0（二乗で中心寄りに集める）
    const k = (y * N + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
  _haloTex = new THREE.CanvasTexture(c);
  _haloTex.minFilter = THREE.LinearFilter; _haloTex.magFilter = THREE.LinearFilter;
  return _haloTex;
}

// 円筒ノートの陰影（2026-09-11 ユーザー指定：帯 → 円筒）。照明に頼らず、円周方向 u の 0.5（カメラ側）を明るく、両端（縁）を暗くするグラデーションを色に掛ける。
// 列はカメラの方位へ向くビルボードなので、常に見える側が明るく丸く見える
let _shadeTex = null;
function cylinderShadeTexture() {
  if (_shadeTex) return _shadeTex;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = N; c.height = 1;
  const g = c.getContext('2d');
  const img = g.createImageData(N, 1);
  for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N;
    const k = Math.max(0, Math.cos((u - 0.5) * Math.PI)); // 0.5 で 1、両端で 0
    const v = Math.round(255 * (0.35 + 0.65 * Math.pow(k, 0.8)));
    img.data[x * 4] = img.data[x * 4 + 1] = img.data[x * 4 + 2] = v; img.data[x * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _shadeTex = new THREE.CanvasTexture(c);
  _shadeTex.minFilter = THREE.LinearFilter; _shadeTex.magFilter = THREE.LinearFilter;
  return _shadeTex;
}

export class PianoRoll {
  constructor(scene, engine, camera) {
    this.scene = scene;
    this.engine = engine;
    this.camera = camera;
    this.notes = engine.allNotes;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mode = 'overhead';

    const lo = engine.minPitch - 1, hi = engine.maxPitch + 1;
    this.pitchLo = lo;
    this.semitoneW = WALL_WIDTH / (hi - lo + 1);

    // ノート：底面が pivot の直径 1・高さ 1 の円筒（scale.x = 幅 = 直径、scale.y = 長さ）。thetaStart = π で u=0.5 が +z（カメラ側）
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false, Math.PI);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ map: cylinderShadeTexture(), transparent: true, opacity: 0.82 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.notes.length);
    // グロー用：底辺が pivot の 1×1 平面（ビルボード）
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    haloGeo.translate(0, 0.5, 0);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    // グロー（2026-09-10）：各ノートの周りに、ぼけた光の板を加算合成で重ねる（ノートより一回り大きい・後処理のブルームは使わない）
    this.haloMesh = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), this.notes.length);
    this.haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.haloMesh.renderOrder = 5;
    this.group.add(this.haloMesh);
    this.glow = 0;
    // 初期状態は全ノート非表示（identity のままだと原点に 1×1 の板が出る）
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.notes.length; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color(0)); this.haloMesh.setMatrixAt(i, zero); this.haloMesh.setColorAt(i, new THREE.Color(0)); }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceMatrix.needsUpdate = true;

    this._color = new THREE.Color();
    this._white = new THREE.Color(1, 1, 1);
    this._m = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._identityQ = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this.columns = new Map(); // track → { x, y, z, width, yaw, quat, line }（setSeats で生成）
    this.trackColors = new Map();
    this.refreshColors();
    this._lastVisible = new Set();
    this.maxDurAll = Math.max(...this.notes.map((n) => n.duration));

    // ---- 壁モードの装飾 ----
    this.wallGroup = new THREE.Group();
    this.group.add(this.wallGroup);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(WALL_WIDTH, 0.08), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    line.position.set(0, WALL_BASE_Y, WALL_Z + 0.02);
    this.wallGroup.add(line);
    const octMat = new THREE.MeshBasicMaterial({ color: '#2a2a48' });
    for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.03, WALL_HEIGHT), octMat);
      l.position.set(this._wallX(p) - this.semitoneW / 2, WALL_BASE_Y + WALL_HEIGHT / 2, WALL_Z);
      this.wallGroup.add(l);
    }

    // ---- 頭上モードの装飾（トラックごとの着弾ライン。setSeats で生成）----
    this.overheadGroup = new THREE.Group();
    this.group.add(this.overheadGroup);
    this.setMode(this.mode);
  }

  _wallX(midi) {
    return -WALL_WIDTH / 2 + (midi - this.pitchLo + 0.5) * this.semitoneW;
  }

  /** トラック色の再取得（楽器割当を変えた後に呼ぶ） */
  refreshColors() {
    for (const tr of this.engine.tracks) this.trackColors.set(tr, new THREE.Color(tr.color));
    for (const [tr, c] of this.columns) c.line.material.color.set(tr.color);
  }

  /**
   * 頭上モードの列位置を座席から作る（配置が変わるたびに呼ぶ）
   * @param {Array<{track, positions:[{x,y,z}]}>} seats  stage.layoutSeats() の戻り値
   */
  setSeats(seats) {
    for (const c of this.columns.values()) { this.overheadGroup.remove(c.line); c.line.geometry.dispose(); c.line.material.dispose(); }
    this.columns.clear();
    for (const seat of seats) {
      const ps = seat.positions;
      const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      const cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
      const spread = 2 * Math.max(...ps.map((p) => Math.hypot(p.x - cx, p.z - cz))); // 同トラックの奏者の広がり（格子対応）
      // 列幅 = 音域 × 半音幅（上限あり）は update で毎フレーム計算（半音幅がスライダーで変わるため）。線は幅 1 で作り scale.x で伸ばす
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.05),
        new THREE.MeshBasicMaterial({ color: seat.track.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      line.position.set(cx, ps[0].y + LAND_Y, cz);
      this.overheadGroup.add(line);
      this.columns.set(seat.track, { x: cx, y: ps[0].y + LAND_Y, z: cz, spread, width: 1, yaw: 0, quat: new THREE.Quaternion(), line });
    }
  }

  setMode(mode, showLine = true) {
    this.mode = mode;
    this.showLine = showLine;
    this.wallGroup.visible = mode === 'wall' && showLine;       // 壁モードの着弾ライン・オクターブ線
    this.overheadGroup.visible = mode === 'overhead' && showLine; // 頭上モードの着弾ライン
  }

  /**
   * @param {number} t 現在時刻 [s]
   * @param {number} speed 落下速度 [unit/s]
   * @param {object} opts { overheadHeight, semitoneW }（頭上モードの見える高さ・半音幅）
   */
  update(t, speed, opts = {}) {
    const overhead = this.mode === 'overhead';
    const overheadH = Number.isFinite(opts.overheadHeight) ? opts.overheadHeight : DEFAULT_OVERHEAD_HEIGHT;
    const semitoneW = Number.isFinite(opts.semitoneW) ? opts.semitoneW : DEFAULT_SEMITONE_W;
    const visibleH = overhead ? overheadH : WALL_HEIGHT;
    const lookahead = visibleH / speed;   // 上端に見える未来 [s]
    const tailSec = 0.5;                  // 着弾後も少しだけ残す
    const notes = this.notes;
    const mesh = this.mesh;
    const zeroM = this._m.identity().scale(this._scl.set(0, 0, 0));

    // 前フレームで表示していたものを一旦消す（表示範囲外になったものを確実に隠す）
    const halo = this.haloMesh, glow = this.glow;
    halo.visible = glow > 0;
    for (const i of this._lastVisible) { mesh.setMatrixAt(i, zeroM); halo.setMatrixAt(i, zeroM); }
    this._lastVisible.clear();

    // 頭上モード：列ごとにカメラの方位へ向ける（円筒ビルボード）。着弾ラインも同じ向き
    if (overhead) {
      const cam = this.camera.position;
      for (const [tr, c] of this.columns) {
        const range = tr.maxPitch - tr.minPitch + 1;
        c.width = Math.min(range * semitoneW, c.spread + COLUMN_EXTRA_MAX);
        c.line.scale.x = c.width;
        c.yaw = Math.atan2(cam.x - c.x, cam.z - c.z);
        c.quat.setFromAxisAngle(this._yAxis, c.yaw);
        c.line.quaternion.copy(c.quat);
      }
    }

    // 表示対象：end > t - tail かつ time < t + lookahead。time 昇順なので二分探索で開始点を探す
    let lo = 0, hi = notes.length;
    const tMin = t - tailSec - this.maxDurAll;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].time < tMin) lo = mid + 1; else hi = mid; }

    for (let i = lo; i < notes.length; i++) {
      const n = notes[i];
      if (n.time > t + lookahead) break;
      if (n.end < t - tailSec) continue;

      let baseY, x, z, w, quat;
      if (overhead) {
        const c = this.columns.get(n.track);
        if (!c) continue;
        const tr = n.track;
        const range = tr.maxPitch - tr.minPitch + 1;
        const semi = c.width / range; // 通常は SEMITONE_W。列幅上限に当たった時だけ詰まる
        w = semi * 0.9;
        const localX = -c.width / 2 + (n.midi - tr.minPitch + 0.5) * semi; // 列の中で音程を横に展開
        // 列のビルボード回転（yaw）に合わせて横オフセットを世界座標へ（y 回転で x→(cos, 0, -sin)）
        x = c.x + Math.cos(c.yaw) * localX;
        z = c.z - Math.sin(c.yaw) * localX;
        baseY = c.y;
        quat = c.quat;
      } else {
        x = this._wallX(n.midi); z = WALL_Z; baseY = WALL_BASE_Y;
        w = this.semitoneW * 0.85;
        quat = this._identityQ;
      }

      const yBottom = baseY + (n.time - t) * speed;
      const h = n.duration * speed;
      // 着弾ライン以下は切り詰める（過去部分は描かない＝発音中は消費されて縮む）
      const clipBottom = Math.max(yBottom, baseY);
      const clipTop = Math.min(yBottom + h, baseY + visibleH);
      if (clipTop <= clipBottom) continue;

      this._pos.set(x, clipBottom, z);
      this._scl.set(w, clipTop - clipBottom, 1);
      this._m.compose(this._pos, quat, this._scl);
      mesh.setMatrixAt(i, this._m);
      if (glow > 0) { // 光の板：ノートの幅 × 1.5 × グロー分だけ四方に広げる
        const pad = w * 1.5 * glow;
        this._pos.set(x, clipBottom - pad, z);
        this._scl.set(w + 2 * pad, clipTop - clipBottom + 2 * pad, 1);
        this._m.compose(this._pos, quat, this._scl);
        halo.setMatrixAt(i, this._m);
      }

      // 色：未来 = トラック色、発音中 = 明るく、直後 = 白フラッシュ
      const c = this._color.copy(this.trackColors.get(n.track));
      if (t >= n.time && t < n.end) {
        const flash = t - n.time < FLASH_SEC ? 1 : 0;
        c.lerp(this._white, 0.15 + 0.7 * flash); // 発音中はやや明るく、着弾直後だけ白く
      } else if (t < n.time) {
        c.multiplyScalar(0.55 + 0.45 * n.velocity);
      }
      mesh.setColorAt(i, c);
      if (glow > 0) halo.setColorAt(i, c);
      this._lastVisible.add(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (glow > 0) { halo.instanceMatrix.needsUpdate = true; if (halo.instanceColor) halo.instanceColor.needsUpdate = true; }
  }

  setVisible(v) { this.group.visible = v; }
  setOpacity(v) { this.mesh.material.opacity = Math.max(0, Math.min(1, v)); }
  /** グローの強さ（0 で無し。1 で幅の 1.5 倍の広がり・不透明度 0.5、2 で広がり 3 倍・0.75） */
  setGlow(g) { this.glow = Math.max(0, g); this.haloMesh.material.opacity = Math.min(1, 0.5 * Math.min(this.glow, 1) + 0.25 * Math.max(0, this.glow - 1)); }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
