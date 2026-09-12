/*
 * PixelOrchestra — spectrum.js
 * 最終更新: 2026-09-12 / v0.1 / 生成元: PixelOrchestra
 *
 * 音声のスペクトラム（タイトルのロゴの周りに円形のバー）。MIDIOrchestra の実装を参考に移植（2026-09-12 ユーザー指定）。
 *   - AnalyserNode で周波数を取り、対数（50Hz〜8kHz）で本数分に均す。高域はエネルギーが小さいのでブーストする
 *   - バーは加算合成の板。中心から外へ伸ばす（ロゴと同じ面＝xy 平面に円を作る）
 *   - 音声が未読み込みでも落ちない（データが無ければ最小の目盛だけ出す）
 */

const MIN_FREQ = 50, MAX_FREQ = 8000;

/** バーの見た目：中心が明るく端へ向かって消える帯（加算合成で光らせる） */
function glowTexture() {
  const W = 128, H = 4;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const t = (x - (W - 1) / 2) / ((W - 1) / 2);
    const core = Math.exp(-t * t * 80), glow = Math.exp(-t * t * 5);
    const a = Math.min(1, core + glow * 0.5), w = Math.min(255, core * 255 + glow * 80);
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = w;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Spectrum {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.tex = glowTexture();
    this.ctx = null; this.analyser = null; this.source = null; this.data = null;
    this.prev = null;
    this.bars = 0;
    this.opts = { bars: 64, radius: 4, height: 2.5, opacity: 0.9, color: '#9fd8ff', width: 1, taper: 1, mode: 'circle' };
    this.shape = null; this.shapeSpan = 0;
  }

  /** 音声要素をつなぐ（1 つの要素につき 1 回だけ。再生の操作の中で呼ぶ：自動再生の制限のため） */
  connect(audioEl) {
    if (this.source) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.4;
      this.analyser.minDecibels = -70;
      this.analyser.maxDecibels = -10;
      this.source = this.ctx.createMediaElementSource(audioEl);
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // ここを通さないと音が出なくなる
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (e) {
      console.warn('スペクトラムの音声接続に失敗:', e);
      this.ctx = null; this.analyser = null; this.source = null;
    }
  }

  /**
   * バーを並べる形を「ロゴの輪郭」にする（2026-09-12 ユーザー指定：円ではなくロゴから線が出ているように）。
   * data = tools/img2voxel.py が出力したドットデータ。ロゴの外側に接するセルを拾い、外向きの法線を求めて等間隔に並べる。
   * 座標はロゴのローカル（pivot = 底辺中央）に合わせる：x = (px - W/2 + 0.5) * cell, y = (H - py - 0.5) * cell
   */
  setShape(data, cell) {
    const rows = data.rows, W = rows[0].length, H = rows.length;
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rows[y][x] !== '.';
    // 外側（縁から本体に遮られずに届く空白）を塗る
    const out = new Uint8Array(W * H);
    const stack = [[0, 0]];
    out[0] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (out[ny * W + nx] || solid(nx, ny)) continue;
        out[ny * W + nx] = 1; stack.push([nx, ny]);
      }
    }
    // 外側に接する本体セル＝輪郭。外向きの法線は「空いている方向」の平均
    let pts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      let nx = 0, ny = 0, touch = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ax = x + dx, ay = y + dy;
        const outside = ax < 0 || ay < 0 || ax >= W || ay >= H || (!solid(ax, ay) && out[ay * W + ax]);
        if (outside) { nx += dx; ny -= dy; touch++; } // 画像の y は下向き、3D は上向き
      }
      if (!touch) continue;
      const len = Math.hypot(nx, ny) || 1;
      pts.push({ x: (x - W / 2 + 0.5) * cell, y: (H - y - 0.5) * cell, nx: nx / len, ny: ny / len });
    }
    // 向きはロゴの輪郭の法線ではなく「ロゴの中心から外へ」に統一する（2026-09-12 ユーザー指定：方向がバラバラに見えるため）。
    // 並びも中心から見た角度順にして、輪郭を一周する形にする
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length || 1; cy /= pts.length || 1;
    for (const p of pts) {
      const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
      p.nx = dx / len; p.ny = dy / len;
      p.a = Math.atan2(dy, dx);
    }
    pts.sort((a, b) => a.a - b.a);
    // 同じ方向に複数の輪郭点があると重なるので、角度で間引いて一番外側だけ残す
    const keep = [];
    for (const p of pts) {
      const last = keep[keep.length - 1];
      if (last && Math.abs(p.a - last.a) < 0.004) {
        if (Math.hypot(p.x - cx, p.y - cy) > Math.hypot(last.x - cx, last.y - cy)) keep[keep.length - 1] = p;
        continue;
      }
      keep.push(p);
    }
    pts = keep;
    this.shape = pts;
    this.shapeSpan = pts.length * cell; // 輪郭のおおよその長さ（セル 1 つ分ずつ）
    this._build();
  }

  setOptions(o) {
    const prev = { ...this.opts };
    Object.assign(this.opts, o);
    if (this.bars !== this.opts.bars || prev.bars !== this.opts.bars || prev.mode !== this.opts.mode
        || prev.width !== this.opts.width || prev.taper !== this.opts.taper) this._build();
    const col = new THREE.Color(this.opts.color);
    this.group.traverse((m) => { if (m.isMesh) { m.material.opacity = this.opts.opacity; m.material.color.copy(col); } });
  }

  _build() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
    }
    const useShape = this.opts.mode === 'logo' && this.shape && this.shape.length;
    const n = Math.max(8, Math.round(this.opts.bars));
    this.bars = n;
    this.prev = new Float32Array(n);
    // 板の幅：円は円周を本数で割った値、ロゴに沿う時は輪郭の長さから見積もる
    const base = useShape ? (this.shapeSpan || 1) / n : (2 * Math.PI * this.opts.radius / n);
    const w = base * 0.8 * this.opts.width;
    const mat = () => new THREE.MeshBasicMaterial({
      map: this.tex, color: new THREE.Color(this.opts.color), transparent: true, opacity: this.opts.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < n; i++) {
      const pivot = new THREE.Group();
      if (useShape) { // 輪郭を等間隔にたどって、外向きに立てる
        const p = this.shape[Math.floor(i * this.shape.length / n)];
        pivot.position.set(p.x, p.y, 0);
        pivot.rotation.z = Math.atan2(p.ny, p.nx) - Math.PI / 2; // 板の +y を法線へ
      } else {
        pivot.rotation.z = -(i / n) * Math.PI * 2; // ロゴと同じ面（xy）に円を作る
      }
      const bar = new THREE.Mesh(this._barGeometry(w), mat()); // 幅 w・長さ 1 の板。長さは scale.y で伸ばす
      pivot.add(bar);
      this.group.add(pivot);
    }
  }

  /** 根本（内側）が太く先端が細い板。taper = 1 で均一、大きいほど根本が太い（2026-09-12 ユーザー指定） */
  _barGeometry(w) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const pos = geo.attributes.position;
    const root = w * (this.opts.taper ?? 1) / 2, tip = w / 2;
    for (let i = 0; i < pos.count; i++) {
      const half = pos.getY(i) < 0 ? root : tip; // ローカル -y が根本（ロゴ側）
      pos.setX(i, Math.sign(pos.getX(i)) * half);
    }
    pos.needsUpdate = true;
    return geo;
  }

  setVisible(v) { this.group.visible = v; }
  /** ロゴに合わせて置く（位置はロゴの中心、大きさはロゴの倍率） */
  setTransform(pos, scale) { this.group.position.copy(pos); this.group.scale.setScalar(scale); }

  update() {
    if (!this.group.visible) return;
    const n = this.bars;
    if (!n) return;
    const { radius, height } = this.opts;
    const minTick = 0; // 音が鳴っていない時は消える（2026-09-12 ユーザー指定）
    if (this.analyser && this.data) {
      this.analyser.getByteFrequencyData(this.data);
      const binCount = this.analyser.frequencyBinCount;
      const perBin = this.ctx.sampleRate / this.analyser.fftSize;
      for (let i = 0; i < n; i++) {
        const f0 = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / n);
        const f1 = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 1) / n);
        const b0 = Math.max(0, Math.floor(f0 / perBin)), b1 = Math.min(binCount - 1, Math.ceil(f1 / perBin));
        let sum = 0, cnt = 0;
        for (let b = b0; b <= b1; b++) { sum += this.data[b]; cnt++; }
        let raw = cnt ? (sum / cnt) / 255 : 0;
        const r = i / n;
        raw = Math.min(raw * (1 + r * r * 4), 1);           // 高域ブースト
        this.prev[i] = this.prev[i] * 0.35 + raw * 0.65;    // なめらかに
      }
    } else {
      for (let i = 0; i < n; i++) this.prev[i] *= 0.9;
    }
    const useShape = this.opts.mode === 'logo' && this.shape && this.shape.length;
    for (let i = 0; i < n; i++) {
      const bar = this.group.children[i].children[0];
      const h = Math.max(minTick, this.prev[i] * height);
      bar.scale.y = h;
      bar.position.y = (useShape ? 0 : radius) + h / 2; // ロゴに沿う時は輪郭から直に伸ばす
    }
  }
}
