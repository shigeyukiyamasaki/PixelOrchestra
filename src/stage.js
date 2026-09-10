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
  // 鍵盤群は数が多いと奥行き 3 段に並べる（2026-09-10 ユーザー指定）：鍵盤打楽器（シロフォン/マリンバ）→ ハープ/チェレスタ → ピアノ。
  // 使われている段だけ手前から詰める。3 段目は金管の扇に隣接（角度は金管の端、半径は金管とほぼ同じ）。楽器が大きいので段の間隔は広め
  keyboard:   { r: 13.5, h: 0,    span: 0, beside: 'woodwind', side: -1, fallbackDeg: -40, levelGap: 3.0,
                depthOf: (v) => (v === 'xylophone' || v === 'marimba' ? 0 : v === 'piano' ? 2 : 1), besideAt: { 2: 'brass' } },
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
  scene.background = null; // 背景は #view の CSS グラデーション（main.js の applyBackground）。キャンバスは透過
  scene.fog = new THREE.Fog('#0b0b16', 55, 110);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 22, 34);

  // 照明（2026-09-10 段階 1：舞台も含めて全部ライトで照らす。屋内想定なので太陽光は無し）。
  // 床・ひな壇・奏者は同じライトで陰影がつき、影は「光が届かない所」として出る
  //   環境光（半球）：跳ね返り光の近似。影の中の明るさを決める（setShadows の ambient）
  //   スポットライト 2 灯：客席側の上手・下手から舞台中央を照らす舞台照明。影付き・縁ぼかし。仰角・左右の開き・円錐の広がりは setShadows で
  const hemi = new THREE.HemisphereLight('#ffffff', '#6a5a50', 0.7);
  scene.add(hemi);
  const spots = [];
  for (const side of [-1, 1]) {
    const sp = new THREE.SpotLight('#fff1d6', 1.6, 110, deg(30), 0.5, 1.0);
    sp.userData.side = side;
    sp.target.position.set(0, 0, -12);
    sp.castShadow = true;
    sp.shadow.mapSize.set(2048, 2048);
    sp.shadow.bias = -0.0006; sp.shadow.normalBias = 0.03;
    sp.shadow.camera.near = 2; sp.shadow.camera.far = 110;
    scene.add(sp, sp.target);
    spots.push(sp);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // ドット絵に合わせて硬い影
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3, -12);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 90;
  controls.minPolarAngle = deg(12);
  controls.maxPolarAngle = deg(89); // ほぼ床の高さまで下りられる（2026-09-09 ユーザー要望）
  // 水平方向の制限なし（ボクセル化で全周から見られる。2026-09-09）
  controls.update();

  // 床・ひな壇・指揮台の深度書き込みは絵の方式で切り替える（setStageDepthWrite）。
  //   2D の板：深度を書かない（depthWrite:false, 先に描く）。奏者の板は足元を軸にカメラへ正対するため、見下ろすと板の上半分が
  //   後方へ倒れ込み、後列の（高い）ひな壇に深度で隠されるから。描く順（renderOrder）が前後関係になる（床 → 後列 → 前列 → 指揮台）
  //   ボクセル：通常どおり深度を書く。深度を書かないと後ろから見た時に前列のひな壇が後列を塗り潰す（2026-09-10 ユーザー指摘）
  // 材質はライトに反応する Phong（鏡面 0 ＝ ピクセル単位の Lambert）。Lambert は頂点ごとの計算＋補間なので、頂点の少ない大きな床では
  // スポットの円錐の範囲が出ない（中心の頂点が明るいと外周まで明るくなる）。床・ひな壇の明るさは照明で決まり、影を受ける
  const stageMat = (opts) => { const m = new THREE.MeshPhongMaterial({ ...opts, shininess: 0, specular: 0x000000, depthWrite: stageDepthWrite }); stageMats.add(m); return m; };
  const addStage = (mesh, order = -20) => { mesh.renderOrder = order; mesh.receiveShadow = true; scene.add(mesh); return mesh; };

  // 床：ドット風の板目テクスチャ
  const floorTex = plankTexture();
  // 楽団がちょうど収まるコンパクトな円（中心を後方へずらし、指揮者の前に余白を残さない）
  // 円の縁は外側 25% でなだらかに透明にする（alphaMap の放射状グラデーション。2026-09-10）
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 64), stageMat({ map: floorTex, color: '#ffffff', alphaMap: radialAlphaTexture(0.75), transparent: true }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = FLOOR_CENTER_Z;
  floor.scale.y = FLOOR_DEPTH_SCALE; // 奥行き方向を少し潰して指揮者の前の余白を減らす（平面の local y = 世界 -z）
  addStage(floor, -40);

  // ひな壇は座席が決まってから buildRisers() で作る（扇形：使われている角度だけ）
  const risers = new THREE.Group();
  scene.add(risers);
  stageCtx = { scene, floorTex, stageMat, addStage, risers, hemi, spots };
  buildRisers([]);

  // 指揮台
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), stageMat({ color: '#34302a' }));
  podium.position.set(0, 0.15, CONDUCTOR_Z);
  addStage(podium, -20);

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

  return { scene, camera, renderer, controls, resize, wall, setShadows };
}

