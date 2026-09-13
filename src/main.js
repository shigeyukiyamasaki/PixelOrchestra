/*
 * PixelOrchestra — main.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * UI・再生クロック・シーン組み立て。描画ロジックは「時刻 t → 状態」の純関数で書き、
 * 将来のオフライン書き出し（Remotion 等）でも使い回せるようにする。
 */
import { MidiEngine, FAMILIES, FAMILY_LABEL, VARIANTS, DYN_SOURCES, midiToNoteName, normalizeVariant } from './midiEngine.js';
import { createStage, layoutSeats, buildRisers, setStageDepthWrite, setFloorStyle, setScreens, screenInfo, SCREEN_DEFAULT, CONDUCTOR_Z, PODIUM_H } from './stage.js';
import { Puppet } from './puppet.js';
import { nameLabel, setGlowSoftness, setPartStyle, LABEL_FONT, dotPart, PX } from './sprites.js';
import { HEAD_Y } from './pianoRoll.js';
import { TENCHI } from './logoData.js';
import { Spectrum } from './spectrum.js';
import { PianoRoll } from './pianoRoll.js';

const SETTINGS_KEY = 'pixelOrchestra.settings.v1';
const FAMILY_KEY = 'pixelOrchestra.families.v1';
// MIDIOrchestra と同じキー・同じ形式 { trackName: {pitchMin, pitchMax} }。同一オリジン（romashige.com）に置けば両ツールで共用される
const PITCH_FILTER_KEY = 'midiOrchestra_pitchFilters';
const DYN_SOURCE_KEY = 'pixelOrchestra.dynSources.v1'; // トラック名 → 強弱の情報源
const MERGE_KEY = 'pixelOrchestra.mergeInto.v1';      // トラック名 → 統合先（'auto' | 'none' | トラック名）
const SCREENS_KEY = 'pixelOrchestra.screens.v1';       // ひな壇の上に重ねるスクリーンの構成（枚数・位置・高さ・色・濃度）

// ---- ブラウザ間の設定共有（2026-09-12 ユーザー指定）----
// localStorage はブラウザごとに隔離されていて外から同期できないので、開発サーバー上の
// settings.json を「置き場所」にして、起動時に読み込み・変更時に書き出す。
// 同じ localhost:8766 を見ているブラウザは、リロードすれば同じ設定になる。
// サーバーが無い／静的配信のときは POST が失敗するだけで、これまでどおり localStorage で動く。
const SYNC_KEYS = [SETTINGS_KEY, FAMILY_KEY, PITCH_FILTER_KEY, DYN_SOURCE_KEY, MERGE_KEY, SCREENS_KEY];
const SYNC_URL = 'settings.json';
let syncTimer = null;

