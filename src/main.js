/*
 * PixelOrchestra — main.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * UI・再生クロック・シーン組み立て。描画ロジックは「時刻 t → 状態」の純関数で書き、
 * 将来のオフライン書き出し（Remotion 等）でも使い回せるようにする。
 */
import { MidiEngine, FAMILIES, FAMILY_LABEL, VARIANTS, DYN_SOURCES, midiToNoteName, normalizeVariant } from './midiEngine.js';
import { createStage, layoutSeats, buildRisers, setStageDepthWrite, setFloorStyle, setScreens, setDomes, updateScreens, setWeather, updateWeather, screenInfo, SCREEN_DEFAULT, DOME_DEFAULT, CONDUCTOR_Z, PODIUM_H, SEAT_SHIFT_Z, sunFromTime, updateSky, renderFrame } from './stage.js';
import { Puppet } from './puppet.js';
import { setVoxelOverrides, COSTUMES } from './costume.js';
import { nameLabel, setGlowSoftness, setPartStyle, applyMetalLook, LABEL_FONT, dotPart } from './sprites.js';
import { HEAD_Y } from './pianoRoll.js';
import { TENCHI } from './logoData.js';
import { PianoRoll } from './pianoRoll.js';
import { AutoCamera } from './autoCam.js';

// ---- 視聴モード（公開ページ。index.html?view=プロジェクト名。2026-09-18 ユーザー指定）----
// 操作パネルを隠して映像だけを出し、projects/<名前>/ を読んで再生する。romashige.com へ公開した時の見せ方。
// 設定はその場限りの保存領域に入れる：手元で ?view= を開いても、編集画面の localStorage と settings.json を書き換えないように
const VIEW_NAME = new URLSearchParams(location.search).get('view') || '';
const COSTUME = new URLSearchParams(location.search).get('costume') || '';   // 衣装の試作：?costume=cecil で全員に着せる（2026-09-20 ユーザー指定）
const LS = VIEW_NAME ? memoryStorage() : window.localStorage;
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
if (VIEW_NAME) { document.body.classList.add('viewer'); document.title = `${VIEW_NAME} — Pixel Orchestra`; }

const SETTINGS_KEY = 'pixelOrchestra.settings.v1';
const FAMILY_KEY = 'pixelOrchestra.families.v1';
// MIDIOrchestra と同じキー・同じ形式 { trackName: {pitchMin, pitchMax} }。同一オリジン（romashige.com）に置けば両ツールで共用される
const PITCH_FILTER_KEY = 'midiOrchestra_pitchFilters';
const DYN_SOURCE_KEY = 'pixelOrchestra.dynSources.v1'; // トラック名 → 強弱の情報源
const MERGE_KEY = 'pixelOrchestra.mergeInto.v1';      // トラック名 → 統合先（'auto' | 'none' | トラック名）
const COSTUME_KEY = 'pixelOrchestra.costumes.v1';     // トラック名 → 衣装のキー（そのセクションの首席 1 人だけが着る。2026-09-22 ユーザー指定）
const CONDUCTOR_COSTUME_KEY = 'pixelOrchestra.conductorCostume.v1'; // 指揮者に着せる衣装のキー（2026-09-22 ユーザー指定）
const SCREENS_KEY = 'pixelOrchestra.screens.v1';       // ひな壇の上に重ねるスクリーンの構成（枚数・位置・高さ・色・濃度）
const CREDITS_KEY = 'pixelOrchestra.credits.v1';       // クレジットの入力履歴と「ゲーム → 作曲者」
const DOMES_KEY = 'pixelOrchestra.domes.v1';           // スカイドーム（遠景。3 層固定）の対応
const PRESETS_KEY = 'pixelOrchestra.presets.v1';       // プリセット（上の設定を丸ごと名前付きで控える。2026-09-14 ユーザー指定）
const SECTION_PRESETS_KEY = 'pixelOrchestra.sectionPresets.v1'; // 箱ごとのプリセット { 箱: { 名前: 中身 } }（天気・光源など細かい単位。2026-09-19 ユーザー指定）
// 箱ごとに最後に選んだ（保存した）プリセット名 { 箱: 名前 }。プロジェクト・プリセットの控えに入れ、選び直すと保存時の名前に戻る（2026-09-20 ユーザー指定）
const SECTION_SEL_KEY = 'pixelOrchestra.sectionSel.v1';

// ---- ブラウザ間の設定共有（2026-09-12 ユーザー指定）----
// localStorage はブラウザごとに隔離されていて外から同期できないので、開発サーバー上の
// settings.json を「置き場所」にして、起動時に読み込み・変更時に書き出す。
// 同じ localhost:8766 を見ているブラウザは、リロードすれば同じ設定になる。
// サーバーが無い／静的配信のときは POST が失敗するだけで、これまでどおり localStorage で動く。
const PRESET_KEYS = [SETTINGS_KEY, FAMILY_KEY, PITCH_FILTER_KEY, DYN_SOURCE_KEY, MERGE_KEY, COSTUME_KEY, CONDUCTOR_COSTUME_KEY, SCREENS_KEY, CREDITS_KEY, DOMES_KEY, SECTION_SEL_KEY];
const SYNC_KEYS = [...PRESET_KEYS, PRESETS_KEY, SECTION_PRESETS_KEY];   // プリセットそのもの（全体・箱ごと）も共有する（中身には入れない）。プロジェクトはサーバーのフォルダに保存（2026-09-18）
const SYNC_URL = 'settings.json';
let syncTimer = null;

async function pullSettings() {
  if (VIEW_NAME) return false;                                   // 視聴モードは共有の設定を読まない（プロジェクトの設定で再生する）
  try {
    const res = await fetch(`${SYNC_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;                                   // まだ置いていない → localStorage のまま
    const all = await res.json();
    let n = 0;
    for (const k of SYNC_KEYS) {
      if (all[k] == null) continue;
      LS.setItem(k, JSON.stringify(all[k]));           // 以降の読み込みは全部 localStorage 経由なので、ここで上書きするだけでよい
      n++;
    }
    if (n) console.log(`[設定共有] settings.json から ${n} 件読み込みました`);
    return true;
  } catch { return false; }                                      // サーバー無し・オフライン等
}

function pushSettings() {                                        // 変更のたびに呼ぶ（まとめ書き）
  if (VIEW_NAME) return;                                         // 視聴モードは書き出さない（編集画面の設定を上書きしないため）
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const all = {};
    for (const k of SYNC_KEYS) {                                   // 未設定のキーは書かない（ファイルを読みやすく保つ）
      const raw = LS.getItem(k);
      if (raw == null) continue;
      try { all[k] = JSON.parse(raw); } catch { /* 壊れていたら送らない */ }
    }
    fetch(SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all, null, 2) })
      .catch(() => {});                                          // 書けなくても致命的ではない（localStorage には入っている）
  }, 600);
}

// 起動時に読み込む。ここで待つので、以降の loadSettings() 等はサーバーの値を見る
await pullSettings();

// 衣装の部位で、編集画面（/edit.html）で保存したボクセルがあれば読む（2026-09-21 ユーザー指定）。
// 部位を作るのは後（placePuppets）なので、ここで待っておけば間に合う
try {
  const r = await fetch('/voxels.json?t=' + Date.now(), { cache: 'no-store' });
  if (r.ok) {
    const all = await r.json();
    setVoxelOverrides(all);
    const n = Object.keys(all).length;
    if (n) console.log(`[衣装] 編集したボクセルを ${n} 部位ぶん読み込みました`);
  }
} catch (e) { console.warn('[衣装] /voxels.json を読めません（元の形で続行）:', e.message); }

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません（HTML と JS の id 不一致）`);
  return el;
};

// ---------- ステージ ----------
const stage = createStage($('view'));
const { scene, camera, renderer, controls, setShadows } = stage;

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

// ---- タイトルを「ひな壇の曲率」で曲げる（2026-09-13 ユーザー指定）----
// ひな壇は (0, SEAT_SHIFT_Z) を中心とした円弧なので、ロゴをその中心まわりの円筒に巻き付ける。
// 半径はロゴの Z 位置から毎フレーム決まるので、Z を動かせばその位置の曲がり方になる。
// 頂点シェーダで曲げる（ジオメトリは他と共有＆キャッシュされているため、作り直さない）
const bendU = { uBend: { value: 0 }, uCz: { value: SEAT_SHIFT_Z }, uX0: { value: 0 }, uZ0: { value: 0 }, uS: { value: 1 } };
logo.traverse((m) => {
  if (!m.isMesh) return;
  m.material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, bendU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBend; uniform float uCz; uniform float uX0; uniform float uZ0; uniform float uS;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uBend > 0.5) {
          float R0 = uCz - uZ0;                       // ロゴの中心面から円弧の中心までの距離
          if (R0 > 1.0) {
            float th = (uX0 + uS * transformed.x) / R0;   // 弧の長さが横位置と一致するように
            float Rv = R0 - uS * transformed.z;           // 厚みぶんは半径方向にずらす
            float xw = Rv * sin(th);
            float zw = uCz - Rv * cos(th);
            transformed.x = (xw - uX0) / uS;              // 親の位置・倍率を打ち消してローカルへ戻す
            transformed.z = (zw - uZ0) / uS;
          }
        }`);
  };
  m.material.needsUpdate = true;
});

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

// 遅延（秒）。MIDI 遅延は奏者の動き・ピアノロールを、音声遅延は音を、舞台の時計に対して遅らせる。
// どちらもプラスで遅らせる（MIDIOrchestra と同じ向き。2026-09-14 ユーザー指定）
function midiDelaySec() { const v = parseFloat($('midiDelay').value); return Number.isFinite(v) ? v : 0; }
function audioDelaySec() { const v = parseFloat($('audioDelay').value); return Number.isFinite(v) ? v : 0; }

// 舞台の時計（マスター）。音声が実際に鳴っている間だけ音声の時計に従う
// （音声遅延がプラスの頭は、まだ鳴っていないので performance.now() で進める）
function currentTime() {
  if (!clock.playing) return clock.t;
  if (audioLoaded && !audio.paused) return audio.currentTime + audioDelaySec();
  return clock.tStart + (performance.now() - clock.perfStart) / 1000;
}
/** 舞台の時計 t のとき、音声を鳴らすべきか・どこへ合わせるか（毎フレーム呼ぶ） */
function syncAudio(t) {
  if (!audioLoaded || !clock.playing) return;
  const at = t - audioDelaySec();
  if (at < 0) { if (!audio.paused) audio.pause(); audio.currentTime = 0; return; } // まだ出番でない
  if (audio.paused) {
    audio.currentTime = at;
    audio.play().catch((e) => console.warn('audio.play 失敗:', e));
    // 音声が鳴り出すとマスターが音声側に移る。ずれないよう perf 側の基準も今の t に合わせておく
    clock.tStart = t; clock.perfStart = performance.now();
  }
}
// 再生ボタンの図形：再生中は ❚❚、止まっている時は ▶（文字でなく SVG。中央に揃えるため。2026-09-18 ユーザー指定）
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
function setPlayIcon(playing) {
  for (const id of ['playBtn', 'vPlayBtn']) {   // 上のバーと映像の上のバー
    const b = $(id);
    b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    b.setAttribute('aria-label', playing ? '一時停止' : '再生');
  }
  wakeTransport();   // 再生を始めた時も止めた時も、いったん出す（再生中なら 2.5 秒後に消える）
}
let transportTimer = null;
function wakeTransport() {
  const bar = $('viewTransport');
  bar.classList.remove('idle');
  clearTimeout(transportTimer);
  transportTimer = setTimeout(() => { if (clock.playing) bar.classList.add('idle'); }, 2500);
}
function play() {
  if (!engine) return;
  if (clock.t >= engine.duration + midiDelaySec()) clock.t = 0;
  clock.playing = true;
  clock.tStart = clock.t;
  clock.perfStart = performance.now();
  if (audioLoaded) {
    syncAudio(clock.t);
  }
  setPlayIcon(true);
  if (VIEW_NAME) $('viewerCover').hidden = true;   // 視聴モード：再生中は覆いを外す
}
function pause() {
  clock.t = currentTime();
  clock.playing = false;
  if (audioLoaded) audio.pause();
  setPlayIcon(false);
  if (VIEW_NAME) $('viewerCover').hidden = false;  // 視聴モード：止めたら覆い（▶）を戻す
}
function seek(t) {
  const wasPlaying = clock.playing;
  if (wasPlaying) pause();
  clock.t = Math.max(0, Math.min(engine ? engine.duration + midiDelaySec() : 0, t));
  if (audioLoaded) audio.currentTime = Math.max(0, clock.t - audioDelaySec());
  if (wasPlaying) play();
}

// MIDI 遅延を動かした時：曲の終わりが後ろにずれるので、シークの範囲も合わせる
$('midiDelay').addEventListener('input', () => {
  if (engine) $('seek').max = $('vSeek').max = Math.floor((engine.duration + midiDelaySec()) * 100);
});

// 音声遅延を動かした時：舞台の時計は音声から引いているので、音声の位置を同じ差だけずらして時刻を保つ
let audioDelayPrev = 0;
$('audioDelay').addEventListener('input', (e) => {
  const now = parseFloat(e.target.value) || 0;
  const d = now - audioDelayPrev;
  audioDelayPrev = now;
  if (!audioLoaded) return;
  if (clock.playing) {
    const at = audio.currentTime - d;
    if (audio.paused) syncAudio(currentTime());
    else if (at >= 0) audio.currentTime = at;
    else { audio.pause(); audio.currentTime = 0; clock.tStart = currentTime(); clock.perfStart = performance.now(); }
  } else {
    audio.currentTime = Math.max(0, clock.t - now);
  }
});

// ---------- スクリーン（ひな壇の上に重ねる層。背景やキャラクターを映す想定。2026-09-13 ユーザー指定） ----------
// 枚数は自由。位置はひな壇の奥行きの中の割合（0 = 手前の辺 / 1 = 奥の辺）で持つ。
// 枚数が変わる UI なので、id 付き input の自動収集には乗せず、独自キーで保存する
// 項目が増えても古い保存データが壊れないよう、足りない値は既定で埋める
// （埋めないと「幅」がスライダーの最小値 0.02 と表示され、触った瞬間にスクリーンが潰れる）
const SCREEN_BASE = { name: '', pos: 1, scale: 1, opacity: 1, show: true,
                      src: '', srcRaw: '', key: '#00ff00', thr: 0, at: 0, lift: 0, flip: false,
                      speed: 0, loop: false, gap: 1 };
// tile（繰り返し幅）は廃止し、1 枚の幅は「大きさ」で決める形にした（2026-09-13）。古い保存データを移す
const withDefaults = (o) => { const v = { ...SCREEN_BASE, ...o }; if (o && o.tile > 0) v.loop = true; delete v.tile; return v; };
let screens = (() => {
  try { const a = JSON.parse(LS.getItem(SCREENS_KEY) || 'null'); if (Array.isArray(a) && a.length) return a.map(withDefaults); } catch (e) { console.warn('スクリーン設定の読込失敗:', e); }
  return SCREEN_DEFAULT.map(withDefaults);
})();
// スカイドーム（遠景。3 層固定。追加も削除もしない）
const DOME_BASE = { name: '', r: 40, y: -10, span: 180, tiles: 2, speed: 0, opacity: 1, show: true,
                    src: '', srcRaw: '', key: '#00ff00', thr: 0, flip: false, fade: 0.12 };
let domes = (() => {
  try { const a = JSON.parse(LS.getItem(DOMES_KEY) || 'null');
    if (Array.isArray(a) && a.length === 3) {
      return a.map((o) => { const v = { ...DOME_BASE, ...o }; v.r = Math.min(50, Math.max(10, v.r)); return v; });
    } } catch (e) { console.warn('スカイドーム設定の読込失敗:', e); }
  return DOME_DEFAULT.map((o) => ({ ...DOME_BASE, ...o }));
})();
let domeSaveTimer = null;
function saveDomes() {
  clearTimeout(domeSaveTimer);
  domeSaveTimer = setTimeout(() => {
    try { LS.setItem(DOMES_KEY, JSON.stringify(domes)); pushSettings(); } catch (e) { console.warn('スカイドーム設定の保存失敗:', e); }
  }, 400);
}
let screenSaveTimer = null;
function saveScreens() {
  clearTimeout(screenSaveTimer);
  screenSaveTimer = setTimeout(() => {
    try { LS.setItem(SCREENS_KEY, JSON.stringify(screens)); pushSettings(); } catch (e) { console.warn('スクリーン設定の保存失敗:', e); }
  }, 400);
}
// 素材ルート（開発サーバーが /media/ で公開しているフォルダ）。絶対パスを URL に直すのに使う
let mediaRoots = [];
fetch('media-roots.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : []).then((a) => { mediaRoots = a || []; })
  .catch(() => { mediaRoots = []; });
// 素材の一覧 { フォルダ: [ファイル名] }。プルダウンに出す。届いたら行を作り直す
let mediaList = {};
function loadMediaList(refresh = false) {
  return fetch(`media-list.json${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => { mediaList = d || {}; renderScreens(); })
    .catch((e) => { console.warn('素材の一覧を取得できませんでした:', e.message); });   // 前回の一覧は残す
}
loadMediaList();
// 一覧（フォルダ: [ファイル]）を木にする。カラム表示で辿るため
function mediaTree(list = mediaList) {   // list：画像・動画（既定）か、音声（audioList）
  const root = { dirs: new Map(), files: [] };
  for (const dir of Object.keys(list).sort()) {
    let node = root;
    if (dir) for (const seg of dir.split('/')) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files = list[dir];
  }
  return root;
}
// 開いているカラム表示（同時に 1 つだけ）
let picker = null;
function closePicker() { picker?.el.remove(); picker = null; }
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
// 外を押したら閉じる。mousedown ではなく pointerdown で聞く：プレビューの 3D 画面はカメラ操作（OrbitControls）が
// pointerdown で既定の動作を止めるため、その後の mousedown が発生せず、いちばん広いプレビューの上を押しても閉じなかった（2026-09-18 ユーザー指摘）
addEventListener('pointerdown', (e) => { if (picker && !picker.el.contains(e.target) && e.target !== picker.anchor) closePicker(); }, true);

/**
 * 素材を選ぶカラム表示を開く。左のカラムでフォルダを選ぶと右に次のカラムが出る（Finder と同じ）。
 * ファイルを選んだ時点で onPick(dir, name) を呼んで閉じる。2026-09-13 ユーザー指定
 * list：出す一覧（既定は画像・動画。上のバーの音声は audioList を渡す。2026-09-18）
 */
function openPicker(anchor, sc, onPick, list = mediaList) {
  closePicker();
  const el = document.createElement('div');
  el.className = 'mediaPicker';
  const cols = document.createElement('div');
  cols.className = 'cols';
  el.appendChild(cols);
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = '<span>パスを直接入力</span>';
  const tx = document.createElement('input');
  tx.type = 'text'; tx.placeholder = '/Volumes/… もしくは assets/…';
  tx.value = sc.srcRaw || sc.src || '';
  tx.onkeydown = (e) => e.stopPropagation();
  tx.onchange = () => { sc.srcRaw = tx.value.trim(); sc.src = toMediaUrl(tx.value); closePicker(); onPick(); };
  foot.appendChild(tx);
  const clr = document.createElement('button');
  clr.textContent = '素材を外す';
  clr.onclick = () => { sc.src = ''; sc.srcRaw = ''; closePicker(); onPick(); };
  foot.appendChild(clr);
  const cls = document.createElement('button');   // 何も選ばずに閉じる（外を押す・Escape でも閉じる。2026-09-18 ユーザー指定）
  cls.textContent = '✕'; cls.className = 'close'; cls.title = '何も変えずに閉じる（Escape、ウィンドウの外を押しても閉じる）';   // ✕・赤背景・白文字（2026-09-18 ユーザー指定）
  cls.onclick = () => closePicker();
  foot.appendChild(cls);
  el.appendChild(foot);

  const root = mediaTree(list);
  const parts = srcParts(sc);
  let path = parts ? parts.dir.split('/').filter(Boolean) : [];
  const nodeAt = (segs) => segs.reduce((n, sg) => (n && n.dirs.get(sg)) || null, root);

  // カラムは「中身が変わらないものは作り直さない」。毎回作り直すとスクロール位置が 0 に戻り、
  // ホイールで下へ送れなくなる（下層をホバーで開くようにした副作用。2026-09-13 ユーザー指摘）
  const colEls = [];
  function buildCol(k) {
    const node = nodeAt(path.slice(0, k));
    const col = document.createElement('div');
    col.className = 'col';
    col.dataset.at = path.slice(0, k).join('/');
    for (const name of node.dirs.keys()) {
      const b2 = document.createElement('button');
      b2.className = 'dir';
      b2.dataset.name = name;
      b2.textContent = name;
      b2.title = name;
      // ホバーだけで下層を開く。同じ場所なら何もしない（作り直すと mouseenter が再発して無限に回る）
      const open = () => { const next = [...path.slice(0, k), name]; if (next.join('/') === path.join('/')) return; path = next; draw(); };
      b2.onmouseenter = open;
      b2.onclick = open;
      col.appendChild(b2);
    }
    const here = col.dataset.at;
    for (const name of node.files) {
      const b2 = document.createElement('button');
      b2.className = 'file';
      b2.dataset.name = name;
      b2.textContent = name;
      b2.title = name;
      b2.onclick = () => { onPick(here, name); closePicker(); };
      col.appendChild(b2);
    }
    return col;
  }
  function draw() {
    let added = false;
    for (let k = 0; k <= path.length; k++) {
      const at = path.slice(0, k).join('/');
      if (!nodeAt(path.slice(0, k))) break;
      if (!colEls[k] || colEls[k].dataset.at !== at) {     // 中身が変わるカラムだけ作り直す
        const col = buildCol(k);
        if (colEls[k]) cols.replaceChild(col, colEls[k]); else { cols.appendChild(col); added = true; }
        colEls[k] = col;
      }
      // 選択中の印だけ付け替える（作り直さないのでスクロール位置は保たれる）
      for (const b2 of colEls[k].children) {
        const isDir = b2.classList.contains('dir');
        const on = isDir ? path[k] === b2.dataset.name
          : parts && nfc(parts.name) === nfc(b2.dataset.name) && nfc(parts.dir) === nfc(at);
        b2.classList.toggle('on', !!on);
      }
    }
    while (colEls.length > path.length + 1) cols.removeChild(colEls.pop());   // 深い方は捨てる
    if (added) cols.scrollLeft = cols.scrollWidth;    // 新しいカラムが出た時だけ右端を見せる
  }
  draw();
  document.body.appendChild(el);
  // 位置はブラウザの中央（CSS の .mediaPicker が決める。フォルダを辿って幅が変わっても中央のまま。2026-09-18 ユーザー指定）。
  // 以前は押したカードの上に開いていたが、下段のカードからだと画面の下寄りで見づらかった
  picker = { el, anchor };
}

// 選んだ素材のサムネイル。動画は小さく再生する（先頭フレームだけ出すより中身が分かる）
function thumbFor(sc) {
  if (!sc.src) { const d = document.createElement('div'); d.className = 'ph'; d.textContent = '素材'; return d; }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(sc.src)) {
    const v = document.createElement('video');
    v.src = sc.src; v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.play().catch(() => {});    // 自動再生が止められても静止画として出る
    return v;
  }
  const im = document.createElement('img');
  im.src = sc.src;
  return im;
}

