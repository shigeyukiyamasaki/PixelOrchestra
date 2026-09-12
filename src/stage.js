/*
 * PixelOrchestra — stage.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * シーン・カメラ・OrbitControls・ステージ（床・ひな壇・指揮台）と、
 * トラック → 座席位置（扇形配置）の計算。
 */

// 列の定義：r=指揮者からの半径（そのセクションの最前列）、h=ひな壇の高さ、span=列が占める角度幅 [deg]
// 弦は 3 列（r 6.5 / 9.15 / 11.8）に広がるので、木管以降のひな壇（内径 r-2）はその外側に置く
export const ROWS = {
  // 弦：1 列目を指揮者に寄せ（r 8→6.5）、列の間隔を広げる（rowGap 2.65。3 列目は 11.8 のまま）。2026-09-10 ユーザー指定「前後 3 列が詰まりすぎ」
  // 12 列分の弧が r=6.5 では 180° 必要（指揮者の真横まで）なので span を 180 に。これ以上寄せると 1 列目の人数が削られる
  strings:    { r: 6.5,  h: 0,    span: 180, rowGap: 2.65 },
  woodwind:   { r: 15,   h: 1.0,  span: 90 },
  brass:      { r: 19,   h: 2.0,  span: 100 },
  percussion: { r: 23,   h: 3.0,  span: 110 },
  // コントラバス（右）と鍵盤群（左：ハープ/ピアノ/チェレスタ/シロフォン/マリンバ）は、木管の扇のすぐ外側に隣接して床に立つ
  // （ひな壇なし・真ん中寄せ。2026-09-09 ユーザー指定）
  contrabass: { r: 13.5, h: 0,    span: 0, beside: 'woodwind', side: +1, fallbackDeg: 40, rowGap: 2.65 }, // 前後の間隔は他の弦と同じ（2026-09-10）
  // 鍵盤群は数が多いと奥行き 3 段に並べる（2026-09-10 ユーザー指定）：鍵盤打楽器（シロフォン/マリンバ）→ ハープ/チェレスタ → ピアノ。
  // 使われている段だけ手前から詰める。楽器が大きいので段の間隔は広め。
  // 1 段目は 2 列目相当（r 16.5）から始める：r 13.5 だとバイオリンの 3 列目（r 11.8）のすぐ後ろに来て密着する（2026-09-10 ユーザー指摘）。
  // 2 段目（r 19.5）・3 段目（r 22.5）は金管の扇の端に隣接
  keyboard:   { r: 16.5, h: 0,    span: 0, beside: 'woodwind', side: -1, fallbackDeg: -40, levelGap: 3.0,
                depthOf: (v) => (v === 'xylophone' || v === 'marimba' ? 0 : v === 'piano' ? 2 : 1), besideAt: { 1: 'brass', 2: 'brass' } }, // 3 段目も金管の端に揃える（打楽器の扇は広く、端に付けると床の縁まで出てしまう）
};
// 楽器ごとの人数（横 cols × 奥行き rows）。実際のオーケストラの人数感（2026-09-09 ユーザー指定：1st Vn = 3×3）
// 未指定は 1 人
export const SECTION_SIZE = {
  violin1: { cols: 3, rows: 3 }, violin2: { cols: 3, rows: 3 }, viola: { cols: 3, rows: 2 }, cello: { cols: 3, rows: 2 }, contrabass: { cols: 2, rows: 2 },
  piccolo: { cols: 1, rows: 1 }, flute: { cols: 2, rows: 1 }, oboe: { cols: 2, rows: 1 }, clarinet: { cols: 2, rows: 1 }, bassoon: { cols: 2, rows: 1 },
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
const VARIANT_ORDER = { brass: ['horn', 'trumpet', 'trombone', 'tuba'], strings: ['violin1', 'violin2', 'viola', 'cello'] }; // 弦は 1st → 2nd → ヴィオラ → チェロ（2026-09-12）

// トラックがどの列に座るか（ファミリーと別扱いの楽器はここで振り分ける）
function rowKeyOf(track) {
  if (track.variant === 'contrabass') return 'contrabass';
  if (track.variant === 'xylophone' || track.variant === 'marimba') return 'keyboard'; // 鍵盤打楽器は左の鍵盤群へ
  return track.family;
}
const PUPPET_GAP = 1.7;   // 同一トラック内の奏者間隔（横）[unit]（奏者の幅 ≒ 1.2）

export const PODIUM_H = 0.6;      // 指揮台の高さ [unit]
export const CONDUCTOR_Z = -2.1; // 指揮台（2.2 角）と指揮者の z。+z = 客席側。-3.2 から指揮台の半分（1.1）手前へ（2026-09-10 ユーザー指定）
export const SEAT_SHIFT_Z = -1.0; // 指揮者以外（座席・ひな壇）を奥へ平行移動する量 [unit]（2026-09-10 ユーザー指定「少し奥へ」）
// ステージ床は長方形（2026-09-13 ユーザー指定。それまでは外周がぼける楕円だった）。
// 左右は後方ひな壇の切り口（BACK_ROWS の clipX = 18）と同じライン、奥は一番奥のひな壇の外径（-30）を 1 覆う位置、
// 手前は指揮者（z = -2.1）の背後 5 ほど。ぼかしは無し（縁ははっきり出る）
export const FLOOR_X_HALF = 18;   // 左右の縁（±x）
export const FLOOR_Z_FRONT = 3;   // 手前の縁
export const FLOOR_BACK_R = 29.5; // 奥の縁は一番奥のひな壇の外径（29）に沿わせた弧（2026-09-13 ユーザー指定「雛壇のところでカット」）
export const WALL_Z = -30;      // ピアノロール壁の z
export const WALL_WIDTH = 56;
export const WALL_HEIGHT = 14;
export const WALL_BASE_Y = 3.2; // 着弾ライン（後列ひな壇の少し上）

const deg = (d) => (d * Math.PI) / 180;
// 打楽器の後ろに置く、奏者のいないひな壇（キャラクター等を置く想定。2026-09-13 ユーザー指定）。
// ここに足すだけで段が増える。r = 中心からの半径、h = 高さ、span = 扇の開き [deg]
export const BACK_ROWS = [
  // clipX を指定すると、扇形の切り口ではなく x = ±clipX の垂直面で切る（2026-09-13 ユーザー指定）。
  // span は clipX より外まで届く広さにしておき、実際の端は clipX が決める
  { r: 27, h: 4.0, span: 130, clipX: 18 },
];
const RISER_HALF = 2;        // ひな壇の帯の半幅 [unit]（内径 r-2 〜 外径 r+2）
const RISER_MARGIN = deg(7); // 座席の両端に足す余白角
let stageCtx = null;         // createStage() で設定（buildRisers から使う）

export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = null; // 背景は #view の CSS グラデーション（main.js の applyBackground）。キャンバスは透過
  scene.fog = new THREE.Fog('#0b0b16', 55, 110);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 6, 10.5);   // 既定のカメラ（2026-09-12 ユーザー指定）

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
  renderer.localClippingEnabled = true; // ひな壇を垂直面で切る（BACK_ROWS の clipX）
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // ドット絵に合わせて硬い影
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 4, -12);    // 中心点：z は楽団の重心、y は立奏者の胸の高さ（マウス回転の軸もここ）
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
  // 床の形：手前と左右はまっすぐ、奥は一番奥のひな壇の外径に沿った弧（= ひな壇のところでカット）。
  // 平面 shape の y は、rotation.x = -90° で世界の -z になる
  const X = FLOOR_X_HALF, cy = -SEAT_SHIFT_Z, R = FLOOR_BACK_R;
  const yEdge = cy + Math.sqrt(Math.max(0, R * R - X * X)); // 左右の辺と弧が交わる位置
  const sh = new THREE.Shape();
  sh.moveTo(-X, -FLOOR_Z_FRONT);
  sh.lineTo(X, -FLOOR_Z_FRONT);
  sh.lineTo(X, yEdge);
  sh.absarc(0, cy, R, Math.atan2(yEdge - cy, X), Math.atan2(yEdge - cy, -X), false);
  sh.lineTo(-X, -FLOOR_Z_FRONT);
  const floorMat = stageMat({ map: floorMapOf(floorTex), color: '#e6e6e6' });
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(sh, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  addStage(floor, -40);

  // ひな壇は座席が決まってから buildRisers() で作る（扇形：使われている角度だけ）
  const risers = new THREE.Group();
  risers.position.z = SEAT_SHIFT_Z; // 座席と一緒に奥へ
  scene.add(risers);
  stageCtx = { scene, floorTex, grassTex: null, groundTex: floorTex, floorMat, stageMat, addStage, risers, hemi, spots, seats: [] };
  buildRisers([]);

  // 指揮台
  // 指揮台：高さ 0.6・赤茶色（2026-09-10 ユーザー指定）
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, PODIUM_H, 2.2), stageMat({ color: '#7a3a22' }));
  podium.position.set(0, PODIUM_H / 2, CONDUCTOR_Z);
  addStage(podium, -20);

  // ロール壁の背景板（暗い半透明で対比を作る）
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT),
    new THREE.MeshBasicMaterial({ color: '#141428', transparent: true, opacity: 0.85 }),
  );
  wall.position.set(0, WALL_BASE_Y + WALL_HEIGHT / 2, WALL_Z - 0.05);
  scene.add(wall);

  // 描画サイズはプレビュー要素の大きさに合わせる。毎フレーム呼ばれるので、変わった時だけ設定する。
  // レイアウトが決まる前（0×0）に設定すると aspect が NaN になり以後ずっと真っ黒になるため、その時は何もしない
  // （2026-09-12：ページを開いた時に稀に表示されない不具合。読み込み順やブラウザによってタイミングが変わる）
  let lastW = 0, lastH = 0;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 2 || h < 2 || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(container);
  resize();

  return { scene, camera, renderer, controls, resize, wall, setShadows };
}

