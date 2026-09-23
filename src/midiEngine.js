/*
 * PixelOrchestra — midiEngine.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * MIDI（@tonejs/midi でパース済み）→ 楽器ファミリー判定、
 * トラック別「エネルギー包絡線」の事前計算、時刻 t での状態取得を担当する。
 * 描画には一切依存しない（Three.js / Canvas どちらからでも使える）。
 */

// 分類（2026-09-23 ユーザー指定で再編）：鍵盤打楽器＝シロフォン/マリンバ/グロッケン/ビブラフォン/チェレスタ/チューブラーベル/ピアノ、
// 撥弦楽器＝ハープ（以前は「打楽器」と「鍵盤/ハープ」に分かれていた）。
// 分類が決めるのは一覧の見出し・トラックの色・自動カメラのセクション。**動き（叩く／弾く）と配置は楽器ごと**（puppet.js の MOTION_OF、stage.js の rowKeyOf）
export const FAMILIES = ['strings', 'woodwind', 'brass', 'percussion', 'mallet', 'plucked'];
export const FAMILY_LABEL = {
  strings: '弦', woodwind: '木管', brass: '金管', percussion: '打楽器', mallet: '鍵盤打楽器', plucked: '撥弦楽器',
};
// 楽器（バリアント）の一覧：割り当て UI の選択肢。family はここから導出する（単一の正解）
export const VARIANTS = {
  // 2026-09-12：バイオリンを 1st / 2nd に分けた。旧データの 'violin' は 1st として扱う（normalizeVariant）
  violin1:    { family: 'strings',    label: '1st バイオリン' },
  violin2:    { family: 'strings',    label: '2nd バイオリン' },
  viola:      { family: 'strings',    label: 'ヴィオラ' },
  cello:      { family: 'strings',    label: 'チェロ' },
  contrabass: { family: 'strings',    label: 'コントラバス' },
  piccolo:    { family: 'woodwind',   label: 'ピッコロ' },
  flute:      { family: 'woodwind',   label: 'フルート' },
  oboe:       { family: 'woodwind',   label: 'オーボエ' },
  clarinet:   { family: 'woodwind',   label: 'クラリネット' },
  bassoon:    { family: 'woodwind',   label: 'ファゴット' },
  horn:       { family: 'brass',      label: 'ホルン' },
  trumpet:    { family: 'brass',      label: 'トランペット' },
  trombone:   { family: 'brass',      label: 'トロンボーン' },
  tuba:       { family: 'brass',      label: 'チューバ' },
  timpani:    { family: 'percussion', label: 'ティンパニ' },
  bassdrum:   { family: 'percussion', label: 'バスドラム' },
  snare:      { family: 'percussion', label: 'スネア' },
  xylophone:  { family: 'mallet', label: 'シロフォン' },
  marimba:    { family: 'mallet', label: 'マリンバ' },
  glocken:    { family: 'mallet', label: 'グロッケン' },   // 2026-09-23（以前はシロフォンで代用）
  vibraphone: { family: 'mallet', label: 'ビブラフォン' }, // 2026-09-23（以前はマリンバで代用）
  cymbal:     { family: 'percussion', label: 'シンバル' },
  hihat:      { family: 'percussion', label: 'ハイハット' },   // 2026-09-19
  gong:       { family: 'percussion', label: '銅鑼' },         // 2026-09-19（タムタム）
  tubularbells: { family: 'mallet', label: 'チューブラーベル' },   // 2026-09-19
  suscymbal:  { family: 'percussion', label: 'サスペンデッドシンバル' }, // 2026-09-19
  piano:      { family: 'mallet',   label: 'ピアノ' },
  celesta:    { family: 'mallet',   label: 'チェレスタ' },
  harp:       { family: 'plucked',   label: 'ハープ' },
};

