/*
 * PixelOrchestra — main.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * UI・再生クロック・シーン組み立て。描画ロジックは「時刻 t → 状態」の純関数で書き、
 * 将来のオフライン書き出し（Remotion 等）でも使い回せるようにする。
 */
import { MidiEngine, FAMILIES, FAMILY_LABEL, VARIANTS, midiToNoteName } from './midiEngine.js';
import { createStage, layoutSeats } from './stage.js';
import { Puppet } from './puppet.js';
import { nameLabel } from './sprites.js';
import { HEAD_Y } from './pianoRoll.js';
import { PianoRoll } from './pianoRoll.js';

const SETTINGS_KEY = 'pixelOrchestra.settings.v1';
const FAMILY_KEY = 'pixelOrchestra.families.v1';
// MIDIOrchestra と同じキー・同じ形式 { trackName: {pitchMin, pitchMax} }。同一オリジン（romashige.com）に置けば両ツールで共用される
const PITCH_FILTER_KEY = 'midiOrchestra_pitchFilters';

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません（HTML と JS の id 不一致）`);
  return el;
};

// ---------- ステージ ----------
const stage = createStage($('view'));
const { scene, camera, renderer, controls, wall } = stage;

let engine = null;
let roll = null;
let puppets = [];       // { puppet, track }
let conductor = null;
let labels = new THREE.Group(); // パート名ラベル
scene.add(labels);
let midiFileName = '';
let currentMidi = null;

// ---------- 再生クロック ----------
const clock = {
  playing: false,
  t: 0,            // 現在の曲中時刻 [s]
  perfStart: 0,    // 再生開始時の performance.now()
  tStart: 0,       // 再生開始時の t
};
const audio = new Audio();
let audioLoaded = false;

function currentTime() {
  if (!clock.playing) return clock.t;
  if (audioLoaded) return audio.currentTime + audioOffsetSec();
  return clock.tStart + (performance.now() - clock.perfStart) / 1000;
}
function audioOffsetSec() {
  const v = parseFloat($('audioOffset').value);
  return Number.isFinite(v) ? v / 1000 : 0;
}
function play() {
  if (!engine) return;
  if (clock.t >= engine.duration) clock.t = 0;
  clock.playing = true;
  clock.tStart = clock.t;
  clock.perfStart = performance.now();
  if (audioLoaded) {
    audio.currentTime = Math.max(0, clock.t - audioOffsetSec());
    audio.play().catch((e) => console.warn('audio.play 失敗:', e));
  }
  $('playBtn').textContent = '❚❚ 一時停止';
}
function pause() {
  clock.t = currentTime();
  clock.playing = false;
  if (audioLoaded) audio.pause();
  $('playBtn').textContent = '▶ 再生';
}
function seek(t) {
  const wasPlaying = clock.playing;
  if (wasPlaying) pause();
  clock.t = Math.max(0, Math.min(engine ? engine.duration : 0, t));
  if (audioLoaded) audio.currentTime = Math.max(0, clock.t - audioOffsetSec());
  if (wasPlaying) play();
}

// ---------- 設定（id 付き input を自動収集して保存・復元） ----------
const SETTING_IDS = () => [...document.querySelectorAll('#panel input[id], #panel select[id]')]
  .filter((el) => el.type !== 'file' && el.id !== 'seek');

function saveSettings() {
  const data = {};
  for (const el of SETTING_IDS()) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) { console.warn('設定保存失敗:', e); }
}
function loadSettings() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { console.warn('設定読込失敗（デフォルトで続行）:', e); }
  for (const el of SETTING_IDS()) {
    if (!(el.id in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.id]; else el.value = data[el.id];
  }
}
let saveTimer = null;
document.getElementById('panel')?.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
  refreshValueLabels();
});
function refreshValueLabels() {
  for (const el of document.querySelectorAll('#panel input[type=range][id]')) {
    const lab = document.querySelector(`[data-value-for="${el.id}"]`);
    if (lab) lab.textContent = el.value;
  }
}
function settings() {
  const num = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
  return {
    sway: num('sway', 1),
    rollSpeed: num('rollSpeed', 3),
    rollHeight: num('rollHeight', 7),
    noteWidth: num('noteWidth', 0.22),
    showRoll: $('showRoll').checked,
    rollMode: $('rollMode').value === 'wall' ? 'wall' : 'overhead',
    showGlow: $('showGlow').checked,
    showNames: $('showNames').checked,
  };
}

// トラック → 楽器の手動割当（MIDI ファイル名ごと。値は楽器名。旧形式のファミリー名も engine 側で受け付ける）
function loadFamilyOverrides(name) {
  try { return JSON.parse(localStorage.getItem(FAMILY_KEY) || '{}')[name] || {}; } catch { return {}; }
}
function saveFamilyOverride(name, key, family) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(FAMILY_KEY) || '{}'); } catch { all = {}; }
  (all[name] ||= {})[key] = family;
  try { localStorage.setItem(FAMILY_KEY, JSON.stringify(all)); } catch (e) { console.warn('割当保存失敗:', e); }
}

// 音域フィルター（キースイッチ除外）：トラック名 → {pitchMin, pitchMax}
function loadPitchFilters() {
  try { return JSON.parse(localStorage.getItem(PITCH_FILTER_KEY) || '{}'); } catch { return {}; }
}
function savePitchFilter(trackName, pitchMin, pitchMax) {
  const all = loadPitchFilters();
  if (pitchMin <= 0 && pitchMax >= 127) delete all[trackName]; else all[trackName] = { pitchMin, pitchMax };
  try { localStorage.setItem(PITCH_FILTER_KEY, JSON.stringify(all)); } catch (e) { console.warn('音域保存失敗:', e); }
}

// ---------- MIDI 読み込み ----------
$('midiFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const midi = new Midi(buf);
    midiFileName = file.name;
    setStatus(`${file.name}（${midi.tracks.filter((t) => t.notes.length).length} トラック / ${fmtTime(midi.duration)}）`);
    buildScene(midi);
  } catch (err) {
    console.error(err);
    setStatus(`✗ MIDI を読み込めませんでした（${err.message}）。標準 MIDI ファイル (.mid) を選んでください`);
  }
});

$('audioFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  audio.src = URL.createObjectURL(file);
  audio.addEventListener('loadedmetadata', () => { audioLoaded = true; $('audioName').textContent = file.name; }, { once: true });
  audio.addEventListener('error', () => { audioLoaded = false; $('audioName').textContent = '✗ 再生できない形式です（mp3 / wav / m4a を選んでください）'; }, { once: true });
});

function buildScene(midi, { keepTime = false } = {}) {
  const wasPlaying = clock.playing;
  const t0 = currentTime();
  pause();
  currentMidi = midi;
  clock.t = keepTime ? t0 : 0;
  // 既存を破棄
  for (const p of puppets) scene.remove(p.puppet.root);
  if (conductor) scene.remove(conductor.root);
  roll?.dispose();
  puppets = [];

  engine = new MidiEngine(midi, loadFamilyOverrides(midiFileName), loadPitchFilters());
  roll = new PianoRoll(scene, engine, camera);
  placePuppets();
  renderTrackTable();
  $('seek').max = Math.floor(engine.duration * 100);
  if (keepTime && wasPlaying) play();
}
// デバッグ用フック（DevTools から window.__po.puppets 等を参照できる）
window.__po = { get engine() { return engine; }, get puppets() { return puppets; }, get conductor() { return conductor; }, camera, controls };

function placePuppets() {
  for (const p of puppets) scene.remove(p.puppet.root);
  puppets = [];
  const seats = layoutSeats(engine.tracks);
  let seed = 1;
  for (const seat of seats) {
    seat.positions.forEach((pos) => {
      const puppet = new Puppet({ family: seat.track.family, variant: seat.track.variant, color: seat.track.color, seed: seed++ });
      puppet.root.position.set(pos.x, pos.y, pos.z);
      scene.add(puppet.root);
      puppets.push({ puppet, track: seat.track });
    });
  }
  roll.setSeats(seats); // 頭上ロールの列位置を座席に合わせる
  // パート名ラベル：トラックごとに奏者グループの中央・頭の少し上
  labels.traverse((o) => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  labels.clear();
  for (const seat of seats) {
    const ps = seat.positions;
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const sp = nameLabel(seat.track.name, seat.track.color);
    sp.position.set(cx, ps[0].y + HEAD_Y - 0.55, cz);
    labels.add(sp);
  }
  if (!conductor) {
    conductor = new Puppet({ isConductor: true, color: '#ffffff', seed: 99 });
    conductor.root.position.set(0, 0.3, 2);
  }
  scene.add(conductor.root);
}

function renderTrackTable() {
  const tbody = $('trackRows');
  tbody.innerHTML = '';
  for (const tr of engine.tracks) {
    const row = document.createElement('tr');
    const sel = document.createElement('select');
    for (const f of FAMILIES) { // ファミリーごとにグループ化した楽器一覧
      const g = document.createElement('optgroup');
      g.label = FAMILY_LABEL[f];
      for (const [v, def] of Object.entries(VARIANTS)) {
        if (def.family !== f) continue;
        const o = document.createElement('option');
        o.value = v; o.textContent = def.label;
        if (v === tr.variant) o.selected = true;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    sel.addEventListener('change', () => {
      engine.setVariant(tr, sel.value);
      saveFamilyOverride(midiFileName, tr.key, sel.value);
      roll.refreshColors();
      placePuppets();
      renderTrackTable(); // 色見本を更新
    });
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = tr.color;
    const tdSw = document.createElement('td'); tdSw.appendChild(sw);
    const tdName = document.createElement('td'); tdName.className = 'name'; tdName.title = tr.name; tdName.textContent = tr.name;
    const tdN = document.createElement('td'); tdN.textContent = tr.notes.length;
    if (tr.notes.length !== tr.totalNotes) { tdN.textContent = `${tr.notes.length}/${tr.totalNotes}`; tdN.title = '音域フィルターで除外あり（表示/全体）'; }
    row.append(tdSw, tdName, tdN);
    const td = document.createElement('td'); td.appendChild(sel); row.appendChild(td);
    tbody.appendChild(row);

    // 2行目：音域フィルター（キースイッチ除外）。MIDI ノート番号 + Logic 表記の音名
    const row2 = document.createElement('tr');
    row2.className = 'pitch-row';
    const td2 = document.createElement('td'); td2.colSpan = 4;
    const mkNum = (val, title) => { const i = document.createElement('input'); i.type = 'number'; i.min = 0; i.max = 127; i.value = val; i.title = title; return i; };
    const minIn = mkNum(tr.pitchMin, '音域の下限（この番号未満のノートを除外）');
    const maxIn = mkNum(tr.pitchMax, '音域の上限（この番号を超えるノートを除外）');
    const minName = document.createElement('span'); minName.className = 'note-name'; minName.textContent = midiToNoteName(tr.pitchMin);
    const maxName = document.createElement('span'); maxName.className = 'note-name'; maxName.textContent = midiToNoteName(tr.pitchMax);
    const lab = document.createElement('span'); lab.className = 'pitch-label'; lab.textContent = '音域';
    const sep = document.createElement('span'); sep.textContent = '〜';
    td2.append(lab, minIn, minName, sep, maxIn, maxName);
    row2.appendChild(td2);
    tbody.appendChild(row2);
    const applyFilter = () => {
      let lo = parseInt(minIn.value, 10), hi = parseInt(maxIn.value, 10);
      lo = Number.isFinite(lo) ? Math.max(0, Math.min(127, lo)) : 0;
      hi = Number.isFinite(hi) ? Math.max(0, Math.min(127, hi)) : 127;
      if (lo > hi) [lo, hi] = [hi, lo];
      savePitchFilter(tr.name, lo, hi);
      buildScene(currentMidi, { keepTime: true }); // ノート集合が変わるので全体を組み直す（再生位置は保持）
    };
    minIn.addEventListener('input', () => { const v = parseInt(minIn.value, 10); if (Number.isFinite(v)) minName.textContent = midiToNoteName(Math.max(0, Math.min(127, v))); });
    maxIn.addEventListener('input', () => { const v = parseInt(maxIn.value, 10); if (Number.isFinite(v)) maxName.textContent = midiToNoteName(Math.max(0, Math.min(127, v))); });
    minIn.addEventListener('change', applyFilter);
    maxIn.addEventListener('change', applyFilter);
  }
}

// ---------- UI ----------
$('playBtn').addEventListener('click', () => (clock.playing ? pause() : play()));
$('stopBtn').addEventListener('click', () => { pause(); seek(0); });
$('seek').addEventListener('input', (e) => seek(parseInt(e.target.value, 10) / 100));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); clock.playing ? pause() : play(); }
});
$('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
$('resetCam').addEventListener('click', () => {
  camera.position.set(0, 22, 34); controls.target.set(0, 3, -12); controls.update();
});

function setStatus(msg) { $('status').textContent = msg; }
function fmtTime(s) { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

// ---------- メインループ ----------
let lastPerf = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastPerf) / 1000);
  lastPerf = now;
  controls.update();

  if (engine && conductor && roll) {
    const t = currentTime();
    if (clock.playing && t >= engine.duration + 1) pause();
    const s = settings();
    const beat = engine.beatAt(t);
    const g = engine.globalEnergyAt(t);
    const ctx = { t, dt, beat, settings: s, globalEnergy: g };

    for (const { puppet, track } of puppets) {
      puppet.faceCamera(camera);
      puppet.update(engine.trackState(track, t), ctx);
    }
    conductor.faceCamera(camera);
    conductor.update({ energy: g, active: [], onset: null, next: null, age: Infinity, toNext: Infinity, pitchNorm: 0.5 }, ctx);

    labels.visible = s.showNames;
    roll.setVisible(s.showRoll);
    roll.setMode(s.rollMode);
    wall.visible = s.showRoll && s.rollMode === 'wall';
    if (s.showRoll) roll.update(t, s.rollSpeed, { overheadHeight: s.rollHeight, semitoneW: s.noteWidth });

    if (!$('seek').matches(':active')) $('seek').value = Math.floor(t * 100);
    $('timeLabel').textContent = `${fmtTime(t)} / ${fmtTime(engine.duration)}  ♩=${Math.round(engine.bpmAt(t))}`;
  }
  renderer.render(scene, camera);
}

// URL パラメータ ?midi=path で自動読み込み（公開デモ・動作確認用）
async function loadFromUrl() {
  const q = new URLSearchParams(location.search);
  const midiUrl = q.get('midi');
  if (!midiUrl) return;
  try {
    const res = await fetch(midiUrl, { cache: 'no-store' }); // サンプル更新をキャッシュで見逃さない
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const midi = new Midi(await res.arrayBuffer());
    midiFileName = midiUrl.split('/').pop();
    setStatus(`${midiFileName}（${midi.tracks.filter((t) => t.notes.length).length} トラック / ${fmtTime(midi.duration)}）`);
    buildScene(midi);
    const audioUrl = q.get('audio');
    if (audioUrl) {
      audio.src = audioUrl;
      audio.addEventListener('loadedmetadata', () => { audioLoaded = true; $('audioName').textContent = audioUrl.split('/').pop(); }, { once: true });
    }
  } catch (err) {
    console.error(err);
    setStatus(`✗ ${midiUrl} を読み込めませんでした（${err.message}）`);
  }
}

loadSettings();
refreshValueLabels();
animate();
loadFromUrl();
