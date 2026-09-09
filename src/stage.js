/*
 * PixelOrchestra — stage.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * シーン・カメラ・OrbitControls・ステージ（床・ひな壇・指揮台）と、
 * トラック → 座席位置（扇形配置）の計算。
 */

// 列の定義：r=指揮者からの半径（そのセクションの最前列）、h=ひな壇の高さ、span=列が占める角度幅 [deg]
// 弦は 3 列（r 〜 r+2×ROW_GAP ≒ 8〜11.8）に広がるので、木管以降のひな壇（内径 r-2）はその外側に置く
export const ROWS = {
  strings:    { r: 8,    h: 0,    span: 150 },   // 弦 4 パート × 3 列 = 12 列分の弧が必要（r=8, 150° で弧長 ≒ 21）
  woodwind:   { r: 15,   h: 1.0,  span: 90 },
  brass:      { r: 19,   h: 2.0,  span: 100 },
  percussion: { r: 23,   h: 3.0,  span: 110 },
  // コントラバス（右）と鍵盤群（左：ハープ/ピアノ/チェレスタ/シロフォン/マリンバ）は、木管の扇のすぐ外側に隣接して床に立つ
  // （ひな壇なし・真ん中寄せ。2026-09-09 ユーザー指定）
  contrabass: { r: 13.5, h: 0,    span: 0, beside: 'woodwind', side: +1, fallbackDeg: 40 },
  // 鍵盤群は数が多いと奥行きに並べる：鍵盤打楽器（シロフォン/マリンバ）は手前、ハープ/チェレスタ/ピアノは奥
  keyboard:   { r: 13.5, h: 0,    span: 0, beside: 'woodwind', side: -1, fallbackDeg: -40,
                depthOf: (v) => (v === 'xylophone' || v === 'marimba' ? 0 : 1) },
};
// 楽器ごとの人数（横 cols × 奥行き rows）。実際のオーケストラの人数感（2026-09-09 ユーザー指定：1st Vn = 3×3）
// 未指定は 1 人
export const SECTION_SIZE = {
  violin: { cols: 3, rows: 3 }, viola: { cols: 3, rows: 2 }, cello: { cols: 3, rows: 2 }, contrabass: { cols: 2, rows: 2 },
  flute: { cols: 2, rows: 1 }, oboe: { cols: 2, rows: 1 }, clarinet: { cols: 2, rows: 1 }, bassoon: { cols: 2, rows: 1 },
  horn: { cols: 2, rows: 2 }, trumpet: { cols: 3, rows: 1 }, trombone: { cols: 3, rows: 1 }, tuba: { cols: 1, rows: 1 },
};
const ROW_GAP = 1.9;      // 同セクション内の列（奥行き）間隔 [unit]
// トラックの人数。名前に solo を含むトラックは楽器に関わらず 1 人（Violin solo / Cello solo 等。2026-09-09 ユーザー指定）
function sizeOf(track) {
  if (/solo/i.test(track.name)) return { cols: 1, rows: 1 }; // "_CS" 等が続くと \b が効かないので単純一致
  return { ...(SECTION_SIZE[track.variant] || { cols: 1, rows: 1 }) };
}
// 列内の並び順を楽器で固定するファミリー（無指定は平均音程の高い順＝左から右）
// 金管：ホルンを左、トランペットをその右（2026-09-09 ユーザー指定で入れ替え）
const VARIANT_ORDER = { brass: ['horn', 'trumpet', 'trombone', 'tuba'] };

// トラックがどの列に座るか（ファミリーと別扱いの楽器はここで振り分ける）
function rowKeyOf(track) {
  if (track.variant === 'contrabass') return 'contrabass';
  if (track.variant === 'xylophone' || track.variant === 'marimba') return 'keyboard'; // 鍵盤打楽器は左の鍵盤群へ
  return track.family;
}
const PUPPET_GAP = 1.7;   // 同一トラック内の奏者間隔（横）[unit]（奏者の幅 ≒ 1.2）