// 照明の状態。setShadows で切り替える（名前は互換のため）
let lightState = { enabled: true, elev: null, spread: null, cone: null };
const SPOT_R = 40; // スポットライトと舞台中心 (0,0,-12) の距離 [unit]
/**
 * @param {{enabled?:boolean, ambient?:number, spot?:number, spotElev?:number, spotSpread?:number, spotCone?:number}} o
 *   enabled: 影を落とすか  ambient: 環境光の強さ（影の中の明るさ）  spot: スポットライトの強さ
 *   spotElev: スポットの仰角 [deg]（舞台中心から見た光源の高さ。90 で真上）  spotSpread: 左右の開き [deg]（2 灯が客席正面から左右に何度ずつ離れるか）
 *   spotCone: 円錐の広がり [deg]（半頂角）
 */
export function setShadows(o = {}) {
  if (!stageCtx) return;
  const { hemi, spots } = stageCtx;
  if (o.enabled !== undefined && o.enabled !== lightState.enabled) {
    lightState.enabled = !!o.enabled;
    for (const sp of spots) sp.castShadow = lightState.enabled;
  }
  if (Number.isFinite(o.ambient)) hemi.intensity = o.ambient;
  if (Number.isFinite(o.spot)) for (const sp of spots) sp.intensity = o.spot;
  if (Number.isFinite(o.spotCone) && o.spotCone !== lightState.cone) { lightState.cone = o.spotCone; for (const sp of spots) sp.angle = deg(o.spotCone); }
  const elev = Number.isFinite(o.spotElev) ? o.spotElev : lightState.elev, spread = Number.isFinite(o.spotSpread) ? o.spotSpread : lightState.spread;
  if (Number.isFinite(elev) && Number.isFinite(spread) && (elev !== lightState.elev || spread !== lightState.spread)) {
    lightState.elev = elev; lightState.spread = spread;
    const e = deg(elev), a = deg(spread);
    for (const sp of spots) sp.position.set(sp.userData.side * SPOT_R * Math.cos(e) * Math.sin(a), SPOT_R * Math.sin(e), -12 + SPOT_R * Math.cos(e) * Math.cos(a));
  }
}

/**
 * ひな壇を扇形で作り直す。各段は「その段に座っている奏者の角度範囲 + 余白」だけを覆う。
 * 座席が無い段は列定義の span を使う。
 * @param {Array<{track, positions:[{x,y,z}]}>} seats  layoutSeats() の戻り値
 */
// 舞台側（床・ひな壇・指揮台）のマテリアル一覧と深度書き込みフラグ
const stageMats = new Set();
let stageDepthWrite = true;
/** 舞台側の深度書き込みを切り替える（ボクセル = true、2D の板 = false）。main.js が絵の方式を変えた時に呼ぶ */
export function setStageDepthWrite(on) {
  stageDepthWrite = !!on;
  for (const m of stageMats) m.depthWrite = stageDepthWrite;
}