// ---- 楽器名からの判定 ----
// MIDIOrchestra（趣味/MIDIOrchestra/src/main.js の INSTRUMENT_KEYWORDS）から移植（2026-09-09）。
// 順序が重要：具体的なキーワードを先に置く（"english horn" を "horn" より先、"bass clarinet" を "clarinet" より先）。
// 小文字化したトラック名に対する部分一致（includes）。
const INSTRUMENT_KEYWORDS = [
  // 木管
  { id: 'englishhorn',  keywords: ['english horn', 'englishhorn', 'cor anglais', 'corno inglese', 'eng horn', 'e.h.'] },
  { id: 'piccolo',      keywords: ['piccolo', 'picc'] },
  { id: 'flute',        keywords: ['flute', 'flutes', 'flauto'] },
  { id: 'oboe',         keywords: ['oboe', 'oboes', 'oboi'] },
  { id: 'bassclarinet', keywords: ['bass clarinet', 'bassclarinet', 'bass cl', 'b.cl', 'bcl', 'clarinetto basso'] },
  { id: 'clarinet',     keywords: ['clarinet', 'clarinets', 'clarinetto'] },
  { id: 'bassoon',      keywords: ['bassoon', 'bassoons', 'fagotto'] },
  // 金管
  { id: 'horn',         keywords: ['horn', 'horns', 'french horn', 'cor', 'corno'] },
  { id: 'trumpet',      keywords: ['trumpet', 'trumpets', 'tromba', 'trp'] },
  { id: 'trombone',     keywords: ['trombone', 'trombones', 'trb'] },
  { id: 'tuba',         keywords: ['tuba', 'tubas'] },
  { id: 'flugelhorn',   keywords: ['flugelhorn', 'flugel', 'flügelhorn'] },
  // 弦
  // 2nd を先に見る：'violin i' は 'violin ii' にも部分一致するので順番が逆だと 2nd が 1st になる（2026-09-12）
  { id: 'violin2',      keywords: ['violin 2', 'violin ii', 'vln 2', 'vln2', 'vn2', 'vn 2', '2nd violin', 'violins 2'] },
  { id: 'violin1',      keywords: ['violin 1', 'violin i', 'vln 1', 'vln1', 'vn1', 'vn 1', '1st violin', 'violins 1'] },
  { id: 'violin1',      keywords: ['violin', 'vln', 'vn'] },
  { id: 'viola',        keywords: ['viola', 'vla', 'violas'] },
  { id: 'cello',        keywords: ['cello', 'vc', 'vlc', 'cellos', 'celli'] },
  { id: 'contrabass',   keywords: ['contrabass', 'double bass', 'basses', 'contrabasses'] },
  // PixelOrchestra 追加: 'strings' は 'tri'（triangle）に誤爆するので打楽器より先に。'cb' は Logic 略号
  { id: 'contrabass',   keywords: ['cb'] },
  { id: 'violin1',      keywords: ['strings', 'string'] },
  { id: 'harp',         keywords: ['harp', 'harps'] },
  { id: 'dulcimer',     keywords: ['dulcimer'] },
  // 打楽器
  { id: 'timpani',      keywords: ['timpani', 'timp', 'kettle'] },
  { id: 'snare',        keywords: ['snare', 'snaredrum', 'snare drum', 'sd', 's.d.'] },
  { id: 'bassdrum',     keywords: ['bass drum', 'bassdrum', 'bd', 'b.d.', 'gran cassa'] },
  { id: 'marimba',      keywords: ['marimba'] },
  { id: 'vibraphone',   keywords: ['vibraphone', 'vibes', 'vibrafon'] },
  { id: 'xylophone',    keywords: ['xylophone', 'xylo'] },
  // チューブラーベルはグロッケンより先に見る：'tubular bells' が 'bells' に先に一致してグロッケン（→シロフォン）になる（2026-09-19）
  { id: 'tubularbells', keywords: ['tubular bells', 'tubular', 'chimes', 'orchestral chimes'] },
  { id: 'glocken',      keywords: ['glockenspiel', 'glock', 'bells'] },
  { id: 'triangle',     keywords: ['triangle', 'tri'] },
  { id: 'windchimes',   keywords: ['wind chimes', 'windchimes', 'wind chime', 'mark tree'] },
  { id: 'tambourine',   keywords: ['tambourine', 'tamb'] },
  { id: 'tamtam',       keywords: ['tam-tam', 'tamtam', 'tam tam', 'gong', '銅鑼', 'dora'] },
  // ハイハットはシンバルより先に見る：'hi-hat cymbal' が 'cymbal' に先に一致してシンバルになる（2026-09-19）
  { id: 'hihat',        keywords: ['hi-hat', 'hihat', 'hi hat', 'hh'] },
  { id: 'suspendedcymbal', keywords: ['suspended cymbal', 'sus cymbal', 'sus cym', 'susp cymbal', 'ride'] },
  { id: 'cymbals',      keywords: ['cymbal', 'cymbals', 'crash'] },
  { id: 'drums',        keywords: ['drums', 'drum', 'drum kit'] },
  { id: 'percussion',   keywords: ['percussion', 'perc'] },
  // 鍵盤
  { id: 'piano',        keywords: ['piano'] },
  { id: 'celesta',      keywords: ['celesta', 'celeste'] },
  { id: 'organ',        keywords: ['organ'] },
  // 日本語（PixelOrchestra 側で追加。英語と衝突しないので末尾）
  { id: 'englishhorn',  keywords: ['イングリッシュホルン', 'コールアングレ'] },
  { id: 'piccolo',      keywords: ['ピッコロ'] },
  { id: 'flute',        keywords: ['フルート'] },
  { id: 'oboe',         keywords: ['オーボエ'] },
  { id: 'clarinet',     keywords: ['クラリネット'] },
  { id: 'bassoon',      keywords: ['ファゴット', 'バスーン'] },
  { id: 'horn',         keywords: ['ホルン'] },
  { id: 'trumpet',      keywords: ['トランペット'] },
  { id: 'trombone',     keywords: ['トロンボーン'] },
  { id: 'tuba',         keywords: ['チューバ'] },
  { id: 'violin1',      keywords: ['ヴァイオリン', 'バイオリン'] },
  { id: 'viola',        keywords: ['ヴィオラ', 'ビオラ'] },
  { id: 'cello',        keywords: ['チェロ'] },
  { id: 'contrabass',   keywords: ['コントラバス'] },
  { id: 'harp',         keywords: ['ハープ'] },
  { id: 'timpani',      keywords: ['ティンパニ'] },
  { id: 'snare',        keywords: ['スネア'] },
  { id: 'hihat',        keywords: ['ハイハット'] },          // 「ハイハットシンバル」をシンバルにしないよう先に（2026-09-19）
  { id: 'tamtam',       keywords: ['ゴング', 'タムタム'] },   // 銅鑼（漢字）は英語の tamtam の行にある
  { id: 'tubularbells', keywords: ['チューブラーベル', 'チューブラベル', 'チャイム'] },   // 2026-09-19
  { id: 'suspendedcymbal', keywords: ['サスペンデッドシンバル', 'サスペンダーシンバル', 'サスペンドシンバル', 'サスシン'] },   // 「シンバル」より先に（2026-09-19）
  { id: 'cymbals',      keywords: ['シンバル'] },
  { id: 'drums',        keywords: ['ドラム'] },
  { id: 'percussion',   keywords: ['打楽器', 'パーカッション'] },
  { id: 'bassdrum',     keywords: ['バスドラム', '大太鼓', 'グランカッサ'] },
  { id: 'piano',        keywords: ['ピアノ'] },
  { id: 'xylophone',    keywords: ['シロフォン', '木琴'] },
  { id: 'glocken',      keywords: ['グロッケン', '鉄琴'] },   // 2026-09-23
  { id: 'vibraphone',   keywords: ['ビブラフォン', 'ヴィブラフォン', 'ビブラホン'] },   // 2026-09-23
  { id: 'marimba',      keywords: ['マリンバ'] },
  { id: 'celesta',      keywords: ['チェレスタ'] },
];