export const CONDUCTOR_Z = -3.2; // 指揮台の z（弦の最前列 z=-8 に寄せる。+z = 客席側。指揮台の奥行き 2.2 分だけ奥へ：2026-09-09）
export const FLOOR_RADIUS = 20;  // ステージ円の半径
export const FLOOR_CENTER_Z = -10; // ステージ円の中心 z（楽団の重心付近）
export const FLOOR_DEPTH_SCALE = 0.8; // 奥行き方向の縮小率（楕円）
export const WALL_Z = -30;      // ピアノロール壁の z
export const WALL_WIDTH = 56;
export const WALL_HEIGHT = 14;
export const WALL_BASE_Y = 3.2; // 着弾ライン（後列ひな壇の少し上）

const deg = (d) => (d * Math.PI) / 180;
const RISER_HALF = 2;        // ひな壇の帯の半幅 [unit]（内径 r-2 〜 外径 r+2）
const RISER_MARGIN = deg(7); // 座席の両端に足す余白角
let stageCtx = null;         // createStage() で設定（buildRisers から使う）

export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b16');
  scene.fog = new THREE.Fog('#0b0b16', 55, 110);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 22, 34);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3, -12);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 90;
  controls.minPolarAngle = deg(12);
  controls.maxPolarAngle = deg(82);
  controls.minAzimuthAngle = deg(-75);  // 裏側には回れない（紙の板が薄く見えるため）
  controls.maxAzimuthAngle = deg(75);
  controls.update();

  // 床・ひな壇・指揮台は「深度を書かない」（depthWrite:false, 先に描く）。
  // 理由：奏者の板は足元を軸にカメラへ正対するため、見下ろすと板の上半分が後方へ倒れ込み、
  // 後列の（高い）ひな壇に深度で隠される。正当な視点でひな壇が奏者を隠すことは無いので、
  // 舞台側を深度判定から外し、奏者同士・ロールとの前後関係だけを深度で決める（2026-09-09）。
  const STAGE_ORDER = -10;
  const stageMat = (opts) => new THREE.MeshBasicMaterial({ ...opts, depthWrite: false });
  const addStage = (mesh) => { mesh.renderOrder = STAGE_ORDER; scene.add(mesh); return mesh; };

  // 床：ドット風の板目テクスチャ
  const floorTex = plankTexture();
  // 楽団がちょうど収まるコンパクトな円（中心を後方へずらし、指揮者の前に余白を残さない）
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 64), stageMat({ map: floorTex, color: '#8a7a6a' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = FLOOR_CENTER_Z;
  floor.scale.y = FLOOR_DEPTH_SCALE; // 奥行き方向を少し潰して指揮者の前の余白を減らす（平面の local y = 世界 -z）
  addStage(floor);

  // ひな壇は座席が決まってから buildRisers() で作る（扇形：使われている角度だけ）
  const risers = new THREE.Group();
  scene.add(risers);
  stageCtx = { scene, floorTex, stageMat, addStage, risers };
  buildRisers([]);

  // 指揮台
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), stageMat({ color: '#3a2c22' }));
  podium.position.set(0, 0.15, CONDUCTOR_Z);
  addStage(podium);

  // ロール壁の背景板（暗い半透明で対比を作る）
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT),
    new THREE.MeshBasicMaterial({ color: '#141428', transparent: true, opacity: 0.85 }),
  );
  wall.position.set(0, WALL_BASE_Y + WALL_HEIGHT / 2, WALL_Z - 0.05);
  scene.add(wall);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { scene, camera, renderer, controls, resize, wall };
}

/**
 * ひな壇を扇形で作り直す。各段は「その段に座っている奏者の角度範囲 + 余白」だけを覆う。
 * 座席が無い段は列定義の span を使う。
 * @param {Array<{track, positions:[{x,y,z}]}>} seats  layoutSeats() の戻り値
 */