export function buildRisers(seats) {
  if (!stageCtx) return;
  const { floorTex, stageMat, risers } = stageCtx;
  risers.traverse((o) => { o.geometry?.dispose?.(); if (o.material) { stageMats.delete(o.material); o.material.dispose(); } });
  risers.clear();

  // 後列（打楽器）から前列（木管）の順に描く：前列の天面の下に隠れる後列の壁の下部が、天面を塗り潰さないようにする
  const order = { percussion: -33, brass: -32, woodwind: -31 };
  for (const fam of ['percussion', 'brass', 'woodwind']) {
    const row = ROWS[fam];
    if (row.h <= 0) continue;
    const rIn = row.r - RISER_HALF, rOut = row.r + RISER_HALF;
    const ro = order[fam];
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
    const col = fam === 'percussion' ? '#56504a' : fam === 'brass' ? '#66605a' : '#76706a'; // 赤みを抑えた木の色（2026-09-10）
    const segs = Math.max(8, Math.ceil((thMax - thMin) / deg(4)));

    // 天面：RingGeometry の角 a と世界角 θ（-z から）は a = π/2 - θ（rotation.x = -π/2 のため）
    const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, segs, 1, Math.PI / 2 - thMax, thMax - thMin), stageMat({ map: floorTex, color: col }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = row.h;
    top.renderOrder = ro + 0.2; top.receiveShadow = true; risers.add(top);      // 同じ段では 壁 → 側面 → 天面 → 縁 の順
    // 前面（内径側の壁）：CylinderGeometry の角 φ は φ = π - θ
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      stageMat({ color: '#2a2824', side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    front.renderOrder = ro; front.receiveShadow = true; risers.add(front);
    // 背面（外径側の壁）：後ろから見た時に中が見えないように（2026-09-10 ユーザー指摘）
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(rOut, rOut, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      stageMat({ color: '#26241f', side: THREE.DoubleSide }),
    );
    back.position.y = row.h / 2;
    back.renderOrder = ro; back.receiveShadow = true; risers.add(back);
    // 両端の側面（扇の切り口）
    for (const th of [thMin, thMax]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(rOut - rIn, row.h), stageMat({ color: '#22201b', side: THREE.DoubleSide }));
      const rm = (rIn + rOut) / 2;
      side.position.set(rm * Math.sin(th), row.h / 2, -rm * Math.cos(th));
      side.rotation.y = -th + Math.PI / 2; // 面の法線を接線方向へ
      side.renderOrder = ro + 0.1; risers.add(side);
    }
    // 段の縁（見切り線）：Torus は rotation.z で開始角を回す（Euler XYZ では z が先に掛かる）
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.05, 6, segs * 2, thMax - thMin), stageMat({ color: '#18160f' }));
    rim.rotation.x = -Math.PI / 2; rim.rotation.z = Math.PI / 2 - thMax; rim.position.y = row.h + 0.01;
    rim.renderOrder = ro + 0.3; risers.add(rim);
  }
}

// 中心 1 → 半径 inner までは不透明、外周で 0 になる放射状のアルファ（円ジオメトリの UV は外接正方形に 0..1）
function radialAlphaTexture(inner = 0.75) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(N / 2, N / 2, (N / 2) * inner, N / 2, N / 2, N / 2);
  grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#000');
  g.fillStyle = grad; g.fillRect(0, 0, N, N);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}