/** 旧データの楽器名を今の名前に直す（保存済みの割当を読む時に通す） */
export function normalizeVariant(v) { return v === 'violin' ? 'violin1' : v; }

// MIDIOrchestra の楽器 ID → PixelOrchestra のバリアント（絵・動きの単位）
// 専用スプライトが無いものは近い見た目・同じ動きのものに寄せる（TODO: 鍵盤打楽器のスプライト追加）
const ORCH_ID_TO_VARIANT = {
  englishhorn: 'oboe', piccolo: 'piccolo', flute: 'flute', oboe: 'oboe', bassclarinet: 'clarinet', clarinet: 'clarinet', bassoon: 'bassoon',
  horn: 'horn', trumpet: 'trumpet', trombone: 'trombone', tuba: 'tuba', flugelhorn: 'trumpet',
  violin1: 'violin1', violin2: 'violin2', viola: 'viola', cello: 'cello', contrabass: 'contrabass', harp: 'harp', dulcimer: 'harp',
  timpani: 'timpani', snare: 'snare', bassdrum: 'bassdrum',
  marimba: 'marimba', vibraphone: 'vibraphone', xylophone: 'xylophone', glocken: 'glocken', tubularbells: 'tubularbells',
  triangle: 'cymbal', windchimes: 'cymbal', tambourine: 'cymbal', tamtam: 'gong', suspendedcymbal: 'suscymbal', cymbals: 'cymbal', hihat: 'hihat',
  drums: 'snare', percussion: 'snare',
  piano: 'piano', celesta: 'celesta', organ: 'piano',
};

/** トラック名 → バリアント。該当なしは null */
export function guessVariantFromName(trackName) {
  const name = (trackName || '').toLowerCase();
  for (const { id, keywords } of INSTRUMENT_KEYWORDS) {
    for (const kw of keywords) if (name.includes(kw)) return ORCH_ID_TO_VARIANT[id] || null;
  }
  return null;
}