// 照明の状態。setShadows で切り替える（名前は互換のため）
let lightState = { enabled: true, elev: null, spread: null, cone: null, blur: null };
const SPOT_R = 40; // スポットライトと舞台中心 (0,0,-12) の距離 [unit]
/**
 * @param {{enabled?:boolean, ambient?:number, spot?:number, spotElev?:number, spotSpread?:number, spotCone?:number, spotBlur?:number}} o
 *   enabled: 影を落とすか  ambient: 環境光の強さ（影の中の明るさ）  spot: スポットライトの強さ
 *   spotElev: スポットの仰角 [deg]（舞台中心から見た光源の高さ。90 で真上）  spotSpread: 左右の開き [deg]（2 灯が客席正面から左右に何度ずつ離れるか）
 *   spotCone: 円錐の広がり [deg]（半頂角）  spotBlur: 輪郭のぼけ（0 でくっきり、1 で中心から外へなだらかに消える）
 */
// 床用のテクスチャ（ShapeGeometry の UV は座標そのままなので、40×32 unit に 1 枚になるよう繰り返しを設定）
function floorMapOf(tex) {
  const m = tex.clone(); m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.repeat.set(1 / 40, 1 / 32);
  return m;
}

/** 床とひな壇の天面の見た目を切り替える（'plank' = 板目 / 'grass' = 草原）。2026-09-13 ユーザー指定 */
export function setFloorStyle(style) {
  if (!stageCtx) return;
  if (style === 'grass' && !stageCtx.grassTex) stageCtx.grassTex = grassTexture();
  const tex = style === 'grass' ? stageCtx.grassTex : stageCtx.floorTex;
  if (tex === stageCtx.groundTex) return;
  stageCtx.groundTex = tex;
  stageCtx.floorMat.map?.dispose();
  stageCtx.floorMat.map = floorMapOf(tex);
  stageCtx.floorMat.needsUpdate = true;
  buildRisers(stageCtx.seats);   // ひな壇の天面も同じ地面の絵にする
}

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
  if (Number.isFinite(o.spotBlur) && o.spotBlur !== lightState.blur) { lightState.blur = o.spotBlur; for (const sp of spots) sp.penumbra = o.spotBlur; } // 輪郭のぼけ（2026-09-12 ユーザー指定）
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
  stageCtx.seats = seats;       // 床のスタイルを変えた時に組み直せるよう控える
  const { groundTex, stageMat, risers } = stageCtx;
  risers.traverse((o) => { o.geometry?.dispose?.(); if (o.material) { stageMats.delete(o.material); if (o.material.map?.__disposable) o.material.map.dispose(); o.material.dispose(); } });
  risers.clear();

  // 後列（打楽器）から前列（木管）の順に描く：前列の天面の下に隠れる後列の壁の下部が、天面を塗り潰さないようにする。
  // 奏者のいない後方の段（BACK_ROWS）はさらに奥なので、打楽器より先に描く
  const order = { percussion: -33, brass: -32, woodwind: -31 };
  const rows = [
    ...BACK_ROWS.map((row, i) => ({ row, ro: -34 - i, col: '#b2b2b2' })),
    ...['percussion', 'brass', 'woodwind'].map((fam) => ({ row: ROWS[fam], ro: order[fam], fam,
      col: fam === 'percussion' ? '#bfbfbf' : fam === 'brass' ? '#cbcbcb' : '#d8d8d8' })), // 天面は床と同じ板目（白〜灰の倍率で奥ほど少し暗く。2026-09-10 ユーザー指定：床と同じ色味。同日「少し暗く」で 10% 減）
  ];
  for (const { row, ro, fam, col } of rows) {
    if (row.h <= 0) continue;
    const rIn = row.r - RISER_HALF, rOut = row.r + RISER_HALF;
    // この段（高さ h・半径帯）に座っている奏者の角度範囲（奏者のいない段は span をそのまま使う）
    let thMin = Infinity, thMax = -Infinity;
    for (const seat of seats) for (const p of seat.positions) {
      const pz = p.z - SEAT_SHIFT_Z; // 座席は奥へずらしてあるので戻して角度を測る
      const r = Math.hypot(p.x, pz);
      if (Math.abs(p.y - row.h) > 0.01 || r < rIn - 0.5 || r > rOut + 0.5) continue;
      const th = Math.atan2(p.x, -pz);
      thMin = Math.min(thMin, th); thMax = Math.max(thMax, th);
    }
    if (!Number.isFinite(thMin)) { thMin = -deg(row.span) / 2; thMax = deg(row.span) / 2; }
    // 左右対称にする（片側だけ広いと舞台らしくない）
    const half = Math.max(Math.abs(thMin), Math.abs(thMax)) + RISER_MARGIN;
    thMin = -half; thMax = half;
    const segs = Math.max(8, Math.ceil((thMax - thMin) / deg(4)));
    // clipX 指定の段は x = ±clipX の垂直面で切る。扇の弧は clipX の外まで作っておき、はみ出しをクリップで落とす
    const cx = row.clipX;
    const clip = cx ? [new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx), new THREE.Plane(new THREE.Vector3(1, 0, 0), cx)] : null;
    const matC = (o) => { const m = stageMat(o); if (clip) m.clippingPlanes = clip; return m; };

    // 天面：RingGeometry の角 a と世界角 θ（-z から）は a = π/2 - θ（rotation.x = -π/2 のため）
    const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, segs, 1, Math.PI / 2 - thMax, thMax - thMin), matC({ map: groundTex, color: col }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = row.h;
    top.renderOrder = ro + 0.2; top.receiveShadow = true; risers.add(top);      // 同じ段では 壁 → 側面 → 天面 → 縁 の順
    // 前面（内径側の壁）：CylinderGeometry の角 φ は φ = π - θ
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      matC({ map: rockMap(rIn * (thMax - thMin), row.h), color: '#846a41', side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    front.renderOrder = ro; front.receiveShadow = true; risers.add(front);
    // 背面（外径側の壁）：後ろから見た時に中が見えないように（2026-09-10 ユーザー指摘）
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(rOut, rOut, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      matC({ map: rockMap(rOut * (thMax - thMin), row.h), color: '#7a603a', side: THREE.DoubleSide }),
    );
    back.position.y = row.h / 2;
    back.renderOrder = ro; back.receiveShadow = true; risers.add(back);
    // 両端の側面。clipX 指定なら x = ±clipX の垂直な切り口（内径・外径との交点で幅が決まる）、
    // そうでなければ従来どおり扇の切り口
    if (cx) {
      const z1 = -Math.sqrt(Math.max(0, rIn * rIn - cx * cx));   // 内径との交点
      const z2 = -Math.sqrt(Math.max(0, rOut * rOut - cx * cx)); // 外径との交点
      for (const sx of [-cx, cx]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(z2 - z1), row.h), stageMat({ map: rockMap(Math.abs(z2 - z1), row.h), color: '#715935', side: THREE.DoubleSide }));
        side.position.set(sx, row.h / 2, (z1 + z2) / 2);
        side.rotation.y = Math.PI / 2;                            // 面の法線を x 方向へ
        side.renderOrder = ro + 0.1; risers.add(side);
      }
    } else {
      for (const th of [thMin, thMax]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(rOut - rIn, row.h), stageMat({ map: rockMap(rOut - rIn, row.h), color: '#715935', side: THREE.DoubleSide }));
        const rm = (rIn + rOut) / 2;
        side.position.set(rm * Math.sin(th), row.h / 2, -rm * Math.cos(th));
        side.rotation.y = -th + Math.PI / 2; // 面の法線を接線方向へ
        side.renderOrder = ro + 0.1; risers.add(side);
      }
    }
    // 段の縁（見切り線）：Torus は rotation.z で開始角を回す（Euler XYZ では z が先に掛かる）
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.05, 6, segs * 2, thMax - thMin), matC({ color: '#6b5430' }));
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
// 草原（スーパーファミコン風）：色数を絞り、1 ドット = GRASS_DOT px の粒で描く。
// 地色にディザで濃淡を撒き、その上に「房」（3〜4 ドットの縦線を数本まとめたもの）と小さな花を置く。
// 乱数は固定シードなので、読み込むたびに模様が変わることはない
function grassTexture() {
  const S = 768, DOT = 4;            // 板目と同じ 768px（床では 40×32 unit に 1 枚）
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const BASE = '#4f9a3e', DARK = '#3b7c2f', LIGHT = '#66b44b', HI = '#86cc63', SOIL = '#6b8f3a';
  let seed = 20260913 >>> 0;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x * DOT, y * DOT, DOT, DOT); };
  const N = S / DOT;                  // ドット数（192×192）

  g.fillStyle = BASE; g.fillRect(0, 0, S, S);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {   // 地色のディザ（市松＋乱数で粒立ち）
    const r = rnd();
    if (r < 0.10) px(x, y, DARK);
    else if (r < 0.20) px(x, y, LIGHT);
    else if (r < 0.22) px(x, y, SOIL);
  }
  for (let i = 0; i < 260; i++) {     // 房：縦 2〜3 ドットの線を 2〜4 本、少しずらして並べる
    const bx = Math.floor(rnd() * N), by = Math.floor(rnd() * N);
    const blades = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < blades; b++) {
      const x = (bx + b * 2 + Math.floor(rnd() * 2)) % N;
      const h = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < h; k++) px(x, (by - k + N) % N, k === h - 1 ? HI : LIGHT);
      px(x, (by + 1) % N, DARK);      // 根元の影
    }
  }
  for (let i = 0; i < 40; i++) {      // 小さな花（1 ドット＋周りを少し明るく）
    const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N);
    px(x, y, rnd() < 0.5 ? '#f2e9a8' : '#efc0d8');
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  return tex;
}