// macOS のファイル名は NFD なので、比較は NFC に揃える
const nfc = (x) => (x || '').normalize('NFC');
/** sc.src（media/… の URL）を { dir, name } に戻す。当てはまらなければ null（＝直接入力） */
function srcParts(sc) {
  const u = sc.src || '';
  if (!u.startsWith('media/')) return null;
  const segs = u.slice('media/'.length).split('/').map(decodeURIComponent);
  return { dir: segs.slice(0, -1).join('/'), name: segs[segs.length - 1] };
}
const mediaUrlOf = (dir, name) => `media/${[...(dir ? dir.split('/') : []), name].map(encodeURIComponent).join('/')}`;
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

// スクリーン 1 枚ぶんのカードを作る（縦並び。追加すると右へ増えていく。2026-09-13 ユーザー指定）。
// カードの並べ替え（2026-09-18）：引きずり中のカードの番号。dragover の間は dataTransfer が読めない（ブラウザの保護）ので変数に持つ
let screenDragFrom = null;
const dragIndex = () => screenDragFrom;
const clearDropMarks = () => { for (const el of document.querySelectorAll('#screenRows .dropBefore, #screenRows .dropAfter')) el.classList.remove('dropBefore', 'dropAfter'); };

/**
 * 「抜く強さ」の行のラベル文字の場所に、抜く色（クロマキー）の色玉を置く（2026-09-18 ユーザー指定。スクリーン・スカイドーム共通）。
 * lab: slider() が作った行。obj: 設定（obj.key に色）。行の外枠は <label> から <div> に替える
 * （<label> のままだと、行の空いた所を押した時に色玉が開いてしまう）
 */
function putKeyColor(lab, obj, changed, title) {
  const key = document.createElement('input');
  key.type = 'color'; key.title = title;
  key.value = obj.key || '#00ff00';
  key.oninput = () => { obj.key = key.value; changed(); };
  const cell = lab.querySelector('span'); cell.textContent = ''; cell.appendChild(key);
  const row = document.createElement('div'); row.className = lab.className; row.title = lab.title;
  row.append(...lab.childNodes);
  lab.replaceWith(row);
}

// 値をいじったら即座に 3D へ反映し、保存は遅らせる
function screenRow(sc, i) {
  const box = Object.assign(document.createElement('div'), { className: 'screen' });
  const put = (parent, html) => { const d = document.createElement('div'); d.innerHTML = html; return parent.appendChild(d.firstElementChild); };
  const changed = () => { setScreens(screens); saveScreens(); };

  // 上：サムネイル（押すと素材のカラム表示が開く）。右に「表示・反転・削除」を縦に並べる（2026-09-18 ユーザー指定）
  const top = put(box, '<div class="top"></div>');
  const thumb = top.appendChild(Object.assign(document.createElement('button'), { className: 'thumb' }));
  const side = put(top, '<div class="side"></div>');
  const drawThumb = () => {
    thumb.textContent = '';
    thumb.appendChild(thumbFor(sc));
    thumb.querySelector('img, video')?.setAttribute('draggable', 'false');   // 引きずりは画像単体でなくサムネイル（ボタン）で始める
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = sc.src ? (srcParts(sc)?.name || sc.srcRaw || '') : '素材を選ぶ';
    thumb.appendChild(cap);
    thumb.title = (sc.srcRaw || sc.src || '押すとフォルダを辿って素材を選べる（透過 PNG か、緑背景の mp4）') + '\nつまんで左右に動かすとカードを並べ替えられる';
  };
  drawThumb();
  thumb.onclick = () => openPicker(thumb, sc, (dir, name) => {
    if (dir !== undefined) { sc.src = mediaUrlOf(dir, name); sc.srcRaw = `${dir}/${name}`; }
    drawThumb();
    changed();
    setTimeout(renderScreens, 600);   // 素材の大きさを説明文に出すため（読み込み後）
  });
  // カードの並べ替え：サムネイルをつまんで、ほかのカードの上で離す（2026-09-18 ユーザー指定）。
  // 押すだけなら上の onclick（素材選び）。数ピクセル動かした時だけ引きずりになる。
  // 並び順はメニューの中の順番だけで、舞台での前後（「奥行き」）は変えない
  thumb.draggable = true;
  thumb.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move';   // Firefox は setData が無いと引きずれない
    screenDragFrom = i; box.classList.add('dragging');
  });
  thumb.addEventListener('dragend', () => { screenDragFrom = null; box.classList.remove('dragging'); clearDropMarks(); });
  box.addEventListener('dragover', (e) => {   // 入る位置（前か後ろか）を線で示す
    if (dragIndex() === null) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const r = box.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
    clearDropMarks(); box.classList.add(before ? 'dropBefore' : 'dropAfter');
  });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) clearDropMarks(); });
  box.addEventListener('drop', (e) => {
    const from = dragIndex(); clearDropMarks();
    if (from === null) return;
    e.preventDefault(); screenDragFrom = null;
    const r = box.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
    let to = i + (before ? 0 : 1);
    if (from < to) to--;                      // 抜いたぶん、後ろの番号が 1 つ詰まる
    if (to === from) return;
    const [moved] = screens.splice(from, 1); screens.splice(to, 0, moved);
    renderScreens(); changed();
  });

  const name = put(box, '<input type="text" class="name" title="名前（覚え書き。表示には影響しない）">');
  name.value = sc.name || `スクリーン${i + 1}`;
  name.oninput = () => { sc.name = name.value; saveScreens(); };
  name.onkeydown = (e) => e.stopPropagation();   // Space 等を再生ショートカットに取られない

  const slider = (label, key, min, max, step, digits, title) => {
    const lab = put(box, `<label class="sld" title="${title}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><b></b></label>`);
    const el = lab.querySelector('input');
    // 既定値は必ず SCREEN_BASE から取る。表に無いと range 要素が「範囲の中央」を返してしまい、
    // 触っていないのに変な値が表示される（2026-09-13 に 2 回やった）
    if (!(key in SCREEN_BASE)) console.warn(`SCREEN_BASE に ${key} の既定値がありません`);
    el.value = sc[key] ?? SCREEN_BASE[key] ?? +min;
    // 値の表示は数値入力欄＋上下矢印（他の欄と同じ。2026-09-18 ユーザー指定）。桁数は項目ごと
    const box2 = numBoxFor(el, lab.querySelector('b'), { toText: (v) => (+v).toFixed(digits) });
    el.oninput = () => { sc[key] = +el.value; box2.show(); changed(); };
    return lab;
  };
  const px = screenInfo(i);
  slider('奥行き', 'pos', 0, 1, 0.01, 2, 'ひな壇の奥行きの中での位置。0 = 手前の辺、1 = 奥の辺');
  slider('大きさ', 'scale', 0.1, 6, 0.05, 2,
    `素材の実寸に対する倍率。1 で素材のドットが奏者のドットと同じ大きさ${px ? `（この素材は ${px.w}×${px.h} ドット）` : ''}`);
  slider('横位置', 'at', -1, 1, 0.01, 2, '-1 = 左端、0 = 中央、1 = 右端');
  slider('縦位置', 'lift', -6, 24, 0.1, 1, 'ひな壇の天面からの高さ [unit]。0 で天面に立ち、上げると宙に浮く');
  slider('濃度', 'opacity', 0.05, 1, 0.05, 2, '不透明度。1 で完全に不透明、下げるほど後ろが透ける');
  // 雲のように横へ流す（2026-09-13 ユーザー指定）。繰り返しは「大きさ」の幅ごとなので絵は歪まない
  slider('流れる速度', 'speed', -10, 10, 0.1, 1, '横に流れる速さ [unit/秒]。プラスで右から左へ、マイナスで逆。0 で止まる。「繰返」と併せて使う');
  // 繰返間隔：行の頭に「繰返」のチェック（以前は最下行にあった。2026-09-18 ユーザー指定）。文字を押してもチェックが切り替わる
  {
    const row = slider('繰返間隔', 'gap', 1, 6, 0.05, 2, '繰返：素材を横に繰り返して弧いっぱいに敷く（雲など）。1 枚の幅は「大きさ」で決まるので絵は歪まない\n間隔：繰り返した時の絵と絵の間隔。1 で隙間なし、2 で絵 1 枚ぶんの隙間が空く。絵の大きさは変わらない');
    const loop = document.createElement('input'); loop.type = 'checkbox';
    loop.checked = !!sc.loop;
    loop.onchange = () => { sc.loop = loop.checked; changed(); };
    row.querySelector('span').prepend(loop);
  }
  // 抜く強さ：一番下。ラベル文字の代わりに、抜く色の色玉を置く（2026-09-18 ユーザー指定）
  putKeyColor(slider('', 'thr', 0, 1, 0.01, 2, '抜く強さ：キー色にどれだけ近い画素まで抜くか。0 で抜かない。mp4 は色がにじむので 0.4〜0.5 ほど要る'),
    sc, changed, '抜く色（緑背景の色）。透過 PNG なら抜く強さ 0 のままでよい');

  // サムネイルの右の列：表示・反転・削除
  const foot = side;
  const show = put(foot, '<label title="このスクリーンを表示する"><input type="checkbox"><span>表示</span></label>').querySelector('input');
  show.checked = sc.show !== false;
  show.onchange = () => { sc.show = show.checked; changed(); };
  const flip = put(foot, '<label title="素材を左右反転して映す"><input type="checkbox"><span>反転</span></label>').querySelector('input');
  flip.checked = !!sc.flip;
  flip.onchange = () => { sc.flip = flip.checked; changed(); };
  const del = put(foot, '<button title="このスクリーンを削除する">削除</button>');
  del.onclick = () => { screens.splice(i, 1); renderScreens(); changed(); };
  return box;
}
// スカイドーム 1 枚ぶんのカード。作りはスクリーンのカードと同じで、項目だけ違う
function domeRow(d, i) {
  const box = Object.assign(document.createElement('div'), { className: 'screen dome' });
  const put = (parent, html) => { const x = document.createElement('div'); x.innerHTML = html; return parent.appendChild(x.firstElementChild); };
  const changed = () => { setDomes(domes); saveDomes(); };

  // サムネイルの右に「表示・反転」を縦に並べる（スクリーンと同じ。2026-09-18 ユーザー指定）
  const top = put(box, '<div class="top"></div>');
  const thumb = top.appendChild(Object.assign(document.createElement('button'), { className: 'thumb' }));
  const side = put(top, '<div class="side"></div>');
  const drawThumb = () => {
    thumb.textContent = '';
    thumb.appendChild(thumbFor(d));
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = d.src ? (srcParts(d)?.name || d.srcRaw || '') : '素材を選ぶ';
    thumb.appendChild(cap);
    thumb.title = d.srcRaw || d.src || '押すとフォルダを辿って素材を選べる（雲などの遠景）';
  };
  drawThumb();
  thumb.onclick = () => openPicker(thumb, d, (dir, name) => {
    if (dir !== undefined) { d.src = mediaUrlOf(dir, name); d.srcRaw = `${dir}/${name}`; }
    drawThumb(); changed();
  });

  const name = put(box, '<input type="text" class="name" title="名前（覚え書き）">');
  name.value = d.name || `スカイドーム${i + 1}`;
  name.oninput = () => { d.name = name.value; saveDomes(); };
  name.onkeydown = (e) => e.stopPropagation();

  const slider = (label, key, min, max, step, digits, title) => {
    const lab = put(box, `<label class="sld" title="${title}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><b></b></label>`);
    const el = lab.querySelector('input');
    el.value = d[key] ?? DOME_BASE[key] ?? +min;
    const box2 = numBoxFor(el, lab.querySelector('b'), { toText: (v) => (+v).toFixed(digits) });   // 数値入力欄＋上下矢印（2026-09-18 ユーザー指定）
    el.oninput = () => { d[key] = +el.value; box2.show(); changed(); };
    return lab;
  };
  slider('半径', 'r', 10, 50, 0.5, 1, '舞台の中心からの距離。大きいほど遠くに見える');
  slider('高さ', 'y', -60, 40, 0.5, 1, 'ドームの中心の高さ。下げると地平線が下がる');
  slider('範囲', 'span', 40, 360, 5, 0, '横に何度ぶん覆うか。180 で半円（客席から見える側だけ）');
  slider('枚数', 'tiles', 0.5, 10, 0.1, 1, '範囲の中に素材を何枚並べるか。増やすと絵が小さくなる');
  slider('端のぼかし', 'fade', 0, 0.45, 0.01, 2, '範囲の両端で絵をなだらかに消す幅（範囲に対する割合）。0 でくっきり切れる');
  slider('濃度', 'opacity', 0.05, 1, 0.05, 2, '不透明度');
  slider('流れる速度', 'speed', -30, 30, 0.5, 1, '横に流れる速さ [度/秒]。プラスで右から左へ');   // 色玉の行のすぐ上に（2026-09-18 ユーザー指定）
  // 抜く強さ：ラベル文字の代わりに、抜く色の色玉を置く（2026-09-18 ユーザー指定）
  putKeyColor(slider('', 'thr', 0, 1, 0.01, 2, '抜く強さ：キー色にどれだけ近い画素まで抜くか。0 で抜かない'), d, changed, '抜く色（緑背景の色）');

  const foot = side;   // サムネイルの右の列
  const show = put(foot, '<label title="このドームを表示する"><input type="checkbox"><span>表示</span></label>').querySelector('input');
  show.checked = d.show !== false;
  show.onchange = () => { d.show = show.checked; changed(); };
  const flip = put(foot, '<label title="素材を左右反転して映す"><input type="checkbox"><span>反転</span></label>').querySelector('input');
  flip.checked = !!d.flip;
  flip.onchange = () => { d.flip = flip.checked; changed(); };
  // 削除：カードは残し、画像（素材）だけを外す（スクリーンの「削除」はカードごと消すが、ドームは 3 層固定なので。2026-09-18 ユーザー指定）
  const del = put(foot, '<button title="画像を外す（カードと設定は残る。素材選びの「素材を外す」と同じ）">削除</button>');
  del.onclick = () => { d.src = ''; d.srcRaw = ''; drawThumb(); changed(); };
  return box;
}