// ---- GM プログラム番号からのフォールバック ----
function familyFromProgram(p, channel) {
  if (channel === 9) return 'percussion';
  if (p === 47) return 'percussion';              // Timpani
  if (p >= 112) return 'percussion';              // Percussive / SFX
  if (p === 8) return 'keyboard';                 // Celesta
  if (p >= 9 && p <= 15) return 'percussion';     // Chromatic percussion
  if (p <= 7 || (p >= 16 && p <= 23) || p === 46) return 'keyboard'; // Piano / Organ / Harp
  if (p >= 40 && p <= 51) return 'strings';
  if (p >= 56 && p <= 63) return 'brass';
  if (p >= 64 && p <= 79) return 'woodwind';
  return 'strings';
}

/** 楽器名 → GM 番号 の順で判定し、バリアントを返す */
export function detectInstrument(name, program, channel) {
  const byName = guessVariantFromName(name);
  if (byName) return byName;
  const family = familyFromProgram(program, channel);
  return variantFromProgram(family, program);
}

// GM プログラム番号からのバリアント（名前で判定できなかった時だけ）
function variantFromProgram(family, program) {
  switch (family) {
    case 'strings':
      if (program === 43) return 'contrabass';
      if (program === 42) return 'cello';
      if (program === 41) return 'viola';
      return 'violin1';
    case 'woodwind':
      if (program === 72) return 'piccolo';
      if (program === 73) return 'flute';
      if (program === 70) return 'bassoon';
      if (program === 68 || program === 69) return 'oboe';
      return 'clarinet';
    case 'brass':
      if (program === 58) return 'tuba';
      if (program === 57) return 'trombone';
      if (program === 60) return 'horn';
      return 'trumpet';
    case 'percussion':
      if (program === 11) return 'vibraphone';                  // Vibraphone（2026-09-23 専用の絵）
      if (program === 12) return 'marimba';                     // Marimba
      if (program === 9) return 'glocken';                      // Glockenspiel（2026-09-23 専用の絵）
      if (program === 13) return 'xylophone';                   // Xylophone
      return 'timpani';
    case 'keyboard':
      if (program === 46) return 'harp';
      if (program === 8) return 'celesta';
      return 'piano';
  }
  return 'violin1';
}

// ソロ役の奏者がソロで動く時間の幅：ソロの音の SOLO_HOLD 秒後まで・SOLO_LEAD 秒前から（その外はセクションと一緒に弾く）
const SOLO_HOLD = 1.0, SOLO_LEAD = 0.5;

// ファミリー別の色相（ノート色・足元の光の基準）
const FAMILY_HUE = { strings: 20, woodwind: 130, brass: 48, percussion: 285, mallet: 205, plucked: 330 };   // 鍵盤打楽器は旧「鍵盤」の青を引き継ぐ

const ENERGY_RATE = 50;   // エネルギー包絡線のサンプリング周波数 [Hz]
const ENERGY_DECAY = 0.86; // 1ステップ（20ms）ごとの減衰率（≒ 130ms で半減）

// CC 列（time 昇順）の時刻 t における値。最初のイベントより前は最初の値、以降は直前の値（二分探索）
// ティンパニのキースイッチ → 奏法（hit ＝ 1 打／roll ＝ CC1 で強弱のロール／cresc ＝ クレッシェンド込みのロール）
const TIMP_KS = { 24: 'hit', 25: 'roll', 26: 'cresc', 27: 'cresc', 28: 'cresc', 29: 'cresc' };
const KS_EPS = 0.02;   // キースイッチが音と同時（わずかに後）に置かれていても効くように [秒]

/** 区間 [t0, t1) の中で CC の値が変わる書き込みがあるか（ロールかショットかの判定） */
function ccMovesIn(list, t0, t1) {
  let prev = ccValueAt(list, t0);
  for (const c of list) { if (c.time < t0) continue; if (c.time >= t1) break; if (Math.abs(c.value - prev) > 0.01) return true; prev = c.value; }
  return false;
}

function ccValueAt(list, t) {
  if (!list.length) return 0;
  if (t < list[0].time) return list[0].value;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid].time <= t) lo = mid; else hi = mid - 1; }
  return list[lo].value;
}

export const DYN_SOURCES = { auto: '自動', velocity: 'velocity', cc1: 'CC1', cc11: 'CC11', 'cc1+cc11': 'CC1+CC11' };