async function pullSettings() {
  try {
    const res = await fetch(`${SYNC_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;                                   // まだ置いていない → localStorage のまま
    const all = await res.json();
    let n = 0;
    for (const k of SYNC_KEYS) {
      if (all[k] == null) continue;
      localStorage.setItem(k, JSON.stringify(all[k]));           // 以降の読み込みは全部 localStorage 経由なので、ここで上書きするだけでよい
      n++;
    }
    if (n) console.log(`[設定共有] settings.json から ${n} 件読み込みました`);
    return true;
  } catch { return false; }                                      // サーバー無し・オフライン等
}

function pushSettings() {                                        // 変更のたびに呼ぶ（まとめ書き）
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const all = {};
    for (const k of SYNC_KEYS) {                                   // 未設定のキーは書かない（ファイルを読みやすく保つ）
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try { all[k] = JSON.parse(raw); } catch { /* 壊れていたら送らない */ }
    }
    fetch(SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all, null, 2) })
      .catch(() => {});                                          // 書けなくても致命的ではない（localStorage には入っている）
  }, 600);
}

// 起動時に読み込む。ここで待つので、以降の loadSettings() 等はサーバーの値を見る
await pullSettings();

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません（HTML と JS の id 不一致）`);
  return el;
};

// ---------- ステージ ----------
const stage = createStage($('view'));
const { scene, camera, renderer, controls, wall, setShadows } = stage;

let engine = null;
let roll = null;
let puppets = [];       // { puppet, track }
let conductor = null;
let labels = new THREE.Group(); // パート名ラベル
scene.add(labels);

// ロゴ（画像 → ボクセル）。配置は仮置き：舞台の後方に立てる（2026-09-12。置き場所は後で決める）
const logo = dotPart(TENCHI, { depth: 6, res: 1.4, name: 'tenchi', back: { '#1f7fc0': '#12689d', '#1c6a9e': '#125275', '#1a5378': '#12405e', '#f2f6fa': '#9fb4c4' },
  inner: { chars: 'i', depth: 3, z0: -3 } }); // 内側は本体より 3 セル奥 // 文字の内側は 8 セル奥に引っ込めた白い板（紺・青が出っ張る）
scene.add(logo);
window.__logo = logo; // 位置合わせ用（位置・大きさ・濃度は「タイトル」の設定から）
let logoOpacity = 1;
const spectrum = new Spectrum(scene); // タイトルの周りのスペクトラム（2026-09-12）
spectrum.setShape(TENCHI, PX / 1.4); // ロゴの輪郭（dotPart と同じ res 1.4 のセル幅）

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
    spectrum.connect(audio); // 再生の操作の中で音声をつなぐ（自動再生の制限のため）
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

// ---------- スクリーン（ひな壇の上に重ねる層。背景やキャラクターを映す想定。2026-09-13 ユーザー指定） ----------
// 枚数は自由。位置はひな壇の奥行きの中の割合（0 = 手前の辺 / 1 = 奥の辺）で持つ。
// 枚数が変わる UI なので、id 付き input の自動収集には乗せず、独自キーで保存する
let screens = (() => {
  try { const a = JSON.parse(localStorage.getItem(SCREENS_KEY) || 'null'); if (Array.isArray(a) && a.length) return a; } catch (e) { console.warn('スクリーン設定の読込失敗:', e); }
  return SCREEN_DEFAULT.map((o) => ({ ...o }));
})();
let screenSaveTimer = null;
function saveScreens() {
  clearTimeout(screenSaveTimer);
  screenSaveTimer = setTimeout(() => {
    try { localStorage.setItem(SCREENS_KEY, JSON.stringify(screens)); pushSettings(); } catch (e) { console.warn('スクリーン設定の保存失敗:', e); }
  }, 400);
}
// 素材ルート（開発サーバーが /media/ で公開しているフォルダ）。絶対パスを URL に直すのに使う
let mediaRoots = [];
fetch('media-roots.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : []).then((a) => { mediaRoots = a || []; })
  .catch(() => { mediaRoots = []; });
// Finder からコピーした絶対パスを、そのまま貼れるようにする（素材ルートの中なら /media/… に読み替える）
function toMediaUrl(src) {
  const p = (src || '').trim().replace(/^file:\/\//, '');
  if (!p || /^https?:\/\//.test(p)) return p;
  for (const root of mediaRoots) {
    if (p === root || p.startsWith(`${root}/`)) {
      return `media/${p.slice(root.length + 1).split('/').map(encodeURIComponent).join('/')}`;
    }
  }
  return p;   // プロジェクト内の相対パス（assets/… 等）はそのまま
}

// 1 枚ぶんの行を作る（2 段：上＝置き方、下＝映すもの）。値をいじったら即座に 3D へ反映し、保存は遅らせる
function screenRow(sc, i) {
  const frag = document.createDocumentFragment();
  const line = (cls) => frag.appendChild(Object.assign(document.createElement('div'), { className: cls }));
  const row = line('scr'), row2 = line('scr scr2');
  const put = (parent, html) => { const d = document.createElement('div'); d.innerHTML = html; return parent.appendChild(d.firstElementChild); };
  const changed = () => { setScreens(screens); saveScreens(); };

  const show = put(row, '<label title="このスクリーンを表示する"><input type="checkbox"></label>').querySelector('input');
  show.checked = sc.show !== false;
  show.onchange = () => { sc.show = show.checked; changed(); };

  const name = put(row, '<label><input type="text" title="名前（覚え書き。表示には影響しない）"></label>').querySelector('input');
  name.value = sc.name || `スクリーン${i + 1}`;
  name.oninput = () => { sc.name = name.value; saveScreens(); };
  name.onkeydown = (e) => e.stopPropagation();   // Space 等を再生ショートカットに取られない

  const slider = (parent, label, key, min, max, step, digits, title) => {
    const lab = put(parent, `<label title="${title}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><b></b></label>`);
    const el = lab.querySelector('input'), out = lab.querySelector('b');
    const set = (v) => { el.value = v; out.textContent = (+el.value).toFixed(digits); };
    set(sc[key] ?? min);
    el.oninput = () => { sc[key] = +el.value; out.textContent = (+el.value).toFixed(digits); changed(); };
    return set;
  };
  slider(row, '位置', 'pos', 0, 1, 0.01, 2, 'ひな壇の奥行きの中での位置。0 = 手前の辺、1 = 奥の辺');
  slider(row, '高さ', 'h', 1, 40, 0.5, 1, 'ひな壇の天面からの高さ [unit]');
  slider(row, '濃度', 'opacity', 0.05, 1, 0.05, 2, '不透明度。1 で完全に不透明、下げるほど後ろが透ける');

  const col = put(row, '<label title="確認用の色（素材を入れるまでの仮の色）"><input type="color"></label>').querySelector('input');
  col.value = sc.color;
  col.oninput = () => { sc.color = col.value; changed(); };

  const del = put(row, '<button title="このスクリーンを削除する">削除</button>');
  del.onclick = () => { screens.splice(i, 1); renderScreens(); changed(); };

  // ---- 下の段：映すもの ----
  const src = put(row2, '<label class="src" title="透過 PNG か、緑背景の mp4。Finder からコピーした絶対パスをそのまま貼れる"><span>素材</span><input type="text" placeholder="/Volumes/… もしくは assets/…"></label>').querySelector('input');
  src.value = sc.srcRaw || sc.src || '';
  src.onkeydown = (e) => e.stopPropagation();
  src.onchange = () => { sc.srcRaw = src.value.trim(); sc.src = toMediaUrl(src.value); changed(); };

  const setWide = slider(row2, '幅', 'wide', 0.02, 1, 0.01, 2, 'ひな壇の弧全体に対する幅の割合。キャラクターを置く時は小さくする');
  slider(row2, '横位置', 'at', -1, 1, 0.01, 2, '-1 = 左端、0 = 中央、1 = 右端');

  const fit = put(row2, '<button title="素材の縦横比に合わせて幅を決める（高さはそのまま）">比率</button>');
  fit.onclick = () => {
    const info = screenInfo(i);
    if (!info || !info.aspect) { fit.textContent = '未読込'; setTimeout(() => { fit.textContent = '比率'; }, 1200); return; }
    sc.wide = Math.max(0.02, Math.min(1, (sc.h * info.aspect) / info.arcFull));
    setWide(sc.wide); changed();
  };

  const key = put(row2, '<label title="抜く色（緑背景の色）。透過 PNG ならしきい値 0 のままでよい"><span>キー色</span><input type="color"></label>').querySelector('input');
  key.value = sc.key || '#00ff00';
  key.oninput = () => { sc.key = key.value; changed(); };
  slider(row2, 'しきい値', 'thr', 0, 1, 0.01, 2, 'キー色にどれだけ近い画素まで抜くか。0 で抜かない。mp4 は色がにじむので大きめに');
  return frag;
}
function renderScreens() {
  const box = $('screenRows');
  if (!box) return;
  box.textContent = '';
  screens.forEach((sc, i) => box.appendChild(screenRow(sc, i)));
  setBarHeight();
}
const SCREEN_COLORS = ['#4a90d9', '#e0645a', '#5ec26a', '#d9b23f', '#9a6fd0', '#3fb6c2'];   // 確認用の仮の色（順に使い回す）
$('screenAdd').addEventListener('click', () => {
  const n = screens.length;
  screens.push({ name: `スクリーン${n + 1}`, pos: Math.max(0, 1 - n * 0.25), h: 10,
                 color: SCREEN_COLORS[n % SCREEN_COLORS.length], opacity: 1, show: true,
                 src: '', key: '#00ff00', thr: 0, wide: 1, at: 0 });
  renderScreens();
  setScreens(screens); saveScreens();
});
// プレビューの高さ計算（style.css の --barh）に、上下のバーの実寸を渡す
function setBarHeight() {
  const h = ($('camBar')?.offsetHeight || 0) + ($('screenBar')?.offsetHeight || 0);
  if (h) document.documentElement.style.setProperty('--barh', `${h}px`);
}
addEventListener('resize', setBarHeight);

// ---------- 設定（id 付き input を自動収集して保存・復元） ----------
const SETTING_IDS = () => [...document.querySelectorAll('#panel input[id], #panel select[id], #topbar input[id], #topbar select[id], #camBar input[id]')]
  .filter((el) => el.type !== 'file' && el.id !== 'seek');
// ラジオボタンは name をキーに、選択中の value を保存
const RADIO_NAMES = () => [...new Set([...document.querySelectorAll('#panel input[type=radio][name]')].map((el) => el.name))];
const radioValue = (name) => document.querySelector(`#panel input[type=radio][name="${name}"]:checked`)?.value;

function saveSettings() {
  const data = {};
  for (const el of SETTING_IDS()) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  for (const name of RADIO_NAMES()) data[name] = radioValue(name);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); pushSettings(); } catch (e) { console.warn('設定保存失敗:', e); }
}
function loadSettings() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { console.warn('設定読込失敗（デフォルトで続行）:', e); }
  for (const el of SETTING_IDS()) {
    if (!(el.id in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.id]; else el.value = data[el.id];
  }
  for (const name of RADIO_NAMES()) {
    if (!(name in data)) continue;
    const el = document.querySelector(`#panel input[type=radio][name="${name}"][value="${data[name]}"]`);
    if (el) el.checked = true;
  }
}
let saveTimer = null;
for (const id of ['panel', 'topbar', 'camBar']) document.getElementById(id)?.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
  refreshValueLabels();
});
function refreshValueLabels() {
  for (const el of document.querySelectorAll('#panel input[type=range][id], #camBar input[type=range][id]')) {
    const lab = document.querySelector(`[data-value-for="${el.id}"]`);
    if (!lab) continue;
    if (lab.tagName === 'INPUT') { if (document.activeElement !== lab) lab.value = el.value; } // 数値入力欄（編集中は上書きしない）
    else lab.textContent = el.value;
  }
}
// スライダーの値表示を数値入力欄に置き換える（直接入力できる。Enter/フォーカス外しで確定、範囲外はスライダーの範囲に丸める。2026-09-11 ユーザー指定）
function makeValueInputs() {
  for (const el of document.querySelectorAll('#panel input[type=range][id], #camBar input[type=range][id]')) {
    const lab = document.querySelector(`b[data-value-for="${el.id}"]`);
    if (!lab) continue;
    const num = document.createElement('input');
    num.type = 'number'; num.className = 'num'; num.dataset.valueFor = el.id;
    num.min = el.min; num.max = el.max; num.step = el.step || 'any'; num.value = el.value;
    num.title = '数値を直接入力（Enter で確定）';
    const commit = () => {
      if (num.value === '') { num.value = el.value; return; }
      const v = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), parseFloat(num.value)));
      if (Number.isNaN(v)) { num.value = el.value; return; }
      el.value = v; num.value = el.value;
      el.dispatchEvent(new Event('input', { bubbles: true })); // スライダーを動かしたのと同じ経路（保存・反映）
    };
    num.addEventListener('change', commit);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); num.blur(); } e.stopPropagation(); }); // Space 等をショートカットに取られない
    num.addEventListener('keyup', (e) => e.stopPropagation());
    // 右側の上下矢印（1 ステップずつ増減。押しっぱなしで連続）
    const wrap = document.createElement('span'); wrap.className = 'numwrap';
    const spin = document.createElement('span'); spin.className = 'numspin';
    const step = parseFloat(el.step) || 1;
    const bump = (dir) => {
      const v = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), (parseFloat(num.value) || 0) + dir * step));
      el.value = v; num.value = el.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (const [dir, glyph, title] of [[1, '▲', '増やす'], [-1, '▼', '減らす']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = glyph; b.title = title; b.tabIndex = -1;
      let timer = null, repeat = null;
      const stop = () => { clearTimeout(timer); clearInterval(repeat); timer = repeat = null; };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); bump(dir); timer = setTimeout(() => { repeat = setInterval(() => bump(dir), 60); }, 400); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
      spin.appendChild(b);
    }
    lab.replaceWith(wrap); wrap.append(num, spin);
  }
}
function settings() {
  const num = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
  return {
    sway: num('sway', 1),
    dynResponse: num('dynResponse', 1),
    rollSpeed: num('rollSpeed', 3),
    rollHeight: num('rollHeight', 7),
    noteWidth: num('noteWidth', 0.22),
    showRoll: $('showRoll').checked,
    rollMode: radioValue('rollMode') === 'wall' ? 'wall' : 'overhead',
    showLandLine: false, // 着地点のラインは不要（2026-09-10 ユーザー確定。UI 撤去）
    rollOpacity: num('rollOpacity', 0.85),
    rollGlow: num('rollGlow', 0),
    showGlow: $('showGlow').checked,
    glowIntensity: num('glowIntensity', 1),
    glowSoft: num('glowSoft', 0.6),
    showNames: $('showNames').checked,
    labelSize: num('labelSize', 1), labelSource: radioValue('labelSource') === 'variant' ? 'variant' : 'name', // パート名（2026-09-12）
    floorStyle: $('floorStyle')?.value === 'grass' ? 'grass' : 'plank', // 床の絵（板目／草原）
    showShadows: $('showShadows').checked,
    ambient: num('ambient', 0.7),
    spotIntensity: num('spotIntensity', 1.6),
    spotElev: num('spotElev', 40),
    spotSpread: num('spotSpread', 30),
    spotCone: num('spotCone', 30),
    spotBlur: num('spotBlur', 0.5),
    exposure: num('exposure', 1),
    bgTop: $('bgTop').value, bgBottom: $('bgBottom').value, bgMid: num('bgMid', 50),
    showTitle: $('showTitle').checked, // タイトルのロゴ（2026-09-12）
    showSpectrum: $('showSpectrum').checked, // スペクトラム（同日）
    specBars: num('specBars', 64), specRadius: num('specRadius', 4), specHeight: num('specHeight', 2.5),
    specWidth: num('specWidth', 1), specOpacity: num('specOpacity', 0.9), specColor: $('specColor').value,
    specMode: radioValue('specMode') === 'logo' ? 'logo' : 'circle',
    titleX: num('titleX', 0), titleY: num('titleY', 7), titleZ: num('titleZ', -12), titleScale: num('titleScale', 1), titleOpacity: num('titleOpacity', 1),
    facing: 'conductor',  // 体の向きは指揮者固定（2026-09-10 ユーザー確定。UI は撤去）
    partStyle: 'voxel',   // 絵の方式はボクセル固定（2026-09-10 ユーザー確定。2D の板の実装は sprites.js に残っているが UI は撤去）
  };
}