function renderScreens() {
  const box = $('screenRows'), dbox = $('domeRows');
  if (!box || !dbox) return;
  box.textContent = ''; dbox.textContent = '';
  domes.forEach((d, i) => dbox.appendChild(domeRow(d, i)));    // 遠景（3 層固定）は左のセクションへ
  screens.forEach((sc, i) => box.appendChild(screenRow(sc, i)));
  // 右端の「＋」でカードを増やす
  const add = Object.assign(document.createElement('button'), { className: 'addCard', textContent: '＋', title: 'スクリーンを 1 枚増やす' });
  add.onclick = addScreen;
  box.appendChild(add);
  setBarHeight();
}
function addScreen() {
  screens.push(withDefaults({ name: `スクリーン${screens.length + 1}` }));
  renderScreens();
  setScreens(screens); saveScreens();
}
$('screenReload').addEventListener('click', (e) => {
  const b = e.currentTarget;
  b.textContent = '調べています…';
  loadMediaList(true).then(() => { b.textContent = '素材の一覧を更新'; });
});
// プレビューは端末の画素数どおりに置く。入り切らない時だけ丸ごと縮める（2026-09-14 ユーザー指定）。
// 縮めても中の比率は変わらないので、実機で「どれだけ入るか」の見え方は保たれる
function setBarHeight() {
  const area = $('viewArea'), wrap = $('viewWrap');
  if (area.clientWidth < 2 || area.clientHeight < 2) return;
  if (!wrap.className) {   // 端末を指定しない：空きに収まる最大の 16:9（今までどおりの動き）
    const w = Math.min(area.clientWidth, (area.clientHeight * 16) / 9);
    wrap.style.setProperty('--fw', `${w.toFixed(1)}px`);
    wrap.style.setProperty('--fh', `${((w * 9) / 16).toFixed(1)}px`);
  }
  // 端末を選んでいる時は、ブラウザが狭くても縮めない。入り切らない分は見切れる（2026-09-14 ユーザー指定）
  placeAutoCamBox();
}
// プレビューに重ねる操作の層を、選んでいる端末の画面にぴったり重ねる（2026-09-14 ユーザー指定）。
// 画面の位置と大きさを測って合わせる（はみ出す時は見えている範囲に合わせる）
function placeAutoCamBox() {
  const ov = document.getElementById('viewOverlay');
  if (!ov) return;
  const ar = $('viewArea').getBoundingClientRect(), wr = $('viewWrap').getBoundingClientRect();
  // 端末の画面がブラウザからはみ出す時は、見えている部分に合わせる（操作の箱が画面外へ行かないように）
  const l = Math.max(wr.left, ar.left), t = Math.max(wr.top, ar.top);
  const r = Math.min(wr.right, ar.right), b = Math.min(wr.bottom, ar.bottom);
  ov.style.left = `${l - ar.left}px`;
  ov.style.top = `${t - ar.top}px`;
  ov.style.width = `${Math.max(0, r - l)}px`;
  ov.style.height = `${Math.max(0, b - t)}px`;
  // 操作の箱の大きさ：PC と「なし」は等倍、スマホは 70%（2026-09-14 ユーザー指定）
  const phoneV = $('viewWrap').classList.contains('phoneV');
  const phone = phoneV || $('viewWrap').classList.contains('phoneH');
  ov.style.setProperty('--ovzoom', phone ? '.7' : '1');
  ov.classList.toggle('phone', phone);   // スマホは数値入力と上下矢印を隠す（2026-09-14 ユーザー指定）
  // 箱の配置は端末ごとに決める（2026-09-14 / 2026-09-18 ユーザー指定）。
  //   なし・PC ：左＝ピアノロール・奏者・揺れ／右上＝自動カメラ・パート名・足元の光
  //   スマホ横 ：左＝自動カメラ・ピアノロール・奏者・揺れ・パート名・足元の光
  //   スマホ縦 ：上の帯＝ピアノロール・揺れ・自動カメラ（左から横に）／下の帯＝奏者・パート名・足元の光
  const wrapC = $('viewWrap').classList;
  const mode = phoneV ? 'phoneV' : wrapC.contains('phoneH') ? 'phoneH' : wrapC.contains('pc') ? 'pc' : 'free';
  const LAYOUT = {
    free:   { viewLeft: ['boxRoll', 'boxPlayer', 'boxShake'], viewRight: ['autoCamBox', 'boxLabel', 'boxGlow'], viewTop: [], viewBottom: [] },
    pc:     { viewLeft: ['boxRoll', 'boxPlayer', 'boxShake'], viewRight: ['autoCamBox', 'boxLabel', 'boxGlow'], viewTop: [], viewBottom: [] },
    phoneH: { viewLeft: ['autoCamBox', 'boxRoll', 'boxPlayer', 'boxShake', 'boxLabel', 'boxGlow'], viewRight: [], viewTop: [], viewBottom: [] },
    phoneV: { viewLeft: [], viewRight: [], viewTop: ['boxRoll', 'boxShake', 'autoCamBox'], viewBottom: ['boxPlayer', 'boxLabel', 'boxGlow'] },
  }[mode];
  const left = $('viewLeft'), bottom = $('viewBottom');
  for (const [holder, ids] of Object.entries(LAYOUT)) {
    const el = $(holder);
    if ([...el.children].map((e) => e.id).join() !== ids.join()) for (const id of ids) el.appendChild($(id));   // 違う時だけ並べ直す（毎フレーム呼ばれるため）
  }
  // 左の列が端末の画面からはみ出す時は、中でスクロールさせる（zoom の分だけ単位を戻す）
  const z = phone ? 0.7 : 1;
  const pad = phone ? 20 : 28;   // 上下の余白（style.css の top/bottom と合わせる）
  left.style.maxHeight = `${Math.max(80, (b - t) / z - pad)}px`;
  $('viewRight').style.maxHeight = left.style.maxHeight;   // 右の列（PC ではパート名・足元の光も入る）も同じ
  // スマホ横：映る面の左に空く黒い隙間にカードを収める。機種で隙間が狭くなったら
  // 横スクロールではなくカードの幅を縮める（2026-09-14 ユーザー指定）
  if ($('viewWrap').classList.contains('phoneH')) {
    const vr0 = $('view').getBoundingClientRect(), wr0 = $('viewWrap').getBoundingClientRect();
    const gap = (vr0.left - wr0.left) / z;      // 隙間（箱と同じ単位に直す）
    left.style.width = `${Math.max(110, gap - pad)}px`;
  } else {
    left.style.width = '';
  }
  // 下の列は映像のすぐ下（黒帯の上端）から下へ積む。映像に重ならないように
  if (phoneV) {
    const vr = $('view').getBoundingClientRect();
    bottom.style.top = `${Math.max(0, vr.bottom - t + 10) / z}px`;
  } else {
    bottom.style.top = '';
  }
  // 映像に重なっている箱に .onImage を付ける（スライダーの棒を黒にするため。2026-09-14 ユーザー指定）
  const vr = $('view').getBoundingClientRect();
  for (const box of ov.querySelectorAll('.box')) {
    const r = box.getBoundingClientRect();
    const over = Math.min(r.right, vr.right) - Math.max(r.left, vr.left) > 2
              && Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top) > 2;
    box.classList.toggle('onImage', over);
  }
}
addEventListener('resize', setBarHeight);

// ---------- テンポ・拍子（プレビューの左上。2026-09-13 ユーザー指定） ----------
// 拍子は「今の拍／分母」。分子が 1 2 3 4 … と進み、小節の頭で 1 に戻る
const TEMPO_SIZE = { bpm: 18, sig: 30 };
let tempoLastBeat = -1;
let tempoKey = '';
// 端末ごとの文字の倍率。スマホは画面が小さいぶん、クレジットとテンポ・拍子を小さくする
// （スマホ横 0.7 / スマホ縦 0.5。2026-09-14 ユーザー指定）
function deviceTextScale() {
  const c = $('viewWrap').classList;
  return c.contains('phoneV') ? 0.5 : c.contains('phoneH') ? 0.7 : 1;
}

function applyTempo(s, bpm, beat) {
  const box = $('tempoHud');
  const ds = deviceTextScale();
  const key = [s.showTempo, s.tempoScale, s.tempoOpacity, ds, Math.round(bpm), beat.beatInBar, beat.beatUnit].join('|');
  if (key === tempoKey) return;        // 拍が変わった時だけ DOM を触る
  tempoKey = key;
  box.style.display = s.showTempo ? 'block' : 'none';
  box.style.opacity = s.tempoOpacity;
  const b = box.querySelector('.bpm'), g = box.querySelector('.sig');
  b.style.fontSize = `${TEMPO_SIZE.bpm * s.tempoScale * ds}px`;
  g.style.fontSize = `${TEMPO_SIZE.sig * s.tempoScale * ds}px`;
  b.textContent = `♩= ${Math.round(bpm)}`;
  g.textContent = `${beat.beatInBar + 1}/${beat.beatUnit || 4}`;
  // 1 拍目に入った瞬間だけ黄色で大きくして白・等倍へ戻す（2026-09-16 ユーザー指定。色もキーフレーム側）。クラスを付け直してアニメを頭から再生。
  // クラス名は汎用の pop を避ける（Arc の拡張機能が .pop を画面中央固定にしていて拍子が飛んだ。2026-09-16）
  if (beat.beatInBar === 0 && tempoLastBeat !== 0) { g.classList.remove('beatPop'); void g.offsetWidth; g.classList.add('beatPop'); }
  tempoLastBeat = beat.beatInBar;
}

// ---------- クレジット（プレビューの左下。2026-09-13 ユーザー指定。MIDIOrchestra を参考に） ----------
// 接頭辞（Comp. / Arr.）付きの行は、入力がある時だけ出す。行ごとの基準サイズに「大きさ」を掛ける
const CREDIT_SIZE = { 1: 15, 2: 24, 3: 13, 4: 13 };
let creditKey = '';
function applyCredits(s) {
  const ds = deviceTextScale();
  const key = [s.showCredits, s.credit1, s.credit2, s.credit3, s.credit4, s.creditScale, ds, s.creditColor, s.creditOpacity].join('|');
  if (key === creditKey) return;      // 変わった時だけ DOM を触る
  creditKey = key;
  const box = $('credits');
  box.style.display = s.showCredits ? 'flex' : 'none';
  for (const n of [1, 2, 3, 4]) {
    const el = box.querySelector(`.cl[data-line="${n}"]`);
    const text = s[`credit${n}`] || '';
    const slot = el.querySelector('span:last-child');
    if (slot && el.querySelector('.pre')) slot.textContent = text; else el.textContent = text;
    el.classList.toggle('off', !text);
    el.style.fontSize = `${CREDIT_SIZE[n] * s.creditScale * ds}px`;
    el.style.color = s.creditColor;
    el.style.opacity = s.creditOpacity;
  }
}

