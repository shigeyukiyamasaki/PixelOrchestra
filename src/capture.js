// キャプチャ（2026-10-09 ユーザー指定：このアプリの中で、簡単にキャプチャを撮りたい。静止画・動画・簡単な GIF）
//
// 画面は 3 層でできている：空の背景（#view の CSS グラデーション）＋ 3D の絵（透過のキャンバス）＋ 上に重ねた文字（クレジット・テンポ。DOM）。
// 3D のキャンバスだけを保存すると空が抜けるので、撮る時に 1 枚のキャンバス（comp）へ重ね直す：背景 → 3D → 文字（「文字も入れる」がオンの時）。
// 再生ボタンなどの操作部品は入れない。
// 正方形モード（同日ユーザー指定）：getRegion が切り出す範囲（キャンバスの画素）を返したら、その中だけを comp に描く。
// 録画・GIF は、始めた時の範囲で最後まで撮る（途中で枠を動かしても、絵の大きさは変えられないため）。
//
// 3D のキャンバスは描いた直後しか中身を読めない（描き終えた絵を保持しない設定）ので、重ねるのは必ず描画の直後に呼ばれる onFrame の中で行う。
//  ・静止画：ボタンで予約 → 次に描いた直後に PNG にして保存
//  ・動画　：comp を録画する（MediaRecorder）。1 コマ描くたびに comp へ重ねて、録画へ 1 コマ送る。音声を読み込んでいれば音も入れる
//  ・GIF 　：画面の何コマかに 1 回（1 秒 GIF_FPS コマ前後）、幅 GIF_W に縮めた絵をためておき、止めた時に 256 色の GIF に書き出す（外部のライブラリは使わない）
// 保存はブラウザのダウンロード（PixelOrchestra_capture_YYYYMMDD_HHMMSS.拡張子）

const GIF_W = 960;        // GIF の幅の上限 [画素]（高さは縦横比から）。最初は 480（2026-10-09 ユーザー指定：倍の解像度に）
const GIF_FPS = 12;       // GIF のコマ数の目標 [コマ/秒]。実際は、画面のフレームレートを整数で割った値のうち、これに一番近い物になる（下の gifInterval）
const GIF_MAX_SEC = 4;    // GIF の長さの上限 [秒]（これを超えたら自動で止める。ためた絵がメモリを使いすぎないように）。最初は 8（同日：解像度を倍にした代わりに半分へ。ファイルが 4 倍になるため）
const VIDEO_BPS = 16e6;   // 動画のビットレート [bit/秒]
const BG_STOPS = 32;      // 背景のグラデーションを何段で描くか（CSS の中間点つきグラデーションを、色の段で近似する）

const pad2 = (n) => String(n).padStart(2, '0');
function fileName(ext) {
  const d = new Date();
  return `PixelOrchestra_capture_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.${ext}`;
}
function download(blob, ext) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = fileName(ext);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}
const hexRgb = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; };

/**
 * view：#view（背景と文字の親）、getCanvas：3D のキャンバスを返す、getBg：背景 { a, b, mid }（上の色・下の色・中間点 %。無ければ null）、
 * audio：音声の要素（無くてよい）、withText：文字も入れるか、onState：状態が変わった時に呼ぶ（ボタンの表示の更新用）、
 * getRegion：切り出す範囲 { x, y, w, h }（キャンバスの画素。無ければ null ＝全体）、getScreenFps：画面を描く回数 [コマ/秒]（無ければ 60）
 */