// トラック → 楽器の手動割当（MIDI ファイル名ごと。値は楽器名。旧形式のファミリー名も engine 側で受け付ける）
function loadFamilyOverrides(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(FAMILY_KEY) || '{}')[name] || {};
    // 旧名 'violin'（1st/2nd に分ける前）の保存値は捨てて自動判定に戻す。残すと 2nd バイオリンまで 1st になる（2026-09-12）
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => normalizeVariant(v) === v));
  } catch { return {}; }
}
function saveFamilyOverride(name, key, family) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(FAMILY_KEY) || '{}'); } catch { all = {}; }
  (all[name] ||= {})[key] = family;
  try { localStorage.setItem(FAMILY_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('割当保存失敗:', e); }
}

// 音域フィルター（キースイッチ除外）：トラック名 → {pitchMin, pitchMax}
function loadPitchFilters() {
  try { return JSON.parse(localStorage.getItem(PITCH_FILTER_KEY) || '{}'); } catch { return {}; }
}
function savePitchFilter(trackName, pitchMin, pitchMax) {
  const all = loadPitchFilters();
  if (pitchMin <= 0 && pitchMax >= 127) delete all[trackName]; else all[trackName] = { pitchMin, pitchMax };
  try { localStorage.setItem(PITCH_FILTER_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('音域保存失敗:', e); }
}

// 強弱の情報源（velocity / CC1 / CC11）：トラック名 → source
function loadDynSources() {
  try { return JSON.parse(localStorage.getItem(DYN_SOURCE_KEY) || '{}'); } catch { return {}; }
}
function saveDynSource(trackName, source) {
  const all = loadDynSources();
  if (source === 'auto') delete all[trackName]; else all[trackName] = source;
  try { localStorage.setItem(DYN_SOURCE_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('強弱ソース保存失敗:', e); }
}

// トラック統合：トラック名 → 'auto' | 'none' | 統合先トラック名
function loadMerges() {
  try { return JSON.parse(localStorage.getItem(MERGE_KEY) || '{}'); } catch { return {}; }
}
function saveMerge(trackName, value) {
  const all = loadMerges();
  if (value === 'auto') delete all[trackName]; else all[trackName] = value;
  try { localStorage.setItem(MERGE_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('統合設定保存失敗:', e); }
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
  audio.addEventListener('error', () => { audioLoaded = false; $('audioName').textContent = '✗ 再生できない形式（mp3/wav/m4a）'; }, { once: true });
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

  engine = new MidiEngine(midi, loadFamilyOverrides(midiFileName), loadPitchFilters(), loadDynSources(), loadMerges());
  roll = new PianoRoll(scene, engine, camera);
  placePuppets();
  renderTrackTable();
  $('seek').max = Math.floor(engine.duration * 100);
  if (keepTime && wasPlaying) play();
}
// デバッグ用フック（DevTools から window.__po.puppets 等を参照できる）
window.__po = { get engine() { return engine; }, get puppets() { return puppets; }, get conductor() { return conductor; }, camera, controls, scene, renderer, Puppet, spectrum };

// 楽器を含む奏者 1 人の横方向の占有範囲 [unit]（奏者の原点基準、+x = 奏者の左）。variant ごとに 1 度だけ仮のパペットを作って測る。
// 大きな楽器（グランカッサ・ピアノ・ハープ等）の隣に自動で隙間が空く
const footprintCache = new Map();
function footprintOf(track) {
  const key = `${track.variant}|${settings().partStyle}`;
  if (!footprintCache.has(key)) {
    const p = new Puppet({ family: track.family, variant: track.variant, color: '#ffffff', seed: 0 });
    footprintCache.set(key, p.measureFootprint());
  }
  return footprintCache.get(key);
}

// トーンマッピング（2026-09-10）：スポットを強くした時の白飛びを抑える。「ハイライトのみ」固定（2026-09-10 ユーザー確定。Reinhard/ACES は彩度が落ちるので廃止）
// 輝度 0.8 までは素通し（色も彩度もそのまま）、それ以上だけ 1.0 に漸近するよう圧縮。
// 圧縮は輝度に対して行い RGB を同じ比率で縮めるので色相・彩度が変わらない（ACES は 1.0 以下でも彩度が落ちるという指摘への対応）
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
    color *= toneMappingExposure;
    float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    const float knee = 0.8;
    if ( l <= knee ) return color;
    float t = l - knee;
    float c = knee + ( 1.0 - knee ) * ( t / ( t + ( 1.0 - knee ) ) ); // knee で傾き 1 のまま接続し、1.0 に漸近
    return color * ( c / l );
  }`,
);
renderer.toneMapping = THREE.CustomToneMapping;
// 背景：上下グラデーション（CSS）。中間地点 = 2 色が半分ずつ混ざる高さ [%]（2026-09-10）
let bgApplied = '';
function applyBackground(top, bottom, mid) {
  const css = `linear-gradient(to bottom, ${top}, ${mid}%, ${bottom})`;
  if (css === bgApplied) return;
  bgApplied = css;
  $('view').style.background = css;
}
function applyToneMapping(exposure) { renderer.toneMappingExposure = exposure; }

function placePuppets() {
  setPartStyle(settings().partStyle);
  setStageDepthWrite(settings().partStyle !== 'sprite'); // ボクセルは通常の深度、2D の板は描画順で前後を決める
  for (const p of puppets) scene.remove(p.puppet.root);
  puppets = [];
  if (conductor && conductor.style !== settings().partStyle) { scene.remove(conductor.root); conductor = null; } // 方式が変わったら作り直す
  const seats = layoutSeats(engine.tracks, footprintOf);
  let seed = 1;
  for (const seat of seats) {
    seat.positions.forEach((pos) => {
      const puppet = new Puppet({ family: seat.track.family, variant: seat.track.variant, color: seat.track.color, seed: seed++ });
      puppet.delay = 0.035 * (pos.row || 0); // 後列ほどわずかに遅れる（プルトの揃いと奥行き感）
      puppet.root.position.set(pos.x, pos.y, pos.z);
      scene.add(puppet.root);
      puppets.push({ puppet, track: seat.track });
    });
  }
  roll.setSeats(seats); // 頭上ロールの列位置を座席に合わせる
  buildRisers(seats);   // ひな壇を使われている角度だけの扇形に作り直す
  lastSeats = seats;
  rebuildLabels();
  if (!conductor) {
    conductor = new Puppet({ isConductor: true, color: '#ffffff', seed: 99 });
    conductor.root.position.set(0, PODIUM_H, CONDUCTOR_Z);
  }
  scene.add(conductor.root);
}

// パート名ラベル：トラックごとに奏者グループの中央・頭の少し上（フォント読み込み後にも作り直す）
let lastSeats = [];
let labelSizeApplied = 1, labelSourceApplied = 'name';
function rebuildLabels() {
  labels.traverse((o) => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  labels.clear();
  for (const seat of lastSeats) {
    const ps = seat.positions;
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const s = settings();
    const text = s.labelSource === 'variant' ? (VARIANTS[seat.track.variant]?.label || seat.track.name) : seat.track.name;
    const sp = nameLabel(text, seat.track.color, s.labelSize);
    sp.position.set(cx, ps[0].y + HEAD_Y - 0.55, cz);
    labels.add(sp);
  }
}
document.fonts?.load(`12px "${LABEL_FONT}"`).then(() => rebuildLabels()).catch(() => {});

function renderTrackTable() {
  const tbody = $('trackRows');
  tbody.innerHTML = '';
  for (const tr of engine.sources) { // 設定は MIDI トラック単位（統合後のセクションではなく）
    const row = document.createElement('tr');
    if (tr.mergeTarget) row.className = 'merged';
    const sel = document.createElement('select');
    sel.title = 'このトラックを演奏する楽器。絵・動き・配置（列）が変わる。名前から自動判定した結果が初期値';
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
      saveFamilyOverride(midiFileName, tr.key, sel.value);
      buildScene(currentMidi, { keepTime: true }); // 統合の可否（同じ楽器か）も変わるので組み直す
    });
    const section = engine.tracks.find((sec) => sec.sources.includes(tr));
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = section ? section.color : '#888';
    const tdSw = document.createElement('td'); tdSw.appendChild(sw);
    const tdName = document.createElement('td'); tdName.className = 'name'; tdName.title = tr.name; tdName.textContent = tr.name;
    if (tr.mergeTarget) { tdName.title = `${tr.name} → ${tr.mergeTarget.name} に統合`; tdName.textContent = `↳ ${tr.name}`; }
    const tdN = document.createElement('td'); tdN.textContent = tr.notes.length; tdN.title = 'このトラックのノート数';
    if (tr.notes.length !== tr.totalNotes) { tdN.textContent = `${tr.notes.length}/${tr.totalNotes}`; tdN.title = '音域フィルターで除外あり（表示／全体）'; }
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
    const lab = document.createElement('span'); lab.className = 'pitch-label'; lab.textContent = '音域'; lab.title = '演奏として扱う音域（MIDI ノート番号）。範囲外＝キースイッチ等は動き・ロール・強さの全てから除外。音名は Logic 表記（C3 = 60）';
    const sep = document.createElement('span'); sep.textContent = '〜';
    td2.append(lab, minIn, minName, sep, maxIn, maxName);
    // 強弱の情報源（velocity / CC1 / CC11）。自動の時は判定結果を併記
    const dynLab = document.createElement('span'); dynLab.className = 'pitch-label dyn-label'; dynLab.textContent = '強弱'; dynLab.title = '前傾・揺れ幅・足元の光に使う強さの情報源';
    const dynSel = document.createElement('select'); dynSel.className = 'dyn-select';
    for (const [v, label] of Object.entries(DYN_SOURCES)) {
      const o = document.createElement('option'); o.value = v;
      o.textContent = v === 'auto' ? `自動（${DYN_SOURCES[tr.dynResolved] || tr.dynResolved}）` : label;
      if (v === tr.dynSource) o.selected = true;
      dynSel.appendChild(o);
    }
    dynSel.title = '強さの情報源。自動＝曲中で変化している CC1/CC11 を採用（無ければ velocity）。CC は発音中だけ有効。弓の振り幅や打楽器の振り下ろしは常に velocity';
    dynSel.addEventListener('change', () => { saveDynSource(tr.name, dynSel.value); buildScene(currentMidi, { keepTime: true }); });
    td2.append(document.createElement('br'), dynLab, dynSel);
    // 統合先：重ね録りした別音源のトラックを同じ奏者にまとめる
    const mgLab = document.createElement('span'); mgLab.className = 'pitch-label dyn-label'; mgLab.textContent = '統合'; mgLab.title = '重ね録りしたトラックを同じ奏者にまとめる';
    const mgSel = document.createElement('select'); mgSel.className = 'dyn-select';
    const addOpt = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; if (v === tr.mergeSetting) o.selected = true; mgSel.appendChild(o); };
    addOpt('auto', `自動（${tr.mergeResolved === 'none' ? 'しない' : '→ ' + tr.mergeResolved}）`);
    addOpt('none', '統合しない');
    for (const other of engine.sources) if (other !== tr && other.variant === tr.variant) addOpt(other.name, `→ ${other.name}`);
    mgSel.title = '統合先。自動＝楽器が同じで、末尾の _HW/_CB 等と +N を除いた名前が一致するトラックへ統合。楽器が同じトラックだけ選べる';
    mgSel.addEventListener('change', () => { saveMerge(tr.name, mgSel.value); buildScene(currentMidi, { keepTime: true }); });
    td2.append(mgLab, mgSel);
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
  if (e.code !== 'Space') return;
  // 文字/数値入力とプルダウンの中だけはスペースを通す。ファイル選択・ボタン・スライダーにフォーカスがあっても再生/停止にする
  const el = e.target;
  const typing = (el.tagName === 'INPUT' && ['text', 'number', 'search'].includes(el.type)) || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
  if (typing) return;
  e.preventDefault();
  clock.playing ? pause() : play();
});
// ファイル選択後はフォーカスを外す（残っているとスペースがファイルダイアログに取られる）
for (const id of ['midiFile', 'audioFile']) $(id).addEventListener('change', () => $(id).blur());
// プレビュー上のカメラ操作バーの高さを CSS 変数に流す（プレビューの最大幅の計算に使う。2026-09-12）
{
  const bar = $('camBar');
  const setBarH = () => document.documentElement.style.setProperty('--barh', `${bar.offsetHeight}px`);
  new ResizeObserver(setBarH).observe(bar);
  setBarH();
}

$('resetCam').addEventListener('click', () => {
  camera.position.set(0, 6, 10.5); controls.target.set(0, 4, -12); controls.update(); // 既定のカメラ（2026-09-11 ユーザー指定）
  syncCameraSliders();
});

// ---------- カメラ座標スライダー（MIDIOrchestra を参考に。2026-09-11）----------
// スライダー → カメラ、マウス操作（OrbitControls）→ スライダー の双方向。値は他の設定と同じく自動保存される
const CAM_IDS = ['camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ'];
let camSyncing = false;
function syncCameraSliders() { // カメラ → スライダー
  camSyncing = true;
  const p = camera.position, t = controls.target;
  const vals = { camX: p.x, camY: p.y, camZ: p.z, tgtX: t.x, tgtY: t.y, tgtZ: t.z };
  for (const id of CAM_IDS) $(id).value = vals[id].toFixed(1);
  refreshValueLabels();
  camSyncing = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}
function applyCameraSliders(movedId = null) { // スライダー → カメラ
  const v = (id) => parseFloat($(id).value);
  if (movedId && movedId.startsWith('cam')) {
    // 位置のスライダー：カメラと中心点を同じ量だけ平行移動（中心点を固定したまま位置だけ動かすと回転に見える。2026-09-11 ユーザー指摘）
    const d = new THREE.Vector3(v('camX') - camera.position.x, v('camY') - camera.position.y, v('camZ') - camera.position.z);
    camera.position.add(d); controls.target.add(d);
    controls.update();
    syncCameraSliders();
    return;
  }
  camera.position.set(v('camX'), v('camY'), v('camZ'));
  controls.target.set(v('tgtX'), v('tgtY'), v('tgtZ'));
  controls.update();
}
for (const id of CAM_IDS) $(id).addEventListener('input', () => { if (!camSyncing) applyCameraSliders(id); });
controls.addEventListener('change', () => { if (!camSyncing) syncCameraSliders(); });

function setStatus(msg) { $('status').textContent = msg; }
function fmtTime(s) { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

// ---------- メインループ ----------
let lastPerf = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastPerf) / 1000);
  lastPerf = now;
  stage.resize(); // プレビューの大きさに追従（変わった時だけ設定する。初回の描画サイズ取りこぼし対策も兼ねる）
  controls.update();

  if (engine && conductor && roll) {
    const t = currentTime();
    if (clock.playing && t >= engine.duration + 1) pause();
    const s = settings();
    const beat = engine.beatAt(t);
    const g = engine.globalEnergyAt(t);
    const ctx = { t, dt, beat, settings: s, globalEnergy: g };

    const face = (p) => (s.facing === 'conductor' ? p.faceToward(0, CONDUCTOR_Z) : p.faceCamera(camera));
    for (const { puppet, track } of puppets) {
      face(puppet);
      puppet.update(engine.trackState(track, t - puppet.delay), ctx);
    }
    face(conductor);
    conductor.update({ energy: g, active: [], onset: null, next: null, age: Infinity, toNext: Infinity, pitchNorm: 0.5 }, ctx);

    labels.visible = s.showNames;
    if (s.labelSize !== labelSizeApplied || s.labelSource !== labelSourceApplied) { // 大きさ・表示する名前が変わったらラベルを作り直す
      labelSizeApplied = s.labelSize; labelSourceApplied = s.labelSource;
      rebuildLabels();
    }
    setShadows({ enabled: s.showShadows && s.partStyle !== 'sprite', ambient: s.ambient, spot: s.spotIntensity, spotElev: s.spotElev, spotSpread: s.spotSpread, spotCone: s.spotCone, spotBlur: s.spotBlur });
    applyToneMapping(s.exposure);
    applyBackground(s.bgTop, s.bgBottom, s.bgMid);
    setFloorStyle(s.floorStyle);   // 変わった時だけ作り直す（中で同じなら何もしない）
    logo.visible = s.showTitle;
    logo.position.set(s.titleX, s.titleY, s.titleZ);
    logo.scale.setScalar(s.titleScale);
    spectrum.setVisible(s.showSpectrum);
    spectrum.setOptions({ bars: s.specBars, radius: s.specRadius, height: s.specHeight, width: s.specWidth, opacity: s.specOpacity, color: s.specColor, mode: s.specMode });
    spectrum.setTransform(logo.position, s.titleScale);
    spectrum.update();
    if (s.titleOpacity !== logoOpacity) { // 透過（1 未満なら透明扱いにして奥のものが透ける）
      logoOpacity = s.titleOpacity;
      logo.traverse((m) => { if (m.isMesh) { m.material.opacity = logoOpacity; m.material.transparent = logoOpacity < 1; m.material.depthWrite = logoOpacity >= 1; m.material.needsUpdate = true; } });
    }
    setGlowSoftness(s.glowSoft);
    roll.setVisible(s.showRoll);
    roll.setMode(s.rollMode, s.showLandLine);
    roll.setOpacity(s.rollOpacity);
    roll.setGlow(s.rollGlow);
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

makeValueInputs();
loadSettings();
renderScreens();      // スクリーンの操作メニューを作る（3D 側はひな壇の組み立て時に反映される）
setScreens(screens);
refreshValueLabels();
applyCameraSliders(); // 保存されたカメラ座標を復元
animate();
loadFromUrl();
