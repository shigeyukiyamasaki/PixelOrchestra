/*
 * PixelOrchestra — voxelEdit.js
 * 最終更新: 2026-09-21 / v0.1 / 生成元: PixelOrchestra
 *
 * 衣装の部位（顔・髪・兜）をボクセルのまま画面で編集する（2026-09-21 ユーザー指定：
 * 髪型などの細部は言葉で伝えるのが難しいので、直接いじれるようにする）。
 *
 *   読み込み：GET /voxels.json に編集済みがあればそれ、無ければ手続き的な形を bakePart で焼き出す
 *   操作　　：クリック＝道具（削る／足す／塗る）、Alt+クリック＝色を吸う、ドラッグ＝回す、ホイール＝寄る
 *   目印　　：マウスの下のセルを枠で示す（道具ごとに色。「足す」は新しく入る位置）。HUD に座標を出す
 *   解像度　：res 1（1px 粒）の部位は「解像度を倍にする」で 2×2×2 に割れる。見た目は変わらない
 *   筆　　　：1 / 2 / 4。2 以上は「その倍数」に吸着するので、倍にしたあとも元の粒で描ける
 *   相方　　：顔↔髪をどう出すか（出さない／薄く／くっきり）。くっきりにすると完成形が見える（p で切替）
 *   背面　　：data.back（最奥面の色置換）が効いていると後頭部が塗れない。焼き込んで解除できる
 *   取り消し：Cmd+Z で戻す、Cmd+Shift+Z でやり直す。寸法・back も含めて控えるので、解像度や背面の操作も戻せる
 *   色　　　：「この色を追加」でパレットへ登録（塗る前に足せる）。未使用の色は Alt+クリックか一括で消せる
 *   保存　　：POST /voxels/<キー>.json（サーバーが assets/voxel/ に書き、旧版は backup/ へ退避）
 *
 * 座標の約束は sprites.js と同じ。グリッド (x, y, z) は
 *   x: 0..w-1（左→右） / y: 0..h-1（上→下、正面図の行） / z: 0..depth-1（0 = 背面）
 * ローカル座標へは cell = PX/res として
 *   px = (x - pivotX) * cell / py = (pivotY - y) * cell / pz = (z0 + z) * cell
 */
import { PARTS } from './costume.js';
import { bakePart, voxelPart, lastPartArgs, PX } from './sprites.js';

// 相方（髪を触る時に顔を薄く出す、その逆も）
const PAIR = {
  cecilHead: 'cecilHelmet', cecilHelmet: 'cecilHead',
  tellaHead: 'tellaHair', tellaHair: 'tellaHead',
  randiHead: 'randi6Shell',                 // 衣装 randi6-flat の組み合わせ（randiHair は 2026-09-22 に削除）
  primmHead: 'primmHair', primmHair: 'primmHead',
  popoiHead: 'popoiHair', popoiHair: 'popoiHead',
  randi6Shell: 'randiHead',
};

const $ = (id) => document.getElementById(id);
const view = $('view');

// ---------- 状態 ----------
let saved = {};            // サーバーにある編集済み（キー → データ）
const baked = {};          // 手続き的な形を焼き出したもの（キー → データ）。元に戻す時の基準
let key = null;            // 編集中の部位
let data = null;           // 編集中のデータ（layers を書き換える）
let dirty = false;
let undoStack = [];
let redoStack = [];
let tool = 'erase';
let color = '#ffffff';
let hoverCell = null;       // マウスが今指しているセル（HUD と枠の表示用）
let brush = 1;              // 筆の大きさ（1 / 2 / 4）。2 以上は「その倍数」に吸着させる
let pairMode = 'ghost';     // 相方の部位の出し方：off / ghost（薄く）/ solid（くっきり）

// ---------- 3D ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1016');
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;

// 面の向きごとの明るさの差を大きくする（2026-09-24 ユーザー指定：真っ黒な楽器の陰影が分かりにくい。以前は全体光 0.9・斜めの光 0.7）
scene.add(new THREE.HemisphereLight('#ffffff', '#444a5a', 0.55));
const key1 = new THREE.DirectionalLight('#ffffff', 1.15); key1.position.set(3, 5, 4); scene.add(key1);
const key2 = new THREE.DirectionalLight('#aab4cc', 0.35); key2.position.set(-4, 2, -3); scene.add(key2);

const grid = new THREE.GridHelper(4, 40, 0x38405a, 0x252b3c);
grid.material.transparent = true; grid.material.opacity = 0.5;
grid.material.depthWrite = false;   // 半透明が深度を書くと、手前のボクセルに線が乗る（2026-09-21）
grid.renderOrder = -1;
scene.add(grid);

