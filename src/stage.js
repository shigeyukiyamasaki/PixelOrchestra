/*
 * PixelOrchestra — stage.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * シーン・カメラ・OrbitControls・ステージ（床・ひな壇・指揮台）と、
 * トラック → 座席位置（扇形配置）の計算。
 */

// 列の定義：r=指揮者からの半径、h=ひな壇の高さ、puppets=1トラックあたりの人数
export const ROWS = {
  strings:    { r: 7,    h: 0,    puppets: 3, span: 140 },
  woodwind:   { r: 11,   h: 1.0,  puppets: 1, span: 90 },
  brass:      { r: 15,   h: 2.0,  puppets: 1, span: 100 },
  percussion: { r: 19,   h: 3.0,  puppets: 1, span: 110 },
  keyboard:   { r: 13.5, h: 2.0,  puppets: 1, span: 0, edge: true }, // 金管ひな壇の両端（コントラバスと重ならない距離）
  // コントラバスは弦の列より一段後ろ（木管ひな壇の手前縁）、チェロの真後ろ（2026-09-09 ユーザー指定）
  contrabass: { r: 10.5, h: 1.0,  puppets: 2, span: 0, behind: 'cello', fallbackDeg: 55 },
};
// 列内の並び順を楽器で固定するファミリー（無指定は平均音程の高い順＝左から右）
// 金管：ホルンを左、トランペットをその右（2026-09-09 ユーザー指定で入れ替え）
const VARIANT_ORDER = { brass: ['horn', 'trumpet', 'trombone', 'tuba'] };

// トラックがどの列に座るか（ファミリーと別扱いの楽器はここで振り分ける）
function rowKeyOf(track) {
  return track.variant === 'contrabass' ? 'contrabass' : track.family;
}
const PUPPET_GAP = 2.1;   // 同一トラック内の奏者間隔 [unit]
const KEYBOARD_ANGLE = 72; // 鍵盤/ハープを置く角度 [deg]（左右交互）

export const WALL_Z = -23;      // ピアノロール壁の z
export const WALL_WIDTH = 44;
export const WALL_HEIGHT = 14;
export const WALL_BASE_Y = 3.2; // 着弾ライン（後列ひな壇の少し上）

const deg = (d) => (d * Math.PI) / 180;

export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b16');
  scene.fog = new THREE.Fog('#0b0b16', 40, 80);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 15, 24);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2.5, -9);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 60;
  controls.minPolarAngle = deg(12);
  controls.maxPolarAngle = deg(82);
  controls.minAzimuthAngle = deg(-75);  // 裏側には回れない（紙の板が薄く見えるため）
  controls.maxAzimuthAngle = deg(75);
  controls.update();

  // 床：ドット風の板目テクスチャ
  const floorTex = plankTexture();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshBasicMaterial({ map: floorTex, color: '#8a7a6a' }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ひな壇（後列ほど高い半円のリング。前列を覆わないよう内径 r-2 〜 外径 r+2 の帯にする）
  const RISER_HALF = 2;
  for (const fam of ['woodwind', 'brass', 'percussion']) {
    const row = ROWS[fam];
    if (row.h <= 0) continue;
    const rIn = row.r - RISER_HALF, rOut = row.r + RISER_HALF;
    const col = fam === 'percussion' ? '#5a4c40' : fam === 'brass' ? '#6a5a4c' : '#7a6a5a';
    const top = new THREE.Mesh(
      new THREE.RingGeometry(rIn, rOut, 48, 1, 0, Math.PI),
      new THREE.MeshBasicMaterial({ map: floorTex, color: col }),
    );
    top.rotation.x = -Math.PI / 2;   // (cos a, sin a, 0) → (cos a, 0, -sin a)：a∈[0,π] で z≤0 = 後方
    top.position.y = row.h;
    scene.add(top);
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, 48, 1, true, Math.PI / 2, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#2e2620', side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    scene.add(front);
    // 段の縁（見切り線）
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rIn, 0.05, 6, 64, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#1a140f' }),
    );
    rim.rotation.x = -Math.PI / 2; rim.position.y = row.h + 0.01;
    scene.add(rim);
  }

  // 指揮台
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), new THREE.MeshBasicMaterial({ color: '#3a2c22' }));
  podium.position.set(0, 0.15, 2);
  scene.add(podium);

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

    if (row.behind) { // 基準楽器（チェロ）の真後ろに並べる。無ければ既定角
      const ref = tracks.filter((t) => t.variant === row.behind && centerAngle.has(t));
      const base = ref.length ? ref.reduce((a, t) => a + centerAngle.get(t), 0) / ref.length : deg(row.fallbackDeg);
      const puppets = row.puppets;
      const slot = (puppets * PUPPET_GAP) / row.r;
      const start = base - slot * (list.length - 1) / 2;
      list.forEach((tr, i) => {
        const center = start + slot * i;
        const positions = [];
        for (let k = 0; k < puppets; k++) positions.push(seatPos(row, center + (k - (puppets - 1) / 2) * (PUPPET_GAP / row.r)));
        seats.push({ track: tr, puppets, positions });
      });
      continue;
    }

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

    const n = list.length;
    let puppets = row.puppets;
    if (n >= 6) puppets = 1; else if (n >= 4 && puppets > 2) puppets = 2;
    const slotAngle = (puppets * PUPPET_GAP) / row.r; // 1トラックが占める角度 [rad]
    const span = deg(row.span);
    const step = n > 1 ? Math.min(span / (n - 1), slotAngle * 1.25) : 0;
    const start = -step * (n - 1) / 2;
    list.forEach((tr, i) => {
      const center = start + step * i;
      centerAngle.set(tr, center);
      const positions = [];
      for (let k = 0; k < puppets; k++) {
        const th = center + (k - (puppets - 1) / 2) * (PUPPET_GAP / row.r);
        positions.push(seatPos(row, th));
      }
      seats.push({ track: tr, puppets, positions });
    });
  }
  return seats;
}

// 角度 0 = 指揮者の真後ろ（-z 方向）。x = r sinθ, z = -r cosθ
function seatPos(row, th) {
  return { x: row.r * Math.sin(th), y: row.h, z: -row.r * Math.cos(th) };
}