// ---------- クレジットの履歴と「ゲーム → 作曲者」（2026-09-13 ユーザー指定） ----------
// 同じゲーム名・作曲者名を何度も打たずに済むよう、入力を覚えて候補に出す。
// 1 つのゲームに対して作曲者はほぼ固定なので、ゲーム名を選んだら作曲者を自動で入れる。
// 辞書は手で作らず、入力するたびに自動で溜まる
const CREDIT_HIST_MAX = 30;
let credits = (() => {
  try { const o = JSON.parse(LS.getItem(CREDITS_KEY) || 'null'); if (o && o.hist) return o; } catch (e) { console.warn('クレジット履歴の読込失敗:', e); }
  return { hist: { 1: [], 2: [], 3: [], 4: [] }, byGame: {} };
})();
function saveCredits() {
  try { LS.setItem(CREDITS_KEY, JSON.stringify(credits)); pushSettings(); } catch (e) { console.warn('クレジット履歴の保存失敗:', e); }
}
function fillCreditList(n) {
  const dl = document.getElementById(`creditHist${n}`);
  if (!dl) return;
  dl.textContent = '';
  for (const v of credits.hist[n] || []) dl.appendChild(Object.assign(document.createElement('option'), { value: v }));
}
function rememberCredit(n, v) {
  const t = (v || '').trim();
  if (!t) return;
  const list = credits.hist[n] || (credits.hist[n] = []);
  const i = list.indexOf(t);
  if (i >= 0) list.splice(i, 1);
  list.unshift(t);                       // 使ったものが先頭
  list.length = Math.min(list.length, CREDIT_HIST_MAX);
  fillCreditList(n);
}
function setupCredits() {
  for (const n of [1, 2, 3, 4]) fillCreditList(n);
  const el = (n) => $(`credit${n}`);
  const commit = (n) => { rememberCredit(n, el(n).value); learnGame(); saveCredits(); };
  const learnGame = () => {                // ゲーム名と作曲者が揃っていたら対応を覚える
    const g = el(1).value.trim(), c = el(3).value.trim();
    if (g && c) credits.byGame[g] = c;
  };
  for (const n of [1, 2, 3, 4]) el(n).addEventListener('change', () => commit(n));
  // ゲーム名を選んだら、覚えている作曲者を入れる（候補から選んだ時も change が飛ぶ）
  el(1).addEventListener('change', () => {
    const c = credits.byGame[el(1).value.trim()];
    if (c && c !== el(3).value) {
      el(3).value = c;
      el(3).dispatchEvent(new Event('input', { bubbles: true }));   // 保存と反映はいつもの経路で
      rememberCredit(3, c);
    }
  });
}

// ---------- 設定（id 付き input を自動収集して保存・復元） ----------
const SETTING_IDS = () => [...document.querySelectorAll('#panel input[id], #panel select[id], #topbar input[id], #topbar select[id], #camBar input[id], #camBar select[id], #viewArea input[id], #viewArea select[id]')]
  .filter((el) => el.type !== 'file' && el.id !== 'seek' && el.id !== 'vSeek' && !el.id.startsWith('preset') && !el.id.startsWith('project'));   // プリセット・プロジェクトの一覧・名前欄は設定ではない
// ラジオボタンは name をキーに、選択中の value を保存
// 対象は右メニュー（ラジオがあるのは右メニューだけ。別の場所に置く時はここに足す）
const RADIO_AREA = '#panel';
const RADIO_NAMES = () => [...new Set([...document.querySelectorAll(`${RADIO_AREA} input[type=radio][name]`)].map((el) => el.name))];
const radioValue = (name) => document.querySelector(`${RADIO_AREA} input[type=radio][name="${name}"]:checked`)?.value;

function saveSettings() {
  const data = {};
  for (const el of SETTING_IDS()) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  for (const name of RADIO_NAMES()) data[name] = radioValue(name);
  try { LS.setItem(SETTINGS_KEY, JSON.stringify(data)); pushSettings(); } catch (e) { console.warn('設定保存失敗:', e); }
}
function loadSettings() {
  let data = {};
  try { data = JSON.parse(LS.getItem(SETTINGS_KEY) || '{}'); } catch (e) { console.warn('設定読込失敗（デフォルトで続行）:', e); }
  for (const el of SETTING_IDS()) {
    if (!(el.id in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.id]; else el.value = data[el.id];
  }
  for (const name of RADIO_NAMES()) {
    if (!(name in data)) continue;
    const el = document.querySelector(`${RADIO_AREA} input[type=radio][name="${name}"][value="${data[name]}"]`);
    if (el) el.checked = true;
  }
  // 互換：旧「屋内／屋外」ラジオ（lightMode）で保存されていたら「屋外」チェックへ読み替える（2026-09-17）
  if (!('outdoor' in data) && 'lightMode' in data) $('outdoor').checked = data.lightMode === 'sun';
  // 互換：天気の種類「なし」を廃止して見出しのチェック（weatherOn）にした（2026-09-20）。チェックの保存が無ければ以前の種類から決める
  if (!('weatherOn' in data) && 'weatherType' in data) $('weatherOn').checked = data.weatherType === 'rain' || data.weatherType === 'snow';
}
// 「落ちる速さ」スライダー（0.1〜10）は雨と雪で共通。雨だけこの倍率を掛ける：10 で以前の 3 倍と同じ速さ。
// 雪は値そのまま（上限 10 は吹雪用）（2026-09-19 ユーザー指定）
const RAIN_SPEED_SCALE = 0.3;
let saveTimer = null;
for (const id of ['panel', 'topbar', 'camBar', 'viewArea']) document.getElementById(id)?.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
  refreshValueLabels();
});
// 値表示（数値入力欄）を付けるスライダー。上のバーの遅延も含む（シークは除く）
const RANGE_SEL = '#panel input[type=range][id], #camBar input[type=range][id], #viewArea input[type=range][id], #topbar .dly input[type=range][id], #settingsPop input[type=range][id]';   // #settingsPop：上のバーの「設定」ポップアップ（クレジット・テンポ。2026-09-18）
// 値表示の書式（2026-09-16 ユーザー指定：時刻は時計表記）。toText: 数値 → 表示、fromText: 入力 → 数値（NaN なら不正）
const VALUE_FMT = {
  sunHour: {
    toText: (v) => { const h = Math.floor(v), m = Math.round((v - h) * 60); return `${h}:${String(m).padStart(2, '0')}`; },
    fromText: (t) => { const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(t); return m ? (+m[1]) + (m[2] ? (+m[2]) / 60 : 0) : (Number.isFinite(parseFloat(t)) ? parseFloat(t) : NaN); },
  },
};
const valueText = (id, v) => (VALUE_FMT[id] ? VALUE_FMT[id].toText(parseFloat(v)) : String(v));
function refreshValueLabels() {
  for (const el of document.querySelectorAll(RANGE_SEL)) {
    const lab = document.querySelector(`[data-value-for="${el.id}"]`);
    if (!lab) continue;
    if (lab.tagName === 'INPUT') { if (document.activeElement !== lab) lab.value = valueText(el.id, el.value); } // 数値入力欄（編集中は上書きしない）
    else lab.textContent = valueText(el.id, el.value);
  }
}
// スライダーの値表示を数値入力欄に置き換える（直接入力できる。Enter/フォーカス外しで確定、範囲外はスライダーの範囲に丸める。2026-09-11 ユーザー指定）
function makeValueInputs() {
  for (const el of document.querySelectorAll(RANGE_SEL)) {
    const lab = document.querySelector(`b[data-value-for="${el.id}"]`);
    if (!lab) continue;
    const fmt = VALUE_FMT[el.id];
    numBoxFor(el, lab, { toText: (v) => valueText(el.id, v), fromText: fmt ? fmt.fromText : null,
      title: fmt ? '時刻を直接入力（例 18:30。Enter で確定）' : '数値を直接入力（Enter で確定）' });
  }
}
/**
 * スライダー el の値表示 lab（<b>）を、数値入力欄＋上下矢印に置き換える。右メニューのスライダーと、
 * 下段のカード（スクリーン・スカイドーム。作り直されるたびに呼ぶ）の両方で使う（2026-09-18 ユーザー指定で下段にも付けた）。
 * toText: 値 → 表示の文字、fromText: 入力の文字 → 値（省略時は数値として読む。指定時は文字入力欄になる）。
 * 確定・矢印はスライダーに input イベントを流すので、スライダーを動かしたのと同じ経路で反映・保存される。
 * 戻り値の show() は、スライダー側の値を欄に写す（編集中は上書きしない）
 */
function numBoxFor(el, lab, { toText = (v) => String(v), fromText = null, title = '数値を直接入力（Enter で確定）' } = {}) {
  const num = document.createElement('input');
  num.type = fromText ? 'text' : 'number'; num.className = 'num';
  if (el.id) num.dataset.valueFor = el.id;
  if (!fromText) { num.min = el.min; num.max = el.max; num.step = el.step || 'any'; }
  num.value = toText(el.value);
  num.title = title;
  const commit = () => {
    if (num.value === '') { num.value = toText(el.value); return; }
    const raw = fromText ? fromText(num.value) : parseFloat(num.value);
    const v = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), raw));
    if (Number.isNaN(v)) { num.value = toText(el.value); return; }
    el.value = v; num.value = toText(el.value);
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
    const v = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), (parseFloat(el.value) || 0) + dir * step));
    el.value = v; num.value = toText(el.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (const [dir, glyph, tip] of [[1, '▲', '増やす'], [-1, '▼', '減らす']]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = glyph; b.title = tip; b.tabIndex = -1;
    let timer = null, repeat = null;
    const stop = () => { clearTimeout(timer); clearInterval(repeat); timer = repeat = null; };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); bump(dir); timer = setTimeout(() => { repeat = setInterval(() => bump(dir), 60); }, 400); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    spin.appendChild(b);
  }
  lab.replaceWith(wrap); wrap.append(num, spin);
  return { num, show: () => { if (document.activeElement !== num) num.value = toText(el.value); } };
}
function settings() {
  const num = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
  return {
    sway: num('sway', 1),
    dynResponse: num('dynResponse', 1),
    dynSpeed: num('dynSpeed', 1),   // 姿勢が強弱に追いつく速さ（2026-09-15）
    // 天気（スカイドームの欄。2026-09-17 ユーザー指定）
    // 見出しのチェックがオフなら降らせない（種類の「なし」は廃止。2026-09-20 ユーザー指定）
    weatherType: $('weatherOn').checked && ['rain', 'snow'].includes(radioValue('weatherType')) ? radioValue('weatherType') : 'none',
    weatherAmount: num('weatherAmount', 0.5), weatherWind: num('weatherWind', 0.2), weatherThunder: num('weatherThunder', 0),
    weatherSpeed: num('weatherSpeed', 1), weatherFps: num('weatherFps', 12), weatherWidth: num('weatherWidth', 0.3),
    weatherPos: num('weatherPos', 0.5), weatherHeight: num('weatherHeight', 12), weatherGlint: num('weatherGlint', 1),
    instFlash: num('instFlash', 1),
    metalSpec: num('metalSpec', 2),   // 金属の楽器のツヤ（2026-09-23 ユーザー指定。ハイライトの鋭さは楽器ごとの固定値にしてスライダーは廃止）
    // 画面の揺れ（2026-09-18 ユーザー指定）
    shakeOn: $('shakeOn').checked, shakeMode: $('shakeMode').value || 'v',
    shakeAmt: num('shakeAmt', 1), shakeDecay: num('shakeDecay', 1), shakeDots: $('shakeDots').checked, // 楽器のフラッシュの強さ（0 = 光らない / 1 = 従来。2026-09-17 ユーザー指定）
    rollSpeed: num('rollSpeed', 3),
    rollHeight: num('rollHeight', 7),
    noteWidth: num('noteWidth', 0.22),
    showRoll: $('showRoll').checked,
    showLandLine: false, // 着地点のラインは不要（2026-09-10 ユーザー確定。UI 撤去）
    rollOpacity: num('rollOpacity', 0.85),
    rollGlow: num('rollGlow', 0),
    showGlow: $('showGlow').checked,
    glowIntensity: num('glowIntensity', 1),
    glowSoft: num('glowSoft', 0.6),
    showNames: $('showNames').checked,
    labelSize: num('labelSize', 1), // パート名（2026-09-12）
    labelOutline: num('labelOutline', 3), labelY: num('labelY', 0),   // 白縁の太さ・頭上からの高さ（2026-09-13）
    floorStyle: ['grass', 'grassDark'].includes($('floorStyle')?.value) ? $('floorStyle').value : 'plank', // 床の絵（板目／草原／草原（深緑））
    showShadows: true,   // 影は常に落とす（2026-09-16 ユーザー指定でチェックを廃止。2D の板のときだけ下で自動オフ）
    ambient: num('ambient', 0.7),
    spotIntensity: num('spotIntensity', 1.6),
    spotElev: num('spotElev', 40),
    spotSpread: num('spotSpread', 30),
    spotCone: num('spotCone', 30),
    spotBlur: num('spotBlur', 0.5),
    // 光源の切替と太陽光（2026-09-16 ユーザー指定）
    lightMode: $('outdoor').checked ? 'sun' : 'spot',   // 屋外チェック（旧ラジオ lightMode の値名は stage.js との受け渡しで残す）
    sunOn: $('sunOn').checked, spotOn: $('spotOn').checked,   // 光源の使用／不使用（併用可。2026-09-17）
    sunIntensity: num('sunIntensity', 1.2), sunAzimuth: num('sunAzimuth', 30), sunElev: num('sunElev', 55), sunTemp: num('sunTemp', 0.5),
    sunManual: $('sunManual').checked, sunHour: num('sunHour', 12), sunCloud: num('sunCloud', 0), stageFacing: num('stageFacing', 180),
    sunAmbient: num('sunAmbient', 0.7), skyGlowSpread: num('skyGlowSpread', 1),
    starTwinkle: num('starTwinkle', 1), sunBloom: num('sunBloom', 1.5),
    skyTint: $('skyTint').checked, groundBounceOn: $('groundBounceOn').checked, groundBounce: $('groundBounce').checked,   // 空色の影響・床の照り返しの色（2026-09-16）
    moonAge: num('moonAge', 15), moonAzimuth: num('moonAzimuth', 180), moonElev: num('moonElev', 30), moonBright: num('moonBright', 1),   // 月（2026-09-16）
    exposure: num('exposure', 1), bloomAll: num('bloomAll', 0), bloomThr: num('bloomThr', 0.7),   // 画面全体のブルームと閾値（2026-09-17）
    bgTop: $('bgTop').value, bgBottom: $('bgBottom').value, bgMid: num('bgMid', 50), bgFlip: $('bgFlip').checked,
    showTitle: $('showTitle').checked, // タイトルのロゴ（2026-09-12）
    titleBend: $('titleBend').checked,    // ひな壇の曲率で曲げる（2026-09-13）
    // 自動カメラ（演奏会のカメラワーク。2026-09-13）
    autoCam: $('autoCam').checked, camRate: num('camRate', 1), camClose: num('camClose', 0.6),
    camMove: num('camMove', 0.6), camMoveFreq: num('camMoveFreq', 0.6),
    // クレジット（2026-09-13。MIDIOrchestra と同じ作り：プレビューに重ねた DOM）
    showTempo: $('showTempo').checked, tempoScale: num('tempoScale', 1), tempoOpacity: num('tempoOpacity', 0.9),
    showCredits: $('showCredits').checked,
    credit1: $('credit1').value, credit2: $('credit2').value, credit3: $('credit3').value, credit4: $('credit4').value,
    creditScale: num('creditScale', 1), creditColor: $('creditColor').value, creditOpacity: num('creditOpacity', 0.8),
    titleX: num('titleX', 0), titleY: num('titleY', 7), titleZ: num('titleZ', -12), titleScale: num('titleScale', 1), titleOpacity: num('titleOpacity', 1),
    facing: 'conductor',  // 体の向きは指揮者固定（2026-09-10 ユーザー確定。UI は撤去）
    partStyle: 'voxel',   // 絵の方式はボクセル固定（2026-09-10 ユーザー確定。2D の板の実装は sprites.js に残っているが UI は撤去）
  };
}