// 岩肌（スーパーファミコン風）：グレースケールで描き、材質の色（土色）を掛けて染める。
// 四辺が繋がるように、はみ出した分を反対側へも描いて敷き詰められるようにする
let rockTex = null;
function rockTexture() {
  if (rockTex) return rockTex;
  const S = 128, DOT = 2;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const N = S / DOT;
  let seed = 913 >>> 0;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(((x % N) + N) % N * DOT, ((y % N) + N) % N * DOT, DOT, DOT); };
  const rect = (x, y, w, h, col) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, col); };

  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {          // ざらつき
    const r = rnd();
    if (r < 0.16) px(x, y, '#e2e2e2');
    else if (r < 0.24) px(x, y, '#cfcfcf');
  }
  for (let i = 0; i < 26; i++) {                                     // 岩の面（大きめの明暗の塊）
    const w = 4 + Math.floor(rnd() * 10), h = 3 + Math.floor(rnd() * 7);
    const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N);
    rect(x, y, w, h, rnd() < 0.5 ? '#eaeaea' : '#d5d5d5');
    rect(x, y + h, w, 1, '#a9a9a9');                                 // 下側に影
    rect(x, y, 1, h, '#f4f4f4');                                     // 左に光
  }
  for (let i = 0; i < 14; i++) {                                     // ひび（折れ線）
    let x = Math.floor(rnd() * N), y = Math.floor(rnd() * N);
    const len = 6 + Math.floor(rnd() * 14);
    for (let k = 0; k < len; k++) {
      px(x, y, '#9c9c9c');
      if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
    }
  }
  rockTex = new THREE.CanvasTexture(c);
  rockTex.magFilter = THREE.NearestFilter; rockTex.minFilter = THREE.NearestFilter;
  rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
  return rockTex;
}