let mesh = null, pairMesh = null;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ---------- データの用意 ----------
/** 手続き的な部位を焼き出す（makePart の引数を控えてあるので同じ形になる） */
function bakeOf(k) {
  if (baked[k]) return baked[k];
  if (PARTS[k].bake) {                   // 三面図から起こした部位など、データを直に持つもの
    baked[k] = PARTS[k].bake();
    return baked[k];
  }
  PARTS[k].make();                       // 実際に作らせて、makePart が受け取った引数を控える
  const a = lastPartArgs();
  baked[k] = bakePart(a.w, a.h, a.pivotX, a.pivotY, a.draw, a.opts);
  return baked[k];
}
const clone = (d) => JSON.parse(JSON.stringify(d));

async function loadSaved() {
  try {
    const r = await fetch('/voxels.json?t=' + Date.now(), { cache: 'no-store' });
    saved = r.ok ? await r.json() : {};
  } catch (e) {
    saved = {};
    toast('サーバーに繋がりません（保存はできません）');
    console.warn('[voxelEdit] /voxels.json を読めません:', e);
  }
}

// ---------- 表示 ----------
const cellOf = (d) => PX / (d.res ?? 1);

function rebuild() {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  if (pairMesh) { scene.remove(pairMesh); pairMesh.geometry.dispose(); pairMesh.material.dispose(); pairMesh = null; }
  if (!data) return;
  mesh = voxelPart(data, 'edit', { cache: false });
  if (showEdges) addCellEdges(mesh);
  scene.add(mesh);
  const pk = PAIR[key];
  if (pk && pairMode !== 'off') {
    pairMesh = voxelPart(saved[pk] || bakeOf(pk), 'editPair', { cache: false });
    if (pairMode === 'ghost') {                  // 編集中はこちら。下の形が透けて見える
      pairMesh.material.transparent = true;
      pairMesh.material.opacity = 0.25;
      pairMesh.material.depthWrite = false;
    }                                            // solid は素のまま＝完成形の見え方
    scene.add(pairMesh);
  }
  updateHud();
}

// セルの境目の線（2026-09-24 ユーザー指定：真っ黒な楽器では段差や角が見えない）。見えている面の 1 セルごとに枠を描く。
// meshCells は面 1 枚を 6 頂点（a b c a c e）で積むので、角 a b c e を拾って 4 辺にする
let showEdges = true;
function addCellEdges(m) {
  const p = m.geometry.attributes.position.array, out = [];
  for (let i = 0; i + 18 <= p.length; i += 18) {
    const v = (k) => [p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]];
    const a = v(0), b = v(1), c = v(2), e = v(5);
    out.push(...a, ...b, ...b, ...c, ...c, ...e, ...e, ...a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#7a8296', transparent: true, opacity: 0.55 }));
  lines.raycast = () => {};   // クリックの当たり判定はボクセルだけ
  m.material.polygonOffset = true; m.material.polygonOffsetFactor = 1; m.material.polygonOffsetUnits = 1;   // 線が面に埋もれないよう面を奥へ
  m.add(lines);
}

function frameCamera() {
  const cell = cellOf(data);
  const r = Math.max(data.w, data.h, data.depth) * cell;
  controls.target.set(0, (data.pivotY - data.h / 2) * cell, 0);
  camera.position.set(0, controls.target.y + r * 0.35, r * 1.9);
  camera.near = r / 100; camera.far = r * 40; camera.updateProjectionMatrix();
  grid.position.y = (data.pivotY - data.h) * cell;
  grid.scale.setScalar(r / 2);
  controls.update();
}

function countCells() {
  let n = 0;
  for (const rows of data.layers) for (const row of rows) for (const ch of row) if (ch !== '.') n++;
  return n;
}

function updateHud() {
  $('hud').innerHTML = !data ? '' :
    `${PARTS[key].label}　${data.w}×${data.h}×${data.depth}（${data.res === 2 ? '2 倍解像度' : '1px 粒'}）<br>` +
    `ボクセル ${countCells()}　色 ${Object.keys(data.palette).length}　面 ${triCount()}<br>` +
    `クリック=${{ erase: '削る', add: '足す', paint: '塗る' }[tool]}　筆 ${brush}${brush > 1 ? '（' + brush + 'の倍数に吸着）' : ''}　Alt+クリック=色を吸う　ドラッグ=回す` +
    (hoverCell
      ? `<br><span style="color:${hoverCell.tint}">■</span> セル (${hoverCell.x}, ${hoverCell.y}, ${hoverCell.z})　${hoverCell.note}`
      : '<br><span style="opacity:.5">セル ―</span>');
  $('stat').textContent = dirty ? '未保存の変更があります' : (saved[key] ? '保存済み（編集あり）' : '元の形のまま');
  $('saveBtn').disabled = !dirty;
  $('undoBtn').disabled = !undoStack.length;
  $('redoBtn').disabled = !redoStack.length;
  $('resetBtn').disabled = !saved[key] && !dirty;
  const pk = PAIR[key];
  $('pairNote').textContent = pk
    ? `相方＝${PARTS[pk].label}${pairMode === 'solid' ? '（くっきり。クリックは編集中の部位にだけ効く）' : ''}`
    : 'この部位に相方はありません';
  for (const o of document.querySelectorAll('[data-pair]')) {
    o.classList.toggle('on', o.dataset.pair === pairMode);
    o.disabled = !pk;
  }
  const res = data.res ?? 1;
  $('upscaleBtn').disabled = res >= 2;
  const nb = data.back ? Object.keys(data.back).length : 0;
  $('bakeBackBtn').disabled = !nb;
  $('backNote').textContent = nb
    ? `${nb} 色を一番奥の面だけ置き換えています。このままだと後頭部に塗った色が上書きされます`
    : '置換なし。後頭部もそのまま塗れます';
  $('resNote').textContent = res >= 2
    ? `1 セル = ${(PX / res).toFixed(4)}（もう倍にはできません）`
    : '1px 粒。倍にすると彫れる粒が半分、データは 8 倍、面は約 4 倍';
}

// ---------- セルの読み書き ----------
const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= data.w || y >= data.h || z >= data.depth)
  ? null : (data.layers[z][y][x] === '.' ? null : data.layers[z][y][x]);