export function buildRisers(seats) {
  if (!stageCtx) return;
  const { floorTex, stageMat, risers } = stageCtx;
  risers.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  risers.clear();

  for (const fam of ['woodwind', 'brass', 'percussion']) {
    const row = ROWS[fam];
    if (row.h <= 0) continue;
    const rIn = row.r - RISER_HALF, rOut = row.r + RISER_HALF;
    // この段（高さ h・半径帯）に座っている奏者の角度範囲
    let thMin = Infinity, thMax = -Infinity;
    for (const seat of seats) for (const p of seat.positions) {
      const r = Math.hypot(p.x, p.z);
      if (Math.abs(p.y - row.h) > 0.01 || r < rIn - 0.5 || r > rOut + 0.5) continue;
      const th = Math.atan2(p.x, -p.z);
      thMin = Math.min(thMin, th); thMax = Math.max(thMax, th);
    }
    if (!Number.isFinite(thMin)) { thMin = -deg(row.span) / 2; thMax = deg(row.span) / 2; }
    // 左右対称にする（片側だけ広いと舞台らしくない）
    const half = Math.max(Math.abs(thMin), Math.abs(thMax)) + RISER_MARGIN;
    thMin = -half; thMax = half;
    const col = fam === 'percussion' ? '#5a4c40' : fam === 'brass' ? '#6a5a4c' : '#7a6a5a';
    const segs = Math.max(8, Math.ceil((thMax - thMin) / deg(4)));

    // 天面：RingGeometry の角 a と世界角 θ（-z から）は a = π/2 - θ（rotation.x = -π/2 のため）
    const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, segs, 1, Math.PI / 2 - thMax, thMax - thMin), stageMat({ map: floorTex, color: col }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = row.h;
    top.renderOrder = -10; risers.add(top);
    // 前面（内径側の壁）：CylinderGeometry の角 φ は φ = π - θ
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      stageMat({ color: '#2e2620', side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    front.renderOrder = -10; risers.add(front);
    // 両端の側面（扇の切り口）
    for (const th of [thMin, thMax]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(rOut - rIn, row.h), stageMat({ color: '#241d18', side: THREE.DoubleSide }));
      const rm = (rIn + rOut) / 2;
      side.position.set(rm * Math.sin(th), row.h / 2, -rm * Math.cos(th));
      side.rotation.y = -th + Math.PI / 2; // 面の法線を接線方向へ
      side.renderOrder = -10; risers.add(side);
    }
    // 段の縁（見切り線）：Torus は rotation.z で開始角を回す（Euler XYZ では z が先に掛かる）
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.05, 6, segs * 2, thMax - thMin), stageMat({ color: '#1a140f' }));
    rim.rotation.x = -Math.PI / 2; rim.rotation.z = Math.PI / 2 - thMax; rim.position.y = row.h + 0.01;
    rim.renderOrder = -10; risers.add(rim);
  }
}

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#b09070'; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = y % 16 ? '#a08060' : '#b89878';
    g.fillRect(0, y, 64, 7);
    g.fillStyle = '#7a5a40'; g.fillRect(0, y + 7, 64, 1);
    g.fillRect((y * 5) % 64, y, 1, 7);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

/**
 * トラック配列 → 座席位置リスト
 * @returns {Array<{track, positions:[{x,y,z}], puppets:number}>}
 */