export function createCapture({ view, getCanvas, getBg, audio, withText, onState, getRegion, getScreenFps }) {
  const comp = document.createElement('canvas'), cx = comp.getContext('2d');
  let wantStill = false, rec = null, gif = null, note = '';
  let fullW = 0, fullH = 0;   // 3D のキャンバスの画素数（切り出しても、背景と文字はこの大きさを基準に描く）
  const say = (msg) => { note = msg; onState?.(); };

  // ---- 重ねる ----
  function drawBackground() {
    const bg = getBg?.(), a = bg && hexRgb(bg.a), b = bg && hexRgb(bg.b);
    if (!a || !b) { cx.fillStyle = getComputedStyle(view).backgroundColor || '#000'; cx.fillRect(0, 0, fullW, fullH); return; }
    // CSS の linear-gradient(to bottom, A, M%, B)：位置 t（0〜1）の混ぜ具合は t^(log 0.5 / log M)（M の所でちょうど半々）
    const h = Math.max(0.001, Math.min(0.999, (bg.mid ?? 50) / 100)), e = Math.log(0.5) / Math.log(h);
    const g = cx.createLinearGradient(0, 0, 0, fullH);
    for (let i = 0; i <= BG_STOPS; i++) {
      const t = i / BG_STOPS, k = Math.pow(t, e);
      g.addColorStop(t, `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)}, ${Math.round(a[1] + (b[1] - a[1]) * k)}, ${Math.round(a[2] + (b[2] - a[2]) * k)})`);
    }
    cx.fillStyle = g; cx.fillRect(0, 0, fullW, fullH);
  }
  // 文字：クレジットとテンポの中の文字を、画面での位置・書体・色・濃さ・影のまま描く。位置は「文字の四角」を画面から読み、
  // キャンバスの画素へ換算する（k）。拡大（transform）が掛かっている分は、要素の見かけの幅と元の幅の比（sc）で文字の大きさに掛ける
  function drawTexts() {
    const vr = view.getBoundingClientRect();
    if (!vr.width) return;
    const k = fullW / vr.width, range = document.createRange();
    for (const id of ['credits', 'tempoHud']) {
      const root = document.getElementById(id);
      if (!root) continue;
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        const el = n.parentElement, st = getComputedStyle(el);
        if (st.visibility === 'hidden') continue;
        range.selectNodeContents(n);
        const r = range.getClientRects()[0];
        if (!r || !r.width) continue;   // 表示されていない（display: none など）
        let op = 1;
        for (let e2 = el; e2 && e2 !== view; e2 = e2.parentElement) { const o = parseFloat(getComputedStyle(e2).opacity); if (Number.isFinite(o)) op *= o; }
        if (op <= 0.005) continue;
        const er = el.getBoundingClientRect(), sc = el.offsetWidth > 0 ? er.width / el.offsetWidth : 1, px = parseFloat(st.fontSize) * sc * k;
        cx.save();
        cx.font = `${st.fontStyle} ${st.fontWeight} ${px}px ${st.fontFamily}`;
        if ('letterSpacing' in cx && st.letterSpacing !== 'normal') cx.letterSpacing = `${parseFloat(st.letterSpacing) * sc * k}px`;
        cx.textBaseline = 'alphabetic'; cx.fillStyle = st.color; cx.globalAlpha = op;
        const sh = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(st.textShadow || '');
        if (sh) { cx.shadowColor = sh[1]; cx.shadowOffsetX = +sh[2] * sc * k; cx.shadowOffsetY = +sh[3] * sc * k; cx.shadowBlur = +sh[4] * sc * k; }
        const m = cx.measureText(n.nodeValue), desc = m.fontBoundingBoxDescent ?? px * 0.2;   // 文字の四角の下端 − 書体の下がり ＝ 文字の基準線
        cx.fillText(n.nodeValue, (r.left - vr.left) * k, (r.bottom - vr.top) * k - desc);
        cx.restore();
      }
    }
  }
  // 今の切り出しの範囲（キャンバスの中に収め、縦横とも偶数の画素にする：動画の形式が奇数の大きさを受け付けないことがある）
  function regionNow() {
    const gl = getCanvas();
    if (!gl || !gl.width || !gl.height) return null;
    const r = getRegion?.();
    if (!r) return { x: 0, y: 0, w: gl.width, h: gl.height };
    const w = Math.max(2, Math.min(gl.width, Math.floor(r.w / 2) * 2)), h = Math.max(2, Math.min(gl.height, Math.floor(r.h / 2) * 2));
    return { x: Math.max(0, Math.min(gl.width - w, Math.round(r.x))), y: Math.max(0, Math.min(gl.height - h, Math.round(r.y))), w, h };
  }
  function compose(region) {
    const gl = getCanvas(), rg = region || regionNow();
    if (!gl || !gl.width || !gl.height || !rg) return false;
    fullW = gl.width; fullH = gl.height;
    if (comp.width !== rg.w || comp.height !== rg.h) { comp.width = rg.w; comp.height = rg.h; }
    cx.setTransform(1, 0, 0, 1, -rg.x, -rg.y);   // 全体の座標のまま描いて、切り出す範囲だけが comp に入るようにずらす
    drawBackground();
    cx.drawImage(gl, 0, 0);
    if (withText?.()) { try { drawTexts(); } catch (e) { console.warn('キャプチャ：文字を描けませんでした:', e); } }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }

  // ---- 静止画 ----
  function still() { wantStill = true; say('次のコマを保存します…'); }

  // ---- 動画 ----
  function startVideo() {
    const region = regionNow();
    if (!region || !compose(region)) { say('✗ 画面を読めませんでした'); return; }
    if (typeof MediaRecorder === 'undefined' || !comp.captureStream) { say('✗ このブラウザは録画に対応していません'); return; }
    const stream = comp.captureStream(0), track = stream.getVideoTracks()[0];   // 0：コマは自分で送る（描いた時だけ）
    let hasAudio = false;
    try {   // 音声を読み込んでいれば、音も入れる（スピーカーからの音はそのまま出る）
      const as = audio && audio.src && audio.captureStream ? audio.captureStream() : null;
      for (const t of as ? as.getAudioTracks() : []) { stream.addTrack(t); hasAudio = true; }
    } catch (e) { console.warn('キャプチャ：音声を録画に入れられませんでした:', e); }
    const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) { say('✗ このブラウザで使える録画の形式がありません'); return; }
    const chunks = [], ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    let mr;
    try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS }); }
    catch (e) { console.warn('キャプチャ：録画を始められませんでした:', e); say(`✗ 録画を始められませんでした（${e.message}）`); return; }
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    mr.onerror = (ev) => { console.warn('キャプチャ：録画のエラー:', ev.error || ev); say(`✗ 録画でエラーが出ました（${ev.error?.message || '不明'}）`); };
    mr.onstop = () => {
      for (const t of stream.getTracks()) if (t.kind === 'video') t.stop();   // 音声の線は音声の要素の物なので止めない
      if (!chunks.length) { say('✗ 録画の中身が空でした'); return; }
      say(`✓ ${download(new Blob(chunks, { type: mime.split(';')[0] }), ext)} を保存しました`);
    };
    mr.start(1000);
    rec = { mr, track, t0: performance.now(), hasAudio, region };
    say('');
  }
  function stopVideo() { const r = rec; rec = null; if (r && r.mr.state !== 'inactive') r.mr.stop(); onState?.(); }

  // ---- GIF ----
  // GIF のコマを拾う間隔 [ミリ秒]：画面の k コマに 1 回。k は、画面のフレームレート ÷ 目標のコマ数 を四捨五入した整数（1 以上）。
  // 2026-10-09 ユーザー指摘：最初は「1/12 秒たった最初のコマ」を拾っていて、画面が 30 コマだと 3 コマに 1 回＝10 コマになるのに「12 コマ」と
  // 説明していた。画面のコマの整数倍でしか拾えないので、はじめから整数倍で決める（60 → 12、30 → 10、20 → 10、15 → 15、12 → 12、10 → 10、6 → 6）。
  // 判定は時刻で行う（画面が重くてコマが落ちた時に、GIF だけ極端にコマが減らないように）。4 ミリ秒は、書き換えの時刻の揺れの分
  function gifInterval() {
    const f = Math.max(1, getScreenFps?.() || 60), k = Math.max(1, Math.round(f / GIF_FPS));
    return { ms: 1000 * k / f, fps: f / k };
  }
  function startGif() {
    const region = regionNow();
    if (!region) { say('✗ 画面を読めませんでした'); return; }
    const w = Math.min(GIF_W, region.w), h = Math.max(1, Math.round(w * region.h / region.w));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const iv = gifInterval();
    gif = { w, h, c, g: c.getContext('2d', { willReadFrequently: true }), frames: [], times: [], t0: performance.now(), last: -1e9, region, ms: iv.ms, fps: iv.fps };
    say('');
  }
  function stopGif() {
    const g = gif; gif = null;
    if (!g) return;
    if (!g.frames.length) { say('✗ GIF のコマが 1 枚も撮れませんでした'); return; }
    say(`GIF を書き出しています…（${g.frames.length} コマ）`);
    setTimeout(() => {   // 「書き出しています」を先に表示させてから（書き出しの間は画面が止まる）
      try { say(`✓ ${download(new Blob([encodeGif(g.w, g.h, g.frames, g.times, g.ms)], { type: 'image/gif' }), 'gif')} を保存しました`); }
      catch (e) { console.warn('キャプチャ：GIF を書き出せませんでした:', e); say(`✗ GIF を書き出せませんでした（${e.message}）`); }
    }, 30);
  }

  /** 描画の直後に毎コマ呼ぶ（now：performance.now()） */
  function onFrame(now) {
    if (!wantStill && !rec && !gif) return;
    // 録画・GIF の途中は、始めた時の範囲で描く。静止画だけの時は今の範囲。録画中に撮った静止画も、録画の範囲になる
    if (!compose(rec?.region || gif?.region || null)) return;
    if (wantStill) {
      wantStill = false;
      comp.toBlob((b) => { if (b) say(`✓ ${download(b, 'png')} を保存しました`); else say('✗ 静止画を作れませんでした'); }, 'image/png');
    }
    if (rec) rec.track.requestFrame?.();
    if (gif && now - gif.last >= gif.ms - 4) {
      gif.g.drawImage(comp, 0, 0, gif.w, gif.h);
      gif.frames.push(gif.g.getImageData(0, 0, gif.w, gif.h).data); gif.times.push(now); gif.last = now;
      if (now - gif.t0 >= GIF_MAX_SEC * 1000) stopGif();
    }
    if (rec || gif) onState?.();   // 経過時間の表示
  }

  return {
    still, onFrame,
    toggleVideo() { if (rec) stopVideo(); else startVideo(); },
    toggleGif() { if (gif) stopGif(); else startGif(); },
    /** ボタンの表示用：{ video: 録画中の秒数（していなければ null）, videoAudio, gif: GIF の秒数（同）, gifMax, gifFps：GIF のコマ数, note } */
    state() { const now = performance.now(); return { video: rec ? (now - rec.t0) / 1000 : null, videoAudio: !!rec?.hasAudio, gif: gif ? (now - gif.t0) / 1000 : null, gifMax: GIF_MAX_SEC, gifFps: gif ? gif.fps : null, note }; },
  };
}