// トラック → 楽器の手動割当（MIDI ファイル名ごと。値は楽器名。旧形式のファミリー名も engine 側で受け付ける）
function loadFamilyOverrides(name) {
  try {
    const saved = JSON.parse(LS.getItem(FAMILY_KEY) || '{}')[name] || {};
    // 旧名 'violin'（1st/2nd に分ける前）の保存値は捨てて自動判定に戻す。残すと 2nd バイオリンまで 1st になる（2026-09-12）
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => normalizeVariant(v) === v));
  } catch { return {}; }
}
function saveFamilyOverride(name, key, family) {
  let all = {};
  try { all = JSON.parse(LS.getItem(FAMILY_KEY) || '{}'); } catch { all = {}; }
  (all[name] ||= {})[key] = family;
  try { LS.setItem(FAMILY_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('割当保存失敗:', e); }
}

// 音域フィルター（キースイッチ除外）：トラック名 → {pitchMin, pitchMax}
function loadPitchFilters() {
  try { return JSON.parse(LS.getItem(PITCH_FILTER_KEY) || '{}'); } catch { return {}; }
}
function savePitchFilter(trackName, pitchMin, pitchMax) {
  const all = loadPitchFilters();
  if (pitchMin <= 0 && pitchMax >= 127) delete all[trackName]; else all[trackName] = { pitchMin, pitchMax };
  try { LS.setItem(PITCH_FILTER_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('音域保存失敗:', e); }
}

// 強弱の情報源（velocity / CC1 / CC11）：トラック名 → source
function loadDynSources() {
  try { return JSON.parse(LS.getItem(DYN_SOURCE_KEY) || '{}'); } catch { return {}; }
}
function saveDynSource(trackName, source) {
  const all = loadDynSources();
  if (source === 'auto') delete all[trackName]; else all[trackName] = source;
  try { LS.setItem(DYN_SOURCE_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('強弱ソース保存失敗:', e); }
}

// 衣装：トラック名 → 衣装のキー。**そのセクションの首席（前列の 1 人）だけ**が着る（2026-09-22 ユーザー指定）。
// 全員に着せたい時は従来どおり ?costume= を使う
function loadCostumes() {
  try { return JSON.parse(LS.getItem(COSTUME_KEY) || '{}'); } catch { return {}; }
}
function loadConductorCostume() {
  try { const v = JSON.parse(LS.getItem(CONDUCTOR_COSTUME_KEY) || '""'); return COSTUMES[v] ? v : ''; } catch { return ''; }
}
function saveConductorCostume(key) {
  try {
    if (!key) LS.removeItem(CONDUCTOR_COSTUME_KEY); else LS.setItem(CONDUCTOR_COSTUME_KEY, JSON.stringify(key));
    pushSettings();
  } catch (e) { console.warn('指揮者の衣装保存失敗:', e); }
}

function saveCostume(trackName, key) {
  const all = loadCostumes();
  if (!key) delete all[trackName]; else all[trackName] = key;
  try { LS.setItem(COSTUME_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('衣装保存失敗:', e); }
}

// トラック統合：トラック名 → 'auto' | 'none' | 統合先トラック名
function loadMerges() {
  try { return JSON.parse(LS.getItem(MERGE_KEY) || '{}'); } catch { return {}; }
}
function saveMerge(trackName, value) {
  const all = loadMerges();
  if (value === 'auto') delete all[trackName]; else all[trackName] = value;
  try { LS.setItem(MERGE_KEY, JSON.stringify(all)); pushSettings(); } catch (e) { console.warn('統合設定保存失敗:', e); }
}

// ---------- MIDI 読み込み ----------
// ---- ファイルを開く（2026-09-14 ユーザー指定）----
// 「ファイル選択」（input type=file）は開始フォルダを指定・記憶できず、ブラウザがオリジンに 1 つだけ
// 覚えるので、MIDI と音声で同じ場所が開いてしまう。File System Access API の showOpenFilePicker は
// id ごとに最後のフォルダを別々に覚えるので、使える時はそちらを使う（使えない時は従来の input）
async function pickFile(id, types) {
  if (!window.showOpenFilePicker) return null;      // 非対応なら input にフォールバック
  try {
    const [h] = await window.showOpenFilePicker({ id, types, multiple: false });
    return await h.getFile();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('ファイルを開けませんでした:', err);
    return null;                                     // 取り消しは何もしない
  }
}
const MIDI_TYPES = [{ description: 'MIDI ファイル', accept: { 'audio/midi': ['.mid', '.midi'] } }];
const AUDIO_TYPES = [{ description: '音声ファイル', accept: { 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'] } }];

// ---- 読み込んでいる MIDI と音声の控え（プロジェクトに保存する。2026-09-18 ユーザー指定）----
// MIDI は中身。音声は出どころに応じて：素材フォルダ（media/…）・URL・別のプロジェクトはサーバーがその場所からコピーし、
// 「音声」ボタン（手元のファイル）で読んだものはブラウザが場所を教えないので、中身をサーバーへ送る
let midiBytes = null;                // 今の MIDI の中身（Uint8Array）
let audioSource = null;              // { kind: 'media' | 'url' | 'file' | 'project', src, raw, name }

// MIDI の中身から読み込む（ファイル・URL・プリセットの 3 か所から使う）
function loadMidiBytes(bytes, name, opts = {}) {
  const midi = new Midi(bytes);
  midiBytes = bytes; midiFileName = name;
  setStatus(`${name}（${midi.tracks.filter((t) => t.notes.length).length} トラック / ${fmtTime(midi.duration)}）`);
  buildScene(midi, opts);
}
async function loadMidiFile(file) {
  if (!file) return;
  try {
    loadMidiBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (err) {
    console.error(err);
    setStatus(`✗ MIDI を読み込めませんでした（${err.message}）。標準 MIDI ファイル (.mid) を選んでください`);
  }
}
// 音声を読み込む。src：再生する URL（素材は media/…、手元のファイルは blob:…）
function setAudioSrc(src, source) {
  audioSource = source;
  audio.src = src;
  audio.addEventListener('loadedmetadata', () => { audioLoaded = true; $('audioName').textContent = source.name; }, { once: true });
  audio.addEventListener('error', () => { audioLoaded = false; $('audioName').textContent = `✗ 読み込めませんでした（${source.name}。mp3/wav/m4a）`; }, { once: true });
}
function clearAudio(msg = '（なし）') {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  audioLoaded = false; audioSource = null;
  $('audioName').textContent = msg;
}
function loadAudioFile(file) {
  if (!file) return;
  setAudioSrc(URL.createObjectURL(file), { kind: 'file', name: file.name });
}
$('midiFile').addEventListener('change', (e) => loadMidiFile(e.target.files[0]));
$('audioFile').addEventListener('change', (e) => loadAudioFile(e.target.files[0]));
// 音声を素材フォルダから選ぶ（場所がプリセットに残る。2026-09-18）。一覧は開くたびに取り直す（サーバー側で 5 秒キャッシュ）
let audioList = {};
$('audioPick').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    const r = await fetch('media-audio.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    audioList = (await r.json()) || {};
  } catch (err) {
    console.warn('音声の一覧を取得できませんでした:', err.message);
    $('audioName').textContent = '✗ 音声の一覧を取れません（開発サーバー tools/serve.py を再起動してください）';
    return;
  }
  const tmp = { src: audioSource?.kind === 'media' ? audioSource.src : '', srcRaw: audioSource?.raw || '' };
  openPicker(btn, tmp, (dir, name) => {
    if (dir !== undefined) { const src = mediaUrlOf(dir, name); setAudioSrc(src, { kind: 'media', src, raw: dir ? `${dir}/${name}` : name, name }); return; }   // 素材ルート直下なら先頭の / を付けない
    if (!tmp.src) { clearAudio(); return; }                                  // 「素材を外す」
    const kind = tmp.src.startsWith('media/') ? 'media' : 'url';            // パスを直接入力
    setAudioSrc(tmp.src, { kind, src: tmp.src, raw: tmp.srcRaw, name: (tmp.srcRaw || tmp.src).split('/').pop() });
  }, audioList);
});
// クリックを乗っ取って、フォルダを別々に覚えるピッカーを使う。
// ボタンの見た目はラベルだが、クリックが当たるのは上に重ねた透明な input なので input 側に付ける
for (const [id, types, load] of [['midiFile', MIDI_TYPES, loadMidiFile], ['audioFile', AUDIO_TYPES, loadAudioFile]]) {
  if (!window.showOpenFilePicker) break;             // 非対応のブラウザは従来の「ファイル選択」のまま
  $(id).addEventListener('click', async (e) => {
    e.preventDefault();                              // 標準のダイアログは開かせない
    load(await pickFile(`pixelOrchestra-${id}`, types));
  });
}

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
  $('seek').max = $('vSeek').max = Math.floor((engine.duration + midiDelaySec()) * 100);
  if (keepTime && wasPlaying) play();
}
// デバッグ用フック（DevTools から window.__po.puppets 等を参照できる）
window.__po = { get mediaList() { return mediaList; }, get seats() { return lastSeats; }, get autoCam() { return autoCam; }, get engine() { return engine; }, get puppets() { return puppets; }, get conductor() { return conductor; }, camera, controls, scene, renderer, Puppet, audio, clock, currentTime };

// 楽器を含む奏者 1 人の占有範囲 [unit]（奏者の原点基準、+x = 奏者の左、+z = 奏者の前＝指揮者側）。variant ごとに 1 度だけ仮のパペットを作って測る。
// 横（minX/maxX）は大きな楽器（グランカッサ・ピアノ・ハープ等）の隣に自動で隙間を空けるため、
// 奥行き（minZ/maxZ）は打楽器の段で楽器ごと後ろに下げるために使う（stage.js の depthCenter）
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
// 最大チャンネル 0.8 までは素通し（色も彩度もそのまま）、それ以上だけ 1.0 に漸近するよう圧縮。
// RGB を同じ比率で縮めるので色相・彩度が変わらない（ACES は 1.0 以下でも彩度が落ちるという指摘への対応）。
// 判定を輝度にしていた時は赤・青主体の色が輝度 0.8 未満のまま R/B だけ 1.0 を超えてクリップし、露出を上げると色が抜けた（2026-09-16 修正）
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
    color *= toneMappingExposure;
    // 判定は輝度ではなく最大チャンネル（2026-09-16 ユーザー指摘：輝度判定だと赤・青が先にクリップして色が抜ける）
    float l = max( color.r, max( color.g, color.b ) );
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
// 上下反転（2026-09-14 ユーザー指定）は見た目だけ。上の色・下の色・中間地点の値は動かさない
// CSS の色に、シェーダーと同じ露出＋トーン圧縮（輝度 0.8 以上だけ 1.0 に漸近）を掛ける（2026-09-16 ユーザー指摘：露出が空に効いていなかった）
function toneHex(hex, exposure) {
  const c = new THREE.Color(hex).multiplyScalar(exposure);
  const l = Math.max(c.r, c.g, c.b), knee = 0.8;   // 判定は最大チャンネル（シェーダーと同じ）
  if (l > knee) { const t = l - knee; c.multiplyScalar((knee + (1 - knee) * (t / (t + (1 - knee)))) / l); }
  c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b);
  return '#' + c.getHexString();
}
function applyBackground(top, bottom, mid, flip, exposure = 1) {
  top = toneHex(top, exposure); bottom = toneHex(bottom, exposure);
  const css = flip
    ? `linear-gradient(to bottom, ${bottom}, ${100 - mid}%, ${top})`
    : `linear-gradient(to bottom, ${top}, ${mid}%, ${bottom})`;
  if (css === bgApplied) return;
  bgApplied = css;
  $('view').style.background = css;
}
// 太陽光・自動のとき、詳細（強さ・方角・高度・色温度・天空光）のスライダーに計算値を入れて追従させる（2026-09-16 ユーザー指定）。
// 手動に切り替えた時はその値から始められる。input イベントは出さない（保存は次の操作時にまとめて）
let sunFollowKey = '';
function followSunSliders(s) {
  const key = `${s.sunHour}|${s.sunCloud}|${s.stageFacing}|${s.moonAge}`;
  if (key === sunFollowKey) return;
  sunFollowKey = key;
  const a = sunFromTime(s.sunHour, s.sunCloud, s.stageFacing, s.moonAge);
  const vals = { sunIntensity: a.intensity.toFixed(2), sunAzimuth: Math.round(a.azimuth), sunElev: Math.round(a.elev), sunTemp: a.temp.toFixed(2), sunAmbient: a.skyLight.toFixed(2), bgTop: a.sky, bgBottom: a.horizon,
                 moonAzimuth: Math.round(a.moonAzimuth), moonElev: Math.round(a.moonElev), moonBright: a.moonK.toFixed(2) };
  for (const [id, v] of Object.entries(vals)) {
    const el = $(id); if (!el) continue;
    el.value = v;
    const lab = document.querySelector(`[data-value-for="${id}"]`);
    if (lab) { if (lab.tagName === 'INPUT') lab.value = valueText(id, el.value); else lab.textContent = valueText(id, el.value); }
  }
}
let lastBloomAll = 0, lastBloomThr = 0.7;
let lastMetalSpec = null;   // 金属のツヤ（変わった時だけシーンを走査する）
function applyToneMapping(exposure) { renderer.toneMappingExposure = exposure; }

// 弓の向きの共有台帳。キーは「音符の時刻 | 音の長さ」なので、同じパートの中はもちろん、
// 同じリズムを弾いている弦どうし（ハモっていても）同じ向きになる（2026-09-14 ユーザー指定）
const bowSync = { dirOf: new Map() };

let conductorCostumeApplied = null;   // 今の指揮者に着せてある衣装（変わったら作り直す）
function placePuppets() {
  setPartStyle(settings().partStyle);
  bowSync.dirOf.clear();
  setStageDepthWrite(settings().partStyle !== 'sprite'); // ボクセルは通常の深度、2D の板は描画順で前後を決める
  for (const p of puppets) scene.remove(p.puppet.root);
  puppets = [];
  // 方式が変わった時と、指揮者の衣装が変わった時は作り直す（Puppet は作る時にしか衣装を見ない）
  const condCostume = loadConductorCostume() || COSTUME;
  if (conductor && (conductor.style !== settings().partStyle || conductorCostumeApplied !== condCostume)) {
    scene.remove(conductor.root); conductor = null;
  }
  const seats = layoutSeats(engine.tracks, footprintOf);
  let seed = 1;
  const costumes = loadCostumes();
  for (const seat of seats) {
    // セクションの代表トラック名で引く（統合されたトラックは代表に寄せてある）。
    // positions は前列・左から並ぶので、index 0 ＝ 首席。ここ 1 人だけに着せる（2026-09-22 ユーザー指定）
    const secCostume = COSTUMES[costumes[seat.track.name]] ? costumes[seat.track.name] : '';
    seat.positions.forEach((pos, i) => {
      const costume = (i === 0 && secCostume) ? secCostume : COSTUME;
      const puppet = new Puppet({ family: seat.track.family, variant: seat.track.variant, color: seat.track.color, seed: seed++, costume });
      puppet.bowSync = bowSync;   // 同じリズムを弾く奏者どうしで弓の向きを揃える（2026-09-14 ユーザー指定）
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
    conductor = new Puppet({ isConductor: true, color: '#ffffff', seed: 99, costume: condCostume });
    conductorCostumeApplied = condCostume;
    conductor.root.position.set(0, PODIUM_H, CONDUCTOR_Z);
  }
  scene.add(conductor.root);
}

// パート名ラベル：トラックごとに奏者グループの中央・頭の少し上（フォント読み込み後にも作り直す）
let lastSeats = [];
let labelSizeApplied = 1, labelOutlineApplied = 3, labelYApplied = 0;
function rebuildLabels() {
  labels.traverse((o) => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  labels.clear();
  for (const seat of lastSeats) {
    const ps = seat.positions;
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const s = settings();
    // 出す文字は割り当てた楽器の名前で固定（2026-09-14 ユーザー指定。MIDI のトラック名は使わない）
    const text = VARIANTS[seat.track.variant]?.label || seat.track.name;
    const sp = nameLabel(text, seat.track.color, s.labelSize, s.labelOutline);
    sp.userData.baseY = ps[0].y + HEAD_Y - 0.55;      // 高さ位置スライダーはここからの差分
    sp.position.set(cx, sp.userData.baseY + s.labelY, cz);
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
    // 衣装：このセクションの首席 1 人だけに着せる。統合されたトラックは席を持たないので選べない
    const csLab = document.createElement('span'); csLab.className = 'pitch-label dyn-label'; csLab.textContent = '衣装';
    const csSel = document.createElement('select'); csSel.className = 'dyn-select';
    const cur = loadCostumes()[tr.name] || '';
    const addCos = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; if (v === cur) o.selected = true; csSel.appendChild(o); };
    addCos('', 'なし');
    for (const [k, def] of Object.entries(COSTUMES)) addCos(k, def.label || k);
    csSel.disabled = !!tr.mergeTarget;
    csLab.title = csSel.title = tr.mergeTarget
      ? '統合されたトラックは席を持たないので選べません（統合先のトラックで選んでください）'
      : 'このセクションの首席（前列の 1 人）だけがこのキャラクターになります。全員に着せたい時は ?costume= を使います';
    csSel.addEventListener('change', () => { saveCostume(tr.name, csSel.value); buildScene(currentMidi, { keepTime: true }); });
    td2.append(document.createElement('br'), csLab, csSel);
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
// 上のバー（playBtn…）と映像の上のバー（vPlayBtn…。2026-09-18）で同じ処理
for (const p of ['', 'v']) {
  const id = (n) => p ? `v${n[0].toUpperCase()}${n.slice(1)}` : n;
  $(id('playBtn')).addEventListener('click', () => (clock.playing ? pause() : play()));
  $(id('stopBtn')).addEventListener('click', () => { pause(); seek(0); });
}
// 巻き戻し・早送り（5 秒ずつ。2026-09-18 に 10 秒で入れ、2026-09-19 ユーザー指定で 5 秒に）。範囲外は seek が曲の頭・終わりに収める
const SKIP_SEC = 5;
for (const id of ['rewBtn', 'vRewBtn']) $(id).addEventListener('click', () => { if (engine) seek(currentTime() - SKIP_SEC); });
for (const id of ['ffBtn', 'vFfBtn']) $(id).addEventListener('click', () => { if (engine) seek(currentTime() + SKIP_SEC); });
for (const id of ['seek', 'vSeek']) $(id).addEventListener('input', (e) => seek(parseInt(e.target.value, 10) / 100));
// 映像の上のバー：再生中にマウスを 2.5 秒動かさないと薄く消え、動かすと出る（止まっている間は出たまま。2026-09-18）
for (const ev of ['pointermove', 'pointerdown']) $('viewArea').addEventListener(ev, wakeTransport, { passive: true });
$('viewTransport').addEventListener('click', (e) => e.stopPropagation());   // 公開ページの「画面を押すと一時停止」に伝えない
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
  const ro = new ResizeObserver(setBarHeight);
  for (const id of ['stageArea', 'camBar', 'screenBar', 'viewArea']) { const el = document.getElementById(id); if (el) ro.observe(el); }
  setBarHeight();
}

// トラックの欄の折りたたみ（2026-09-18 ユーザー指定）：見出しを押すと列が細い帯になる（幅は CSS の body.tracks-folded が決める）。
// 列の幅が変わるとプレビューの枠が変わり、上のサイズ監視が拾って取り直すので、ここでは何もしなくてよい。
// 状態はこのブラウザにだけ覚える：プリセットにもブラウザ間の共有（settings.json）にも入れない
// （プリセットを読み込んだら欄が勝手に閉じる、という動きにしないため）
// 指揮者の衣装（2026-09-22 ユーザー指定）。奏者はトラックごと、指揮者だけはここで選ぶ
{
  const sel = $('conductorCostume');
  const cur = loadConductorCostume();
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; if (v === cur) o.selected = true; sel.appendChild(o); };
  add('', 'なし');
  for (const [k, def] of Object.entries(COSTUMES)) add(k, def.label || k);
  sel.addEventListener('change', () => { saveConductorCostume(sel.value); buildScene(currentMidi, { keepTime: true }); });
}

{
  const FOLD_KEY = 'pixelOrchestra.ui.tracksFolded';
  const hd = $('tracksHd'), mark = hd.querySelector('.foldMark');
  const apply = (folded) => {
    document.body.classList.toggle('tracks-folded', folded);
    hd.setAttribute('aria-expanded', String(!folded));
    mark.textContent = folded ? '▶' : '◀';
  };
  let folded = false;
  try { folded = LS.getItem(FOLD_KEY) === '1'; } catch (e) { console.warn('折りたたみ状態の読込失敗（開いた状態で続行）:', e); }
  apply(folded);
  const toggle = () => {
    folded = !folded; apply(folded);
    try { LS.setItem(FOLD_KEY, folded ? '1' : '0'); } catch (e) { console.warn('折りたたみ状態の保存失敗:', e); }
  };
  hd.addEventListener('click', toggle);
  hd.addEventListener('keydown', (e) => {   // Enter / Space で切り替え。Space を再生ショートカットに取られない
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); }
  });
  hd.addEventListener('keyup', (e) => { if (e.key === ' ') e.stopPropagation(); });
}

// 「設定」ポップアップ（クレジット・テンポ・拍子。2026-09-18 ユーザー指定）：上のバーのボタンで開閉。外を押す・Escape でも閉じる。
// 中の入力は #topbar 配下なので、設定の自動収集・保存は今までどおり効く
{
  const btn = $('settingsBtn'), pop = $('settingsPop');
  const setOpen = (open) => { pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('on', open); };
  btn.addEventListener('click', () => setOpen(pop.hidden));
  addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) setOpen(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) setOpen(false); });
  // 中で文字を打っている間、Space 等を再生ショートカットに取られない。伝播を止めるので Escape はここで先に扱う
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); e.stopPropagation(); });
}