// 板目テクスチャ。12×12 枚分をキャンバスに描き込む（repeat は使わない：alphaMap は map の UV 変換を共有するので、
// repeat を使うと縁ぼかしの alphaMap まで 12 倍に繰り返されて床が消える）
function plankTexture() {
  const T = 64, N = 12;
  const c = document.createElement('canvas');
  c.width = T * N; c.height = T * N;
  const g = c.getContext('2d');
  g.fillStyle = '#e9c076'; g.fillRect(0, 0, T * N, T * N); // 板目：基調 #E9C076（2026-09-10 ユーザー指定）。材質の色は白にして絵の色をそのまま出す
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const ox = tx * T, oy = ty * T;
    for (let y = 0; y < T; y += 8) {
      g.fillStyle = y % 16 ? '#dcb46c' : '#f0cb86';
      g.fillRect(ox, oy + y, T, 7);
      g.fillStyle = '#b08e4e'; g.fillRect(ox, oy + y + 7, T, 1);
      g.fillRect(ox + (y * 5) % T, oy + y, 1, 7);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  return tex;
}

/**
 * トラック配列 → 座席位置リスト
 * @returns {Array<{track, positions:[{x,y,z}], puppets:number}>}
 */
/**
 * @param {Array} tracks
 * @param {(track) => {minX:number, maxX:number} | null} [footprintOf]
 *   奏者 1 人の横方向の占有範囲 [unit]（奏者の原点基準、+x = 奏者の左 = 角度が増す向き）。楽器が大きいトラックは
 *   自動的に間隔を広げ、占有範囲の中心が座席の中心に来るよう奏者をずらす（2026-09-10 ユーザー指定：大きな楽器の隣に隙間を空ける）
 */
export function layoutSeats(tracks, footprintOf = null) {
  // トラックごとの奏者 1 人分の間隔 [unit] と、座席中心からの横ずらし [unit]
  const slotOf = (tr) => {
    const f = footprintOf?.(tr);
    if (!f) return { gap: PUPPET_GAP, off: 0 };
    const w = f.maxX - f.minX + 0.3;                              // 楽器を含む幅 + 余白
    return { gap: Math.max(PUPPET_GAP, w), off: -(f.minX + f.maxX) / 2 };
  };
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
    const slots = list.map(slotOf);
    const angleOf = (cols, i) => (cols * slots[i].gap) / row.r; // 1トラックが占める角度 [rad]
    if (!row.beside && list.length > 1) {
      for (let guard = 0; guard < 8; guard++) { // 中断条件付き
        const total = sizes.reduce((a, s, i) => a + angleOf(s.cols, i), 0);
        if (total <= span + PUPPET_GAP / row.r || sizes.every((s) => s.cols <= 1)) break;
        for (const s of sizes) if (s.cols > 1) s.cols--;
      }
    }

    // 各トラックの中心角を決める（角度幅は人数に比例）
    let centers;
    if (row.beside) { // 基準列（木管）の扇のすぐ外側に隣接（side: +1 = 右、-1 = 左）
      const edgeOf = (fam) => { // 基準列の扇の端の角度
        const refThetas = seats.filter((st) => st.track.family === fam).flatMap((st) => st.positions.map((p) => Math.atan2(p.x, -p.z)));
        return refThetas.length ? (row.side > 0 ? Math.max(...refThetas) : Math.min(...refThetas)) : null;
      };
      const edge0 = edgeOf(row.beside) ?? deg(row.fallbackDeg);
      const gap = RISER_MARGIN + 0.9 / row.r; // 扇の余白 + 少し
      // 奥行きレベルごとに横並び（depthOf が無ければ全員同じレベル）。使われているレベルだけ手前から詰める（k = 0, 1, 2…）
      const levels = new Map();
      list.forEach((tr, i) => { const k = row.depthOf ? row.depthOf(tr.variant) : 0; (levels.get(k) || levels.set(k, []).get(k)).push(i); });
      const levelGap = row.levelGap ?? ROW_GAP;
      [...levels.entries()].sort((a, b) => a[0] - b[0]).forEach(([k0, idxs], k) => {
        // レベルごとに隣接先を変えられる（3 段目は金管の端）。基準列が無ければ木管の端
        const edge = (row.besideAt?.[k0] && edgeOf(row.besideAt[k0])) ?? edge0;
        const total = idxs.reduce((a, i) => a + angleOf(sizes[i].cols, i), 0);
        let cursor = row.side > 0 ? edge + gap : edge - gap - total;
        const rowK = { r: row.r + k * levelGap, h: row.h };
        for (const i of idxs) {
          const c = cursor + angleOf(sizes[i].cols, i) / 2; cursor += angleOf(sizes[i].cols, i);
          const tr = list[i];
          centerAngle.set(tr, c);
          // 角度間隔は最前列の半径基準（gridPositions は row.r を使う）。奥のレベルは半径だけ大きくする
          const positions = gridPositions({ r: row.r, h: row.h }, c, sizes[i].cols, sizes[i].rows, slots[i]).map((p) => {
            const th = Math.atan2(p.x, -p.z), r = Math.hypot(p.x, p.z) + k * levelGap;
            return { x: r * Math.sin(th), y: rowK.h, z: -r * Math.cos(th), row: p.row + k };
          });
          seats.push({ track: tr, puppets: sizes[i].cols * sizes[i].rows, positions });
        }
      });
      continue;
    } else {
      const n = list.length;
      const total = sizes.reduce((a, s, i) => a + angleOf(s.cols, i), 0);
      const gap = n > 1 ? Math.max(0, Math.min((span - total) / (n - 1), (PUPPET_GAP / row.r) * 0.5)) : 0; // トラック間の余白
      let cursor = -(total + gap * (n - 1)) / 2;
      centers = sizes.map((s, i) => { const c = cursor + angleOf(s.cols, i) / 2; cursor += angleOf(s.cols, i) + gap; return c; });
    }

    list.forEach((tr, i) => {
      const { cols, rows } = sizes[i];
      const center = centers[i];
      centerAngle.set(tr, center);
      seats.push({ track: tr, puppets: cols * rows, positions: gridPositions(row, center, cols, rows, slots[i]) });
    });
  }
  return seats;
}

// 中心角 center を軸に cols × rows の格子で座らせる。奥の列ほど半径が大きい。偶数列は半人分ずらす（重なり防止・自然な見た目）
// slot = { gap: 奏者間隔 [unit], off: 占有範囲の中心を座席中心に合わせるための横ずらし [unit] }
function gridPositions(row, center, cols, rows, slot = { gap: PUPPET_GAP, off: 0 }) {
  const positions = [];
  for (let k = 0; k < rows; k++) {
    const r = row.r + k * ROW_GAP;
    const stagger = (k % 2) * 0.5;
    for (let j = 0; j < cols; j++) {
      const th = center + (slot.off + (j - (cols - 1) / 2 + stagger) * slot.gap) / row.r;
      positions.push({ x: r * Math.sin(th), y: row.h, z: -r * Math.cos(th), row: k });
    }
  }
  return positions;
}

// 角度 0 = 指揮者の真後ろ（-z 方向）。x = r sinθ, z = -r cosθ
function seatPos(row, th) {
  return { x: row.r * Math.sin(th), y: row.h, z: -row.r * Math.cos(th) };
}