function setCell(x, y, z, ch) {
  const row = data.layers[z][y];
  data.layers[z][y] = row.slice(0, x) + ch + row.slice(x + 1);
}

/** 色 → パレットの記号。無ければ足す */
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/=<>[]{}()!?@#$%&~^_|;:,';
function symOf(hex) {
  hex = hex.toLowerCase();
  for (const [k, v] of Object.entries(data.palette)) if (v.toLowerCase() === hex) return k;
  const k = KEYS.split('').find((c) => !(c in data.palette));
  if (!k) { toast('色が多すぎます（これ以上増やせません）'); return null; }
  data.palette[k] = hex;
  renderSwatches();
  return k;
}

// 寸法も一緒に控える。「解像度を倍にする」は w/h/depth/res/pivot/z0 を変えるので、
// layers だけ戻すと寸法と噛み合わなくなる（2026-09-21）
const DIMS = ['res', 'w', 'h', 'depth', 'z0', 'pivotX', 'pivotY', 'back'];

/** 今の状態をひとつ控える／書き戻す。取り消しとやり直しで共用する */
const snapshot = () => {
  const u = { layers: clone(data.layers), palette: clone(data.palette) };
  for (const k of DIMS) u[k] = data[k];
  return u;
};
const restore = (u) => {
  data.layers = u.layers; data.palette = u.palette;
  for (const k of DIMS) if (u[k] !== undefined) data[k] = u[k];
  dirty = true;
  renderSwatches(); rebuild();       // 形は同じ位置に戻るのでカメラは動かさない
};

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];                    // 新しく手を加えたら、やり直せる先は無くなる
}

function undo() { const u = undoStack.pop(); if (!u) return; redoStack.push(snapshot()); restore(u); }
function redo() { const u = redoStack.pop(); if (!u) return; undoStack.push(snapshot()); restore(u); }

