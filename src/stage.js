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
  keyboard:   { r: 19,   h: 2.0,  span: 0, edge: true }, // 金管ひな壇の両端
  // コントラバスは弦の後ろ（木管ひな壇の手前縁）、チェロの真後ろ（2026-09-09 ユーザー指定）
  contrabass: { r: 14,   h: 1.0,  span: 0, behind: 'cello', fallbackDeg: 55 },
};
// 楽器ごとの人数（横 cols × 奥行き rows）。実際のオーケストラの人数感（2026-09-09 ユーザー指定：1st Vn = 3×3）
// 未指定は 1 人
export const SECTION_SIZE = {
  violin: { cols: 3, rows: 3 }, viola: { cols: 3, rows: 2 }, cello: { cols: 3, rows: 2 }, contrabass: { cols: 2, rows: 2 },
  flute: { cols: 2, rows: 1 }, oboe: { cols: 2, rows: 1 }, clarinet: { cols: 2, rows: 1 }, bassoon: { cols: 2, rows: 1 },
  horn: { cols: 2, rows: 2 }, trumpet: { cols: 3, rows: 1 }, trombone: { cols: 3, rows: 1 }, tuba: { cols: 1, rows: 1 },
};
const ROW_GAP = 1.9;      // 同セクション内の列（奥行き）間隔 [unit]
// 列内の並び順を楽器で固定するファミリー（無指定は平均音程の高い順＝左から右）
// 金管：ホルンを左、トランペットをその右（2026-09-09 ユーザー指定で入れ替え）
const VARIANT_ORDER = { brass: ['horn', 'trumpet', 'trombone', 'tuba'] };

// トラックがどの列に座るか（ファミリーと別扱いの楽器はここで振り分ける）
function rowKeyOf(track) {
  return track.variant === 'contrabass' ? 'contrabass' : track.family;
}
const PUPPET_GAP = 1.7;   // 同一トラック内の奏者間隔（横）[unit]（奏者の幅 ≒ 1.2）
const KEYBOARD_ANGLE = 72; // 鍵盤/ハープを置く角度 [deg]（左右交互）

export const WALL_Z = -30;      // ピアノロール壁の z
export const WALL_WIDTH = 56;
export const WALL_HEIGHT = 14;
export const WALL_BASE_Y = 3.2; // 着弾ライン（後列ひな壇の少し上）

const deg = (d) => (d * Math.PI) / 180;

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
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), stageMat({ map: floorTex, color: '#8a7a6a' }));
  floor.rotation.x = -Math.PI / 2;
  addStage(floor);

  // ひな壇（後列ほど高い半円のリング。前列を覆わないよう内径 r-2 〜 外径 r+2 の帯にする）
  const RISER_HALF = 2;
  for (const fam of ['woodwind', 'brass', 'percussion']) {
    const row = ROWS[fam];
    if (row.h <= 0) continue;
    const rIn = row.r - RISER_HALF, rOut = row.r + RISER_HALF;
    const col = fam === 'percussion' ? '#5a4c40' : fam === 'brass' ? '#6a5a4c' : '#7a6a5a';
    const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 48, 1, 0, Math.PI), stageMat({ map: floorTex, color: col }));
    top.rotation.x = -Math.PI / 2;   // (cos a, sin a, 0) → (cos a, 0, -sin a)：a∈[0,π] で z≤0 = 後方
    top.position.y = row.h;
    addStage(top);
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, 48, 1, true, Math.PI / 2, Math.PI),
      stageMat({ color: '#2e2620', side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    addStage(front);
    // 段の縁（見切り線）
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.05, 6, 64, Math.PI), stageMat({ color: '#1a140f' }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = row.h + 0.01;
    addStage(rim);
  }

  // 指揮台
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), stageMat({ color: '#3a2c22' }));
  podium.position.set(0, 0.15, 2);
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
  let kbCount = 0;
  const centerAngle = new Map(); // track → 列内の中心角（後ろに置く楽器の基準）

  // 「behind」指定の列は基準になる列の後で処理する
  const famKeys = Object.keys(byFam).sort((a, b) => (ROWS[a]?.behind ? 1 : 0) - (ROWS[b]?.behind ? 1 : 0));
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

    if (row.edge) { // 鍵盤/ハープは両端に交互配置
      for (const tr of list) {
        const side = kbCount % 2 ? 1 : -1;
        const extra = Math.floor(kbCount / 2) * 6; // 3人目以降は角度を内側へ
        const th = deg(side * (KEYBOARD_ANGLE - extra));
        seats.push({ track: tr, puppets: 1, positions: [seatPos(row, th)] });
        kbCount++;
      }
      continue;
    }

    // 各トラックの人数（横×奥行き）。列の角度幅に収まらない時は横の人数を均等に減らす
    const sizes = list.map((tr) => ({ ...(SECTION_SIZE[tr.variant] || { cols: 1, rows: 1 }) }));
    const span = deg(row.span);
    const angleOf = (cols) => (cols * PUPPET_GAP) / row.r; // 1トラックが占める角度 [rad]
    if (!row.behind && list.length > 1) {
      for (let guard = 0; guard < 8; guard++) { // 中断条件付き
        const total = sizes.reduce((a, s) => a + angleOf(s.cols), 0);
        if (total <= span + angleOf(1) || sizes.every((s) => s.cols <= 1)) break;
        for (const s of sizes) if (s.cols > 1) s.cols--;
      }
    }

    // 各トラックの中心角を決める（角度幅は人数に比例）
    let centers;
    if (row.behind) { // 基準楽器（チェロ）の真後ろに並べる。無ければ既定角
      const ref = tracks.filter((t) => t.variant === row.behind && centerAngle.has(t));
      const base = ref.length ? ref.reduce((a, t) => a + centerAngle.get(t), 0) / ref.length : deg(row.fallbackDeg);
      const total = sizes.reduce((a, s) => a + angleOf(s.cols), 0);
      let cursor = base - total / 2;
      centers = sizes.map((s) => { const c = cursor + angleOf(s.cols) / 2; cursor += angleOf(s.cols); return c; });
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
      positions.push({ x: r * Math.sin(th), y: row.h, z: -r * Math.cos(th) });
    }
  }
  return positions;
}

// 角度 0 = 指揮者の真後ろ（-z 方向）。x = r sinθ, z = -r cosθ
function seatPos(row, th) {
  return { x: row.r * Math.sin(th), y: row.h, z: -row.r * Math.cos(th) };
}