$('resetCam').addEventListener('click', () => {
  camera.position.set(0, 9, 10.5); controls.target.set(0, 3, -12); controls.update(); // 既定のカメラ（2026-09-13 ユーザー指定）
  syncCameraSliders();
});

// プレビューの縦横比を PC（16:9）/ スマホ（9:16）に切り替える（2026-09-14 ユーザー指定）。
// 実際の描画サイズは stage.resize() が毎フレーム見ているので、class を付け替えるだけでよい
const VIEW_MODES = [['viewFree', ''], ['viewPc', 'pc'], ['viewPhoneV', 'phoneV'], ['viewPhoneH', 'phoneH']];
for (const [id, cls] of VIEW_MODES) {
  $(id).addEventListener('click', () => {
    for (const [other, c] of VIEW_MODES) {
      $(other).classList.toggle('on', other === id);
      if (c) $('viewWrap').classList.toggle(c, c === cls);
    }
    setBarHeight();   // 端末が変われば入り切るかどうかも変わる
  });
}

// ---------- カメラ座標スライダー（MIDIOrchestra を参考に。2026-09-11）----------
// スライダー → カメラ、マウス操作（OrbitControls）→ スライダー の双方向。値は他の設定と同じく自動保存される
const CAM_IDS = ['camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ'];
let camSyncing = false;
// 表示だけ更新する（保存はしない）。自動カメラ中に毎フレーム呼ぶので、触るのはカメラの 6 本だけ
function showCameraValues() {
  camSyncing = true;
  const p = camera.position, t = controls.target;
  const vals = { camX: p.x, camY: p.y, camZ: p.z, tgtX: t.x, tgtY: t.y, tgtZ: t.z };
  for (const id of CAM_IDS) {
    const v = vals[id].toFixed(1);
    const el = $(id);
    if (el.value !== v) el.value = v;
    const lab = document.querySelector(`[data-value-for="${id}"]`);
    if (lab && document.activeElement !== lab) {
      if (lab.tagName === 'INPUT') lab.value = v; else lab.textContent = v;
    }
  }
  camSyncing = false;
}
function syncCameraSliders() { // カメラ → スライダー（手動操作の後。保存もする）
  showCameraValues();
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
controls.addEventListener('change', () => { if (!camSyncing && !autoDriving) syncCameraSliders(); });

function setStatus(msg) { $('status').textContent = msg; }
function fmtTime(s) { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

// ---------- 自動カメラ（演奏会のカメラワーク。2026-09-13 ユーザー指定） ----------
// ショットの一覧は曲・座席・設定が変わった時だけ作り直す（毎フレームは引くだけ）
const autoCam = new AutoCamera();
let autoCamKey = '';
let autoDriving = false;      // 自動でカメラを動かしている間は、スライダーへの書き戻しをしない
function updateAutoCam(s, t) {
  if (!engine || !lastSeats.length) return;
  const key = [lastSeats.length, engine.duration, s.camRate, s.camClose].join('|');
  if (key !== autoCamKey) {
    autoCamKey = key;
    autoCam.build(engine, lastSeats, {
      rate: s.camRate, close: s.camClose,
      // セクション（弦・木管・金管・打楽器）と、楽器の実際の高さを渡す。
      // 超近接は顔でも足元でもなく楽器を狙う（2026-09-13 ユーザー指定）
      familyOf: (seat) => VARIANTS[seat.track.variant]?.family || 'other',
      instYOf: (seat) => {
        const pp = puppets.find((x) => x.track === seat.track)?.puppet;
        const o = pp && (pp.inst || pp.held?.R || pp.held?.L);
        // 原点ではなく見た目の中心（外接箱の中心）。原点はチェレスタなら床、ホルンなら頭上にある
        return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).y : null;
      },
    }, CONDUCTOR_Z);
  }
  const shot = autoCam.at(t, { conductorZ: CONDUCTOR_Z, move: s.camMove, moveFreq: s.camMoveFreq });
  if (!shot) return;
  autoDriving = true;
  camera.position.set(shot.pos[0], shot.pos[1], shot.pos[2]);
  controls.target.set(shot.target[0], shot.target[1], shot.target[2]);
  controls.update();
  showCameraValues();     // スライダーを自動カメラに追従させる（保存はしない。2026-09-13 ユーザー指定）
  autoDriving = false;
}

// ---------- メインループ ----------
// ---- 画面の揺れ（2026-09-18 ユーザー指定）：バスドラム（楽器に bassdrum を割り当てたトラック）が鳴った瞬間に画面全体を揺らす。連動先は固定 ----
const SHAKE_VARIANT = 'bassdrum';
// 「時刻 → 揺れ」の純関数。発音からの経過時間で減衰する振動（cos × exp）。大きさは音の強さ（velocity）×「強さ」×カメラから中心点までの距離
// （寄っても引いても画面上で同じくらいの幅になる）。同じ再生位置なら同じ揺れになる（後で書き出しても再現できる）
const SHAKE_FREQ = 7;          // 振動の速さ [Hz]（0.25 秒で 1〜2 往復）
const SHAKE_GAIN = 0.022;      // 強さ 1・velocity 最大で、距離の 2.2%（画角 50° なら画面の高さの約 2.4%）
const SHAKE_ROLL = 0.04;       // 傾き [rad]（約 2.3°）
const SHAKE_DOT_ROWS = 120;    // 「ドット単位」の段：画面の高さをこの行数に見立てる
const SHAKE_DOT_FPS = 15;      // 「ドット単位」の時間の刻み [コマ/秒]
const _shk = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), applied: false };
let shakeNow = null;
function shakeAt(tm, s) {
  if (!s.shakeOn || !(s.shakeAmt > 0) || !engine) return null;
  const k = 4 * s.shakeDecay;                       // 減衰 [1/s]。1 で e^-1 が 0.25 秒
  // ドット単位：時間も 1 秒 15 コマに刻む（位置の段だけでは 60 コマで滑らかに見えてしまった。2026-09-18 ユーザー指摘）
  const tq = s.shakeDots ? Math.floor(tm * SHAKE_DOT_FPS) / SHAKE_DOT_FPS : tm;
  let disp = 0, seed = 0;
  engine.tracks.forEach((tr) => {
    if (tr.variant !== SHAKE_VARIANT) return;
    const st = engine.trackState(tr, tq);
    if (!st.onset || st.age < 0 || st.age * k > 6) return;   // 減衰しきった音は無視
    const e = Math.min(1, engine.energyAt(tr, st.onset.time + 0.03));   // 鳴った瞬間の強さ（velocity。CC 固定でも効く）
    disp += e * Math.exp(-st.age * k) * Math.cos(2 * Math.PI * SHAKE_FREQ * st.age);
    seed = Math.max(seed, st.onset.time);
  });
  if (Math.abs(disp) < 1e-4) return null;
  const dist = camera.position.distanceTo(controls.target);
  let amp = Math.max(-2, Math.min(2, disp)) * s.shakeAmt * SHAKE_GAIN * dist;
  if (s.shakeDots) {   // ドット単位：画面の高さを 120 行に見立て、その 1 行ぶんに丸める（240 行では段が細かすぎて分からなかった）
    const q = (2 * dist * Math.tan((camera.fov * Math.PI / 180) / 2)) / SHAKE_DOT_ROWS;
    amp = Math.round(amp / q) * q;
    if (amp === 0) return null;
  }
  const out = { x: 0, y: 0, z: 0, roll: 0 };
  switch (s.shakeMode) {
    case 'h': out.x = amp; break;
    case 'rand': { const a = (Math.sin(seed * 127.1) * 43758.5453) % 1 * 2 * Math.PI; out.x = Math.cos(a) * amp; out.y = Math.sin(a) * amp; break; }   // 発音ごとに向きが変わる
    case 'tilt': out.roll = (amp / (SHAKE_GAIN * dist)) * SHAKE_ROLL; break;   // 位置の代わりに回す（量は同じ正規化）
    case 'punch': out.z = amp; break;      // 前へ出て戻る
    default: out.y = amp;                  // 縦：カメラが上へ跳ねる＝絵はまず下へ沈む（2026-09-18 確認時に符号を直した）
  }
  return out;
}
// 描画の直前に掛け、直後に控えた値をそのまま書き戻す（足して引くと誤差でカメラ操作の change が毎フレーム鳴り、スライダーの保存が走る）
function applyShake(sh) {
  if (!sh) return;
  _shk.pos.copy(camera.position); _shk.quat.copy(camera.quaternion);
  const q = camera.quaternion;
  _shk.right.set(1, 0, 0).applyQuaternion(q); _shk.up.set(0, 1, 0).applyQuaternion(q); _shk.fwd.set(0, 0, -1).applyQuaternion(q);
  camera.position.addScaledVector(_shk.right, sh.x).addScaledVector(_shk.up, sh.y).addScaledVector(_shk.fwd, sh.z);
  if (sh.roll) camera.rotateZ(sh.roll);
  _shk.applied = true;
}
function undoShake() {
  if (!_shk.applied) return;
  camera.position.copy(_shk.pos); camera.quaternion.copy(_shk.quat);
  _shk.applied = false;
}