/** 今の形の三角形の数（露出面だけ張るので、表面積に比例する） */
function triCount() {
  if (!mesh) return 0;
  const g = mesh.geometry;
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/**
 * 背面の色置換（data.back）を、一番奥のセルの色として焼き込んで解除する。
 *
 * back は「**一番奥の面だけ** この色をこの色に置き換える」という指定で、手続き的に作ったパーツで
 * 顔の目・眼鏡・口が後頭部に回り込んで見えるのを潰すために置いてある（persona.js の backMap）。
 * これが効いている間は **後頭部に塗った色が置換色で上書きされて見えない**（2026-09-21 ユーザー指摘）。
 * 側面・上下の面には掛からないので「側面は塗れるのに後頭部だけ塗れない」という症状になる。
 *
 * 焼き込むと塗れるようになるが、最奥セルに背面以外の面も出ている場合は **その面の色も変わる**
 * （今までそこは正面図の色のまま＝目の黒などが輪郭に漏れていた箇所）。数を出して確認してから実行する。
 */
function bakeBack() {
  if (!data || !data.back || !Object.keys(data.back).length) return;
  const bm = Object.fromEntries(Object.entries(data.back).map(([a, b]) => [a.toLowerCase(), b]));
  const colAt = (x, y, z) => { const ch = data.layers[z][y][x]; return ch === '.' ? null : data.palette[ch].toLowerCase(); };
  const targets = [];
  let risky = 0;
  for (let y = 0; y < data.h; y++) for (let x = 0; x < data.w; x++) {
    let z = 0;
    while (z < data.depth && !colAt(x, y, z)) z++;            // その柱の一番奥の中身
    if (z >= data.depth) continue;
    const c = colAt(x, y, z);
    if (!bm[c]) continue;
    targets.push([x, y, z, bm[c]]);
    if (!at(x, y, z + 1) || !at(x - 1, y, z) || !at(x + 1, y, z) || !at(x, y - 1, z) || !at(x, y + 1, z)) risky++;
  }
  if (!targets.length) { data.back = null; updateHud(); return; }
  if (!confirm(
    `背面の色置換を、一番奥のセルの色として焼き込んで解除します。\n\n` +
    `・後頭部にも色が塗れるようになります\n` +
    `・書き換えるセル ${targets.length} 個\n` +
    `・うち ${risky} 個は背面以外にも面が出ているので、その面の色も変わります\n` +
    `　（今までそこは正面図の色のまま＝目の黒などが輪郭に漏れていた箇所です）\n\n` +
    `取り消し（Cmd+Z）で戻せます。進めますか？`)) return;
  pushUndo();
  for (const [x, y, z, hex] of targets) { const sym = symOf(hex); if (sym) setCell(x, y, z, sym); }
  data.back = null;
  dirty = true;
  renderSwatches(); rebuild();
  toast(`背面の色置換を解除しました（${targets.length} セルを書き換え、うち ${risky} 個は他の面の色も変化）`);
}

/**
 * 1 セルを 2×2×2 に割って、半分の粒で彫れるようにする（2026-09-21 ユーザー指定）。
 * 座標は px = (x - pivotX) * PX / res なので、x・pivot・z0 を 2 倍して res も 2 倍にすると
 * **見た目は 1 ピクセルも変わらない**（同じ位置・同じ大きさのまま、格子だけ細かくなる）。
 * 髪・兜・上着の立体は res 1（1px 粒）で作ってあるが、細部を彫りたい時にこれで倍にする。
 * 粗い方へは戻せない（「編集を捨てて元の形へ」で手続き的な形を作り直すことはできる）。
 */
function upscale() {
  if (!data || (data.res ?? 1) >= 2) return;
  const cells = countCells(), tris = triCount();
  if (!confirm(
    `セルを 2×2×2 に割って、半分の粒で彫れるようにします。\n\n` +
    `・見た目は変わりません（同じ位置・同じ大きさ）\n` +
    `・ボクセル ${cells} → ${cells * 8}（8 倍）\n` +
    `・面の数 ${tris} → おおよそ ${tris * 4}（表面のセルが 4 倍になるため）\n` +
    `・保存する JSON も 8 倍くらいになります\n\n` +
    `粗い方へは戻せません。進めますか？`)) return;
  pushUndo();
  const w = data.w * 2, h = data.h * 2, depth = data.depth * 2, layers = [];
  for (let z = 0; z < depth; z++) {
    const src = data.layers[z >> 1], rows = [];
    for (let y = 0; y < h; y++) {
      const line = src[y >> 1];
      let r = '';
      for (let x = 0; x < w; x++) r += line[x >> 1];
      rows.push(r);
    }
    layers.push(rows);
  }
  data.res = (data.res ?? 1) * 2;
  data.w = w; data.h = h; data.depth = depth;
  data.z0 *= 2; data.pivotX *= 2; data.pivotY *= 2;
  data.layers = layers;
  dirty = true;
  rebuild();
  toast(`解像度を倍にしました（ボクセル ${cells} → ${countCells()}、面 ${tris} → ${triCount()}）`);
}

// ---------- 当たり判定 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** 画面座標 → { x, y, z, nx, ny, nz }（当たったセルと面の向き）。外れたら null */
function pick(ev) {
  if (!mesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const cell = cellOf(data);
  const n = hit.face.normal;                       // ローカル空間（mesh は回していないので世界と同じ向き）
  const p = mesh.worldToLocal(hit.point.clone());
  const inside = p.clone().addScaledVector(n, -cell * 0.5);   // 面から半セル内側 = 当たったボクセル
  return {
    x: Math.floor(inside.x / cell + data.pivotX),
    y: Math.floor(data.pivotY - inside.y / cell),
    z: Math.floor(inside.z / cell - data.z0),
    nx: Math.round(n.x), ny: Math.round(n.y), nz: Math.round(n.z),
  };
}

// ---------- マウスが指しているセルを枠で示す ----------
// どのボクセルに効くのかがクリック前に分からないと、削り過ぎ・付け間違いが起きる（2026-09-21 ユーザー指定）。
// 道具ごとに色を変え、「足す」は**当たったセルではなく新しく入る位置**を示す。
// 深度テストを切って手前に出す（奥のセルを指した時も枠が隠れない）。
const HOVER = {
  erase: { edge: '#ff6b81', fill: '#ff6b81', a: 0.22, note: 'クリックで削る' },
  add:   { edge: '#5ee38a', fill: '#5ee38a', a: 0.22, note: 'ここに足す' },
  paint: { edge: '#ffffff', fill: null,      a: 0.45, note: 'クリックで塗る' },   // fill=null は今の色
  pick:  { edge: '#ffd24a', fill: '#ffd24a', a: 0.22, note: '離すと色を取る' },
  out:   { edge: '#7a8296', fill: '#7a8296', a: 0.10, note: 'ここには効かない' },
};
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const hoverFill = new THREE.Mesh(unitBox,
  new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
const hoverEdge = new THREE.LineSegments(new THREE.EdgesGeometry(unitBox),
  new THREE.LineBasicMaterial({ transparent: true, depthTest: false }));
hoverFill.renderOrder = 20; hoverEdge.renderOrder = 21;
hoverFill.visible = hoverEdge.visible = false;
scene.add(hoverFill, hoverEdge);

let lastMove = null;        // 道具を変えた時・Alt を押した時に同じ場所で描き直すため

function hideHover() {
  hoverFill.visible = hoverEdge.visible = false;
  renderer.domElement.style.cursor = '';
  if (hoverCell) { hoverCell = null; updateHud(); }
}

/**
 * 今どこに効くか＝{ 起点 x,y,z, 一辺 n, mode }。**枠の表示と apply が同じ答えを使う**ので、
 * 見えている枠と実際に削れる範囲がずれない。
 * 筆が 2 以上の時は「n の倍数」に吸着させる（2026-09-21 ユーザー指定）。
 * 解像度を倍にすると元の 1 セルは 2X, 2X+1 の 2 つになるので、
 * **筆 2 ＋偶数吸着でちょうど元の粒**に戻る。吸着させないと半セルずれた位置に描けてしまう。
 */
// 列ごと（2026-09-24 ユーザー指定）：クリックした面に垂直な向きに、部位の端から端まで（筆の太さの断面で）まとめて効かせる。
// 削る＝列の全部を消す、塗る＝列の中の埋まっているセルを塗る、足す＝列の中の空いているセルを埋める
let colMode = false;
let colDepth = 0;            // 列の深さ（2026-09-25 ユーザー指定）：0 = 端から端まで、N = クリックした面から N セル奥まで
function targetBlock(ev) {
  const h = pick(ev);
  if (!h) return null;
  if (ev.altKey) return { x: h.x, y: h.y, z: h.z, n: 1, mode: 'pick' };
  const n = brush, snap = (v) => Math.floor(v / n) * n;
  if (colMode) {
    const axis = h.nx ? 'x' : h.ny ? 'y' : 'z';
    const t = { x: snap(h.x), y: snap(h.y), z: snap(h.z), n, axis, mode: tool };
    const full = { x: data.w, y: data.h, z: data.depth }[axis];
    if (colDepth > 0 && colDepth < full) {
      // 当たったセルから面の内側へ N セル。y は下向きが正なので法線の符号が x・z と逆になる
      const inward = axis === 'x' ? -h.nx : axis === 'y' ? h.ny : -h.nz;
      t[axis] = inward > 0 ? h[axis] : h[axis] - colDepth + 1;
      t.len = colDepth;
    } else { t[axis] = 0; t.len = full; }
    return t;
  }
  if (tool === 'add') {                                     // 当たった面の外側へ 1 ブロック
    const t = { x: snap(h.x) + h.nx * n, y: snap(h.y) - h.ny * n, z: snap(h.z) + h.nz * n, n, mode: 'add' };
    return blockCells(t).length ? t : { x: snap(h.x), y: snap(h.y), z: snap(h.z), n, mode: 'out' };
  }
  // 面があるのに中身が空＝ズレている時は apply が何もしないので、枠も「効かない」色にする
  if (!at(h.x, h.y, h.z)) return { x: snap(h.x), y: snap(h.y), z: snap(h.z), n, mode: 'out' };
  return { x: snap(h.x), y: snap(h.y), z: snap(h.z), n, mode: tool };
}

/** ブロックの大きさ [x, y, z]（列ごとの時は、その向きだけ列の深さ t.len。0 指定なら部位の端から端まで） */
function blockSize(t) {
  return [t.axis === 'x' ? t.len : t.n, t.axis === 'y' ? t.len : t.n, t.axis === 'z' ? t.len : t.n];
}
/** ブロックの中で、部位の枠に収まっているセルだけ返す */
function blockCells(t) {
  const out = [], [sx, sy, sz] = blockSize(t);
  for (let z = t.z; z < t.z + sz; z++)
    for (let y = t.y; y < t.y + sy; y++)
      for (let x = t.x; x < t.x + sx; x++)
        if (x >= 0 && y >= 0 && z >= 0 && x < data.w && y < data.h && z < data.depth) out.push([x, y, z]);
  return out;
}

function showHover(ev) {
  lastMove = ev;
  if (!data || !mesh || down) { hideHover(); return; }      // ドラッグ（回転）中は出さない
  const t = targetBlock(ev);
  if (!t) { hideHover(); return; }
  const st = HOVER[t.mode];
  const cell = cellOf(data), [sx, sy, sz] = blockSize(t);
  const q = new THREE.Vector3((t.x + sx / 2 - data.pivotX) * cell,
                              (data.pivotY - t.y - sy / 2) * cell,
                              (t.z + sz / 2 + data.z0) * cell);
  mesh.localToWorld(q);
  hoverFill.position.copy(q); hoverEdge.position.copy(q);
  hoverFill.scale.set(cell * sx * 1.02, cell * sy * 1.02, cell * sz * 1.02); hoverEdge.scale.copy(hoverFill.scale);
  hoverFill.material.color.set(st.fill ?? color);
  hoverFill.material.opacity = st.a;
  hoverEdge.material.color.set(st.edge);
  hoverFill.visible = hoverEdge.visible = true;
  renderer.domElement.style.cursor = t.mode === 'out' ? 'not-allowed' : 'crosshair';
  const same = hoverCell && hoverCell.x === t.x && hoverCell.y === t.y && hoverCell.z === t.z
               && hoverCell.mode === t.mode && hoverCell.n === t.n && hoverCell.axis === t.axis && hoverCell.len === t.len;
  if (!same) { hoverCell = { ...t, tint: st.edge, note: t.axis ? `${st.note}（${t.axis} 方向の列ごと${colDepth > 0 ? '・深さ ' + colDepth : ''}）` : st.note }; updateHud(); }
}

/** 道具を変えた・Alt を押した／離した時に、同じ位置で描き直す */
function refreshHover() { if (lastMove) showHover(lastMove); }

renderer.domElement.addEventListener('pointermove', showHover);
renderer.domElement.addEventListener('pointerleave', () => { lastMove = null; hideHover(); });
addEventListener('keydown', (e) => { if (e.key === 'Alt') refreshHover(); });
addEventListener('keyup',   (e) => { if (e.key === 'Alt') refreshHover(); });

function apply(ev) {
  const t = targetBlock(ev);
  if (!t) return;
  if (t.mode === 'pick') {                          // 色を吸う（筆の大きさは無関係）
    const cur = at(t.x, t.y, t.z);
    if (!cur) return;
    setColor(data.palette[cur]);
    toast('色を取りました ' + data.palette[cur]);
    return;
  }
  if (t.mode === 'out') {
    if (tool === 'add') toast('その向きにはもう場所がありません（部位の枠の外）');
    return;
  }
  const sym = tool === 'erase' ? '.' : symOf(color);
  if (!sym) return;
  const changes = [];                               // 先に洗い出して、**取り消しは 1 回分**にまとめる
  for (const [x, y, z] of blockCells(t)) {
    const cur = at(x, y, z);
    if (tool === 'erase') { if (cur) changes.push([x, y, z, '.']); }
    else if (tool === 'add') { if (!cur) changes.push([x, y, z, sym]); }
    else if (cur && cur !== sym) changes.push([x, y, z, sym]);
  }
  if (!changes.length) return;
  pushUndo();
  for (const [x, y, z, ch] of changes) setCell(x, y, z, ch);
  dirty = true;
  rebuild();
}

// クリックとドラッグ（回転）を区別する：押してから離すまでの移動が小さければクリック
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; hideHover(); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved < 4 && e.button === 0) apply(e);
  showHover(e);                                   // 削った直後に、次にどこへ効くかを出し直す
});