export function layoutSeats(tracks) {
  const byFam = {};
  for (const tr of tracks) (byFam[rowKeyOf(tr)] ||= []).push(tr);
  const seats = [];
  const centerAngle = new Map(); // track → 列内の中心角（後ろに置く楽器の基準）

  // 「beside」指定の列は基準になる列（木管）の後で処理する
  const famKeys = Object.keys(byFam).sort((a, b) => (ROWS[a]?.beside ? 1 : 0) - (ROWS[b]?.beside ? 1 : 0));
  for (const fam of famKeys) {
    const row = ROWS[fam];
    if (!row) continue;
    // 高音を左（-x）、低音を右（+x）。楽器順が固定されたファミリーはその順
    const order = VARIANT_ORDER[fam];
    const list = byFam[fam].slice().sort((a, b) => {
      if (order) {
        const ia = order.indexOf(a.variant), ib = order.indexOf(b.variant);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      return b.meanPitch - a.meanPitch;
    });

    // 各トラックの人数（横×奥行き）。列の角度幅に収まらない時は横の人数を均等に減らす
    const sizes = list.map((tr) => sizeOf(tr));
    const span = deg(row.span);
    const angleOf = (cols) => (cols * PUPPET_GAP) / row.r; // 1トラックが占める角度 [rad]
    if (!row.beside && list.length > 1) {
      for (let guard = 0; guard < 8; guard++) { // 中断条件付き
        const total = sizes.reduce((a, s) => a + angleOf(s.cols), 0);
        if (total <= span + angleOf(1) || sizes.every((s) => s.cols <= 1)) break;
        for (const s of sizes) if (s.cols > 1) s.cols--;
      }
    }

    // 各トラックの中心角を決める（角度幅は人数に比例）
    let centers;
    if (row.beside) { // 基準列（木管）の扇のすぐ外側に隣接（side: +1 = 右、-1 = 左）
      const refThetas = seats.filter((st) => st.track.family === row.beside).flatMap((st) => st.positions.map((p) => Math.atan2(p.x, -p.z)));
      const edge = refThetas.length ? (row.side > 0 ? Math.max(...refThetas) : Math.min(...refThetas)) : deg(row.fallbackDeg);
      const gap = RISER_MARGIN + 0.9 / row.r; // 扇の余白 + 少し
      // 奥行きレベルごとに横並び（depthOf が無ければ全員同じレベル）。各レベルは同じ起点角から扇の外側へ並ぶ
      const levels = new Map();
      list.forEach((tr, i) => { const k = row.depthOf ? row.depthOf(tr.variant) : 0; (levels.get(k) || levels.set(k, []).get(k)).push(i); });
      for (const [k, idxs] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
        const total = idxs.reduce((a, i) => a + angleOf(sizes[i].cols), 0);
        let cursor = row.side > 0 ? edge + gap : edge - gap - total;
        const rowK = { r: row.r + k * ROW_GAP, h: row.h };
        for (const i of idxs) {
          const c = cursor + angleOf(sizes[i].cols) / 2; cursor += angleOf(sizes[i].cols);
          const tr = list[i];
          centerAngle.set(tr, c);
          // 角度間隔は最前列の半径基準（gridPositions は row.r を使う）。奥のレベルは半径だけ大きくする
          const positions = gridPositions({ r: row.r, h: row.h }, c, sizes[i].cols, sizes[i].rows).map((p) => {
            const th = Math.atan2(p.x, -p.z), r = Math.hypot(p.x, p.z) + k * ROW_GAP;
            return { x: r * Math.sin(th), y: rowK.h, z: -r * Math.cos(th), row: p.row + k };
          });
          seats.push({ track: tr, puppets: sizes[i].cols * sizes[i].rows, positions });
        }
      }
      continue;
    } else {
      const n = list.length;
      const total = sizes.reduce((a, s) => a + angleOf(s.cols), 0);
      const gap = n > 1 ? Math.max(0, Math.min((span - total) / (n - 1), angleOf(1) * 0.5)) : 0; // トラック間の余白
      let cursor = -(total + gap * (n - 1)) / 2;
      centers = sizes.map((s) => { const c = cursor + angleOf(s.cols) / 2; cursor += angleOf(s.cols) + gap; return c; });
    }

    list.forEach((tr, i) => {
      const { cols, rows } = sizes[i];
      const center = centers[i];
      centerAngle.set(tr, center);
      seats.push({ track: tr, puppets: cols * rows, positions: gridPositions(row, center, cols, rows) });
    });
  }
  return seats;
}

// 中心角 center を軸に cols × rows の格子で座らせる。奥の列ほど半径が大きい。偶数列は半人分ずらす（重なり防止・自然な見た目）
function gridPositions(row, center, cols, rows) {
  const positions = [];
  for (let k = 0; k < rows; k++) {
    const r = row.r + k * ROW_GAP;
    const stagger = (k % 2) * 0.5;
    for (let j = 0; j < cols; j++) {
      const th = center + (j - (cols - 1) / 2 + stagger) * (PUPPET_GAP / row.r);
      positions.push({ x: r * Math.sin(th), y: row.h, z: -r * Math.cos(th), row: k });
    }
  }
  return positions;
}

// 角度 0 = 指揮者の真後ろ（-z 方向）。x = r sinθ, z = -r cosθ
function seatPos(row, th) {
  return { x: row.r * Math.sin(th), y: row.h, z: -row.r * Math.cos(th) };
}