let lastPerf = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastPerf) / 1000);
  lastPerf = now;
  stage.resize(); // プレビューの大きさに追従（変わった時だけ設定する。初回の描画サイズ取りこぼし対策も兼ねる）
  controls.update();

  if (engine && conductor && roll) {
    const t = currentTime();                 // 舞台の時計（シーク・時間表示・スクリーンはこれ）
    const md = midiDelaySec();
    const tm = t - md;                       // MIDI の時刻（奏者の動き・ピアノロール・テンポ表示）
    syncAudio(t);                            // 音声遅延の待ち合わせ
    if (clock.playing && t >= engine.duration + md + 1) pause();
    const s = settings();
    const beat = engine.beatAt(tm);
    const g = engine.globalEnergyAt(tm);
    const ctx = { t: tm, dt, beat, settings: s, globalEnergy: g, bpm: engine.bpmAt(tm) };   // bpm は姿勢の均し（拍の長さ）に使う
    shakeNow = shakeAt(tm, s);               // 画面の揺れ（描画の直前に掛ける）

    const face = (p) => (s.facing === 'conductor' ? p.faceToward(0, CONDUCTOR_Z) : p.faceCamera(camera));
    for (const { puppet, track } of puppets) {
      face(puppet);
      puppet.update(engine.trackState(track, tm - puppet.delay), ctx);
    }
    face(conductor);
    conductor.update({ energy: g, active: [], onset: null, next: null, age: Infinity, toNext: Infinity, pitchNorm: 0.5 }, ctx);

    labels.visible = s.showNames;
    if (s.labelSize !== labelSizeApplied || s.labelOutline !== labelOutlineApplied) {
      // 大きさ・白縁の太さが変わったら絵を作り直す
      labelSizeApplied = s.labelSize; labelOutlineApplied = s.labelOutline;
      rebuildLabels();
    }
    if (s.labelY !== labelYApplied) {   // 高さ位置は動かすだけ（作り直さない）
      labelYApplied = s.labelY;
      labels.children.forEach((sp) => { sp.position.y = (sp.userData.baseY ?? sp.position.y) + s.labelY; });
    }
    if (s.lightMode === 'sun' && !s.sunManual) { followSunSliders(s); s.bgTop = $('bgTop').value; s.bgBottom = $('bgBottom').value; }   // 自動のとき詳細スライダー（空の色も）を計算値に追従させる
    setShadows({ enabled: s.showShadows && s.partStyle !== 'sprite', ambient: s.ambient, spot: s.spotIntensity, spotElev: s.spotElev, spotSpread: s.spotSpread, spotCone: s.spotCone, spotBlur: s.spotBlur,
                 mode: s.lightMode, sunOn: s.sunOn, spotOn: s.spotOn, sun: s.sunIntensity, sunAzimuth: s.sunAzimuth, sunElev: s.sunElev, sunTemp: s.sunTemp,
                 sunAmbient: s.sunAmbient, sunAuto: s.sunManual ? null : { hour: s.sunHour, cloud: s.sunCloud, facing: s.stageFacing, moonAge: s.moonAge },
                 moonAzimuth: s.moonAzimuth, moonElev: s.moonElev, moonBright: s.moonBright, stageFacing: s.stageFacing, hour: s.sunHour, horizonHex: s.bgBottom,
                 bgFlip: s.bgFlip, skyGlowSpread: s.skyGlowSpread, starTwinkle: s.starTwinkle, sunBloom: s.sunBloom, skyTint: s.skyTint, groundBounceOn: s.groundBounceOn, groundBounce: s.groundBounce });   // 天空光の色相は stage 側で夕焼け色から決める。地面の色は床の平均色（stage 側）
    // 金属のツヤ（値が変わった時だけシーンを走査してマテリアルに反映）
    if (s.metalSpec !== lastMetalSpec) { lastMetalSpec = s.metalSpec; applyMetalLook(scene, s.metalSpec); }
    applyToneMapping(s.exposure); lastBloomAll = s.bloomAll; lastBloomThr = s.bloomThr;
    applyBackground(s.bgTop, s.bgBottom, s.bgMid, s.bgFlip, s.exposure);   // 空にも露出を掛ける
    setFloorStyle(s.floorStyle);   // 変わった時だけ作り直す（中で同じなら何もしない）
    if (s.autoCam) updateAutoCam(s, tm);     // 自動カメラ（手動操作より先に。切り替えは小節の頭）
    controls.enabled = !s.autoCam && !VIEW_NAME;   // 自動の間はマウス操作を止める。視聴モードも止める（保存したカメラで見せる）
    updateScreens(t);      // 流れるスクリーン（雲など）は時刻から位置を決める
    setWeather({ type: s.weatherType, amount: s.weatherAmount, wind: s.weatherWind, thunder: s.weatherThunder, speed: s.weatherSpeed * (s.weatherType === 'rain' ? RAIN_SPEED_SCALE : 1), fps: s.weatherFps, width: s.weatherWidth,
                 pos: s.weatherPos, height: s.weatherHeight, glint: s.weatherGlint });
    updateWeather(t);      // 雨・雪・雷も時刻から決める（setShadows の後：屋外かどうかを見る）
    applyTempo(s, engine.bpmAt(tm), beat);
    applyCredits(s);
    logo.visible = s.showTitle;
    logo.position.set(s.titleX, s.titleY, s.titleZ);
    logo.scale.setScalar(s.titleScale);
    bendU.uBend.value = s.titleBend ? 1 : 0;   // 曲げは毎フレーム位置・倍率を渡す（Z を動かせば曲率も変わる）
    bendU.uX0.value = s.titleX; bendU.uZ0.value = s.titleZ; bendU.uS.value = s.titleScale;
    if (s.titleOpacity !== logoOpacity) { // 透過（1 未満なら透明扱いにして奥のものが透ける）
      logoOpacity = s.titleOpacity;
      logo.traverse((m) => { if (m.isMesh) { m.material.opacity = logoOpacity; m.material.transparent = logoOpacity < 1; m.material.depthWrite = logoOpacity >= 1; m.material.needsUpdate = true; } });
    }
    setGlowSoftness(s.glowSoft);
    roll.setVisible(s.showRoll);
    roll.setMode(s.showLandLine);
    roll.setOpacity(s.rollOpacity);
    roll.setGlow(s.rollGlow);
    if (s.showRoll) roll.update(tm, s.rollSpeed, { overheadHeight: s.rollHeight, semitoneW: s.noteWidth });

    for (const el of [$('seek'), $('vSeek')]) if (!el.matches(':active')) el.value = Math.floor(t * 100);
    // 上のバーと映像の上のバーは同じ表示：時間だけ（テンポは出さない。2026-09-19 ユーザー指定）
    $('timeLabel').textContent = $('vTime').textContent = `${fmtTime(t)} / ${fmtTime(engine.duration + md)}`;
  }
  applyShake(shakeNow);   // 画面の揺れ：この描画の間だけカメラをずらす（空の球も一緒に動く）
  updateSky(camera);   // 空の球をカメラに追従
  renderFrame(renderer, scene, camera, lastBloomAll, lastBloomThr);   // 太陽のブルーム・全体のブルームを掛けて描く
  undoShake();
}

// URL パラメータ ?midi=path で自動読み込み（公開デモ・動作確認用）
async function loadFromUrl() {
  const q = new URLSearchParams(location.search);
  const midiUrl = q.get('midi');
  if (!midiUrl) return;
  try {
    const res = await fetch(midiUrl, { cache: 'no-store' }); // サンプル更新をキャッシュで見逃さない
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadMidiBytes(new Uint8Array(await res.arrayBuffer()), midiUrl.split('/').pop());
    const audioUrl = q.get('audio');
    if (audioUrl) setAudioSrc(audioUrl, { kind: 'url', src: audioUrl, name: decodeURIComponent(audioUrl.split('/').pop()) });
  } catch (err) {
    console.error(err);
    setStatus(`✗ ${midiUrl} を読み込めませんでした（${err.message}）`);
  }
}

makeValueInputs();
// 「表示する」のチェックは見出しの右端へ移す（id はそのままなので設定の保存・復元はこれまでどおり）
for (const d of document.querySelectorAll('#panel .box, #camBar .box, #viewArea .box, #settingsPop .box')) {
  const hd = d.querySelector(':scope > .hd');
  // その箱の先頭にあるチェック（「表示する」「自動で切り替える」など）を見出しの右端へ
  const chk = d.querySelector(':scope > label.chk');
  if (!hd || !chk) continue;
  const el = chk.querySelector('input[type=checkbox]');
  if (!el) continue;
  el.title = `${chk.textContent.trim()}：${chk.title}`;
  hd.appendChild(el);
  chk.remove();
}
// ---------- プリセットとプロジェクト（2026-09-14 / 2026-09-18 ユーザー指定） ----------
//   プリセット  ：見た目の設定だけ。PRESET_KEYS（設定・楽器の割当・音域・統合・スクリーン・スカイドーム・クレジット履歴）の
//                 localStorage の値をそのまま写したもの。ブラウザに保存（settings.json で共有）。別の曲に当てはめて使い回す
//   プロジェクト：上に加えて、MIDI・音声・スクリーンとスカイドームの素材をまるごと。開発サーバーが projects/<名前>/ の
//                 フォルダに書き出す（素材はコピーを参照するので、原本を動かしても消しても壊れない。原本の修正は保存し直すと取り直す）
// 保存欄 1 組（一覧・名前・保存・削除）ぶんの画面の処理を makeSlot にまとめ、保存先（backend）だけ差し替えて 2 組作る。
// 知らせは名前欄のプレースホルダーに一瞬出す（#status は MIDI のファイル名を出す場所なので使わない）

// 今の設定の控え（PRESET_KEYS の localStorage の値そのまま）
function snapshotSettings() {
  saveSettings();                    // 遅延保存を待たず、今の値を localStorage に確定させる
  const snap = {};
  for (const k of PRESET_KEYS) { const raw = LS.getItem(k); if (raw != null) snap[k] = raw; }
  return snap;
}
// 控えのスクリーン・スカイドームの素材の URL を、fn で置き換える（fn が値を返さなければそのまま）。
// 集めるだけなら fn の中で控えて undefined を返す
function mapAssetSrcs(snap, fn) {
  const out = { ...snap };
  for (const k of [SCREENS_KEY, DOMES_KEY]) {
    if (out[k] == null) continue;
    try {
      const a = JSON.parse(out[k]);
      if (!Array.isArray(a)) continue;
      for (const o of a) if (o && o.src) { const v = fn(o.src); if (v != null) o.src = v; }
      out[k] = JSON.stringify(a);
    } catch (e) { console.warn('素材の場所を読めませんでした:', e); }
  }
  return out;
}
// 控えを画面へ戻す（再読み込みせずに済ませる）。src があれば MIDI・音声も戻す（プロジェクト）
//   src = { midi: { name, bytes } | null, audio: { kind, src, name } | null }
function applySnapshot(p, src) {
  for (const k of PRESET_KEYS) { if (p[k] != null) LS.setItem(k, p[k]); else LS.removeItem(k); }
  pushSettings();
  loadSettings(); refreshValueLabels(); applyCameraSliders();
  try { const a = JSON.parse(LS.getItem(SCREENS_KEY) || 'null'); if (Array.isArray(a)) screens = a.map(withDefaults); } catch (e) { console.warn('スクリーンの復元失敗:', e); }
  try { const a = JSON.parse(LS.getItem(DOMES_KEY) || 'null');
        if (Array.isArray(a) && a.length === 3) domes = a.map((o) => { const v = { ...DOME_BASE, ...o }; v.r = Math.min(50, Math.max(10, v.r)); return v; }); }
  catch (e) { console.warn('スカイドームの復元失敗:', e); }
  renderScreens(); setScreens(screens); setDomes(domes);
  try { const c = JSON.parse(LS.getItem(CREDITS_KEY) || 'null'); if (c && c.hist) credits = c; } catch (e) { console.warn('クレジット履歴の復元失敗:', e); }
  for (const n of [1, 2, 3, 4]) fillCreditList(n);
  let midiDone = false;
  if (src) {
    if (src.midi?.bytes) {
      try { loadMidiBytes(src.midi.bytes, src.midi.name); midiDone = true; }   // 割当・音域・統合は上で書き戻し済みなので、それで組まれる
      catch (e) { console.error(e); setStatus(`✗ プロジェクトの MIDI を読み込めませんでした（${e.message}）`); }
    }
    if (src.audio) setAudioSrc(src.audio.src, { ...src.audio }); else clearAudio();
  }
  // 楽器の割当・音域・統合が変わるので、MIDI を読んでいれば組み直す（プロジェクトの MIDI を読んだ時は組み済み）
  if (currentMidi && !midiDone) buildScene(currentMidi, { keepTime: true });
}

// サーバーとのやりとり。失敗したらサーバーの言い分（error）を投げる。ローカルでも固まらないよう時間を切る（TOOL_CRAFT_RULES §5-1）
async function api(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(180000), ...opts });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch { /* JSON でなければ番号だけ */ }
    if (!VIEW_NAME && (r.status === 404 || r.status === 501)) msg += '（開発サーバー tools/serve.py を再起動してください）';
    throw new Error(msg);
  }
  return r;
}
const projectUrl = (name, file = '') => `projects/${encodeURIComponent(name)}${file ? `/${encodeURIComponent(file)}` : ''}`;