// ---------- UI ----------
function renderPartList() {
  const box = $('partList');
  box.innerHTML = '';
  for (const [k, spec] of Object.entries(PARTS)) {
    const b = document.createElement('button');
    b.className = 'part' + (k === key ? ' on' : '');
    b.innerHTML = spec.label + (saved[k] ? '<span class="mark">●</span>' : '');
    b.onclick = () => selectPart(k);
    box.appendChild(b);
  }
}

function renderSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  const used = usedSyms();
  for (const [k, hex] of Object.entries(data.palette)) {
    const b = document.createElement('button');
    b.className = 'sw' + (hex.toLowerCase() === color.toLowerCase() ? ' on' : '');
    b.style.background = hex;
    b.title = hex + (used.has(k) ? '（使用中）' : '（未使用・Alt+クリックで消す）');
    b.style.opacity = used.has(k) ? 1 : 0.4;
    b.onclick = (e) => { if (e.altKey) dropColor(k); else setColor(hex); };   // dropColor 側で使用中は弾いて理由を出す
    box.appendChild(b);
  }
  $('palNote').textContent = `${Object.keys(data.palette).length} 色（空き ${KEYS.length - Object.keys(data.palette).length}）`
    + (used.size < Object.keys(data.palette).length ? `　未使用 ${Object.keys(data.palette).length - used.size}` : '');
}