// 岩肌を指定の大きさで敷くためのテクスチャ（1 タイル = ROCK_TILE unit）
const ROCK_TILE = 2.2;
function rockMap(uLen, vLen) {
  const m = rockTexture().clone(); m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.repeat.set(Math.max(1, Math.round(uLen / ROCK_TILE)), Math.max(1, Math.round(vLen / ROCK_TILE)));
  m.__disposable = true;          // 作り直しのたびに捨てる（天面の地面テクスチャは共有なので捨てない。r128 の Texture に userData は無い）
  return m;
}

function plankTexture() {
  const T = 64, N = 12;
  const c = document.createElement('canvas');
  c.width = T * N; c.height = T * N;
  const g = c.getContext('2d');
  g.fillStyle = '#cba76d'; g.fillRect(0, 0, T * N, T * N); // 板目：基調 #E9C076 にほんの少し赤み → 彩度を 15% 落とし、明るさを 12% 落とす（2026-09-10 ユーザー指定）。材質の色は白にして絵の色をそのまま出す
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const ox = tx * T, oy = ty * T;
    for (let y = 0; y < T; y += 8) {
      g.fillStyle = y % 16 ? '#c09c64' : '#d1b17b';
      g.fillRect(ox, oy + y, T, 7);
      g.fillStyle = '#997a49'; g.fillRect(ox, oy + y + 7, T, 1);
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
    // 手持ち楽器（弓・バイオリン等）は隣と少し重なってよいので 0.3 の食い込みを許す。これが無いと弦の間隔が 1.87 に広がり、
    // 独奏トラックが 1 つ増えただけで弦の扇が溢れて各セクションの人数が削られる（2026-09-10 ユーザー報告）
    const w = f.maxX - f.minX - 0.3;
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
      // 収まらない時は「横の人数が最も多いトラック」から 1 列ずつ減らす（全トラック一斉に減らすと独奏 1 本で全セクションが痩せる）
      for (let guard = 0; guard < 16; guard++) { // 中断条件付き
        const total = sizes.reduce((a, s, i) => a + angleOf(s.cols, i), 0);
        if (total <= span + PUPPET_GAP / row.r || sizes.every((s) => s.cols <= 1)) break;
        let k = -1;
        sizes.forEach((s, i) => { if (s.cols > 1 && (k < 0 || s.cols >= sizes[k].cols)) k = i; });
        if (k < 0) break;
        sizes[k].cols--;
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
          const positions = gridPositions({ r: row.r, h: row.h, rowGap: row.rowGap }, c, sizes[i].cols, sizes[i].rows, slots[i]).map((p) => {
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
  // 指揮者以外を奥へ平行移動（座席の角度計算は指揮者中心のまま、最後にずらす。ひな壇は buildRisers 側で同じ量ずらす）
  for (const st of seats) for (const p of st.positions) p.z += SEAT_SHIFT_Z;
  return seats;
}

// 中心角 center を軸に cols × rows の格子で座らせる。奥の列ほど半径が大きい。偶数列は半人分ずらす（重なり防止・自然な見た目）
// slot = { gap: 奏者間隔 [unit], off: 占有範囲の中心を座席中心に合わせるための横ずらし [unit] }
function gridPositions(row, center, cols, rows, slot = { gap: PUPPET_GAP, off: 0 }) {
  const positions = [];
  const rowGap = row.rowGap ?? ROW_GAP;
  for (let k = 0; k < rows; k++) {
    const r = row.r + k * rowGap;
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