// 保存先：プリセット（ブラウザ）
const presetBackend = {
  load() { try { const o = JSON.parse(LS.getItem(PRESETS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { console.warn('プリセットの読込失敗:', e); return {}; } },
  store(all) { LS.setItem(PRESETS_KEY, JSON.stringify(all)); pushSettings(); },
  async list() { return Object.keys(this.load()).sort(); },
  async save(name) { const all = this.load(); all[name] = snapshotSettings(); this.store(all); },
  async apply(name) { const p = this.load()[name]; if (!p) throw new Error('見つかりません'); applySnapshot(p, null); },
  async remove(name) { const all = this.load(); delete all[name]; this.store(all); },
};
// 保存先：プロジェクト（開発サーバーのフォルダ）
const projectBackend = {
  async list() { return (await (await api('projects.json')).json()).filter((p) => !p.broken).map((p) => p.name); },
  async save(name) {
    const assets = [];
    const settings = mapAssetSrcs(snapshotSettings(), (u) => { assets.push(u); });
    const body = { settings, midi: null, audio: null, assets };
    if (midiBytes) {
      await api(projectUrl(name, 'song.mid'), { method: 'POST', body: midiBytes });
      body.midi = { name: midiFileName, file: 'song.mid' };
    }
    if (audioSource?.kind === 'file' && audio.src) {   // 手元のファイル：場所が分からないので中身を送る
      const ext = (audioSource.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)?.[1] || 'mp3').toLowerCase();
      await api(projectUrl(name, `audio.${ext}`), { method: 'POST', body: await (await fetch(audio.src)).blob() });
      body.audio = { name: audioSource.name, file: `audio.${ext}` };
    } else if (audioSource?.src) {                     // 素材フォルダ・URL・別のプロジェクト：サーバーがコピーする
      body.audio = { name: audioSource.name, url: audioSource.src };
    }
    await api(projectUrl(name, 'project.json'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
  async apply(name) {
    const p = await (await api(projectUrl(name, 'project.json'))).json();
    const copies = p.copies || {};
    const settings = mapAssetSrcs(p.settings || {}, (u) => copies[u]);   // 素材は保存したコピーを使う
    const src = { midi: null, audio: null };
    if (p.midi?.file) src.midi = { name: p.midi.name, bytes: new Uint8Array(await (await api(projectUrl(name, p.midi.file))).arrayBuffer()) };
    if (p.audio?.file) src.audio = { kind: 'project', src: projectUrl(name, p.audio.file), name: p.audio.name };
    applySnapshot(settings, src);
  },
  async remove(name) { await api(projectUrl(name), { method: 'DELETE' }); },
};

/** 保存欄 1 組。ids：[一覧, 名前, 保存, 削除] の id、backend：保存先、confirmDelete：削除の前に確認するか */
function makeSlot({ ids: [listId, nameId, saveId, delId], label, backend, confirmDelete = false }) {
  let timer = null;
  const flash = (msg, ms = 2500) => { const el = $(nameId); clearTimeout(timer); el.placeholder = msg; timer = setTimeout(() => { el.placeholder = '名前'; }, ms); };
  const fail = (what, e) => { console.error(e); flash(`✗ ${what}できませんでした：${e.message}`, 6000); };
  let busy = false;
  const run = async (fn) => {   // 保存中に二重に押されないように
    if (busy) return;
    busy = true;
    for (const id of [listId, saveId, delId]) $(id).disabled = true;
    try { await fn(); } finally { busy = false; for (const id of [listId, saveId, delId]) $(id).disabled = false; }
  };
  const render = async (sel = '') => {
    const list = $(listId);
    let names = [];
    try { names = await backend.list(); } catch (e) { console.warn(`${label}の一覧を取れませんでした:`, e.message); list.title = `✗ ${e.message}`; }
    list.textContent = '';
    list.appendChild(new Option(`${label}…`, ''));
    for (const n of names) list.appendChild(new Option(n, n));
    list.value = names.includes(sel) ? sel : '';
  };
  $(listId).addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) return;
    $(nameId).value = name;
    run(async () => {
      flash(`「${name}」を読み込んでいます…`);
      try { await backend.apply(name); flash(`「${name}」を読み込みました`); } catch (err) { fail('読み込み', err); }
    });
  });
  $(saveId).addEventListener('click', () => {
    const name = $(nameId).value.trim();
    if (!name) { $(nameId).focus(); flash('名前を入れてください'); return; }
    run(async () => {
      flash(`「${name}」を保存しています…`, 60000);
      try { await backend.save(name); await render(name); flash(`「${name}」を保存しました`); } catch (err) { fail('保存', err); }
    });
  });
  $(delId).addEventListener('click', () => {
    const name = $(nameId).value.trim() || $(listId).value;
    if (!name || ![...$(listId).options].some((o) => o.value === name)) { flash('削除するものを選んでください'); return; }
    // プロジェクトはディスクのファイル（音声・素材のコピー）ごと消えるので確認する（TOOL_CRAFT_RULES §1-1）
    if (confirmDelete && !confirm(`${label}「${name}」を削除しますか？\nフォルダ（MIDI・音声・素材のコピー）ごと消え、元に戻せません。`)) return;
    run(async () => {
      try { await backend.remove(name); await render(); $(nameId).value = ''; flash(`「${name}」を削除しました`); } catch (err) { fail('削除', err); }
    });
  });
  $(nameId).addEventListener('keydown', (e) => e.stopPropagation());   // Space 等をショートカットに取られない
  return { render };
}
const projectSlot = makeSlot({ ids: ['projectList', 'projectName', 'projectSave', 'projectDel'], label: 'プロジェクト', backend: projectBackend, confirmDelete: true });
const presetSlot = makeSlot({ ids: ['presetList', 'presetName', 'presetSave', 'presetDel'], label: 'プリセット', backend: presetBackend });

// ---------- 箱ごとのプリセット（2026-09-19 ユーザー指定：天気・光源など細かい単位でも保存・呼び出し） ----------
// 各箱の見出しの ▾ から、その箱の設定だけを名前を付けて保存・適用・削除する。全体のプリセットとは別の保存領域（SECTION_PRESETS_KEY）。
// 中身は箱の中の id 付き入力とラジオを自動で集める（TOOL_CRAFT_RULES §3-1：箱にスライダーを足せば自動で対象になる）。
// スカイドーム・スクリーンは入力欄でなくカードの一覧なので、一覧を丸ごと控える（素材の場所も含む）
const boxByTitle = (t) => [...document.querySelectorAll('.box .hd')].find((h) => h.childNodes[0]?.textContent.trim() === t)?.closest('.box');
const SECTIONS = [
  { key: 'camera', label: 'カメラ', boxes: () => [boxByTitle('カメラ位置'), boxByTitle('カメラ中心点')] },   // 位置と中心点は 1 組
  { key: 'autocam', label: '自動カメラ', boxes: () => [$('autoCamBox')] },
  { key: 'lens', label: 'レンズ', boxes: () => [$('lensBox')] },
  { key: 'sky', label: '空・時刻', boxes: () => [$('lightBox')] },
  { key: 'floor', label: '床', boxes: () => [boxByTitle('床')] },
  { key: 'weather', label: '天気', boxes: () => [$('weatherBox')] },
  { key: 'light', label: '光源・影', boxes: () => [$('srcBox')] },
  { key: 'title', label: 'タイトル', boxes: () => [boxByTitle('タイトル')] },
  { key: 'roll', label: 'ピアノロール', boxes: () => [$('boxRoll')] },
  { key: 'player', label: '奏者', boxes: () => [$('boxPlayer')] },
  { key: 'shake', label: '揺れ', boxes: () => [$('boxShake')] },
  { key: 'label', label: 'パート名', boxes: () => [$('boxLabel')] },
  { key: 'glow', label: '足元の光', boxes: () => [$('boxGlow')] },
  { key: 'credits', label: 'クレジット', boxes: () => [boxByTitle('クレジット')] },
  { key: 'tempo', label: 'テンポ・拍子', boxes: () => [boxByTitle('テンポ・拍子')] },
  { key: 'dome', label: 'スカイドーム', sec: 'domeSec' },
  { key: 'screen', label: 'スクリーン', sec: 'screenSec' },
  // まとまり：空・時刻／天気／光源・影を 3 つまとめて（連動が強いので。2026-09-20 ユーザー指定）。▾ は見出し「環境」（#envHd）に置く。各箱のプリセットとは別の欄
  { key: 'env', label: '環境', group: ['sky', 'weather', 'light'], hdId: 'envHd' },
];
const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
const secPresets = {
  load() { try { const o = JSON.parse(LS.getItem(SECTION_PRESETS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { console.warn('箱のプリセットの読込失敗:', e); return {}; } },
  store(all) { LS.setItem(SECTION_PRESETS_KEY, JSON.stringify(all)); pushSettings(); },
};
// 箱の中の設定の入力（設定の自動収集と同じ除外：ファイル・シーク・プリセット／プロジェクトの欄）
const sectionInputs = (sec) => sec.boxes().filter(Boolean).flatMap((b) => [...b.querySelectorAll('input[id], select[id]')])
  .filter((el) => el.type !== 'file' && el.id !== 'seek' && el.id !== 'vSeek' && !el.id.startsWith('preset') && !el.id.startsWith('project'));
function sectionSnap(sec) {
  if (sec.group) return { parts: Object.fromEntries(sec.group.map((k) => [k, sectionSnap(SECTION_BY_KEY[k])])) };   // まとまり：各箱の控えを束ねる
  if (sec.sec) return { list: JSON.parse(JSON.stringify(sec.key === 'dome' ? domes : screens)) };
  const v = {}, r = {};
  for (const el of sectionInputs(sec)) {
    if (el.type === 'radio') { if (el.checked) r[el.name] = el.value; } else v[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  for (const b of sec.boxes().filter(Boolean)) for (const el of b.querySelectorAll('input[type=radio][name]:checked')) r[el.name] = el.value;
  return { v, r };
}
// 適用は全体のプリセットと同じ手順（値を戻す → 保存 → 数値表示 → カメラ）。カメラのスライダーに input を流すと
// 「位置を動かすと中心点も平行移動」が働いて中心点がずれるので、イベントは流さない
function applySection(sec, d) {
  if (sec.group) { for (const [k, part] of Object.entries(d.parts || {})) if (SECTION_BY_KEY[k]) applySection(SECTION_BY_KEY[k], part); return; }
  if (sec.sec) {
    if (!Array.isArray(d.list)) return;
    if (sec.key === 'dome') { if (d.list.length !== 3) return; domes = d.list.map((o) => { const x = { ...DOME_BASE, ...o }; x.r = Math.min(50, Math.max(10, x.r)); return x; }); saveDomes(); }
    else { screens = d.list.map(withDefaults); saveScreens(); }
    renderScreens(); setScreens(screens); setDomes(domes);
    return;
  }
  for (const [id, val] of Object.entries(d.v || {})) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!val; else el.value = val;
  }
  for (const [name, val] of Object.entries(d.r || {})) {
    const el = document.querySelector(`input[type=radio][name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  }
  saveSettings(); refreshValueLabels();
  if (sec.key === 'camera') applyCameraSliders();
}
// ▾ を押すと開く小窓（1 つを使い回す）。中身は上のバーの「プロジェクト」「プリセット」と同じ欄（一覧・名前・保存・削除）で、
// 同じ部品（makeSlot）を使う（2026-09-20 ユーザー指定：操作をプロジェクト・プリセットと同じに）。保存先は開いている箱の欄
const secPop = document.createElement('div');
secPop.id = 'secPresetPop'; secPop.hidden = true;
secPop.innerHTML = `<div class="spHd"></div>
  <div class="preset">
    <select id="secPresetList" title="選ぶとその設定に切り替わる"></select>
    <input id="secPresetName" type="text" placeholder="名前" title="保存する名前。既にある名前なら上書き">
    <button id="secPresetSave" class="slotSave" title="いまの設定をこの名前で保存（同じ名前なら上書き）">保存</button>
    <button id="secPresetDel" class="slotDel" title="選んでいるプリセットを削除">削除</button>
  </div>`;
document.body.appendChild(secPop);
let secPopFor = null;
// 箱ごとに最後に選んだ（保存した）プリセット名。小窓を開き直しても一覧と名前欄に残す（2026-09-20 ユーザー指定）。
// 置き場所は SECTION_SEL_KEY（プロジェクト・プリセットの控えに入るので、選び直すとその保存時の名前に戻る）。小窓を開く度にここから読む
const secSelLoad = () => { try { const o = JSON.parse(LS.getItem(SECTION_SEL_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const secSelSet = (k, name) => {
  const o = secSelLoad();
  if (name) o[k] = name; else delete o[k];
  LS.setItem(SECTION_SEL_KEY, JSON.stringify(o)); pushSettings();
};
const secBackend = {   // 小窓を開いている箱（secPopFor）の欄を読み書きする
  async list() { return Object.keys(secPresets.load()[secPopFor.key] || {}).sort(); },
  async save(name) { const all = secPresets.load(); (all[secPopFor.key] ||= {})[name] = sectionSnap(secPopFor); secPresets.store(all); secSelSet(secPopFor.key, name); },
  async apply(name) { const d = secPresets.load()[secPopFor.key]?.[name]; if (!d) throw new Error('見つかりません'); applySection(secPopFor, d); secSelSet(secPopFor.key, name); },
  async remove(name) {
    const all = secPresets.load(), k = secPopFor.key;
    if (all[k]) { delete all[k][name]; if (!Object.keys(all[k]).length) delete all[k]; secPresets.store(all); }   // 空になった箱の欄は残さない
    if (secSelLoad()[k] === name) secSelSet(k, null);
  },
};
const secSlot = makeSlot({ ids: ['secPresetList', 'secPresetName', 'secPresetSave', 'secPresetDel'], label: 'プリセット', backend: secBackend });
async function openSecPop(sec, btn) {
  secPopFor = sec;
  secPop.querySelector('.spHd').textContent = `${sec.label}のプリセット`;
  const last = secSelLoad()[sec.key] || '';
  await secSlot.render(last);
  $('secPresetName').value = $('secPresetList').value === last ? last : '';   // 消されていれば空に
  secPop.hidden = false;
  const r = btn.getBoundingClientRect(), w = secPop.offsetWidth, h = secPop.offsetHeight;
  secPop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  secPop.style.top = `${r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4}px`;
}
function closeSecPop() { secPop.hidden = true; secPopFor = null; }
if (!VIEW_NAME) {
  for (const sec of SECTIONS) {
    const hd = sec.hdId ? $(sec.hdId) : sec.sec ? $(sec.sec)?.querySelector('.hd') : sec.boxes()[0]?.querySelector('.hd');
    if (!hd) { console.warn(`箱のプリセット：「${sec.label}」の見出しが見つかりません`); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'secPre'; b.textContent = '▾';
    b.title = sec.group ? `${sec.label}のプリセット（${sec.group.map((k) => SECTION_BY_KEY[k].label).join('・')}の設定をまとめて保存・呼び出す）`
      : `${sec.label}のプリセット（この箱の設定だけを名前を付けて保存・呼び出す）`;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (secPopFor === sec) closeSecPop(); else openSecPop(sec, b); });
    hd.appendChild(b);
  }
  document.addEventListener('pointerdown', (e) => { if (!secPop.hidden && !secPop.contains(e.target) && !e.target.closest('.secPre')) closeSecPop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !secPop.hidden) closeSecPop(); });
}

// 公開（2026-09-18 ユーザー指定）：保存してから、手元のサーバーが romashige.com へ送る（アプリ本体とプロジェクトのフォルダ）。
// 外へ出す操作なので、送り先の URL を見せて確認してから（TOOL_CRAFT_RULES §1-1）
const PUBLISH_URL = 'https://romashige.com/pixel-orchestra/';
$('projectPublish').addEventListener('click', async () => {
  const name = $('projectName').value.trim() || $('projectList').value;
  const nameEl = $('projectName'), btns = ['projectList', 'projectSave', 'projectPublish', 'projectDel'];
  const say = (msg) => { nameEl.placeholder = msg; };
  if (!name) { nameEl.focus(); say('公開する名前を入れてください'); return; }
  if (!confirm(`「${name}」を保存してから、公開します。\n\n${PUBLISH_URL}?view=${encodeURIComponent(name)}\n\n公開ページは誰でも見られます（音声も聞けます）。よろしいですか？`)) return;
  for (const id of btns) $(id).disabled = true;
  nameEl.value = ''; say(`「${name}」を公開しています…（音声が大きいと数分かかります）`);
  try {
    await projectBackend.save(name);
    await projectSlot.render(name);
    const r = await (await api(`publish/${encodeURIComponent(name)}`, { method: 'POST' })).json();
    const link = $('publishLink');
    link.href = r.url;   // リンク先ができると押せる色になる（CSS の :not([href])）
    nameEl.value = name; say('名前');
    console.log(`[公開] ${name}（${r.method}）→ ${r.url}\n${r.log}`);
  } catch (e) {
    console.error(e);
    nameEl.value = name; say(`✗ 公開できませんでした：${e.message}`);
  } finally {
    for (const id of btns) $(id).disabled = false;
  }
});

loadSettings();
if (!VIEW_NAME) { projectSlot.render(); presetSlot.render(); }   // 視聴モードには保存欄が無い（公開先にプロジェクトの一覧は置かない）
audioDelayPrev = audioDelaySec();   // 復元した値を基準にする（0 のままだと最初の 1 回だけ音がずれる）
setupCredits();       // クレジットの履歴（候補）と「ゲーム → 作曲者」
setDomes(domes);      // スカイドーム（遠景。3 層固定）
renderScreens();      // スクリーンの操作メニューを作る（3D 側はひな壇の組み立て時に反映される）
setScreens(screens);
refreshValueLabels();
applyCameraSliders(); // 保存されたカメラ座標を復元
animate();
if (VIEW_NAME) startViewer(); else loadFromUrl();

// 視聴モードの起動：プロジェクトを読み、覆いの ▶ を押すと再生（音の自動再生はブラウザが止めるので、必ず 1 回押してもらう）
async function startViewer() {
  const cover = $('viewerCover'), msg = $('viewerMsg');
  $('viewerTitle').textContent = VIEW_NAME;
  msg.textContent = '読み込んでいます…';
  try {
    await projectBackend.apply(VIEW_NAME);
  } catch (e) {
    console.error(e);
    msg.textContent = `✗ 読み込めませんでした（${e.message}）`;
    return;
  }
  msg.textContent = '';
  cover.classList.add('ready');
  // 覆いは #view の中にあるので、クリックを外へ伝えない（伝わると直後に下の「再生中なら一時停止」が動いて止まる）
  cover.addEventListener('click', (e) => { e.stopPropagation(); play(); });
  $('view').addEventListener('click', () => { if (clock.playing) pause(); });   // 再生中に画面を押すと一時停止（覆いが戻る）
}