/** 使っているパレットの記号（layers に出てくるもの） */
function usedSyms() {
  const u = new Set();
  for (const rows of data.layers) for (const row of rows) for (const ch of row) if (ch !== '.') u.add(ch);
  return u;
}

/**
 * 今の色をパレットへ足す（2026-09-22 ユーザー指定）。
 * これまでは symOf が「塗った時に初めて」足していたので、**実際に塗るまでスウォッチに並ばなかった**。
 * 明示的に足せると、先に色を揃えてから塗れる。
 */
function addSwatch() {
  const hex = color.toLowerCase();
  const exist = Object.entries(data.palette).find(([, v]) => v.toLowerCase() === hex);
  if (exist) { setColor(data.palette[exist[0]]); toast('その色はもうあります ' + hex); return; }
  pushUndo();
  if (!symOf(hex)) { undoStack.pop(); return; }      // 上限で足せなかったら控えも戻す
  dirty = true;
  renderSwatches(); updateHud();
  toast('色を足しました ' + hex);
}

/** 使っていない色をパレットから消す。使用中の色は消さない（消すとセルが行方不明になる） */
function dropUnused() {
  const used = usedSyms();
  const gone = Object.keys(data.palette).filter((k) => !used.has(k));
  if (!gone.length) { toast('未使用の色はありません'); return; }
  pushUndo();
  for (const k of gone) delete data.palette[k];
  dirty = true;
  renderSwatches(); updateHud();
  toast(`未使用の色を ${gone.length} 個消しました`);
}

