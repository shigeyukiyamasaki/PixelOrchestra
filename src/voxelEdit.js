/*
 * PixelOrchestra — voxelEdit.js
 * 最終更新: 2026-09-21 / v0.1 / 生成元: PixelOrchestra
 *
 * 衣装の部位（顔・髪・兜）をボクセルのまま画面で編集する（2026-09-21 ユーザー指定：
 * 髪型などの細部は言葉で伝えるのが難しいので、直接いじれるようにする）。
 *
 *   読み込み：GET /voxels.json に編集済みがあればそれ、無ければ手続き的な形を bakePart で焼き出す
 *   操作　　：クリック＝道具（削る／足す／塗る）、Alt+クリック＝色を吸う、ドラッグ＝回す、ホイール＝寄る
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
  randiHead: 'randiHair', randiHair: 'randiHead',
  primmHead: 'primmHair', primmHair: 'primmHead',
  popoiHead: 'popoiHair', popoiHair: 'popoiHead',
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
let tool = 'erase';
let color = '#ffffff';

// ---------- 3D ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1016');
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;

scene.add(new THREE.HemisphereLight('#ffffff', '#444a5a', 0.9));
const key1 = new THREE.DirectionalLight('#ffffff', 0.7); key1.position.set(3, 5, 4); scene.add(key1);
const key2 = new THREE.DirectionalLight('#aab4cc', 0.35); key2.position.set(-4, 2, -3); scene.add(key2);

const grid = new THREE.GridHelper(4, 40, 0x38405a, 0x252b3c);
grid.material.transparent = true; grid.material.opacity = 0.5;
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
  scene.add(mesh);
  const pk = PAIR[key];
  if (pk && $('showPair').checked) {
    pairMesh = voxelPart(saved[pk] || bakeOf(pk), 'editPair', { cache: false });
    pairMesh.material.transparent = true;
    pairMesh.material.opacity = 0.25;
    pairMesh.material.depthWrite = false;
    scene.add(pairMesh);
  }
  updateHud();
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
    `ボクセル ${countCells()}　色 ${Object.keys(data.palette).length}<br>` +
    `クリック=${{ erase: '削る', add: '足す', paint: '塗る' }[tool]}　Alt+クリック=色を吸う　ドラッグ=回す`;
  $('stat').textContent = dirty ? '未保存の変更があります' : (saved[key] ? '保存済み（編集あり）' : '元の形のまま');
  $('saveBtn').disabled = !dirty;
  $('undoBtn').disabled = !undoStack.length;
  $('resetBtn').disabled = !saved[key] && !dirty;
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

function pushUndo() {
  undoStack.push({ layers: clone(data.layers), palette: clone(data.palette) });
  if (undoStack.length > 80) undoStack.shift();
}

function undo() {
  const u = undoStack.pop();
  if (!u) return;
  data.layers = u.layers; data.palette = u.palette;
  dirty = true;
  renderSwatches(); rebuild();
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

function apply(ev) {
  const h = pick(ev);
  if (!h) return;
  const cur = at(h.x, h.y, h.z);
  if (!cur) return;                                 // 面があるのに空＝ズレている時は何もしない
  if (ev.altKey) {                                  // 色を吸う
    setColor(data.palette[cur]);
    toast('色を取りました ' + data.palette[cur]);
    return;
  }
  if (tool === 'erase') {
    pushUndo(); setCell(h.x, h.y, h.z, '.');
  } else if (tool === 'paint') {
    const s = symOf(color); if (!s) return;
    if (s === cur) return;
    pushUndo(); setCell(h.x, h.y, h.z, s);
  } else {                                          // 足す：当たった面の外側へ
    const x = h.x + h.nx, y = h.y - h.ny, z = h.z + h.nz;   // y は上下が逆（行番号）
    if (x < 0 || y < 0 || z < 0 || x >= data.w || y >= data.h || z >= data.depth) {
      toast('その向きにはもう場所がありません（部位の枠の外）');
      return;
    }
    if (at(x, y, z)) return;
    const s = symOf(color); if (!s) return;
    pushUndo(); setCell(x, y, z, s);
  }
  dirty = true;
  rebuild();
}

// クリックとドラッグ（回転）を区別する：押してから離すまでの移動が小さければクリック
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved < 4 && e.button === 0) apply(e);
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
  const used = new Set();
  for (const rows of data.layers) for (const row of rows) for (const ch of row) if (ch !== '.') used.add(ch);
  for (const [k, hex] of Object.entries(data.palette)) {
    const b = document.createElement('button');
    b.className = 'sw' + (hex.toLowerCase() === color.toLowerCase() ? ' on' : '');
    b.style.background = hex;
    b.title = hex + (used.has(k) ? '' : '（未使用）');
    b.style.opacity = used.has(k) ? 1 : 0.4;
    b.onclick = () => setColor(hex);
    box.appendChild(b);
  }
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
  dirty = false; undoStack = [];
  const first = Object.values(data.palette)[0];
  if (first) color = first;
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
  dirty = false; undoStack = [];
  renderPartList(); renderSwatches(); rebuild(); updateHud();
  toast('元の形に戻しました');
}

for (const b of document.querySelectorAll('.tool')) {
  b.onclick = () => {
    tool = b.dataset.tool;
    for (const o of document.querySelectorAll('.tool')) o.classList.toggle('on', o === b);
    updateHud();
  };
}
$('newColor').oninput = (e) => setColor(e.target.value);
$('showPair').onchange = rebuild;
$('showGrid').onchange = (e) => { grid.visible = e.target.checked; };
$('saveBtn').onclick = save;
$('undoBtn').onclick = undo;
$('resetBtn').onclick = resetPart;
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
  if (e.key === '1') document.querySelector('[data-tool=erase]').click();
  if (e.key === '2') document.querySelector('[data-tool=add]').click();
  if (e.key === '3') document.querySelector('[data-tool=paint]').click();
});
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- 起動 ----------
await loadSaved();
resize();
selectPart(new URLSearchParams(location.search).get('part') || Object.keys(PARTS)[0]);
animate();
