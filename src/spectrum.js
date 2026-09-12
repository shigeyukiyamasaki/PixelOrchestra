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
    this.opts = { bars: 64, radius: 4, height: 2.5, opacity: 0.9, color: '#9fd8ff', width: 1 };
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

  setOptions(o) {
    const prevBars = this.opts.bars;
    Object.assign(this.opts, o);
    if (this.bars !== this.opts.bars || prevBars !== this.opts.bars) this._build();
    const col = new THREE.Color(this.opts.color);
    this.group.traverse((m) => { if (m.isMesh) { m.material.opacity = this.opts.opacity; m.material.color.copy(col); } });
  }

  _build() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
    }
    const n = Math.max(8, Math.round(this.opts.bars));
    this.bars = n;
    this.prev = new Float32Array(n);
    const w = (2 * Math.PI * this.opts.radius / n) * 0.8 * this.opts.width;
    for (let i = 0; i < n; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = -(i / n) * Math.PI * 2; // ロゴと同じ面（xy）に円を作る
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex, color: new THREE.Color(this.opts.color), transparent: true, opacity: this.opts.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), mat); // 幅 w・長さ 1 の板。長さは scale.y で伸ばす
      pivot.add(bar);
      this.group.add(pivot);
    }
  }

  setVisible(v) { this.group.visible = v; }
  /** ロゴに合わせて置く（位置はロゴの中心、大きさはロゴの倍率） */
  setTransform(pos, scale) { this.group.position.copy(pos); this.group.scale.setScalar(scale); }

  update() {
    if (!this.group.visible) return;
    const n = this.bars;
    if (!n) return;
    const { radius, height } = this.opts;
    const minTick = 0.12; // 無音でも輪郭が分かる程度の目盛
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
    for (let i = 0; i < n; i++) {
      const bar = this.group.children[i].children[0];
      const h = Math.max(minTick, this.prev[i] * height);
      bar.scale.y = h;
      bar.position.y = radius + h / 2;
    }
  }
}