// MIDI ノート番号 → 音名（Logic Pro 準拠：C3 = 60。MIDIOrchestra と同じ）
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToNoteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 2}`;
}

export class MidiEngine {
  /**
   * @param {object} midi  @tonejs/midi の Midi
   * @param {object} familyOverrides  { trackKey: variant }  楽器の手動割当
   * @param {object} pitchFilters     { trackName: {pitchMin, pitchMax} }  音域フィルター（キースイッチ除外）
   * @param {object} dynSources       { trackName: 'auto'|'velocity'|'cc1'|'cc11'|'cc1+cc11' }  強弱の情報源
   * @param {object} mergeInto        { trackName: 'auto'|'none'|targetTrackName }  トラック統合（重ね録りの音源を1セクションに）
   */
  constructor(midi, familyOverrides = {}, pitchFilters = {}, dynSources = {}, mergeInto = {}) {
    this.midi = midi;
    this.ppq = midi.header.ppq;
    this.duration = midi.duration;

    let ti = 0;
    // sources = MIDI のトラックごとの情報（設定はこの単位）。tracks = 統合後のセクション（奏者・ロールはこの単位）
    this.sources = midi.tracks
      .filter((t) => t.notes.length > 0)
      .map((t) => {
        // （フィルターで 0 音になったトラックも席は残す：後で範囲を戻せるように）
        const program = t.instrument?.number ?? 0;
        const name = t.name || `Track ${ti + 1}`;
        // 音域フィルター：範囲外（キースイッチ等）のノートは動き・ロール・エネルギーの全てから除外
        const pf = pitchFilters[name] || {};
        const pitchMin = Number.isFinite(pf.pitchMin) ? pf.pitchMin : 0;
        const pitchMax = Number.isFinite(pf.pitchMax) ? pf.pitchMax : 127;
        const totalNotes = t.notes.length;
        const notes = t.notes
          .filter((n) => n.midi >= pitchMin && n.midi <= pitchMax)
          .map((n) => ({ time: n.time, duration: Math.max(n.duration, 0.05), midi: n.midi, velocity: n.velocity }))
          .sort((a, b) => a.time - b.time);
        notes.forEach((n, i) => { n.index = i; n.end = n.time + n.duration; });
        const key = `${ti}:${name}`;
        // 手動割当（楽器名）があればそれを優先。旧形式（ファミリー名）も受け付ける
        const ov = familyOverrides[key];
        let family, variant;
        if (ov && VARIANTS[ov]) { variant = ov; family = VARIANTS[ov].family; }
        else {
          variant = detectInstrument(name, program, t.channel);
          family = VARIANTS[variant].family;
        }
        // CC1（モジュレーション）/ CC11（エクスプレッション）：持続系音源の強弱。値 0〜1、time 昇順
        const ccList = (num) => ((t.controlChanges && t.controlChanges[num]) || []).map((c) => ({ time: c.time, value: c.value })).sort((a, b) => a.time - b.time);
        const cc1 = ccList(1), cc11 = ccList(11);
        const varies = (list) => list.length >= 3 && (Math.max(...list.map((c) => c.value)) - Math.min(...list.map((c) => c.value))) > 0.1;
        // ティンパニのキースイッチ（2026-09-23 ユーザー指定。Orchestral Tools のティンパニの割り当て）：
        //   C0(24) シングルヒット／C#0(25) ロール（強弱は CC1）／D0〜F0(26〜29) クレッシェンドショート（膨らみ方まで収録）。
        // 最後に押されたキースイッチが次の切り替えまで有効（ラッチ）。各音に art を付け、キースイッチの音は叩く音から除く
        // （ティンパニの実音は 36 より上なので本物の音は消えない）。キースイッチの無い MIDI は何もしない＝全部シングルヒット扱い
        if (variant === 'timpani') {
          const ks = t.notes.filter((n) => TIMP_KS[n.midi]).map((n) => ({ time: n.time, art: TIMP_KS[n.midi] })).sort((a, b) => a.time - b.time);
          if (ks.length) {
            for (let k = notes.length - 1; k >= 0; k--) if (TIMP_KS[notes[k].midi]) notes.splice(k, 1);
            let p = -1;
            for (const n of notes) {
              while (p + 1 < ks.length && ks[p + 1].time <= n.time + KS_EPS) p++;
              n.art = p >= 0 ? ks[p].art : 'hit';
              // C#0（ロール）が有効でも、音の最中に CC1 が動いていない音はショット（1 打）。ロールの直後に C#0 のまま
              // 置かれた止めの一打などが該当する（2026-09-23 ユーザー指摘：FFT_Antipyretic の最後の音がロールしていた）
              if (n.art === 'roll' && !ccMovesIn(cc1, n.time, n.end)) n.art = 'hit';
              if (n.art === 'roll') n.cc1 = cc1;   // ロールの強弱は CC1（trackState の rollCC）
            }
            notes.forEach((n, i) => { n.index = i; });
          }
        }
        const dynSource = dynSources[name] || 'auto';
        let dynResolved = dynSource;
        if (dynSource === 'auto') {
          const v1 = varies(cc1), v11 = varies(cc11);
          dynResolved = v1 && v11 ? 'cc1+cc11' : v1 ? 'cc1' : v11 ? 'cc11' : 'velocity';
        }
        const src = {
          cc1, cc11, dynSource, dynResolved,
          index: ti, key, name, channel: t.channel, program, family, variant,
          notes, totalNotes, pitchMin, pitchMax,
          mergeSetting: mergeInto[name] || 'auto', mergeTarget: null, // mergeTarget: 統合先 source（null = 自分がセクション）
        };
        ti++;
        return src;
      });

    this._resolveMerges();
    this.tracks = this._buildSections();
    this._buildSoloParts();
    this.assignColors();

    this.allNotes = this.tracks.flatMap((tr) => tr.notes.map((n) => ({ ...n, track: tr })))
      .sort((a, b) => a.time - b.time);
    this.minPitch = Math.min(...this.tracks.map((t) => t.minPitch));
    this.maxPitch = Math.max(...this.tracks.map((t) => t.maxPitch));

    this._precomputeEnergy();
    this._buildTempo();
  }

  // ---- トラック統合 ----
  // 自動：楽器が同じで、末尾サフィックス（_HW / _CB 等）と「+N」を除いた名前が一致する先行トラックへ統合。
  // 加えて、名前に solo を含むトラックは同じ楽器のセクション（solo でないトラック）へ統合
  //（Trumpets_HW + Trumpets_CB + Trumpets +3_CB → 1 セクション。Violins 1_HW と Violins 2_HW は別）
  // 末尾サフィックス（_HW 等）と「+3」のような追加人数の表記を除いた基底名（"Trumpets +3_CB" → "trumpets"）
  static baseName(name) { return name.replace(/_[^_]*$/, '').replace(/\s*\+\s*\d+\s*$/, '').trim().toLowerCase(); }
  _resolveMerges() {
    const byName = new Map(this.sources.map((s) => [s.name, s]));
    for (const src of this.sources) {
      const set = src.mergeSetting;
      let target = null;
      if (set === 'none') target = null;
      else if (set !== 'auto') target = byName.get(set) || null;
      else {
        const base = MidiEngine.baseName(src.name);
        target = this.sources.find((o) => o !== src && o.index < src.index && o.variant === src.variant && MidiEngine.baseName(o.name) === base) || null;
        // ソロ（名前に solo）は、同じ楽器のセクション（solo でないトラック）があればそこへ統合する（2026-09-23 ユーザー指定：
        // solo バイオリン → 1st バイオリン、solo チェロ → チェロ。以前は独立した 1 人の奏者だった）。セクションが無ければ従来どおり独立
        if (!target && /solo/i.test(src.name)) target = this.sources.find((o) => o !== src && o.variant === src.variant && !/solo/i.test(o.name)) || null;
      }
      // 統合先が自分／楽器違い／さらに統合されている → その先を辿る（1 段まで）。自己参照・楽器違いは無効
      if (target && target.mergeTarget) target = target.mergeTarget;
      if (target === src || (target && target.variant !== src.variant)) target = null;
      src.mergeTarget = target;
      src.mergeResolved = target ? target.name : 'none';
    }
  }
  /**
   * ソロを統合したセクションを、ソロのパートとそれ以外（本来のセクション）のパートに分けて持つ（2026-09-23 ユーザー指定：
   * ソロがセクションと違う動きをする時・セクションが休みでソロだけ鳴る時は、奏者のうち 1 人だけがソロの動きをする）。
   * 奏者の動き（main.js）だけが使う。ピアノロール・足元の光・全体の強弱はセクション全体の音のまま。
   * 音域（min/maxPitch）はセクションのものを引き継ぐ（手の位置などがセクションと揃うように）
   */
  _buildSoloParts() {
    for (const sec of this.tracks) {
      const solos = sec.sources.filter((src) => /solo/i.test(src.name));
      if (!solos.length || solos.length === sec.sources.length) continue;
      const part = (srcs) => {
        const notes = srcs.flatMap((src) => src.notes).map((n) => ({ ...n })).sort((a, b) => a.time - b.time);
        notes.forEach((n, i) => { n.index = i; });
        return { ...sec, sources: srcs, notes, maxDur: notes.length ? Math.max(...notes.map((n) => n.duration)) : 0 };
      };
      sec.soloPart = part(solos);
      sec.tuttiPart = part(sec.sources.filter((src) => !solos.includes(src)));
    }
  }
  /** ソロのパートが時刻 t の前後（SOLO_HOLD 秒前〜SOLO_LEAD 秒後）で鳴っているか。ソロ役の奏者がソロとセクションのどちらで動くかの判定 */
  soloActiveAt(sec, t) {
    const part = sec.soloPart, ns = part?.notes;
    if (!ns?.length) return false;
    const li = this._lastIndex(ns, t + SOLO_LEAD);
    for (let j = li; j >= 0 && ns[j].time > t - SOLO_HOLD - part.maxDur; j--) if (ns[j].end > t - SOLO_HOLD) return true;
    return false;
  }
  // 統合後のセクション（奏者・ロール・エネルギーの単位）を作る
  _buildSections() {
    const sections = [];
    const map = new Map(); // 代表 source → section
    for (const src of this.sources) {
      const head = src.mergeTarget || src;
      if (!map.has(head)) {
        const sec = { ...head, sources: [], notes: [], totalNotes: 0, mergedNames: [] };
        map.set(head, sec); sections.push(sec);
      }
      const sec = map.get(head);
      sec.sources.push(src);
      sec.notes = sec.notes.concat(src.notes);
      sec.totalNotes += src.totalNotes;
      if (src !== head) sec.mergedNames.push(src.name);
    }
    for (const sec of sections) {
      sec.notes.sort((a, b) => a.time - b.time);
      sec.notes.forEach((n, i) => { n.index = i; });
      const pitches = sec.notes.length ? sec.notes.map((n) => n.midi) : [60];
      sec.maxDur = sec.notes.length ? Math.max(...sec.notes.map((n) => n.duration)) : 0;
      sec.meanPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      sec.minPitch = Math.min(...pitches);
      sec.maxPitch = Math.max(...pitches);
      sec.color = null; sec.energy = null;
    }
    return sections;
  }

  // 色：ファミリー色相 + 同ファミリー内で明度をずらす（割当変更後にも呼ぶ）
  assignColors() {
    const byFam = {};
    for (const tr of this.tracks) (byFam[tr.family] ||= []).push(tr);
    for (const fam of Object.keys(byFam)) {
      byFam[fam].forEach((tr, i) => {
        const l = 50 + (i % 3) * 12;
        const h = (FAMILY_HUE[fam] + i * 9) % 360;
        tr.color = `hsl(${h}, 80%, ${l}%)`;
      });
    }
  }

  // ---- エネルギー包絡線（トラック別・全体）----
  _precomputeEnergy() {
    const len = Math.ceil(this.duration * ENERGY_RATE) + ENERGY_RATE;
    const global = new Float32Array(len);
    const energyOf = (tr) => {
      const E = new Float32Array(len);
      let e = 0, p = 0; // p: 次に処理するノート index
      const notes = tr.notes;
      let active = [];
      // 統合された各トラック（source）ごとに「今そのトラックが鳴っているか」を追う。
      // 鳴っていないトラックの CC は見ない（休んでいるトラックの CC が高いままだと、
      // セクション全体の強弱がそこに張り付いてしまう。2026-09-12 ユーザー報告の原因）
      const srcState = tr.sources.map((src) => ({ src, p: 0, active: [] }));
      for (let k = 0; k < len; k++) {
        const t = k / ENERGY_RATE;
        e *= ENERGY_DECAY;
        while (p < notes.length && notes[p].time < t + 1 / ENERGY_RATE) {
          e = Math.min(1, e + notes[p].velocity * 0.9); // アタックで跳ね上げ
          active.push(notes[p]);
          p++;
        }
        active = active.filter((n) => n.end > t);
        let sus = 0;
        if (active.length) { // 持続中は velocity の 40% を床にする
          sus = Math.max(...active.map((n) => n.velocity)) * 0.4;
          e = Math.max(e, sus);
        }
        // CC 由来の強弱：発音中だけ有効（休符で CC が高くても前傾しない）
        let d = e;
        if (active.length) { // 今鳴っているトラックだけを見て、その CC の最大値を取る
          let cc = 0, useCC = false;
          for (const S of srcState) {
            const sn = S.src.notes;
            while (S.p < sn.length && sn[S.p].time < t + 1 / ENERGY_RATE) { S.active.push(sn[S.p]); S.p++; }
            S.active = S.active.filter((n) => n.end > t);
            if (!S.active.length) continue; // このトラックは休み
            const src = S.src;
            if (src.dynResolved === 'cc1' || src.dynResolved === 'cc1+cc11') { cc = Math.max(cc, ccValueAt(src.cc1, t)); useCC = true; }
            if (src.dynResolved === 'cc11' || src.dynResolved === 'cc1+cc11') { cc = Math.max(cc, ccValueAt(src.cc11, t)); useCC = true; }
          }
          // CC を強弱の情報源にしているトラックは CC の値に追従させる（減衰の床より CC を優先）。
          // アタックの山だけは少し残して、音の出だしが分かるようにする（2026-09-12 ユーザー指摘：
          // CC が下がっていっても前傾が緩まず、音が止まってから解除されていた）
          d = useCC ? Math.min(1, cc + Math.max(0, e - sus) * 0.35) : e;
        }
        E[k] = d;
      }
      return E;
    };
    for (const tr of this.tracks) {
      tr.energy = energyOf(tr);
      for (let k = 0; k < len; k++) global[k] += tr.energy[k];
      if (tr.soloPart) { tr.soloPart.energy = energyOf(tr.soloPart); tr.tuttiPart.energy = energyOf(tr.tuttiPart); }   // ソロ／セクションのパート（奏者の動き用）
    }
    // 全体エネルギーは曲中最大値で正規化（指揮者の振り幅用）
    let gmax = 0;
    for (let k = 0; k < len; k++) gmax = Math.max(gmax, global[k]);
    if (gmax > 0) for (let k = 0; k < len; k++) global[k] /= gmax;
    this.globalEnergy = global;
  }

  energyAt(track, t) {
    const E = track.energy;
    const k = t * ENERGY_RATE;
    const i = Math.floor(k);
    if (i < 0) return 0;
    if (i >= E.length - 1) return E[E.length - 1];
    const f = k - i;
    return E[i] * (1 - f) + E[i + 1] * f;
  }

  globalEnergyAt(t) {
    return this.energyAt({ energy: this.globalEnergy }, t);
  }

  // ---- テンポ・拍 ----
  _buildTempo() {
    const h = this.midi.header;
    this.tempos = (h.tempos && h.tempos.length) ? h.tempos.slice().sort((a, b) => a.ticks - b.ticks) : [{ ticks: 0, bpm: 120 }];
    this.timeSigs = (h.timeSignatures && h.timeSignatures.length)
      ? h.timeSignatures.slice().sort((a, b) => a.ticks - b.ticks)
      : [{ ticks: 0, timeSignature: [4, 4] }];
  }

  bpmAt(t) {
    const ticks = this.midi.header.secondsToTicks(t);
    let bpm = this.tempos[0].bpm;
    for (const tp of this.tempos) { if (tp.ticks <= ticks) bpm = tp.bpm; else break; }
    return bpm;
  }

  // 連続拍番号（4分音符単位）・小節内拍・拍内位相
  beatAt(t) {
    const ticks = Math.max(0, this.midi.header.secondsToTicks(t));
    const beat = ticks / this.ppq;
    let sig = this.timeSigs[0];
    for (const s of this.timeSigs) { if (s.ticks <= ticks) sig = s; else break; }
    const [num, den] = sig.timeSignature || [4, 4];
    const beatLen = 4 / den;                       // 1拍の長さ（4分音符単位）
    const beatsFromSig = (ticks - sig.ticks) / this.ppq / beatLen;
    const beatInBar = Math.floor(beatsFromSig) % num;
    const beatPhase = beatsFromSig - Math.floor(beatsFromSig);
    return { beat, beatInBar, beatPhase, beatsPerBar: num, beatUnit: den };
  }

  // ---- 時刻 t におけるトラック状態 ----
  // notes は time 昇順なので二分探索で「t 以前に始まった最後のノート」を得る
  _lastIndex(notes, t) {
    let lo = 0, hi = notes.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  trackState(track, t) {
    const notes = track.notes;
    const li = this._lastIndex(notes, t);
    const onset = li >= 0 ? notes[li] : null;
    const next = li + 1 < notes.length ? notes[li + 1] : null;
    const active = [];
    for (let j = li; j >= 0 && notes[j].time > t - track.maxDur; j--) {
      if (notes[j].end > t) active.push(notes[j]);
    }
    const range = Math.max(1, track.maxPitch - track.minPitch);
    const pitchNorm = onset ? (onset.midi - track.minPitch) / range : 0.5;
    // ロール（ティンパニのキースイッチ C#0）の音が鳴っている時は、その時刻の CC1（0〜1）。ロールの振りの大きさに使う
    let rollCC = null;
    for (const n of active) if (n.art === 'roll' && n.cc1?.length) { rollCC = ccValueAt(n.cc1, t); break; }
    return {
      track, rollCC,
      energy: this.energyAt(track, t),
      onset, next, active, pitchNorm,
      age: onset ? t - onset.time : Infinity,
      toNext: next ? next.time - t : Infinity,
      // 次の音が鳴った瞬間の強さ（管の息継ぎの深さに使う。velocity 固定＋CC のトラックでも効く）
      nextEnergy: next ? this.energyAt(track, next.time + 1 / ENERGY_RATE) : 0,
    };
  }

  setVariant(track, variant) {
    if (!VARIANTS[variant]) throw new Error(`未知の楽器: ${variant}`);
    track.variant = variant;
    track.family = VARIANTS[variant].family;
    this.assignColors();
  }
}