// ---- GIF の書き出し（GIF89a・全コマ共通の 256 色・くり返し再生）----
// 色の決め方：全コマの色を、RGB 各 5 ビット（32,768 通り）の入れ物に数え、多い順に 256 個を選んで、入れ物の中の平均の色をパレットにする。
// 選ばれなかった入れ物は、一番近いパレットの色へ寄せる（入れ物ごとに 1 回だけ調べて控える）。ドット絵のように色数の少ない絵に向く。
// 絵の中身は LZW で詰める（GIF の決まり。符号は 9 ビットから始めて 12 ビットまで伸び、表がいっぱいになったら作り直す）
function encodeGif(w, h, frames, times, lastMs) {
  const cnt = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  const bin = (d, q) => ((d[q] >> 3) << 10) | ((d[q + 1] >> 3) << 5) | (d[q + 2] >> 3);
  for (const d of frames) for (let q = 0; q < d.length; q += 8) { const k = bin(d, q); cnt[k]++; sr[k] += d[q]; sg[k] += d[q + 1]; sb[k] += d[q + 2]; }   // 1 画素おきに数える
  const used = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) used.push(k);
  used.sort((p, q) => cnt[q] - cnt[p]);
  const n = Math.min(256, used.length), pal = new Uint8Array(768), lut = new Int16Array(32768).fill(-1);
  for (let i = 0; i < n; i++) { const k = used[i]; pal[i * 3] = Math.round(sr[k] / cnt[k]); pal[i * 3 + 1] = Math.round(sg[k] / cnt[k]); pal[i * 3 + 2] = Math.round(sb[k] / cnt[k]); lut[k] = i; }
  const nearest = (k) => {
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b, dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = i; } }
    return best;
  };
  const out = [];
  const u16 = (v) => { out.push(v & 255, (v >> 8) & 255); };
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  u16(w); u16(h); out.push(0xF7, 0, 0);                                  // 全体のパレットあり・256 色
  for (let i = 0; i < 768; i++) out.push(pal[i]);
  out.push(0x21, 0xFF, 11); for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0)); out.push(3, 1, 0, 0, 0);   // くり返し再生（回数 0 ＝ずっと）
  const idx = new Uint8Array(w * h);
  for (let f = 0; f < frames.length; f++) {
    const d = frames[f];
    for (let p = 0, q = 0; p < idx.length; p++, q += 4) { const k = bin(d, q); let v = lut[k]; if (v < 0) { v = nearest(k); lut[k] = v; } idx[p] = v; }
    // このコマを見せる時間 [1/100 秒]：次のコマまでの実際の間隔（最後のコマは、拾う間隔 lastMs）
    const delay = Math.max(2, Math.round((f + 1 < frames.length ? times[f + 1] - times[f] : lastMs) / 10));
    out.push(0x21, 0xF9, 4, 0); u16(delay); out.push(0, 0);
    out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
    out.push(8);                                                         // LZW の最初の符号の幅（8 ＝ 256 色）
    const bytes = lzw(idx);
    for (let p = 0; p < bytes.length; p += 255) { const len = Math.min(255, bytes.length - p); out.push(len); for (let i = 0; i < len; i++) out.push(bytes[p + i]); }
    out.push(0);
  }
  out.push(0x3B);
  return new Uint8Array(out);
}
function lzw(idx) {
  const CLEAR = 256, EOI = 257, buf = [];
  let size = 9, next = 258, cur = 0, bits = 0, dict = new Map();
  const emit = (c) => { cur |= c << bits; bits += size; while (bits >= 8) { buf.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(CLEAR);
  let p = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (p << 8) | k, v = dict.get(key);
    if (v !== undefined) { p = v; continue; }
    emit(p);
    if (next === 4096) { emit(CLEAR); dict = new Map(); next = 258; size = 9; }   // 表がいっぱい：作り直す
    else { if (next >= (1 << size)) size++; dict.set(key, next++); }
    p = k;
  }
  emit(p); emit(EOI);
  if (bits > 0) buf.push(cur & 255);
  return buf;
}