/** スウォッチ 1 個を消す（未使用のものだけ）。Alt+クリックから呼ぶ */
function dropColor(k) {
  if (usedSyms().has(k)) { toast('この色は使われているので消せません'); return; }
  pushUndo();
  delete data.palette[k];
  dirty = true;
  renderSwatches(); updateHud();
  toast('色を消しました');
}

function setColor(hex) {
  color = hex;
  $('newColor').value = hex;
  renderSwatches();
}

function selectPart(k) {
  if (dirty && !confirm('保存していない変更があります。捨てて切り替えますか？')) return;
  key = k;
  data = clone(saved[k] || bakeOf(k));
  dirty = false; undoStack = []; redoStack = [];
  const first = Object.values(data.palette)[0];
  if (first) color = first;
  setBrush(1);
  renderPartList(); renderSwatches(); rebuild(); frameCamera(); updateHud();
}

let toastTimer = null;
function toast(text) {
  const m = $('msg');
  m.textContent = text; m.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => m.classList.remove('show'), 2200);
}

async function save() {
  try {
    const r = await fetch(`/voxels/${key}.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    saved[key] = clone(data);
    dirty = false;
    renderPartList(); updateHud();
    toast('保存しました → ' + j.path);
  } catch (e) {
    toast('保存に失敗しました：' + e.message);
    console.error('[voxelEdit] 保存に失敗:', e);
  }
}

async function resetPart() {
  if (!confirm(`「${PARTS[key].label}」の編集を捨てて、元の形に戻します。よろしいですか？\n（保存済みの JSON は削除されます。直前の版は assets/voxel/backup/ に残ります）`)) return;
  try {
    const r = await fetch(`/voxels/${key}.json`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    toast('削除に失敗しました：' + e.message);
    return;
  }
  delete saved[key];
  data = clone(bakeOf(key));
  dirty = false; undoStack = []; redoStack = [];
  renderPartList(); renderSwatches(); rebuild(); updateHud();
  toast('元の形に戻しました');
}

for (const b of document.querySelectorAll('[data-tool]')) {
  b.onclick = () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('[data-tool]')) o.classList.toggle('on', o === b);
    updateHud(); refreshHover();
  };
}

/** 筆の大きさ。部位を切り替えたら 1 に戻す（大きいまま気づかず削るのを防ぐ） */
function setBrush(n) {
  brush = n;
  for (const o of document.querySelectorAll('[data-brush]')) o.classList.toggle('on', +o.dataset.brush === n);
  updateHud(); refreshHover();
}
for (const b of document.querySelectorAll('[data-brush]')) b.onclick = () => setBrush(+b.dataset.brush);
$('newColor').oninput = (e) => setColor(e.target.value);
$('addSwatchBtn').onclick = addSwatch;
$('dropUnusedBtn').onclick = dropUnused;
function setPairMode(m) { pairMode = m; rebuild(); }
function setColMode(on) { colMode = on; $('colMode').checked = on; refreshHover(); }
$('colMode').onchange = (e) => setColMode(e.target.checked);
// 列の深さ。このブラウザだけに覚える（読めなければ 0 = 端まで）
function setColDepth(v) {
  colDepth = Math.max(0, Math.floor(+v) || 0);
  $('colDepth').value = colDepth;
  try { localStorage.setItem('voxelEdit.colDepth', String(colDepth)); } catch (e) { /* 保存できなくても効く */ }
  refreshHover();
}
$('colDepth').onchange = (e) => setColDepth(e.target.value);
$('colDepth').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };   // Enter で確定して欄から出る（blur で change も発火する）
try { setColDepth(localStorage.getItem('voxelEdit.colDepth') || 0); } catch (e) { /* 読めなければ 0 */ }
for (const b of document.querySelectorAll('[data-pair]')) b.onclick = () => setPairMode(b.dataset.pair);
$('showGrid').onchange = (e) => { grid.visible = e.target.checked; };
// 明るい背景（2026-09-24 ユーザー指定）。選んだ状態はこのブラウザだけに覚える（読めなければ暗い背景のまま）
function setLightBg(on) {
  scene.background.set(on ? '#d4d8e0' : '#0e1016');
  view.classList.toggle('light', on);
  $('lightBg').checked = on;
  try { localStorage.setItem('voxelEdit.lightBg', on ? '1' : '0'); } catch (e) { /* 保存できなくても表示は切り替わる */ }
}
$('lightBg').onchange = (e) => setLightBg(e.target.checked);
$('cellEdges').onchange = (e) => {
  showEdges = e.target.checked; rebuild();
  try { localStorage.setItem('voxelEdit.cellEdges', showEdges ? '1' : '0'); } catch (err) { /* 保存できなくても表示は切り替わる */ }
};
try { if (localStorage.getItem('voxelEdit.cellEdges') === '0') { showEdges = false; $('cellEdges').checked = false; } } catch (e) { /* 読めなければ線あり */ }
try { if (localStorage.getItem('voxelEdit.lightBg') === '1') setLightBg(true); } catch (e) { /* 読めなければ暗い背景 */ }
$('bakeBackBtn').onclick = bakeBack;
$('upscaleBtn').onclick = upscale;
$('saveBtn').onclick = save;
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;
$('resetBtn').onclick = resetPart;
addEventListener('keydown', (e) => {
  if (e.target.matches?.('input[type=number], input[type=text]')) return;   // 数値欄への入力（列の深さ等）でショートカットを動かさない
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
  if (e.key === '1') document.querySelector('[data-tool=erase]').click();
  if (e.key === '2') document.querySelector('[data-tool=add]').click();
  if (e.key === '3') document.querySelector('[data-tool=paint]').click();
  if (e.key === '[') setBrush(brush === 4 ? 2 : 1);
  if (e.key === ']') setBrush(brush === 1 ? 2 : 4);
  if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) setColMode(!colMode);
  if (e.key.toLowerCase() === 'p') setPairMode({ off: 'ghost', ghost: 'solid', solid: 'off' }[pairMode]);
});
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// デバッグ用の窓口（本体の window.__po と同じ考え方）
window.__edit = { scene, camera, controls, get data() { return data; }, get key() { return key; },
                  get mesh() { return mesh; }, get hoverCell() { return hoverCell; }, rebuild, frameCamera };

// ---------- 起動 ----------
await loadSaved();
resize();
selectPart(new URLSearchParams(location.search).get('part') || Object.keys(PARTS)[0]);
animate();
