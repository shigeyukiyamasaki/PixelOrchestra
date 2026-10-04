/*
 * PixelOrchestra — stage.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * シーン・カメラ・OrbitControls・ステージ（床・ひな壇・指揮台）と、
 * トラック → 座席位置（扇形配置）の計算。
 */

import { PX, METAL_LAYER, METAL_BLOOM } from './sprites.js';

// 列の定義：r=指揮者からの半径（そのセクションの最前列）、h=ひな壇の高さ、span=列が占める角度幅 [deg]
// 弦は 3 列（r 6.5 / 9.15 / 11.8）に広がるので、木管以降のひな壇（内径 r-2）はその外側に置く
export const ROWS = {
  // 弦：1 列目を指揮者に寄せ（r 8→6.5）、列の間隔を広げる（rowGap 2.65。3 列目は 11.8 のまま）。2026-09-10 ユーザー指定「前後 3 列が詰まりすぎ」
  // 12 列分の弧が r=6.5 では 180° 必要（指揮者の真横まで）なので span を 180 に。これ以上寄せると 1 列目の人数が削られる
  strings:    { r: 6.5,  h: 0,    span: 180, rowGap: 2.65 },
  // rowsCenter: 前後 2 列以上になる時、1 列目を r に置くのではなく**列全体**をひな壇の帯の中心に合わせる。
  // ホルン（2×2）の後列が帯の後端に追いやられていた（2026-09-23 ユーザー指摘）。ひな壇のある段だけに付ける
  // （弦・鍵盤群は床置きで帯が無く、r が最前列の位置という前提で調整済みのため）
  woodwind:   { r: 15,   h: 1.0,  span: 90,  rowsCenter: true },
  brass:      { r: 19,   h: 2.0,  span: 100, rowsCenter: true },
  // depthCenter: 奏者ではなく「奏者＋楽器」の奥行きの中心をひな壇の帯の中心に合わせる。
  // スネアのように楽器が前に出ていると、奏者を中心に置くと楽器がひな壇の内縁から落ちそうに見える（2026-09-23 ユーザー指定）
  percussion: { r: 23,   h: 3.0,  span: 110, depthCenter: true, rowsCenter: true },
  // コントラバス（右）と鍵盤群（左：チェレスタ/ハープ/ピアノ）は、木管の扇のすぐ外側に隣接して床に立つ
  // （ひな壇なし・真ん中寄せ。2026-09-09 ユーザー指定）
  // behind：その楽器の後ろに、内側（舞台の中央寄り）の端を揃えて並べる（2026-09-23 ユーザー指定：コントラバスはチェロの後ろ、ハープ/チェレスタは
  // 1st バイオリンの後ろ。木管の端に隣接させると、木管が少ない曲で必要以上に中央へ寄った）。その楽器がいない曲は従来どおり beside の隣
  contrabass: { r: 13.5, h: 0,    span: 0, beside: 'woodwind', side: +1, fallbackDeg: 40, rowGap: 2.65, behind: 'cello', behindR: true, gapScale: 1.3 },   // behindR：チェロのすぐ後ろの半径（r はチェロがいない時） // 前後の間隔は他の弦と同じ（2026-09-10）
  // 鍵盤群（チェレスタ/ハープ/ピアノ）は 1st バイオリンの後ろ（内側の端を揃える）。鍵盤打楽器は 2026-09-23 に打楽器のひな壇へ移した。
  // 段：ピアノ（横向き）が 1 段目＝1st バイオリンのすぐ後ろ、ハープ/チェレスタはその後ろ（2026-09-24 ユーザー指定）。
  // 使われている段だけ手前から詰めるので、ピアノの無い曲はハープ/チェレスタが 1 段目（r 16.5。従来の位置）。
  // 1 段目は r 16.5：r 13.5 だとバイオリンの 3 列目（r 11.8）のすぐ後ろに来て密着する（2026-09-10 ユーザー指摘）。
  // fluid：2 段目以降の半径は固定の段の間隔ではなく、前の段の楽器の奥の端 + 隙間 + この段の楽器の手前への張り出し
  // （ひな壇の列に縛られない。2026-09-24 ユーザー指定）
  keyboard:   { r: 16.5, h: 0,    span: 0, beside: 'woodwind', side: -1, fallbackDeg: -40, levelGap: 3.0,
                // outDeg：段（depthOf の値）ごとに、揃えた位置から同じ弧の上を外側（客席側）へ回す角度 [deg]。
                // ピアノは 1st バイオリンの内側の端に揃えると奥すぎたので客席側へ（2026-09-24 ユーザー指定）
                // チューブラーベルは打楽器のひな壇から鍵盤群の一番後ろの段へ（2026-09-25 ユーザー指定：ピアノ・ハープと同じ場所で流動的に。後ろ気味）
                depthOf: (v) => (v === 'piano' ? 0 : v === 'tubularbells' ? 2 : 1), behind: 'violin1', fluid: true, outDeg: { 0: 15 } },
};
// 楽器ごとの人数（横 cols × 奥行き rows）。実際のオーケストラの人数感（2026-09-09 ユーザー指定：1st Vn = 3×3）
// 未指定は 1 人
export const SECTION_SIZE = {
  // 弦は合計の人数（total）で指定し、列ごとの人数は半径に比例して配る（扇形。gridPositions）。
  // 12・10・8・6・4 の標準的な編成（2026-09-24 ユーザー指定。以前は 1st/2nd 3×3、Va/Vc 3×2 からの扇形で 12・12・7・7・4）
  violin1: { total: 12, rows: 3 }, violin2: { total: 10, rows: 3 }, viola: { total: 8, rows: 3 },   // ヴィオラは 3 列（2・3・3）：2 列目が窮屈だったので 3 列目へ（2026-09-24 ユーザー指定）
  cello: { total: 6, rows: 2 },
  contrabass: { total: 4, rows: 1 },   // チェロの後ろに 1 列（2026-09-24 ユーザー指定。以前は 2×2）
  piccolo: { cols: 1, rows: 1 }, flute: { cols: 2, rows: 1 }, oboe: { cols: 2, rows: 1 }, clarinet: { cols: 2, rows: 1 }, bassoon: { cols: 2, rows: 1 },
  horn: { cols: 2, rows: 2 }, trumpet: { cols: 3, rows: 1 }, trombone: { cols: 3, rows: 1 }, tuba: { cols: 1, rows: 1 },
};
const ROW_GAP = 1.9;      // 同セクション内の列（奥行き）間隔 [unit]
// トラックの人数。名前に solo を含むトラックは楽器に関わらず 1 人（Violin solo / Cello solo 等。2026-09-09 ユーザー指定）
// track.single（トラック表の「1 人」。2026-09-28 ユーザー指定）でも 1 人
function sizeOf(track) {
  if (track.single || /solo/i.test(track.name)) return { cols: 1, rows: 1 }; // "_CS" 等が続くと \b が効かないので単純一致
  return { ...(SECTION_SIZE[track.variant] || { cols: 1, rows: 1 }) };
}
// 列内の並び順を楽器で固定するファミリー（無指定は平均音程の高い順＝左から右）
// 金管：ホルンを左、トランペットをその右（2026-09-09 ユーザー指定で入れ替え）
// 打楽器：ティンパニは常に向かって一番左（2026-09-19 ユーザー指定）。一覧にない楽器は従来どおり平均音程の高い順でその右に並ぶ
// 打楽器の列：ティンパニが一番左、その右に鍵盤打楽器を グロッケン → シロフォン → ビブラフォン → マリンバ で固定（2026-09-23 ユーザー指定）。
// 残りの打楽器はその右に平均音程の高い順
// 同じ楽器が複数トラックある時の左右の並び（小さいほど客席から見て左）。2026-09-27 ユーザー指定：グランカッサ（大きい方）を右、バスドラを左に。
// 音高順（高音が左）ではグランカッサ（音 48）がバスドラ（音 36）より左に来ていた
const SAME_VARIANT_RANK = { bassdrum: (tr) => (/gran\s*cass/i.test(tr.name || '') ? 1 : 0) };
const VARIANT_ORDER = { brass: ['horn', 'trumpet', 'trombone', 'tuba'], strings: ['violin1', 'violin2', 'viola', 'cello'], percussion: ['timpani', 'glocken', 'xylophone', 'vibraphone', 'marimba'], keyboard: ['harp', 'celesta', 'piano', 'tubularbells'] }; // 鍵盤群：ハープが外側（左）、チェレスタが木管寄り（2026-09-23 ユーザー指定） // 弦は 1st → 2nd → ヴィオラ → チェロ（2026-09-12）

// トラックがどの列に座るか（ファミリーと別扱いの楽器はここで振り分ける）
function rowKeyOf(track) {
  if (track.variant === 'contrabass') return 'contrabass';
  // 配置は分類ではなく楽器で決める（2026-09-23：分類を「鍵盤打楽器」「撥弦楽器」に再編したが、配置は変えない）
  // 鍵盤打楽器（マレットで叩く台）は打楽器のひな壇に並ぶ（2026-09-23 ユーザー指定：スネアやバスドラと並ぶのが普通。
  // 以前は木管の左の床＝鍵盤群に置いていた）。チューブラーベルは鍵盤群の一番後ろ（2026-09-25 ユーザー指定）
  if (['xylophone', 'marimba', 'glocken', 'vibraphone'].includes(track.variant)) return 'percussion';
  if (['piano', 'celesta', 'harp', 'tubularbells'].includes(track.variant)) return 'keyboard'; // 左の鍵盤群
  return track.family;
}
const STRING_GAP_SCALE = 1.15;   // 弦の奏者の横の間隔の倍率（弦だけ。2026-09-24 ユーザー指定）
const FLUID_MARGIN = 0.3;   // 鍵盤群の流動的な段：前の段の楽器の奥の端との隙間 [unit]
const PUPPET_GAP = 1.7;   // 同一トラック内の奏者間隔（横）[unit]（奏者の幅 ≒ 1.2）

export const PODIUM_H = 0.6;      // 指揮台の高さ [unit]
export const CONDUCTOR_Z = -2.1; // 指揮台（2.2 角）と指揮者の z。+z = 客席側。-3.2 から指揮台の半分（1.1）手前へ（2026-09-10 ユーザー指定）
export const SEAT_SHIFT_Z = -1.0; // 指揮者以外（座席・ひな壇）を奥へ平行移動する量 [unit]（2026-09-10 ユーザー指定「少し奥へ」）
// ステージ床は長方形（2026-09-13 ユーザー指定。それまでは外周がぼける楕円だった）。
// 左右は後方ひな壇の切り口（BACK_ROWS の clipX = 18）と同じライン、奥は一番奥のひな壇の外径（-30）を 1 覆う位置、
// 手前は指揮者（z = -2.1）の背後 5 ほど。ぼかしは無し（縁ははっきり出る）
// 床の左右の縁とスクリーンの段の切り口は同じ値にする（2026-09-29 ユーザー指定：スクリーンの横幅と、奏者のいる床を横に広げる。18 → 24）
export const STAGE_X_HALF = 24;
export const FLOOR_X_HALF = STAGE_X_HALF;   // 左右の縁（±x）
export const FLOOR_Z_FRONT = 3;   // 手前の縁
export const FLOOR_BACK_R = 31;   // 2026-09-29：一番奥のひな壇の奥行きを 1.5 倍（外径 29 → 31）にしたので合わせた。 奥の縁は一番奥のひな壇の外径（29）と同じ弧（2026-09-13 ユーザー指定「雛壇のところでカット」。0.5 はみ出していたのを、ひな壇の背面の壁と面一に。2026-09-17 ユーザー指定）

const deg = (d) => (d * Math.PI) / 180;
// 打楽器の後ろに置く、奏者のいないひな壇（キャラクター等を置く想定。2026-09-13 ユーザー指定）。
// ここに足すだけで段が増える。r = 中心からの半径、h = 高さ、span = 扇の開き [deg]
export const BACK_ROWS = [
  // clipX を指定すると、扇形の切り口ではなく x = ±clipX の垂直面で切る（2026-09-13 ユーザー指定）。
  // span は clipX より外まで届く広さにしておき、実際の端は clipX が決める
  // span 150：段の内径（25）の縁が切り口 x = ±24 まで届く広さ（130 では内側の縁が 22.7 で止まり、扇の切り口が見えた）
  // 奥行き 1.5 倍（2026-09-29 ユーザー指定）：内径 25 はそのまま、外径 29 → 31（中心 28・半幅 3）
  { r: 28, half: 3, h: 4.0, span: 150, clipX: STAGE_X_HALF, screen: true },
];
// 一番奥のひな壇の上に立てる湾曲スクリーン（2026-09-13 ユーザー指定）。背景やキャラクターを映す想定で、
// 何枚でも重ねられる。pos は段の奥行きの中での位置（0 = 手前の辺 / 1 = 奥の辺）。
// 本来は透明にする予定だが、位置の確認用にいったん色を付けている
export const SCREEN_DEFAULT = [
  { name: '背景', pos: 1, scale: 1, opacity: 1, show: true, src: '', key: '#00ff00', thr: 0, at: 0, lift: 0, flip: false, speed: 0, loop: false, gap: 1 },
];
// 素材 1 ドットの大きさ。奏者のドット（res:2 のスプライト 1px = PX/2）と揃える。
// 倍率 scale = 1 で「素材の実寸のまま」。2026-09-13 ユーザー指定「素材を貼ったらその大きさのまま」
export const SCREEN_PX = PX / 2;

// ---- スクリーンに映す素材（透過 PNG / 緑背景の mp4）----
// src ごとにテクスチャを使い回す。作り直すたびに読み込むと、スライダーを動かすだけで動画が頭出しに戻ってしまう
const MEDIA = new Map();
const isVideo = (src) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src);
function mediaTexture(src) {
  if (MEDIA.has(src)) return MEDIA.get(src);
  let tex;
  if (isVideo(src)) {
    const v = document.createElement('video');
    v.src = src; v.loop = true; v.muted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.crossOrigin = 'anonymous';
    v.addEventListener('loadedmetadata', () => { buildScreens(); buildDomes(); });   // 実寸が分かってから組み直す
    v.play().catch((e) => console.warn('動画の自動再生が拒否されました（画面をクリックすると始まります）:', src, e.message));
    tex = new THREE.VideoTexture(v);
    tex.userDataVideo = v;
  } else {
    tex = new THREE.TextureLoader().load(src, () => { tex.needsUpdate = true; buildScreens(); buildDomes(); },
      undefined, () => console.warn('素材を読み込めません:', src));
  }
  // ドット絵なので拡大は最近傍（MIDIOrchestra は Linear 固定だが、こちらは粒を保つ）
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;   // 横は繰り返し（雲を流すため）
  MEDIA.set(src, tex);
  return tex;
}
/** 素材の実寸 [px]。まだ読み込めていなければ null */
function mediaSize(tex) {
  const im = (tex && tex.image) || {};   // tex 自体が無い時もある（まだ読み込んでいない素材。2026-09-13 修正）
  const w = im.videoWidth || im.width || 0, h = im.videoHeight || im.height || 0;
  return w && h ? { w, h } : null;
}

// スカイドームのシェーダ：緑（キー色）との色の距離がしきい値より近い画素を捨てる（MIDIOrchestra と同じ判定）。
// 遠景なので陰影（法線）は付けず、照明の明るさだけを倍率（uLight）で反映する（2026-09-16 ユーザー指定）
const SCREEN_SHADER = {
  vertexShader: `
    varying vec2 vUv;
    #include <clipping_planes_pars_vertex>
    void main() {
      vUv = uv;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      #include <clipping_planes_vertex>
      gl_Position = projectionMatrix * mvPosition;
    }`,
  fragmentShader: `
    uniform sampler2D map; uniform float hasMap;
    uniform vec3 keyColor; uniform float keyThr;
    uniform vec3 tint; uniform float opacity; uniform float flip; uniform vec3 uLight;
    uniform float uRepeat; uniform float uScroll; uniform float uLoop; uniform float uFill; uniform float uFade;
    varying vec2 vUv;
    #include <clipping_planes_pars_fragment>
    void main() {
      #include <clipping_planes_fragment>
      // 左右反転（2026-09-13 ユーザー指定）と、横方向の繰り返し・流し（雲。2026-09-13）。
      // 繰り返す時は 1 周期のうち uFill ぶんだけ絵を置き、残りは隙間として捨てる（間隔の調節）
      // 面は円筒を内側（客席側）から見るので、uv.x は客席から見て右 → 左へ増える。そのまま使うと絵が左右逆に映る
      // （2026-09-18 ユーザー指摘：キャラクターが反転していた）。反転オフで 1 − uv.x、反転オンで uv.x
      float u = (flip > 0.5 ? vUv.x : 1.0 - vUv.x) * uRepeat + uScroll;
      vec2 uv;
      if (uLoop > 0.5) {
        float f = fract(u);
        if (f > uFill) discard;
        uv = vec2(f / uFill, vUv.y);
      } else {
        uv = vec2(u, vUv.y);
      }
      vec4 c = hasMap > 0.5 ? texture2D(map, uv) : vec4(tint, 1.0);
      if (hasMap > 0.5 && keyThr > 0.0 && distance(c.rgb, keyColor) < keyThr) discard;
      float a = c.a * opacity;
      // 端のぼかし：範囲を狭めたスカイドームで、絵が現れる／消える切れ目をなだらかにする
      // （2026-09-14 ユーザー指定）。vUv.x は「その面の端から端まで」なので、繰り返しとは無関係に効く
      if (uFade > 0.001) {
        a *= smoothstep(0.0, uFade, vUv.x) * smoothstep(0.0, uFade, 1.0 - vUv.x);
      }
      if (a < 0.01) discard;
      gl_FragColor = vec4(c.rgb * uLight, a);   // 照明の反映（スカイドームは方向を無視した倍率。2026-09-16 ユーザー指定）
      #include <tonemapping_fragment>          // 露出＋トーン圧縮（本編と同じ。2026-09-16）
    }`,
};
// スカイドーム全体で共有する照明の倍率（setShadows が更新）
const DOME_LIGHT = { value: new THREE.Color(1, 1, 1) };
function screenMaterial(sc, tex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex || null },
      hasMap: { value: tex ? 1 : 0 },
      keyColor: { value: new THREE.Color(sc.key || '#00ff00') },
      keyThr: { value: sc.thr ?? 0 },
      tint: { value: new THREE.Color('#ffffff') },
      opacity: { value: sc.opacity },
      flip: { value: sc.flip ? 1 : 0 },
      uRepeat: { value: 1 }, uScroll: { value: 0 }, uLoop: { value: 0 }, uFill: { value: 1 },
      uFade: { value: 0 },
      uLight: DOME_LIGHT,
    },
    vertexShader: SCREEN_SHADER.vertexShader,
    fragmentShader: SCREEN_SHADER.fragmentShader,
    // 不透明なスクリーンは奥行きも書く（そうしないと手前のキャラクターがパート名を隠せない。
    // 抜いた画素は discard するので、透明部分が後ろを消すことはない）。2026-09-13 ユーザー指定
    transparent: true, side: THREE.DoubleSide, depthWrite: sc.opacity >= 1,
    clipping: true,   // ShaderMaterial は明示しないと clippingPlanes が効かない
    toneMapped: true, // 露出を効かせる（tonemapping_fragment を通す）
  });
}

// スクリーン（キャラクター等）用：照明と影を受ける Lambert に、同じ抜き・繰り返し・端ぼかしを注入する（2026-09-16 ユーザー指定）。
// uniforms は m.uniforms に置き、呼び出し側は ShaderMaterial の時と同じ書き方で更新できる
function litScreenMaterial(sc, tex) {
  const m = new THREE.MeshLambertMaterial({ map: tex || null, transparent: true, side: THREE.DoubleSide, depthWrite: sc.opacity >= 1 });
  m.uniforms = {
    hasMap: { value: tex ? 1 : 0 },
    keyColor: { value: new THREE.Color(sc.key || '#00ff00') },
    keyThr: { value: sc.thr ?? 0 },
    opacity: { value: sc.opacity },        // 参照用（実体は material.opacity）
    flip: { value: sc.flip ? 1 : 0 },
    uRepeat: { value: 1 }, uScroll: { value: 0 }, uLoop: { value: 0 }, uFill: { value: 1 },
    uFade: { value: 0 },
    uVis: { value: new THREE.Vector2(0, 1) },   // 見えている範囲（面の横の座標 u）。端のぼかしはこの両端に掛ける
  };
  m.opacity = sc.opacity;
  m.onBeforeCompile = (shader) => {
    for (const k of Object.keys(m.uniforms)) if (k !== 'opacity') shader.uniforms[k] = m.uniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vScreenUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvScreenUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float hasMap; uniform vec3 keyColor; uniform float keyThr; uniform float flip;
        uniform float uRepeat; uniform float uScroll; uniform float uLoop; uniform float uFill; uniform float uFade; uniform vec2 uVis;
        varying vec2 vScreenUv;`)
      .replace('#include <map_fragment>', `
        float u = (flip > 0.5 ? vScreenUv.x : 1.0 - vScreenUv.x) * uRepeat + uScroll;   // 内側から見るので反転オフで 1 − uv.x（上の SCREEN_SHADER と同じ。2026-09-18）
        vec2 suv;
        if (uLoop > 0.5) { float f = fract(u); if (f > uFill) discard; suv = vec2(f / uFill, vScreenUv.y); }
        else suv = vec2(u, vScreenUv.y);
        #ifdef USE_MAP
          vec4 sc = texture2D(map, suv);
          if (keyThr > 0.0 && distance(sc.rgb, keyColor) < keyThr) discard;
        #else
          vec4 sc = vec4(1.0);
        #endif
        float sa = sc.a;
        if (uFade > 0.001) { float w = uFade * (uVis.y - uVis.x); sa *= smoothstep(uVis.x, uVis.x + w, vScreenUv.x) * (1.0 - smoothstep(uVis.y - w, uVis.y, vScreenUv.x)); }
        if (sa * diffuseColor.a < 0.01) discard;
        diffuseColor.rgb *= sc.rgb; diffuseColor.a *= sa;`);
  };
  m.customProgramCacheKey = () => 'litScreen2' + (tex ? ':map' : '');   // uVis を足した版（古い版のプログラムを使い回さない）
  return m;
}

/**
 * 流れるスクリーン（雲など）の位置を時刻から決める。毎フレーム呼ぶ。
 * 「時刻 → 状態」の純関数なので、後でオフラインに書き出しても同じ絵になる。
 * 速度は正で右から左へ（UV を進めると絵は左へ動く）。1 周期 = 素材 1 枚ぶんの幅
 */
export function updateScreens(t) {
  if (!stageCtx) return;
  for (const m of [...stageCtx.screens.children, ...stageCtx.domes.children]) {
    const sc = m.userData.scroll;
    if (sc) m.material.uniforms.uScroll.value = (sc.speed * t) / sc.period;
  }
}

/** スクリーン 1 枚の素材の実寸 [px]。まだ読み込めていなければ null（UI の表示用） */
export function screenInfo(i) {
  const sc = screenList[i];
  return sc && sc.src ? mediaSize(MEDIA.get(sc.src)) : null;
}
let screenList = SCREEN_DEFAULT.map((o) => ({ ...o }));

/** スクリーンの構成を差し替えて組み直す。main.js の操作メニューから呼ぶ */
export function setScreens(list) {
  screenList = (list || []).map((o) => ({ ...o }));
  buildScreens();
}
const RISER_HALF = 2;        // ひな壇の帯の半幅 [unit]（内径 r-2 〜 外径 r+2）。段ごとに row.half で上書きできる
const RISER_MARGIN = deg(7); // 座席の両端に足す余白角
const KB_CROWDED = 3;        // 鍵盤群（ピアノ・ハープ・チェレスタ・チューブラーベル）がこの台数以上で、チェレスタを木管の隣へ（2026-09-25 ユーザー指定）
const CEL_PIANO_GAP = 0.5;   // 木管の隣のチェレスタとピアノとの隙間 [unit]
const CEL_RISER_GAP = 1.0;   // チェレスタと木管のひな壇の端との隙間 [unit]（2026-09-25 ユーザー指摘：くっつきすぎ。以前は 0.4）
let stageCtx = null;         // createStage() で設定（buildRisers から使う）

export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = null; // 背景は #view の CSS グラデーション（main.js の applyBackground）。キャンバスは透過
  scene.fog = new THREE.Fog('#0b0b16', 55, 110);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 9, 10.5);   // 既定のカメラ（2026-09-13 ユーザー指定）

  // 照明（2026-09-10 段階 1：舞台も含めて全部ライトで照らす。屋内想定なので太陽光は無し）。
  // 床・ひな壇・奏者は同じライトで陰影がつき、影は「光が届かない所」として出る
  //   環境光（半球）：跳ね返り光の近似。影の中の明るさを決める（setShadows の ambient）
  //   スポットライト 2 灯：客席側の上手・下手から舞台中央を照らす舞台照明。影付き・縁ぼかし。仰角・左右の開き・円錐の広がりは setShadows で
  // 金属のブルームのパス（camera.layers.set(METAL_LAYER)）でもライトを拾わせる。
  // three.js は camera.layers に合わないオブジェクトを**ライトも含めて**スキップするので、
  // 有効化しないと金属が真っ黒に描かれてブルームに何も乗らない（2026-09-23 に実際にそうなった）
  const litEverywhere = (l) => { l.layers.enable(METAL_LAYER); l.layers.enable(PLAYER_LAYER); return l; };   // 奏者だけのドット化のパスでも照らす
  const hemi = litEverywhere(new THREE.HemisphereLight('#ffffff', '#6a5a50', 0.7));
  scene.add(hemi);
  const amb = litEverywhere(new THREE.AmbientLight('#ffffff', 0));   // 環境光（跳ね返り）。屋外では天空光に少し足す（2026-09-17）
  scene.add(amb);
  const spots = [];
  for (const side of [-1, 1]) {
    const sp = litEverywhere(new THREE.SpotLight('#fff1d6', 1.6, 110, deg(30), 0.5, 1.0));
    sp.userData.side = side;
    sp.target.position.set(0, 0, -12);
    sp.castShadow = true;
    sp.shadow.mapSize.set(2048, 2048);
    sp.shadow.bias = -0.0006; sp.shadow.normalBias = 0.03;
    sp.shadow.camera.near = 2; sp.shadow.camera.far = 110;
    scene.add(sp, sp.target);
    spots.push(sp);
  }
  // 太陽光（屋外。2026-09-16 ユーザー指定）：平行光 1 本。スポットライトとは併用せず setShadows の mode で切り替える。
  // 影は直交カメラで舞台全体（±34 unit）を覆う。位置は方角・高度から setShadows が置く
  const sun = litEverywhere(new THREE.DirectionalLight('#ffffff', 1.2));
  sun.target.position.set(0, 0, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 150;
  sun.visible = false;
  scene.add(sun, sun.target);
  // 方向つきの空（案 2。2026-09-16 ユーザー指定）：カメラを中心にした大きな球に、太陽の方角の低い空だけ夕焼け色を重ねる。
  // 土台は CSS のグラデーション（天頂＝空の色、地平線＝太陽と反対側の色）。深度は書かず最初に描くので舞台は必ず手前
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: new THREE.Vector3(0, 0, 1) }, glowColor: { value: new THREE.Color('#f28a3c') }, glowAmt: { value: 0 }, flip: { value: 0 },
                sunCol: { value: new THREE.Color('#ffffff') }, sunVis: { value: 0 }, sunRad: { value: 2.0 }, aureole: { value: 0.7 }, spread: { value: 1 },
                sinDip: { value: 0 },
                moonDir: { value: new THREE.Vector3(0, 1, 0) }, moonU: { value: new THREE.Vector3(1, 0, 0) }, moonV: { value: new THREE.Vector3(0, 0, 1) },
                moonK: { value: 1 }, moonVis: { value: 0 }, moonRad: { value: 1.0 }, moonCol: { value: MOON_DISC.clone() },
                starVis: { value: 0 }, poleAxis: { value: new THREE.Vector3(0, 0.574, -0.819) }, starRot: { value: 0 }, time: { value: 0 }, twinkle: { value: 1 }, haloAmt: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform vec3 glowColor; uniform float glowAmt; uniform float flip;
      uniform vec3 sunCol; uniform float sunVis; uniform float sunRad; uniform float aureole; uniform float spread; uniform float sinDip;
      uniform vec3 moonDir; uniform vec3 moonU; uniform vec3 moonV; uniform float moonK; uniform float moonVis; uniform float moonRad; uniform vec3 moonCol; varying vec3 vDir;
      uniform float starVis; uniform vec3 poleAxis; uniform float starRot; uniform float time; uniform float twinkle; uniform float haloAmt;
      // 星（2026-09-16 ユーザー指定）：天球に固定した手続き生成の点。視線を極軸まわりに +時角 回して固定座標に直し、
      // 立方体面の格子（1 面 64×64）ごとに 18% の確率で 1 個置く。明るさは少数だけ強く、ごく弱く瞬く
      float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 rotAxis(vec3 v, vec3 k, float ang) { float c = cos(ang), s = sin(ang); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
      vec4 stars(vec3 d) {
        vec3 sd = rotAxis(d, normalize(poleAxis), starRot);
        vec3 a = abs(sd); vec2 uv; float face;
        if (a.x >= a.y && a.x >= a.z) { uv = sd.yz / a.x; face = sd.x > 0.0 ? 0.0 : 1.0; }
        else if (a.y >= a.z) { uv = sd.xz / a.y; face = sd.y > 0.0 ? 2.0 : 3.0; }
        else { uv = sd.xy / a.z; face = sd.z > 0.0 ? 4.0 : 5.0; }
        const float N = 64.0;
        vec2 g = (uv * 0.5 + 0.5) * N; vec2 cell = floor(g); vec2 f = g - cell;
        vec2 id = cell + face * 101.0;
        float h = hash21(id);
        if (h > 0.18) return vec4(0.0);
        vec2 pos = vec2(hash21(id + 7.1), hash21(id + 13.7)) * 0.7 + 0.15;
        float b = hash21(id + 3.3); b = b * b * b;                 // 少数だけ明るい
        float r = 0.035 + 0.06 * b;                                // 半径（格子単位。1 格子 ≈ 1.4°）
        float st = smoothstep(r + 0.02, r, length(f - pos));
        float tw = 1.0 - 0.25 * twinkle * (1.0 - sin(time * 2.0 + h * 60.0));   // 瞬き：twinkle=1 で ±25%（スライダー。2026-09-16）
        float col = hash21(id + 21.9);
        vec3 c = col < 0.2 ? vec3(0.8, 0.88, 1.0) : (col > 0.85 ? vec3(1.0, 0.93, 0.8) : vec3(1.0));
        return vec4(c, st * (0.3 + 0.7 * b) * tw);
      }
      // 月の円盤（欠けあり）：接平面の座標 (u,v) を半径で正規化し、明暗境界 u = (1−2k)·sqrt(1−v²) より太陽側を明るく
      float moonDisc(vec3 dd) {
        float cm = dot(dd, normalize(moonDir));
        float disc = smoothstep(cos(radians(moonRad + 0.25)), cos(radians(moonRad)), cm);
        float sr = sin(radians(moonRad));
        float u = dot(dd, moonU) / sr, v = clamp(dot(dd, moonV) / sr, -1.0, 1.0);
        float term = (1.0 - 2.0 * moonK) * sqrt(max(0.0, 1.0 - v * v));
        float lit = smoothstep(term - 0.08, term + 0.08, u);
        return disc * (0.06 + 0.94 * lit);   // 影の側も地球照でうっすら
      }
      void main(){
        vec3 d = normalize(vDir);
        float y = flip > 0.5 ? -d.y : d.y;
        vec3 dd = flip > 0.5 ? vec3(d.x, -d.y, d.z) : d;
        // 夕焼けの層：太陽の 3D 方向（方角＋高度）との角度差で決める（2026-09-16 ユーザー指摘：高度を見ていなかった）。
        // spread は「光の広がり」スライダー：0 で太陽のすぐ近くだけ、1 で標準、2 で空の大半
        vec3 sdn = normalize(sunDir);
        // 太陽中心の成分：角度のガウス減衰。幅は「光の広がり」で 0 → ±12°、1 → ±57°、2 → ±100°（16:30 に巨大化した緩い減衰を廃止。2026-09-16）
        float ang = acos(clamp(dot(dd, sdn), -1.0, 1.0));
        float sigma = radians(12.0 + 45.0 * spread);
        float lobe3 = exp(-(ang * ang) / (sigma * sigma));
        // 地平線に沿う成分（夕日用）：方角の一致度 × 地平線からの高さ。spread で横と高さを伸縮
        vec2 h = normalize(d.xz + vec2(1e-5, 0.0));
        float c = dot(h, normalize(sdn.xz + vec2(1e-5, 0.0)));
        float k = clamp(0.45 * spread, 0.0, 0.9);
        float lobeAz = pow(clamp(c * (1.0 - k) + k, 0.0, 1.0), 1.5);
        float hz = exp(-max(y, 0.0) * 2.2 / max(0.25, spread));
        // 太陽が低い間（高度 0→15°）は地平線に沿う成分、高くなるほど太陽中心の成分へ
        float lowSun = 1.0 - clamp(sdn.y / 0.26, 0.0, 1.0);        // sin15° ≈ 0.26
        float a = glowAmt * mix(lobe3, lobeAz * hz, lowSun);
        // 太陽の円盤（見かけの半径 sunRad 度、縁を 0.4 度ぼかす）と弱いハロー。夕焼けの層の上に通常合成（2026-09-16 ユーザー指定）
        float cs = dot(dd, normalize(sunDir));
        float disc = smoothstep(cos(radians(sunRad + 0.4)), cos(radians(sunRad)), cs);
        disc *= smoothstep(-0.011, 0.011, dd.y + sinDip);   // 床の縁を見下ろす角（sinDip）より下は沈んで見えない。切れ目は約 ±0.6° でぼかす（大気減光の近似。2026-09-16 ユーザー指定）
        float halo = pow(max(cs, 0.0), 140.0) * 0.5 * haloAmt;   // 円盤の暈も「太陽の眩しさ」に連動（0 で円盤だけ。2026-09-17 ユーザー指定）
        // にじみ（周日光環）：太陽に近いほど明るく、約 20° で半分・40° でほぼ 0 のなだらかな勾配（2026-09-16 ユーザー指定）
        float aur = pow(max(cs, 0.0), 12.0) * aureole;
        float sa = sunVis * clamp(disc + halo + aur, 0.0, 1.0);
        vec3 sunc = sunCol;   // 色は JS 側で高度に応じて決める（高いと白っぽく、夕日は赤橙）
        float outA = sa + a * (1.0 - sa);
        vec3 outC = outA > 1e-4 ? (sunc * sa + glowColor * a * (1.0 - sa)) / outA : glowColor;
        // 月（夕焼けの層と太陽の上に通常合成）。床の縁より下は沈む
        float md = moonVis * moonDisc(dd) * smoothstep(-0.011, 0.011, dd.y + sinDip);
        float outA2 = md + outA * (1.0 - md);
        vec3 outC2 = outA2 > 1e-4 ? (moonCol * md + outC * outA * (1.0 - md)) / outA2 : outC;
        // 星（一番下の層。夕焼け・太陽・月の下に置く＝それらが有る所では隠れる）。月の近くは月明かりで薄れ、床の縁で切れる
        vec4 sv = stars(dd);
        float ss = starVis * sv.a * smoothstep(-0.011, 0.011, dd.y + sinDip)
                 * (1.0 - 0.85 * moonVis * moonK * smoothstep(0.975, 1.0, dot(dd, normalize(moonDir))));
        float outA3 = outA2 + ss * (1.0 - outA2);
        vec3 outC3 = outA3 > 1e-4 ? (outC2 * outA2 + sv.rgb * ss * (1.0 - outA2)) / outA3 : outC2;
        gl_FragColor = vec4(outC3, outA3);
        #include <tonemapping_fragment>   // 露出＋トーン圧縮（本編と同じ。2026-09-16）
      }`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, toneMapped: true,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), skyMat);
  sky.renderOrder = -1000; sky.visible = false; sky.frustumCulled = false;
  scene.add(sky);
  // 太陽だけの選択的ブルーム（2026-09-16 ユーザー指定・方式 A）。太陽の円盤だけをレイヤー 1 の球に描き、
  // 本編の深度で隠れた画素を捨ててからぼかし、本編に加算する（renderFrame）。本編のドット絵はぼかさない
  const sunOnlyMat = new THREE.ShaderMaterial({
    uniforms: { sunDir: skyMat.uniforms.sunDir, sunCol: skyMat.uniforms.sunCol, sunVis: skyMat.uniforms.sunVis, sunRad: skyMat.uniforms.sunRad, flip: skyMat.uniforms.flip, sinDip: skyMat.uniforms.sinDip,
                moonDir: skyMat.uniforms.moonDir, moonU: skyMat.uniforms.moonU, moonV: skyMat.uniforms.moonV, moonK: skyMat.uniforms.moonK, moonVis: skyMat.uniforms.moonVis, moonRad: skyMat.uniforms.moonRad, moonCol: skyMat.uniforms.moonCol,
                sceneDepth: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, gain: { value: 1 }, ignoreDepth: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunVis; uniform float sunRad; uniform float flip; uniform float sinDip;
      uniform vec3 moonDir; uniform vec3 moonU; uniform vec3 moonV; uniform float moonK; uniform float moonVis; uniform float moonRad; uniform vec3 moonCol;
      uniform sampler2D sceneDepth; uniform vec2 resolution; uniform float gain; uniform float ignoreDepth; varying vec3 vDir;
      void main(){
        // 本編で何か描かれている画素（深度 < 1）は太陽が隠れている
        float dep = ignoreDepth > 0.5 ? 1.0 : texture2D(sceneDepth, gl_FragCoord.xy / resolution).r;
        if (dep < 0.9999) discard;
        vec3 d = normalize(vDir);
        vec3 dd = flip > 0.5 ? vec3(d.x, -d.y, d.z) : d;
        float cs = dot(dd, normalize(sunDir));
        float disc = smoothstep(cos(radians(sunRad + 0.4)), cos(radians(sunRad)), cs);
        disc *= smoothstep(-0.011, 0.011, dd.y + sinDip);   // 床の縁より下は無し（切れ目は約 ±0.6° でぼかす）
        float a = sunVis * disc;
        // 月（明るい側だけ。太陽より弱いにじみ）
        float cm = dot(dd, normalize(moonDir));
        float mdisc = smoothstep(cos(radians(moonRad + 0.25)), cos(radians(moonRad)), cm) * smoothstep(-0.011, 0.011, dd.y + sinDip);
        float sr = sin(radians(moonRad));
        float mu = dot(dd, moonU) / sr, mv = clamp(dot(dd, moonV) / sr, -1.0, 1.0);
        float lit = smoothstep((1.0 - 2.0 * moonK) * sqrt(max(0.0, 1.0 - mv * mv)) - 0.08, (1.0 - 2.0 * moonK) * sqrt(max(0.0, 1.0 - mv * mv)) + 0.08, mu);
        float ma = moonVis * mdisc * lit * 0.5;
        if (a + ma < 0.002) discard;
        gl_FragColor = vec4(sunCol * gain * a + moonCol * ma, min(1.0, a + ma));
      }`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, toneMapped: false,
  });
  const sunOnly = new THREE.Mesh(sky.geometry, sunOnlyMat);
  sunOnly.layers.set(1); sunOnly.frustumCulled = false; sunOnly.visible = false;
  scene.add(sunOnly);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true; // ひな壇を垂直面で切る（BACK_ROWS の clipX）
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // ドット絵に合わせて硬い影
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3, -12);    // 中心点：z は楽団の重心（マウス回転の軸もここ）。2026-09-13 ユーザー指定
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 90;
  controls.minPolarAngle = deg(12);
  controls.maxPolarAngle = deg(170); // 床の高さまで下り、さらに見上げられる（太陽を画面に入れるため。2026-09-16 ユーザー指定）。カメラ Y の下限 0.5 で床には潜らない
  // 水平方向の制限なし（ボクセル化で全周から見られる。2026-09-09）
  controls.update();
  // ホイールで限界に当たらないようにする（2026-09-25 ユーザー指定）。OrbitControls のホイールは「中心点までの距離」を伸縮するだけなので、
  // 中心点から minDistance より近く・maxDistance より遠くへは行けず、その先の場所に届かなかった。
  // 限界に達している時だけ、カメラと中心点を一緒に視線の方向へ平行移動する（回転の軸までの距離は範囲内のまま）。
  // OrbitControls より先に受けるため capture で聞き、平行移動した時は OrbitControls には渡さない
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!controls.enabled || !e.deltaY) return;
    const d = camera.position.distanceTo(controls.target), k = 0.95;   // k：OrbitControls の 1 刻みの倍率（zoomSpeed 1）
    const closer = e.deltaY < 0;
    if (closer ? d * k > controls.minDistance : d / k < controls.maxDistance) return;   // まだ余裕がある → いつもの伸縮
    e.preventDefault(); e.stopImmediatePropagation();
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    let step = Math.min(Math.abs(e.deltaY), 100) / 100 * controls.minDistance * 0.1 * (closer ? 1 : -1);   // マウスの 1 刻み（100）で 0.5
    // 床に潜らない（カメラ Y の下限 0.5 はスライダーと同じ）。下がり切ったら、それ以上は進まない
    const dy = dir.y * step, FLOOR_Y = 0.5;
    if (dy < 0 && camera.position.y + dy < FLOOR_Y) step *= Math.max(0, camera.position.y - FLOOR_Y) / -dy;
    if (!step) return;
    camera.position.addScaledVector(dir, step); controls.target.addScaledVector(dir, step);
    controls.update();
  }, { capture: true, passive: false });

  // 床・ひな壇・指揮台の深度書き込みは絵の方式で切り替える（setStageDepthWrite）。
  //   2D の板：深度を書かない（depthWrite:false, 先に描く）。奏者の板は足元を軸にカメラへ正対するため、見下ろすと板の上半分が
  //   後方へ倒れ込み、後列の（高い）ひな壇に深度で隠されるから。描く順（renderOrder）が前後関係になる（床 → 後列 → 前列 → 指揮台）
  //   ボクセル：通常どおり深度を書く。深度を書かないと後ろから見た時に前列のひな壇が後列を塗り潰す（2026-09-10 ユーザー指摘）
  // 材質はライトに反応する Phong（鏡面 0 ＝ ピクセル単位の Lambert）。Lambert は頂点ごとの計算＋補間なので、頂点の少ない大きな床では
  // スポットの円錐の範囲が出ない（中心の頂点が明るいと外周まで明るくなる）。床・ひな壇の明るさは照明で決まり、影を受ける
  const stageMat = (opts) => { const m = new THREE.MeshPhongMaterial({ ...opts, shininess: 0, specular: 0x000000, depthWrite: stageDepthWrite }); stageMats.add(m); return m; };
  const stageMeshes = [];   // 床・指揮台など（ドット化の「舞台」に使う）
  const addStage = (mesh, order = -20) => { mesh.renderOrder = order; mesh.receiveShadow = true; scene.add(mesh); stageMeshes.push(mesh); return mesh; };

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
  const skirt = new THREE.Group(); skirt.name = 'floorSkirt'; scene.add(skirt);   // 床の厚み（外周の側面）。buildFloorSkirt で組む

  // ひな壇は座席が決まってから buildRisers() で作る（扇形：使われている角度だけ）
  const risers = new THREE.Group();
  risers.position.z = SEAT_SHIFT_Z; // 座席と一緒に奥へ
  scene.add(risers);
  const screens = new THREE.Group();   // スクリーンはひな壇とは別に組み直す（枚数や位置を UI から頻繁に変えるため）
  screens.position.z = SEAT_SHIFT_Z;
  scene.add(screens);
  const domes = new THREE.Group();     // スカイドーム（遠景。3 層固定）
  const models = new THREE.Group(); models.name = 'models';   // 床に置く 3D モデル（GLB。2026-10-01 ユーザー指定）
  const stones = new THREE.Group(); stones.name = 'stones'; scene.add(stones);   // 石のジェネレーター（2026-10-03 ユーザー指定）
  const grass = new THREE.Group(); grass.name = 'grass'; scene.add(grass);       // 草のジェネレーター（2026-10-03 ユーザー指定）
  const water = new THREE.Group(); water.name = 'water'; scene.add(water);       // 水のジェネレーター（2026-10-03 ユーザー指定）
  scene.add(models);
  const weather = new THREE.Group();   // 天気（雨・雪・雷）。スカイドーム 1 枚ごとに、そのすぐ後ろへ 1 枚（2026-09-17 ユーザー指定）
  scene.add(domes);
  scene.add(weather);
  const flashLight = new THREE.AmbientLight('#cfe0ff', 0); flashLight.layers.enable(METAL_LAYER); flashLight.layers.enable(PLAYER_LAYER);   // 雷が舞台を照らすぶん（updateWeather が毎フレーム決める）
  scene.add(flashLight);
  stageCtx = { models, stones, grass, water, stageMeshes, scene, floorTex, grassTex: null, groundTex: floorTex, floorMat, stageMat, addStage, risers, skirt, screens, domes, weather, flashLight, hemi, amb, spots, sun, sky, sunOnly, bloom: { el: 0, cloud: 0, vis: 0, dip: 0, gain: 1 }, seats: [] };
  buildRisers([]);
  buildFloorSkirt();

  // 指揮台
  // 指揮台：高さ 0.6・赤茶色（2026-09-10 ユーザー指定）
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, PODIUM_H, 2.2), stageMat({ color: '#7a3a22' }));
  podium.position.set(0, PODIUM_H / 2, CONDUCTOR_Z);
  addStage(podium, -20);

  // 描画サイズはプレビュー要素の大きさに合わせる。毎フレーム呼ばれるので、変わった時だけ設定する。
  // レイアウトが決まる前（0×0）に設定すると aspect が NaN になり以後ずっと真っ黒になるため、その時は何もしない
  // （2026-09-12：ページを開いた時に稀に表示されない不具合。読み込み順やブラウザによってタイミングが変わる）
  let lastW = 0, lastH = 0;
  // 縦長（スマホ縦など）にした時、左右が切り落とされないように縦の画角を広げる。
  // 基準は 16:9 のときの横画角で、それより細い比率では横に写る範囲が変わらない（2026-09-14 ユーザー指定）
  const BASE_FOV = camera.fov, BASE_ASPECT = 16 / 9;
  const BASE_HTAN = Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * BASE_ASPECT;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 2 || h < 2 || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < BASE_ASPECT
      ? THREE.MathUtils.radToDeg(2 * Math.atan(BASE_HTAN / camera.aspect))
      : BASE_FOV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(container);
  resize();

  return { scene, camera, renderer, controls, resize, setShadows };
}

// 照明の状態。setShadows で切り替える（名前は互換のため）
let lightState = { enabled: true, elev: null, spread: null, cone: null, blur: null, mode: 'spot', sunAz: null, sunEl: null, sunTemp: null };
const SPOT_R = 40; // スポットライトと舞台中心 (0,0,-12) の距離 [unit]
const SUN_R = 60;  // 太陽光の光源と舞台中心の距離 [unit]（平行光なので向きだけが効く。影カメラの範囲に入る距離ならよい）
const HEMI_SKY_INDOOR = '#ffffff', HEMI_GROUND_INDOOR = '#6a5a50';   // 屋内（スポットライト）の半球光の色
// 色温度 0〜1 → 光の色。0 = 朝夕の橙、0.5 = 昼の白、1 = 曇り空の青
const SUN_WARM = new THREE.Color('#ffd2a0'), SUN_WHITE = new THREE.Color('#ffffff'), SUN_COOL = new THREE.Color('#cfe0ff');
const SUN_SET_RED = new THREE.Color('#ffd060'), _sunHigh = new THREE.Color();
const GLOW_HIGH = new THREE.Color('#ffd58a'), _glowTmp = new THREE.Color();   // 高い太陽の周りの黄色い光
const MOON_COL = new THREE.Color('#aab8ea'), MOON_DISC = new THREE.Color('#e8eefc');   // 月光の直射は薄い青白（プルキンエ現象の再現）。天空光には色を乗せない
const _mU = new THREE.Vector3(), _mV = new THREE.Vector3();   // 夕日の円盤の色（周りの夕焼け #f28a3c より明るく、輪郭が立つ。2026-09-16）
function sunColorOf(t) { return t < 0.5 ? SUN_WARM.clone().lerp(SUN_WHITE, t * 2) : SUN_WHITE.clone().lerp(SUN_COOL, (t - 0.5) * 2); }
// 地平線（太陽側）の色 → 天空光の色。明るさは 1 に正規化して「天空光」の強さだけで明るさが決まるようにする
const _skyTmp = new THREE.Color();
// 2026-09-16 ユーザー指定：色を付けるのは夕焼けの黄〜橙だけ。青に寄るほど無色（白）に近づける。
// 「暖かさ」= 赤 − 青（橙 #f28a3c → 1、薄黄 #f2d9a0 → 0.5、水色・紺 → 0）に比例して白から色へ寄せる
function skyLightColorOf(hex) {
  const c = _skyTmp.set(hex);
  const warmth = Math.min(1, Math.max(0, (c.r - c.b) * 1.5));
  c.lerp(SUN_WHITE, 1 - 0.7 * warmth);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum > 0.01) c.multiplyScalar(1 / lum);
  return c;
}
const LAT = deg(35);   // 北緯 35°（日本）。春秋分（赤緯 0）で計算する
const SKY_BASE = 0.7;  // 快晴・南中の天空光の基準（半球光の強さ）
const GROUND_OCCLUSION = 0.35;   // 照り返しの自己遮蔽係数（密集した舞台では足元の地面がほぼ影。直射ぶんに掛ける）
/**
 * 時刻・雲量・舞台の向きから太陽光の物理量を決める（2026-09-16 ユーザー指定：案 B）
 * @param {number} hour 時刻 [時]（小数可）  @param {number} cloud 雲量 0〜1  @param {number} facing 舞台が向く方位 [deg]（0 北・90 東・180 南・270 西）
 * @returns {{azimuth:number, elev:number, temp:number, intensity:number, skyLight:number, sky:string, horizon:string}}
 *   azimuth: 舞台基準の方角（0 客席正面・90 客席から見て右）  elev: 高度 [deg]（負なら地平線下）
 *   temp: 色温度 0〜1  intensity: 直射の強さ  skyLight: 天空光（半球光）の強さ  sky: 空の上端の色 [hex]  horizon: 地平線の色 [hex]
 */
// 時角 H [rad] から高度 [deg] と舞台基準の方角 [deg] を出す（赤緯 0 = 春秋分。太陽も月も同じ式）
function skyPos(H, facing) {
  const elev = Math.asin(Math.cos(LAT) * Math.cos(H));               // 南中で 90−35 = 55°
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT));  // 南から西回りの方位角
  const compass = (180 + azS / Math.PI * 180 + 360) % 360;           // 北 0・東 90・南 180・西 270
  const azimuth = ((facing - compass) % 360 + 360) % 360;            // 舞台基準：客席の方位 − 天体の方位。東は南向き舞台で「客席から見て右」
  return { azimuth, elev: elev / Math.PI * 180 };
}
export const MOON_CYCLE = 29.53;   // 朔望月 [日]
export function sunFromTime(hour, cloud, facing, moonAge = 15) {
  const H = deg((hour - 12) * 15);                                   // 時角。正午 0、午前が負
  const { azimuth, elev: elDeg } = skyPos(H, facing);
  const up = Math.max(0, Math.sin(deg(elDeg)));
  const air = Math.pow(up, 0.35);                                    // 低いほど大気を長く通って弱まる（空気量の近似）
  const c = Math.min(1, Math.max(0, cloud));
  const intensity = 1.6 * air * (1 - c) * (1 - c);                   // 雲で直射は消える
  // 月（2026-09-16 ユーザー指定）：月齢ぶんだけ太陽から時角が遅れる（満月 = 半周遅れ = 太陽の正反対）。
  // 照らされている割合 k は位相角から。明るさは k^3（半月は満月の 1/8 程度。衝効果の近似）
  const phase = (moonAge % MOON_CYCLE) / MOON_CYCLE;
  const moon = skyPos(H - phase * Math.PI * 2, facing);
  const moonK = (1 - Math.cos(phase * Math.PI * 2)) / 2;
  const moonUp = Math.max(0, Math.sin(deg(moon.elev)));
  const moonBright = moonK * moonK * moonK * Math.pow(moonUp, 0.35) * (1 - c) * (1 - c);   // 0〜1（満月・南中・快晴で 1）
  // 天空光：昼は高度で、日没後は薄明の減衰（0° で 0.35 → −18° で星明かりの床 0.04）、月夜は月が少し足す。曇りは拡散光が増える
  const tw = Math.min(1, Math.max(0, -elDeg / 18));
  const dayPart = elDeg >= 0 ? 0.35 + 0.65 * Math.sqrt(up) : 0.35 * (1 - tw) + 0.04 * tw;
  const cloudMul = c <= 0.5 ? 1 + 1.0 * (c / 0.5) : 2.0 - 1.3 * ((c - 0.5) / 0.5);   // 薄雲は空全体が光って増える（0.5 で 2 倍）、雨雲は暗い（1 で 0.7 倍）
  const skyLight = SKY_BASE * (dayPart + 0.12 * moonBright * tw) * cloudMul;
  const tEl = Math.min(0.5, 0.5 * Math.max(0, elDeg) / 30);          // 地平線で橙、30° 以上で白
  const temp = tEl + (0.5 - tEl) * c;                                // 雲で白へ（青側には寄せない。昼に青かぶりしていた。2026-09-16 ユーザー指摘）
  return { azimuth, elev: elDeg, temp, intensity, skyLight, sky: skyColorFromTime(elDeg, c), horizon: horizonColorFromTime(elDeg, c),
           moonAzimuth: moon.azimuth, moonElev: moon.elev, moonK, moonBright };
}
// 地平線の色を高度と雲量から決める（2026-09-16 ユーザー指定：夕焼けのシミュレート。方向は無視）。
// 橙になるのは太陽が地平線の ±6° にいる間だけ。薄雲（雲量 〜0.5）は色を派手に、厚い雲は灰色へ
// 太陽側（球に重ねる夕焼け）。キーは高度 [deg]。橙は 17:30（6°）に出るよう 2026-09-17 に高い方へ広げた（春秋分：30°=15:30、14°=16:55、6°=17:30、0°=18:00）
const HZ_CLEAR = [[30, '#00bfff'], [14, '#e8dcc0'], [6, '#f0a860'], [0, '#f27a38'], [-4, '#e46f7a'], [-8, '#6b4a8c'], [-12, '#131c4d'], [-18, '#05081f']];   // 6° は円盤より暗い橙寄り（円盤の輪郭を立てる）
const HZ_VIVID = [[30, '#00bfff'], [14, '#f5d9a8'], [6, '#ff9a3c'], [0, '#ff6a1f'], [-4, '#ff5f7e'], [-8, '#7a3fa0'], [-12, '#131c4d'], [-18, '#05081f']];
// 太陽と反対側（CSS の地平線の色）：青灰 → 地球の影の帯（ピンク〜紫）→ 濃紺。薄雲でピンクが濃くなる
const HZ_ANTI_CLEAR = [[30, '#00bfff'], [14, '#8fc6ea'], [6, '#c6d4ea'], [0, '#a9a6c9'], [-4, '#7a6ea6'], [-8, '#45407e'], [-12, '#131c4d'], [-18, '#05081f']];
const HZ_ANTI_VIVID = [[30, '#00bfff'], [14, '#a9cfec'], [6, '#d2cfe6'], [0, '#c9a0bd'], [-4, '#8e6aa8'], [-8, '#4d3f8a'], [-12, '#131c4d'], [-18, '#05081f']];
const _hz = new THREE.Color(), _hz2 = new THREE.Color();
function keyColor(out, keys, el) {
  if (el >= keys[0][0]) return out.set(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const [e1, c1] = keys[i - 1], [e0, c0] = keys[i];
    if (el >= e0) return out.set(c0).lerp(_hz2.set(c1), (el - e0) / (e1 - e0));
  }
  return out.set(keys[keys.length - 1][1]);
}
function horizonPalette(clear, vivid, el, cloud) {
  keyColor(_hz, clear, el);
  _hz.lerp(keyColor(_skyTmp, vivid, el), Math.min(1, cloud / 0.5));   // 薄雲で派手に（朝夕）
  const lum = 0.2126 * _hz.r + 0.7152 * _hz.g + 0.0722 * _hz.b;
  const bright = Math.max(daylightOf(el), Math.min(1, lum / 0.5 + 0.05));   // 曇りの明るさは太陽の高度で。薄明では晴れの地平線の明るさを下限に（上限 1）
  // 昼の薄雲は白く（朝夕は派手な色を残す）。厚い雨雲は暗い灰へ（2026-09-16 ユーザー指摘）
  const dayness = Math.min(1, Math.max(0, el / 10));
  _hz.lerp(_skyTmp.copy(SKY_OVERCAST).multiplyScalar(bright), Math.min(1, cloud / 0.5) * dayness);
  if (cloud > 0.5) _hz.lerp(_skyTmp.copy(SKY_RAIN).multiplyScalar(bright), (cloud - 0.5) / 0.5);
  return '#' + _hz.getHexString();
}
function horizonColorFromTime(el, cloud) { return horizonPalette(HZ_ANTI_CLEAR, HZ_ANTI_VIVID, el, cloud); }   // 反対側（土台）
function horizonGlowColorFromTime(el, cloud) { return horizonPalette(HZ_CLEAR, HZ_VIVID, el, cloud); }         // 太陽側（球）
// 空の上端の色を高度と雲量から決める（2026-09-16 ユーザー指定）。
// 昼の青 → 低い太陽で深い青紫 → 地平線下は濃紺。雲は灰色へ寄せ、暗いほど灰も暗く
const SKY_DAY = new THREE.Color('#001f7a'), SKY_LOW = new THREE.Color('#062ccc'), SKY_NIGHT = new THREE.Color('#040e5c'), SKY_DEEP = new THREE.Color('#02051c');   // SKY_DEEP = 真夜中（−18° 以下）   // 昼の空は #001f7a（2026-09-17 ユーザー指定の試し）   // 夜（−12°）は薄明の濃紺。黒にしない（2026-09-16 ユーザー指摘）
const SKY_OVERCAST = new THREE.Color('#e9edf2');   // 薄雲の空は明るい白（晴天より明るいことも多い。2026-09-16 ユーザー指摘）
const SKY_RAIN = new THREE.Color('#6e747c');       // 厚い雨雲の空は暗い灰
const _sky = new THREE.Color();
// 昼夜の明るさ 0.03〜1：高度 6° 以上で 1、−6° で床値（曇りの空・地平線の色に掛ける）
function daylightOf(el) { const t = Math.min(1, Math.max(0, (el + 6) / 12)); return 0.03 + 0.97 * t * t * (3 - 2 * t); }
function skyColorFromTime(el, cloud) {
  if (el >= 30) _sky.copy(SKY_DAY);
  else if (el >= 0) _sky.copy(SKY_LOW).lerp(SKY_DAY, el / 30);
  else if (el >= -12) _sky.copy(SKY_NIGHT).lerp(SKY_LOW, (el + 12) / 12);   // 高度 0° で上からの色（SKY_LOW）と一致させる
  else if (el >= -18) _sky.copy(SKY_DEEP).lerp(SKY_NIGHT, (el + 18) / 6);   // 天文薄明：−18° でほぼ黒
  else _sky.copy(SKY_DEEP);
  // 曇りの明るさは太陽の高度で決める（空の色の輝度に比例させると、昼の空を濃い紺にした時に曇りまで灰色になった。2026-09-17 ユーザー指摘）
  const lum = 0.2126 * _sky.r + 0.7152 * _sky.g + 0.0722 * _sky.b;
  const bright = Math.max(daylightOf(el), Math.min(1, lum / 0.32 + 0.05));   // 薄明では晴れの空の明るさを下限に（曇りが真っ黒にならない）
  // 雲量 0〜0.5：薄雲＝白へ。0.5〜1：厚い雨雲＝暗い灰へ（2026-09-16 ユーザー指摘）
  const white = _skyTmp.copy(SKY_OVERCAST).multiplyScalar(bright);
  _sky.lerp(white, Math.min(1, cloud / 0.5));
  if (cloud > 0.5) _sky.lerp(_skyTmp.copy(SKY_RAIN).multiplyScalar(bright), (cloud - 0.5) / 0.5);
  return '#' + _sky.getHexString();
}
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
  const k = tex.tileScale || 1;   // 草原はタイルを細かく（2 倍。2026-09-17 ユーザー指定）
  m.repeat.set(k / 40, k / 32);
  return m;
}

// ひな壇の天面用のテクスチャ。RingGeometry の UV は外径の正方形を [0,1] に写すので、
// そのまま貼ると段の半径によって粒の大きさが変わってしまう（2026-09-13 ユーザー指摘）。
// 床と同じ「40×32 unit に 1 枚」の実寸になるよう繰り返しを設定し、原点も床に合わせる
function ringMapOf(tex, rOut) {
  const m = tex.clone(); m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  const k = tex.tileScale || 1;
  m.repeat.set(k * 2 * rOut / 40, k * 2 * rOut / 32);
  m.offset.set(-k * rOut / 40, -k * rOut / 32);
  m.__disposable = true;            // 作り直しのたびに捨てる（元の共有テクスチャは触らない）
  return m;
}

/** 床とひな壇の天面の見た目を切り替える（'plank' = 板目 / 'grass' = 草原 / 'grassDark' = 草原（深緑））。2026-09-13 ユーザー指定 */
export function setFloorStyle(style) {
  if (!stageCtx) return;
  if (style === 'grass' && !stageCtx.grassTex) stageCtx.grassTex = grassTexture('normal');
  if (style === 'grassDark' && !stageCtx.grassDarkTex) stageCtx.grassDarkTex = grassTexture('dark');   // 深緑（2026-09-16）
  const tex = style === 'grass' ? stageCtx.grassTex : style === 'grassDark' ? stageCtx.grassDarkTex : stageCtx.floorTex;
  if (tex === stageCtx.groundTex) return;
  stageCtx.groundTex = tex;
  stageCtx.floorMat.map?.dispose();
  stageCtx.floorMat.map = floorMapOf(tex);
  stageCtx.floorMat.needsUpdate = true;
  buildRisers(stageCtx.seats);   // ひな壇の天面も同じ地面の絵にする
  buildFloorSkirt();             // 床の側面の絵も床のスタイルに合わせる
}

/**
 * 光源の切替と太陽光の項目（2026-09-16 ユーザー指定）：
 *   mode: 'spot'（屋内）| 'sun'（屋外）＝環境。光源は sunOn（太陽・月。屋外のみ）と spotOn（スポットライト。両方で可）で併用できる
 *   sun: 太陽光の強さ  sunAzimuth: 方角 [deg]（0 で客席正面、90 で客席から見て右、180 で奥）  sunElev: 高度 [deg]（90 で真上）
 *   sunTemp: 色温度 0〜1  groundColor: 半球光の下色。省略時は床テクスチャの平均色 × 照り返し（屋内では固定色）。上色は太陽側の地平線色の暖色成分だけ
 *   moonAzimuth / moonElev / moonBright: 月の方角・高度・照らされている割合（手動）。自動では sunAuto.moonAge（月齢）から
 *   sunBloom: 太陽の眩しさ（ブルームの強さ。0〜3）  starTwinkle: 星の瞬きの強さ（0〜2、1 で ±25%）  skyTint: 天空光に空の色相を乗せる（false で白）  groundBounceOn: 照り返し自体（false で下からの光ゼロ）  groundBounce: 照り返しに床の色を乗せる（false で同じ明るさの無彩色）
 *   horizonHex: 手動のとき夕焼けの層に使う「地平線の色」  stageFacing / hour: 手動のとき星の回転に使う舞台の向きと時刻  bgFlip: 背景を上下反転中なら空の球も反転  skyGlowSpread: 夕焼けの広がり（0〜2、1 標準）  sunAmbient: 天空光の強さ（太陽光・手動）  sunAuto: {hour, cloud, facing} があれば sun/sunTemp/sunAzimuth/sunElev/sunAmbient を時刻・天気から決める
 */
// スカイドームの明るさ（方向を無視）：屋外は 天空光 + 直射 × 0.55、屋内は素材どおり（舞台照明は空に届かない）
function updateDomeLight() {
  const { hemi, sun } = stageCtx, c = DOME_LIGHT.value;
  if (lightState.mode !== 'sun') { c.setRGB(1, 1, 1); return; }
  c.copy(hemi.color).multiplyScalar(hemi.intensity * 0.9);
  c.r += sun.color.r * sun.intensity * 0.55; c.g += sun.color.g * sun.intensity * 0.55; c.b += sun.color.b * sun.intensity * 0.55;
  c.r = Math.min(1.2, c.r); c.g = Math.min(1.2, c.g); c.b = Math.min(1.2, c.b);
}

/** 空の球をカメラの位置に置く（毎フレーム、描画の直前に呼ぶ）。球はカメラ中心なので視線方向＝頂点方向になる */
// 床（浮島）の中か：手前と左右は直線、奥はひな壇に沿った弧（createStage の Shape と同じ定義）
function insideFloor(x, z) {
  if (Math.abs(x) > FLOOR_X_HALF || z > FLOOR_Z_FRONT) return false;
  const dz = z - SEAT_SHIFT_Z;   // 弧の中心は z = SEAT_SHIFT_Z
  return x * x + dz * dz <= FLOOR_BACK_R * FLOOR_BACK_R;
}
export function updateSky(camera) {
  if (!stageCtx?.sky.visible) return;
  stageCtx.sky.position.copy(camera.position);
  stageCtx.sunOnly.position.copy(camera.position);
  stageCtx.sky.material.uniforms.time.value = performance.now() / 1000;   // 星の瞬き
  // 太陽が沈むライン（2026-09-16 ユーザー指定）：目の高さ（水平）ではなく、カメラから太陽の方角に見える床の縁を見下ろす角。
  // 地球の丸みによる水平線の下がりは 0.1° 未満で無視できる。このシーンで「地面が終わって見える」のは床の縁なので、そこに沈める。
  // 太陽の方角へ 0.5 unit 刻みで進み、床の中にいた最後の距離（縁）を取る。床を通らない向きなら目の高さ（0）
  const d = stageCtx.sky.material.uniforms.sunDir.value, h = Math.max(0.05, camera.position.y);
  const ux = d.x, uz = d.z, len = Math.hypot(ux, uz) || 1;
  let last = -1;
  for (let t = 0; t <= 120; t += 0.5) {
    if (insideFloor(camera.position.x + ux / len * t, camera.position.z + uz / len * t)) last = t;
  }
  // 上限 6°：高いカメラでは縁の見下ろし角が大きくなりすぎ、19 時（高度 −12°）でも太陽が残る（2026-09-16 ユーザー指摘）。
  // 6° なら 18:30（高度 −6°＝市民薄明の終わり）にどのカメラでも半分以上隠れ、18:48 頃に沈みきる
  const dip = Math.min(deg(6), last > 0.5 ? Math.atan2(h, last) : 0);
  stageCtx.sky.material.uniforms.sinDip.value = Math.sin(dip);
  stageCtx.bloom.dip = dip / Math.PI * 180;
}

// ---------- 太陽だけの選択的ブルーム（2026-09-16 ユーザー指定・方式 A） ----------
// 本編 → 等倍のオフスクリーン（深度テクスチャ付き）。太陽の円盤だけ → 1/4 解像度（本編の深度で隠れた所は捨てる）→ ガウスぼかし。
// 最後に本編を最近傍で 1:1 転写しながらぼかした太陽を加算する。本編のドット絵には一切ぼかしが掛からない
const post = { w: 0, h: 0, main: null, a: null, b: null, quadScene: null, quadCam: null, quad: null, blurMat: null, compMat: null,
               probe: null, probeMat: null, px8: new Uint8Array(4), sunNdc: new THREE.Vector3(), half: false, c: null, d: null, brightMat: null };
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
function ensurePost(renderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (post.main && post.w === size.x && post.h === size.y) return;
  post.w = size.x; post.h = size.y;
  for (const k of ['main', 'a', 'b']) post[k]?.dispose();   // c, d は下で
  post.main = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
  post.main.depthTexture = new THREE.DepthTexture(size.x, size.y);
  post.main.depthTexture.type = THREE.UnsignedIntType;
  const bw = Math.max(1, Math.round(size.x / 4)), bh = Math.max(1, Math.round(size.y / 4));
  // ブルーム用は 16bit 浮動小数（WebGL2）：暗い裾の精度と増幅の飽和を避ける。無い環境は 8bit
  post.half = !!(renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float'));
  const bt = post.half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  post.a = new THREE.WebGLRenderTarget(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: bt });
  post.b = new THREE.WebGLRenderTarget(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: bt });
  for (const k of ['c', 'd']) post[k]?.dispose();
  post.c = new THREE.WebGLRenderTarget(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: bt });   // 全体ブルーム用
  post.d = new THREE.WebGLRenderTarget(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: bt });
  if (!post.quadScene) {
    post.quadScene = new THREE.Scene();
    post.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    post.blurMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2(1, 1) } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tex; uniform vec2 dir; uniform vec2 texel; varying vec2 vUv;
        void main(){
          // 13 タップのガウス（σ ≈ 3 タップ）。dir × texel でステップ幅を変えて広げる
          float w[7]; w[0]=0.1964; w[1]=0.1746; w[2]=0.1210; w[3]=0.0656; w[4]=0.0276; w[5]=0.0090; w[6]=0.0023;
          vec4 c = texture2D(tex, vUv) * w[0];
          for (int i = 1; i < 7; i++) { vec2 o = dir * texel * float(i); c += (texture2D(tex, vUv + o) + texture2D(tex, vUv - o)) * w[i]; }
          gl_FragColor = c;
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    post.compMat = new THREE.ShaderMaterial({
      uniforms: { mainTex: { value: null }, bloom: { value: null }, strength: { value: 1 }, bloomAll: { value: null }, strengthAll: { value: 0 },
                  sunUv: { value: new THREE.Vector2(0.5, 0.5) }, aspect: { value: 1.78 }, veil: { value: 0 }, veilR: { value: 0.1 }, veilCol: { value: new THREE.Color(1, 1, 1) },
                  streak: { value: 0 }, streakL: { value: 0.3 }, rayRot: { value: 0 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D mainTex; uniform sampler2D bloom; uniform float strength; uniform sampler2D bloomAll; uniform float strengthAll;
        uniform vec2 sunUv; uniform float aspect; uniform float veil; uniform float veilR; uniform vec3 veilCol; uniform float streak; uniform float streakL; uniform float rayRot; varying vec2 vUv;
        void main(){
          vec4 m = texture2D(mainTex, vUv);              // 本編（premultiplied）。等倍・最近傍なのでそのまま
          vec3 b = texture2D(bloom, vUv).rgb * strength; // ぼかした太陽を加算
          // 光のかぶり（ヴェイリング・グレア。2026-09-17 ユーザー指定）：太陽からの距離 d（画面の高さ = 1）に対して 1/(1+(d/r)²) の長い裾で
          // 画面全体に白っぽい光を足す。手前の物の上にも乗る（目・レンズの散乱の再現）。veil は見えている割合と眩しさで決まる
          vec2 dv = (vUv - sunUv) * vec2(aspect, 1.0);
          float d = length(dv);
          float g = veil / (1.0 + (d * d) / (veilR * veilR));
          // 放射状の光条（2026-09-17 ユーザー指定：巨大な太陽でなく、直視できない眩しさ）。回折の再現。
          // 3 層：主 16 本（細く長い）＋ 副 16 本（間に、短め）＋ 細い 32 本（ごく短い）。長さ streakL（画面の高さ = 1）で指数減衰（本数は 2026-09-17 ユーザー指定で増やした）
          float phi = atan(dv.y, dv.x) + rayRot;   // rayRot：カメラの向きと太陽の画面位置で回る（レンズフレアの動き。2026-09-17 ユーザー指定）
          // 光条は「一定の太さの線」（線からの垂直距離でガウス減衰）。角度幅だと太陽の近くで鋭く、離れると太くなり実物と逆だった（2026-09-17 ユーザー指摘）。
          // 太陽の近くでは線同士が重なって白く溢れ、離れるほど 1 本ずつ分かれて薄れる
          float rays = 0.0;
          // 幅は根本で太く先で細く（w0 → w1 を距離 L で補間）。到達距離は短め（2026-09-17 ユーザー指定）
          { float n = 16.0, off = 0.0, w0 = 0.012, w1 = 0.003, L = streakL;            // 主 16 本
            float dphi = mod(phi - off + 3.14159265 / n, 6.28318531 / n) - 3.14159265 / n;
            float w = mix(w0, w1, clamp(d / L, 0.0, 1.0));
            float perp = d * abs(sin(dphi)); rays += exp(-(perp * perp) / (w * w)) * exp(-d / L); }
          { float n = 16.0, off = 0.19635, w0 = 0.008, w1 = 0.002, L = streakL * 0.5;   // 副 16 本
            float dphi = mod(phi - off + 3.14159265 / n, 6.28318531 / n) - 3.14159265 / n;
            float w = mix(w0, w1, clamp(d / L, 0.0, 1.0));
            float perp = d * abs(sin(dphi)); rays += 0.6 * exp(-(perp * perp) / (w * w)) * exp(-d / L); }
          { float n = 24.0, off = 0.13, w0 = 0.010, w1 = 0.0025, L = streakL * 0.7;   // 中間の 24 本（2026-09-17 ユーザー指定で追加）
            float dphi = mod(phi - off + 3.14159265 / n, 6.28318531 / n) - 3.14159265 / n;
            float w = mix(w0, w1, clamp(d / L, 0.0, 1.0));
            float perp = d * abs(sin(dphi)); rays += 0.5 * exp(-(perp * perp) / (w * w)) * exp(-d / L); }
          { float n = 32.0, off = 0.09817, w0 = 0.005, w1 = 0.0015, L = streakL * 0.3;  // 細い 32 本
            float dphi = mod(phi - off + 3.14159265 / n, 6.28318531 / n) - 3.14159265 / n;
            float w = mix(w0, w1, clamp(d / L, 0.0, 1.0));
            float perp = d * abs(sin(dphi)); rays += 0.35 * exp(-(perp * perp) / (w * w)) * exp(-d / L); }
          // 太陽の近くは光条を立てず（ウニ状のトゲに見えた。2026-09-17 ユーザー指摘）、丸い芯の光で白く溢れさせる。光条は芯の外でなだらかに立ち上がる
          float core = streak * 0.9 * exp(-(d * d) / (0.035 * 0.035));
          rays *= streak * 0.75 * smoothstep(0.02, 0.12, d);
          vec3 v = veilCol * (g + core + rays);
          vec3 add = b + v + texture2D(bloomAll, vUv).rgb * strengthAll;   // 画面全体のブルーム（カメラ側）
          float al = max(add.r, max(add.g, add.b));
          gl_FragColor = vec4(m.rgb + add, min(1.0, m.a + al));
        }`,
      depthTest: false, depthWrite: false, toneMapped: false, transparent: true, blending: THREE.NoBlending,
    });
    post.brightMat = new THREE.ShaderMaterial({   // 本編の明るい部分を抜く（全体ブルーム用。2026-09-17）
      uniforms: { tex: { value: null }, thr: { value: 0.7 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tex; uniform float thr; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tex, vUv); float m = max(c.r, max(c.g, c.b)); float k = max(0.0, m - thr) / max(1e-3, m); gl_FragColor = vec4(c.rgb * k, c.a); }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    post.probeMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, uv: { value: new THREE.Vector2(0.5, 0.5) } },
      vertexShader: QUAD_VS,
      fragmentShader: 'uniform sampler2D tex; uniform vec2 uv; void main(){ gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0); }',
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    post.probe = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    post.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post.blurMat);
    post.quadScene.add(post.quad);
  }
}
function blurPass(renderer, src, dst, dx, dy, step) {
  post.quad.material = post.blurMat;
  post.blurMat.uniforms.tex.value = src.texture;
  post.blurMat.uniforms.dir.value.set(dx, dy);
  post.blurMat.uniforms.texel.value.set(step / src.width, step / src.height);
  renderer.setRenderTarget(dst); renderer.clear();
  renderer.render(post.quadScene, post.quadCam);
}
/** 1 フレーム描く。屋外（太陽あり）なら太陽だけのブルームを掛け、屋内なら従来どおり直接描く */
const _flareTmp = new THREE.Vector3();
// ---- 奏者のドット化（トゥーンのドット絵版の 1 段目。2026-09-30 ユーザー指定：奏者だけ）----
// 奏者だけを 1/size の解像度で描き（色と深度）、本編の前に最近傍で画面いっぱいに書き込む。本編は奏者を隠して上から描くので、
// ほかの物との前後は深度で正しく決まる。影は奏者だけのパスで計算したもの（全員が映る）を本編でも使う
export const PLAYER_LAYER = 4;
// 階調の細かさ（2026-10-04 ユーザー指定）：色の成分ごとに lv 段へ丸める。32 以上で丸めない。
// 舞台は色を変換せずそのまま画面に出す（outputEncoding は既定のまま）ので、画面の値をそのまま等分する（ガンマを掛けて刻むと暗い色が黒に潰れた）
const PIX_QUANT_GLSL = `vec3 pxoQuant( vec3 c, float lv ) {
  if ( lv >= 31.5 ) return c;
  return floor( max( c, 0.0 ) * ( lv - 1.0 ) + 0.5 ) / ( lv - 1.0 );
}
// 透明度も同じ段数で丸める（2026-10-04 ユーザー指定：泡の消え方・水の縁が、階調を粗くしても滑らかなままだった）。0 になったら描かない
float pxoQuantA( float a, float lv ) {
  if ( lv >= 31.5 ) return a;
  return floor( clamp( a, 0.0, 1.0 ) * ( lv - 1.0 ) + 0.5 ) / ( lv - 1.0 );
}`;
const LINE_GAP = 0.25;   // 内側の輪郭線を引く深度の差 [unit]
// rows：画面の短い方を何ドットに分けるか（2026-09-30 ユーザー指定：画素で決めるとスマホで粗すぎたので、端末に依らないドットの数で決める）
const pix = { on: false, rows: 330, roots: [], rt: null, quad: null, outline: false, lineAmt: 1 };
/** o = { on（ドット化）, rows（画面の短い方のドット数）, outline（輪郭線）, lineAmt（輪郭の濃さ 0〜1）, roots（奏者の root の配列）}
 *  輪郭線はドット化の画像から引く（ドット化とセットで使う。単独ではかけない。2026-09-30 ユーザー指定）。
 *  roots：ドットにする物（奏者・舞台・スクリーン等をチェックで選ぶ。2026-10-01 ユーザー指定）。選ばなかった物は本編で等倍に描く */
/** ドット化で選べる舞台側のまとまり（main.js が範囲のチェックに合わせて roots に入れる） */
export function pixelGroups() {
  if (!stageCtx) return {};
  // 水はドット化の対象に入れない（2026-10-04 ユーザー指摘：ドット絵と 3D モデルをオンにすると水が消えた）。水は半透明で奥行きを書かないので、
  // 粗い画像に描くと「一番奥」扱いになり、あとから等倍で描く床に上から塗られて消えた。代わりに水のシェーダーが同じます目でドットにする（WATER_PIX）
  return { stage: [...stageCtx.stageMeshes, stageCtx.skirt, stageCtx.risers], models: [stageCtx.models, stageCtx.stones, stageCtx.grass], screens: [stageCtx.screens], domes: [stageCtx.domes], weather: [stageCtx.weather] };
}
// トゥーン陰影（明るさを段に丸める）は試したが外した（2026-09-30 ユーザー指定）
export function setPixelPlayers(o) { Object.assign(pix, o); }
const _pixClear = new THREE.Color();
function pixelPass(renderer, scene, camera) {
  WATER_PIX.uPixDot.value.set(0, 0);
  if (!(pix.on || pix.outline) || !pix.roots.length) return false;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // 1 ドットの大きさ [画素]（画面の画素より小さくはしない）
  const k = pix.on ? Math.max(1, Math.min(size.x, size.y) / Math.max(1, pix.rows || 330)) : 1, lw = Math.max(1, Math.round(size.x / k)), lh = Math.max(1, Math.round(size.y / k));
  if (!pix.rt || pix.rt.width !== lw || pix.rt.height !== lh) {
    pix.rt?.dispose();
    pix.rt = new THREE.WebGLRenderTarget(lw, lh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
    pix.rt.depthTexture = new THREE.DepthTexture(lw, lh);
    pix.rt.depthTexture.type = THREE.UnsignedIntType;
  }
  WATER_PIX.uPixLv.value = pix.on ? (pix.levels ?? 32) : 32;
  if (pix.on && stageCtx && pix.roots.includes(stageCtx.models)) WATER_PIX.uPixDot.value.set(size.x / lw, size.y / lh);   // 水も同じます目のドットに（範囲に 3D モデルがある時）
  if (!pix.quad) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, depth: { value: null }, texel: { value: new THREE.Vector2() },
                  line: { value: 0 }, lineDark: { value: 0.35 }, ring: { value: 0 }, outerOff: { value: 0 }, near: { value: 0.1 }, far: { value: 200 }, lv: WATER_PIX.uPixLv },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // 輪郭線（3 段目。2026-09-30 ユーザー指定）：外側＝奏者に接する空の画素を線の色に（深度は隣の奏者の一番手前）。
      // 内側＝隣の画素より LINE_GAP 以上奥にある画素（腕の後ろの胴など）を線の色へ寄せる。太さはどちらも 1 ドット
      fragmentShader: `uniform sampler2D tex; uniform sampler2D depth; uniform vec2 texel; uniform float line; uniform float lineDark; uniform float ring; uniform float outerOff;
        // 輪郭の色（2026-10-01 ユーザー指定：セルアウト）：隣の物の色を lineDark（輪郭の明るさ）倍に暗くした色。0 で黒、1 で物の色そのまま。
        // 以前は黒との混ぜ具合（輪郭の色）も別に持っていたが、黒がほぼ 0 なので明るさとの掛け算になり、同じ働きの重複だった
        vec3 selOut(vec4 n) { return (n.rgb / max(n.a, 0.0001)) * lineDark; }
        uniform float near; uniform float far; uniform float lv; varying vec2 vUv;
        ${PIX_QUANT_GLSL}
        float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        void pxoBody() {
          vec4 c = texture2D(tex, vUv);
          float d = texture2D(depth, vUv).r;
          if (line > 0.0) {
            vec2 o0 = vec2(texel.x, 0.0), o1 = vec2(-texel.x, 0.0), o2 = vec2(0.0, texel.y), o3 = vec2(0.0, -texel.y);
            vec4 n0 = texture2D(tex, vUv + o0), n1 = texture2D(tex, vUv + o1), n2 = texture2D(tex, vUv + o2), n3 = texture2D(tex, vUv + o3);
            float d0 = texture2D(depth, vUv + o0).r, d1 = texture2D(depth, vUv + o1).r, d2 = texture2D(depth, vUv + o2).r, d3 = texture2D(depth, vUv + o3).r;
            // 「物がある」＝色があり奥行きも書かれている（2026-09-30 ユーザー指摘：スクロールする木の輪郭が途中で消えた）。
            // 空の球は画面全体に薄い透明度（0.01〜0.035）で描かれるが奥行きを書かないので、透明度だけで見ると場所により「物」扱いになり外側の線が消えた
            bool s0 = n0.a > 0.01 && d0 < 0.99999, s1 = n1.a > 0.01 && d1 < 0.99999, s2 = n2.a > 0.01 && d2 < 0.99999, s3 = n3.a > 0.01 && d3 < 0.99999;
            if (!(c.a > 0.01 && d < 0.99999)) {   // 背景（何も無い・空）：隣に物があれば外側の線
              // 線の濃さは隣の物の透明度に比例（端のぼかし等で薄くなる所は線も薄く。2026-09-30 ユーザー指定）
              float best = 1.0, na = 0.0; vec4 nc = vec4(0.0);   // nc：一番手前の隣の物の色（輪郭の色に使う）
              if (s0) { if (d0 < best) nc = n0; best = min(best, d0); na = max(na, n0.a); }
              if (s1) { if (d1 < best) nc = n1; best = min(best, d1); na = max(na, n1.a); }
              if (s2) { if (d2 < best) nc = n2; best = min(best, d2); na = max(na, n2.a); }
              if (s3) { if (d3 < best) nc = n3; best = min(best, d3); na = max(na, n3.a); }
              if (best < 1.0 && outerOff < 0.5) {   // outerOff：線を消す（外周と奥行きの境目の両方。内側の輪郭だけ残す。2026-10-01 ユーザー指定）
                float la = line * na;
                if (la < 0.01) discard;
                gl_FragColor = vec4(selOut(nc), la);
                gl_FragDepthEXT = best;
                return;
              }
              if (c.a < 0.01) discard;
              gl_FragColor = vec4(c.rgb / max(c.a, 0.0001), c.a);   // 空はそのまま
              gl_FragDepthEXT = d;
              return;
            }
            // 内側の線：奥行きが急に折れる所だけ（2026-09-30 ユーザー指摘：全体の時、遠くの地面が一面の線になった）。
            // 浅い角度の地面は 1 ドットごとに奥行きが大きく変わるが、なだらかに続くだけなので、両隣との差（2 階差分）で見る。
            // 自分が両隣の平均より gap 以上奥なら、手前の物の縁の奥側として線にする。gap は遠いほど大きく
            float ld = lin(d), gap = max(${LINE_GAP.toFixed(3)}, ld * 0.03);
            float l0 = lin(d0), l1 = lin(d1), l2 = lin(d2), l3 = lin(d3);
            bool hx = s0 && s1, hy = s2 && s3;
            bool edge = (hx && ld - 0.5 * (l0 + l1) > gap) || (hy && ld - 0.5 * (l2 + l3) > gap)
                     || (!hx && ((s0 && l0 < ld - 2.0 * gap) || (s1 && l1 < ld - 2.0 * gap)))
                     || (!hy && ((s2 && l2 < ld - 2.0 * gap) || (s3 && l3 < ld - 2.0 * gap)));
            if (edge && outerOff < 0.5) {   // 手前側の隣（一番近い物）の色で線を引く
              vec4 fc = c; float fl = ld;
              if (s0 && l0 < fl) { fl = l0; fc = n0; }
              if (s1 && l1 < fl) { fl = l1; fc = n1; }
              if (s2 && l2 < fl) { fl = l2; fc = n2; }
              if (s3 && l3 < fl) { fl = l3; fc = n3; }
              c.rgb = mix(c.rgb, selOut(fc) * c.a, line * c.a);   // 内側の線も自分の透明度に比例（c.rgb は透明度が掛かった値なので線の色にも掛ける）
            } else if (ring > 0.0 && !edge) {
              // 内側の輪郭（2026-10-01 ユーザー指定）：線に接する物の縁の 1 ドット目に、自分の濃い色を線の ring 倍の濃さで重ねる（線→薄い線→物の色のグラデーション）。
              // 外側の線の内側＝隣が背景、内側の線の手前側＝隣が自分よりずっと奥
              bool rim = !s0 || !s1 || !s2 || !s3
                      || (s0 && l0 > ld + 2.0 * gap) || (s1 && l1 > ld + 2.0 * gap) || (s2 && l2 > ld + 2.0 * gap) || (s3 && l3 > ld + 2.0 * gap);
              if (rim) c.rgb = mix(c.rgb, selOut(c) * c.a, ring * c.a);   // ring：内側の輪郭の濃さ（輪郭の濃さとは別。2026-10-01）
            }
          } else if (c.a < 0.01) discard;
          // 半透明の物（スカイドーム等）は透明な黒の上に描いたので色に不透明度が掛かっている。割り戻してから重ねる
          // （2026-09-30 ユーザー指摘：全体の時、床の向こうのドームが二重に暗くなり黒い影に見えた）
          gl_FragColor = vec4(c.rgb / max(c.a, 0.0001), c.a);
          gl_FragDepthEXT = d;   // 奏者の深度も書く（本編の物との前後を正しくする）
        }
        void main() { pxoBody(); gl_FragColor.rgb = pxoQuant(gl_FragColor.rgb, lv); gl_FragColor.a = pxoQuantA(gl_FragColor.a, lv); if (gl_FragColor.a <= 0.0) discard; }   // 階調の細かさ（輪郭線の色・透明度にも掛かる）`,
      extensions: { fragDepth: true },
      transparent: true, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, toneMapped: false,
    });
    const scn = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false; scn.add(mesh);
    pix.quad = { scene: scn, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
  }
  // 奏者の部品を PLAYER_LAYER に。pixSkip（足元の光）は入れず本編に残す
  for (const r of pix.roots) r.traverse((o) => { if (o.userData.pixSkip) o.traverse((c) => { c.userData.pixSkipChild = true; c.layers.disable(PLAYER_LAYER); }); else if (!o.userData.pixSkipChild) o.layers.enable(PLAYER_LAYER); });   // 毎フレーム（持ち物の付け替え等で増えた部品にも）
  renderer.getClearColor(_pixClear); const ca = renderer.getClearAlpha();
  renderer.setRenderTarget(pix.rt); renderer.setClearColor(0x000000, 0); renderer.clear();
  // 影はここでは作らない（前のフレームの本編で作った物を使う）。three.js は影を落とす物もこの時の層で選ぶので、
  // ここで作ると範囲から外した物（奏者をオフにした時の奏者など）の影が消えた（2026-10-01 ユーザー指摘）
  camera.layers.set(PLAYER_LAYER);
  const autoShadow0 = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = autoShadow0;
  camera.layers.set(0);
  renderer.setClearColor(_pixClear, ca);
  // 本編では奏者の部品を層 0 から外して描かない（root ごと隠すと足元の光まで消えた。2026-10-01）
  // 本編ではドットにした物の色を書かない（層から外すと影も落とさなくなるので、色だけ止める。奥行きもドットの画像のものを使うので書かない）
  pix.hidden = [];
  for (const r of pix.roots) r.traverse((o) => {
    if (o.userData.pixSkipChild || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.userData.pixHid) continue;
      m.userData.pixHid = { colorWrite: m.colorWrite, depthWrite: m.depthWrite };
      m.colorWrite = false; m.depthWrite = false;
      pix.hidden.push(m);
    }
  });
  return true;
}
// 本編の描画先を消した直後に呼ぶ：奏者のドット絵を書き込み、奏者を隠した本編を上から描く（消さない・影は計算し直さない）
function renderMainWithPixels(renderer, scene, camera) {
  const u = pix.quad.mat.uniforms;
  u.tex.value = pix.rt.texture; u.depth.value = pix.rt.depthTexture;
  u.texel.value.set(1 / pix.rt.width, 1 / pix.rt.height); u.line.value = pix.outline ? Math.max(0, Math.min(1, pix.lineAmt ?? 1)) : 0;
  u.near.value = camera.near; u.far.value = camera.far; u.lineDark.value = Math.max(0, Math.min(1, pix.lineDark ?? 0.35)); u.ring.value = pix.ring ? Math.max(0, Math.min(1, pix.ringAmt ?? 0.5)) : 0; u.outerOff.value = pix.outerOff ? 1 : 0;
  const autoClear = renderer.autoClear, autoShadow = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  renderer.render(pix.quad.scene, pix.quad.cam);
  renderer.render(scene, camera);   // ドットにしなかった物を上から（前後はドットの画像の奥行きで決まる）。影の地図はここで全部の物から作る
  renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = autoShadow;
  for (const m of pix.hidden || []) { m.colorWrite = m.userData.pixHid.colorWrite; m.depthWrite = m.userData.pixHid.depthWrite; delete m.userData.pixHid; }
  pix.hidden = [];
  // 目印の層は毎フレーム外す（2026-10-01 ユーザー指摘：奏者を範囲から外しても PLAYER_LAYER が残り、粗い画像にも描かれて等倍と重なり荒れた）
  for (const r of pix.roots) r.traverse((o) => o.layers.disable(PLAYER_LAYER));
  pix.quad.mat.uniforms.depth.value = null;   // 次のフレームで pix.rt に描く時に同時読みにならないよう外す
}

export function renderFrame(renderer, scene, camera, bloomAll = 0, bloomThr = 0.7) {
  updateModelShadow(renderer, scene);   // 3D モデルの影（奏者に落とす分）を先に描く
  updateHighlight(renderer);            // カードのホバーで輪郭（2026-10-03）
  const sunPass = !!(stageCtx?.sunOnly.visible && stageCtx.bloom.vis > 0.001);
  const pixOn = pixelPass(renderer, scene, camera);
  if (!sunPass && bloomAll <= 0.001) {
    renderer.setRenderTarget(null);
    if (pixOn) { renderer.clear(); renderMainWithPixels(renderer, scene, camera); } else renderer.render(scene, camera);
    return;
  }
  ensurePost(renderer);
  const { el, cloud } = stageCtx.bloom, gain = stageCtx.bloom.gain ?? 1, vis = sunPass ? stageCtx.bloom.vis : 0;
  const hT = Math.min(1, Math.max(0, (el - 3) / 32));
  const high = hT * hT;                                          // 高い太陽ほど眩しく広い（3°→35°、二乗で中間を抑える。16 時台に山ができないよう。2026-09-16 ユーザー指摘）
  const haze = 1 + 0.5 * Math.min(1, cloud / 0.5);               // 薄雲でにじみが広がる
  // 1) 本編 → 等倍 RT（深度付き）
  renderer.setRenderTarget(post.main); renderer.setClearColor(0x000000, 0); renderer.clear();
  if (pixOn) renderMainWithPixels(renderer, scene, camera); else renderer.render(scene, camera);
  // 全体ブルーム（2026-09-17）：本編の明るい部分を抜いて 1/4 RT でぼかす（2 段）。太陽のブルームとは別系統
  const texPerDegAll = post.c.height / (camera.fov || 50);
  if (bloomAll > 0.001) {
    post.quad.material = post.brightMat; post.brightMat.uniforms.tex.value = post.main.texture; post.brightMat.uniforms.thr.value = bloomThr;
    renderer.setRenderTarget(post.c); renderer.clear(); renderer.render(post.quadScene, post.quadCam);
    const sp = 1.2 * (texPerDegAll / 5.4);
    // 天気（雨・雪・雷）を素材へ描き足す：天気の層だけを、本編の深度で隠れた画素を捨てながら
    if (stageCtx.weather.visible && stageCtx.weather.children.length) {
      WEATHER_BLOOM.pass.value = 1; WEATHER_BLOOM.depth.value = post.main.depthTexture; WEATHER_BLOOM.res.value.set(post.c.width, post.c.height);
      const autoClear = renderer.autoClear, autoShadow = renderer.shadowMap.autoUpdate;
      renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
      camera.layers.set(WEATHER_LAYER);
      renderer.setRenderTarget(post.c); renderer.render(scene, camera);
      camera.layers.set(0);
      renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = autoShadow;
      // 深度の参照は必ず外す：持たせたままだと、次のフレームで本編（post.main）を描く時に
      // 「描き込み先の深度テクスチャを同時に読む」状態になり、WebGL が INVALID_OPERATION を出す
      WEATHER_BLOOM.pass.value = 0; WEATHER_BLOOM.depth.value = null;
    }
    // 金属（金管・シンバル類等）を、全体より**低い閾値**でブルームの素材へ描き足す（2026-09-23 ユーザー指定）。
    // 全体の閾値を下げると画面全部が光るので、金属だけ別の閾値で抜く。天気と同じ作り（専用レイヤー＋深度で遮蔽を捨てる）
    if (METAL_BLOOM.thr.value < 1) {
      METAL_BLOOM.pass.value = 1; METAL_BLOOM.depth.value = post.main.depthTexture; METAL_BLOOM.res.value.set(post.c.width, post.c.height);
      const autoClear = renderer.autoClear, autoShadow = renderer.shadowMap.autoUpdate;
      renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
      camera.layers.set(METAL_LAYER);
      if (pixOn && pix.on && pix.metalPix) {   // 金属（楽器）は奏者がドットの時だけ粗く
        // ドット化の時（2026-10-01 ユーザー指定：金属のブルームもドットの形に）：素材をドット化と同じ粗い解像度で描き、補間なしで post.c へ写す
        const w = pix.rt.width, h = pix.rt.height;
        if (!pix.metalRt || pix.metalRt.width !== w || pix.metalRt.height !== h) {
          pix.metalRt?.dispose();
          pix.metalRt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
        }
        METAL_BLOOM.res.value.set(w, h);
        renderer.setRenderTarget(pix.metalRt); renderer.setClearColor(0x000000, 0); renderer.clear();
        renderer.render(scene, camera);
        if (!pix.metalCopy) pix.metalCopy = new THREE.ShaderMaterial({
          uniforms: { tex: { value: null } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main() { vec4 c = texture2D(tex, vUv); if (c.a < 0.5) discard; gl_FragColor = c; }',   // 金属の画素だけ上書き（元の作りと同じ）
          depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
        });
        pix.metalCopy.uniforms.tex.value = pix.metalRt.texture;
        camera.layers.set(0);
        const prevMat = post.quad.material; post.quad.material = pix.metalCopy;
        renderer.setRenderTarget(post.c); renderer.render(post.quadScene, post.quadCam);
        post.quad.material = prevMat;
      } else {
        renderer.setRenderTarget(post.c); renderer.render(scene, camera);
      }
      camera.layers.set(0);
      renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = autoShadow;
      // 深度の参照は必ず外す（天気と同じ理由：次のフレームで post.main を描く時に同時読みになる）
      METAL_BLOOM.pass.value = 0; METAL_BLOOM.depth.value = null;
    }
    blurPass(renderer, post.c, post.d, 1, 0, sp); blurPass(renderer, post.d, post.c, 0, 1, sp);
    blurPass(renderer, post.c, post.d, 1, 0, 3 * sp); blurPass(renderer, post.d, post.c, 0, 1, 3 * sp);
  }
  // 2) 太陽の円盤だけ → 1/4 RT。本編の深度で隠れた画素は捨てる
  const u = stageCtx.sunOnly.material.uniforms;
  u.sceneDepth.value = post.main.depthTexture; u.resolution.value.set(post.a.width, post.a.height);
  u.gain.value = 1;                                              // 増幅は合成時（ぼかしの後）に掛ける
  renderer.setRenderTarget(post.a); renderer.clear();
  if (sunPass) {
    camera.layers.set(1);
    const autoShadow = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;   // 影の再計算は本編だけ
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = autoShadow;
    camera.layers.set(0);
  }
  // 3) ガウスぼかし（縦横 × 2 反復。2 回目は歩幅を広げて裾を伸ばす）
  // ぼかしの幅は角度で決める（2026-09-16 ユーザー指摘：ピクセル固定だとブラウザが大きいほどブルームが大きく見えた）。
  // 基準は高さ 1080 px（1/4 で 270）・画角 50° → 1° あたり 5.4 テクセル。歩幅をこれに比例させる
  const texPerDeg = post.a.height / (camera.fov || 50);
  const spread = (0.4 + 3.2 * high) * haze * (texPerDeg / 5.4) * (0.7 + 0.3 * Math.min(2, gain));   // 高い太陽の面積を増やす（2.0→3.2。2026-09-17 ユーザー指定）   // 眩しさで広がりも少し増える
  for (const step of [1.0, 2.5, 6.0]) {   // 3 段：芯の周り → 中間 → 広い裾
    blurPass(renderer, post.a, post.b, 1, 0, step * spread);
    blurPass(renderer, post.b, post.a, 0, 1, step * spread);
  }
  // 見えている割合（2026-09-17）：ぼかし済みの太陽中心 1 画素 ÷ 隠れていない時の理論値（半径 r・ガウス σ の円盤の中心値 1 − exp(−r²/2σ²)）
  const sunDir = stageCtx.sky.material.uniforms.sunDir.value;
  post.sunNdc.copy(camera.position).addScaledVector(sunDir, 100).project(camera);
  const behind = post.sunNdc.z > 1 || sunDir.dot(camera.getWorldDirection(_flareTmp)) < 0;
  let frac = 0;
  const sx = (post.sunNdc.x + 1) / 2, sy = (post.sunNdc.y + 1) / 2;
  if (!behind && sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1) {
    // 1×1 の 8bit RT に太陽中心の値を写して読む（浮動小数 RT を直接読まない）
    post.quad.material = post.probeMat;
    post.probeMat.uniforms.tex.value = post.a.texture; post.probeMat.uniforms.uv.value.set(sx, sy);
    renderer.setRenderTarget(post.probe); renderer.render(post.quadScene, post.quadCam);
    renderer.readRenderTargetPixels(post.probe, 0, 0, 1, 1, post.px8);
    const v = Math.max(post.px8[0], post.px8[1], post.px8[2]) / 255;
    const su = stageCtx.sky.material.uniforms, sc = su.sunCol.value, cmax = Math.max(sc.r, sc.g, sc.b, 1e-3);
    const rTex = su.sunRad.value * texPerDeg;                                   // 円盤の半径 [texel]
    const sigma = 3 * spread * Math.sqrt(1 + 2.5 * 2.5 + 6 * 6);                 // 3 段のガウスの合成 σ [texel]（13 タップ ≈ σ 3）
    const expected = 1 - Math.exp(-(rTex * rTex) / (2 * sigma * sigma));
    frac = Math.min(1, Math.max(0, (v / cmax) / Math.max(1e-4, expected) / Math.max(0.05, vis)));
  }
  // 4) 本編を 1:1 転写しつつ加算
  post.quad.material = post.compMat;
  post.compMat.uniforms.mainTex.value = post.main.texture;
  post.compMat.uniforms.bloom.value = post.a.texture;
  post.compMat.uniforms.bloomAll.value = post.c.texture;
  post.compMat.uniforms.strengthAll.value = bloomAll > 0.001 ? 1.6 * bloomAll : 0;
  post.compMat.uniforms.strength.value = vis * (0.5 + 14.0 * high) * renderer.toneMappingExposure * gain;   // 高い太陽ほど強く（8.5→14。夕日は下限 0.5 のまま。2026-09-17 ユーザー指定）
  // 光のかぶり：太陽の画面位置を中心に。高い太陽ほど強く、夕日は弱い。隠れている割合で消える
  const cu = post.compMat.uniforms;
  cu.sunUv.value.set((post.sunNdc.x + 1) / 2, (post.sunNdc.y + 1) / 2);
  cu.aspect.value = post.main.width / post.main.height;
  cu.veil.value = behind ? 0 : 0.18 * vis * frac * (0.25 + 0.75 * high) * gain * renderer.toneMappingExposure;   // 眩しさ 2 で太陽の周りが +50%、画面の遠い所で +5〜10%
  cu.veilR.value = 0.06 + 0.04 * Math.min(2, gain);
  cu.veilCol.value.copy(stageCtx.sky.material.uniforms.sunCol.value).lerp(SUN_WHITE, 0.6);
  // 光条は夕方に向かって薄れて消える（高さの係数 high に下限を設けず、高度 20° 以下でさらに減らす。2026-09-17 ユーザー指定）
  const lowFade = Math.min(1, Math.max(0, el / 20));
  cu.streak.value = behind ? 0 : 0.6 * vis * frac * high * lowFade * gain * renderer.toneMappingExposure;   // 眩しさに対して半分の効き（値 2 で旧 1。2026-09-17 ユーザー指定）
  cu.streakL.value = 0.11 + 0.035 * Math.min(2, gain);   // 到達距離：眩しさに対して半分の効き（値 2 で旧 1）
  // 光条の回転：太陽の画面位置（中心からのずれ）とカメラの方位から。パンで回り、周回でも回る
  const camYaw = Math.atan2(_flareTmp.x, _flareTmp.z);   // _flareTmp はカメラの向き（上で取得）
  cu.rayRot.value = 0.9 * (cu.sunUv.value.x - 0.5) + 0.5 * (cu.sunUv.value.y - 0.5) + 0.35 * camYaw;   // ぼかしで薄まった分を増幅。芯は白く飽和する。夕日（high 0）はほぼ無し。露出も掛ける
  renderer.setRenderTarget(null); renderer.clear();
  renderer.render(post.quadScene, post.quadCam);
}

export function setShadows(o = {}) {
  if (!stageCtx) return;
  const { hemi, amb, spots, sun } = stageCtx;
  // 光源の使用／不使用（環境と独立。併用可。2026-09-17 ユーザー指定）：太陽・月は屋外のときだけ
  const outdoorNow = (o.mode || lightState.mode) === 'sun';
  const useSun = outdoorNow && o.sunOn !== false, useSpot = o.spotOn !== false;
  for (const sp of spots) sp.visible = useSpot;
  sun.visible = useSun;
  stageCtx.sunOnly.visible = useSun;
  if (o.mode && o.mode !== lightState.mode) {
    lightState.mode = o.mode;
    const outdoor = o.mode === 'sun';
    stageCtx.sky.visible = outdoor;
    if (!outdoor) { hemi.color.set(HEMI_SKY_INDOOR); hemi.groundColor.set(HEMI_GROUND_INDOOR); }
  }
  if (o.enabled !== undefined && o.enabled !== lightState.enabled) {
    lightState.enabled = !!o.enabled;
    for (const sp of spots) sp.castShadow = lightState.enabled;
    sun.castShadow = lightState.enabled;
  }
  if (Number.isFinite(o.ambient)) {
    if (lightState.mode !== 'sun') { hemi.intensity = o.ambient; amb.intensity = 0; }   // 屋内：半球光（上白・下茶）が環境光
    else amb.intensity = 0.25 * o.ambient;                                            // 屋外：天空光に少し足す（周囲からの跳ね返り相当）
  }
  if (lightState.mode === 'sun') {
    let sunI = o.sun, sunT = o.sunTemp, sunAz = o.sunAzimuth, sunEl = o.sunElev, sky = o.sunAmbient;
    let mAz = o.moonAzimuth, mEl = o.moonElev, mK = o.moonBright;   // 月：方角・高度・照らされている割合（手動）
    const cloud = o.sunAuto ? o.sunAuto.cloud : 0;
    if (o.sunAuto) {   // 時刻・天気・舞台の向き・月齢から決める（手動でない時）
      const a = sunFromTime(o.sunAuto.hour, o.sunAuto.cloud, o.sunAuto.facing, o.sunAuto.moonAge);
      sunI = a.intensity; sunT = a.temp; sunAz = a.azimuth; sunEl = a.elev; sky = a.skyLight;
      mAz = a.moonAzimuth; mEl = a.moonElev; mK = a.moonK;
    }
    if (Number.isFinite(sky)) hemi.intensity = sky;   // 天空光。屋外の環境光はこれ（屋内の「環境光」とは別の値）
    const sunElNow = Number.isFinite(sunEl) ? sunEl : lightState.sunEl;
    // 夜（太陽が −6° 以下＝市民薄明の終わり）は月が光源になる（2026-09-16 ユーザー指定）。
    // 満月・南中・快晴の月光を「目が慣れた状態」として昼の約 25% の強さ・青白（プルキンエ現象）で描く。40 万倍の差は表示できない
    const night = Number.isFinite(sunElNow) && sunElNow <= -6;
    const moonUp = Number.isFinite(mEl) ? Math.max(0, Math.sin(deg(mEl))) : 0;
    const moonI = night && Number.isFinite(mK) ? 0.4 * mK * mK * mK * Math.pow(moonUp, 0.35) * (1 - cloud) * (1 - cloud) : 0;
    const srcAz = night ? mAz : sunAz, srcEl = night ? mEl : sunEl;
    const elNow = Number.isFinite(srcEl) ? srcEl : lightState.sunEl;
    if (night) sun.intensity = moonI;
    else if (Number.isFinite(sunI)) sun.intensity = (Number.isFinite(elNow) && elNow <= 0) ? 0 : sunI;   // 地平線下なら直射なし（手動でも物理どおり）
    sun.castShadow = lightState.enabled && sun.intensity > 0.03;   // 直射が消えたら影も消す（曇天・日没後・新月）
    if (night) { if (lightState.sunTemp !== 'moon') { lightState.sunTemp = 'moon'; sun.color.copy(MOON_COL); } }
    else if (Number.isFinite(sunT) && sunT !== lightState.sunTemp) { lightState.sunTemp = sunT; sun.color.copy(sunColorOf(sunT)); }
    if (o.skyTint === false) hemi.color.setRGB(1, 1, 1);   // 空の色を光に乗せない（2026-09-16 ユーザー指定のチェック）
    else if (night) hemi.color.setRGB(1, 1, 1);   // 月夜の天空光は無色（青は乗せない。2026-09-16 ユーザー指示「夕方の黄色だけ」）
    else if (Number.isFinite(sunElNow)) hemi.color.copy(skyLightColorOf(horizonGlowColorFromTime(sunElNow, cloud)));   // 色相は太陽側の地平線（夕焼け）から。青は乗せない
    stageCtx.moonState = { az: mAz, el: mEl, k: mK, sunEl: sunElNow, cloud };
    if (o.groundColor) hemi.groundColor.set(o.groundColor);
    else if (stageCtx.groundTex?.avgColor) {
      // 床（板目／草原）の平均色 × 照り返しの倍率（2026-09-16 ユーザー指定：物理に寄せる）。
      // 地面に当たる光 = 直射の水平面照度（強さ × sin 高度）+ 天空光。天空光と同じ強さで下から当てるので、
      // 平均色（反射率を含む）に「(直射 + 天空光) ÷ 天空光」を掛ける。曇天・日没後は 1 倍（平均色そのもの）
      // 平均色の明るさは絵の都合（0.5 前後）なので、実測の反射率（草 0.22・板 0.30）に正規化してから掛ける（2026-09-16 ユーザー指摘：緑が勝ちすぎ）
      const elForBounce = Number.isFinite(elNow) ? elNow : 0;
      const direct = sun.intensity * Math.max(0, Math.sin(deg(elForBounce)));
      // 自己遮蔽：奏者の足元の地面は本人や周りの影の中なので、照り返しの元になる日向の草は一部だけ（2026-09-16 ユーザー指摘）。
      // 直射ぶんにだけ 0.35 を掛ける（天空光で照らされた分は影の中でも同じなのでそのまま）
      const bounce = Math.min(5, 1 + GROUND_OCCLUSION * direct / Math.max(0.05, hemi.intensity));
      const avg = stageCtx.groundTex.avgColor, lum = 0.2126 * avg.r + 0.7152 * avg.g + 0.0722 * avg.b;
      const albedo = stageCtx.groundTex.albedo ?? 0.25;
      hemi.groundColor.copy(avg).multiplyScalar((lum > 0.01 ? albedo / lum : 1) * bounce);
      if (o.groundBounce === false) hemi.groundColor.setScalar(albedo * bounce);   // 色を乗せない：同じ明るさの無彩色（2026-09-16 ユーザー指定のチェック）
      if (o.groundBounceOn === false) hemi.groundColor.setScalar(0);              // 照り返し自体を無くす（下から当たる光ゼロ。2026-09-16）
    }
    // 平行光の位置は「有効な光源」（昼は太陽・夜は月）の方角・高度から
    const az = Number.isFinite(srcAz) ? srcAz : lightState.sunAz, elSrc = Number.isFinite(srcEl) ? srcEl : lightState.sunEl;
    if (Number.isFinite(az) && Number.isFinite(elSrc) && (az !== lightState.sunAz || elSrc !== lightState.sunEl)) {
      lightState.sunAz = az; lightState.sunEl = elSrc;
      const a = deg(az), e = deg(elSrc);
      // 方角 0 = 客席側（+z）から。客席から見て右（+x）が 90。舞台中心 (0,0,-12) を向く
      sun.position.set(SUN_R * Math.cos(e) * Math.sin(a), SUN_R * Math.sin(e), -12 + SUN_R * Math.cos(e) * Math.cos(a));
    }
    // 太陽の円盤の向き（光源が月でも太陽の位置は太陽のまま）
    const el = Number.isFinite(sunEl) ? sunEl : sunElNow;
    if (Number.isFinite(sunAz) && Number.isFinite(el)) {
      const a = deg(sunAz), e = deg(el);
      stageCtx.sky.material.uniforms.sunDir.value.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    }
    // 太陽側の低い空の色（夕焼け）。反対側の色は CSS の地平線の色が担う。曇天では両方灰色になって差が消える
    if (Number.isFinite(el)) {
      const u = stageCtx.sky.material.uniforms;
      // 層の色：高度 14° 以上は暖かい黄（昼のパレットは青なので使わない）、8°→14° で夕焼けのパレットからつなぐ（2026-09-17 ユーザー指定：高い太陽にも黄色い光を残す）
      if (o.sunAuto) {
        _glowTmp.set(horizonGlowColorFromTime(el, cloud));
        const warmT = Math.min(1, Math.max(0, (el - 8) / 6));
        u.glowColor.value.copy(_glowTmp).lerp(GLOW_HIGH, warmT);
      } else if (o.horizonHex) {
        u.glowColor.value.set(o.horizonHex);   // 手動：選んだ「地平線の色」で広げる（計算色を塗ると選んだ色が出ない。2026-09-17 ユーザー指定で層は残す）
      }
      // 量：出始め 20°・二乗でなだらか（急に現れて大きく見えないよう）。高い太陽でも下限 0.3 を残す（黄色い周囲の光）。手動も同じ
      const gT = Math.min(1, Math.max(0, (20 - el) / 20));
      u.glowAmt.value = Math.max(0.3, gT * gT);
      u.flip.value = o.bgFlip ? 1 : 0;
      if (Number.isFinite(o.skyGlowSpread)) u.spread.value = o.skyGlowSpread;
      if (Number.isFinite(o.starTwinkle)) u.twinkle.value = o.starTwinkle;
      // 太陽そのもの：地平線下では消す。雲で薄れる（(1−雲量)²）。色は直射の色
      // 17:00（高度 12°）まではほぼ据え置き（0.8° → 1.0°）、夕焼けが色づいてから 2.4° へ育つ（2026-09-17 ユーザー指定）
      const pre = Math.min(1, Math.max(0, (25 - el) / 13)), post = Math.min(1, Math.max(0, (12 - el) / 12));
      u.sunRad.value = 0.8 + 0.2 * pre + 1.4 * post;
      u.sunVis.value = (useSun && el > -(u.sunRad.value + 0.5 + stageCtx.bloom.dip)) ? (1 - cloud) * (1 - cloud) : 0;   // 円盤の上端が床の縁に隠れるまで見える（半分沈む）。太陽・月オフなら無し
      // 円盤の色：高度 20° 以上は直射の色を白へ半分寄せた色、地平線に向かって実際の夕日の赤橙へ（2026-09-16 ユーザー指定）
      const lowT = Math.min(1, Math.max(0, el / 20));
      u.sunCol.value.copy(SUN_SET_RED).lerp(_sunHigh.copy(sun.color).lerp(SUN_WHITE, 0.5), lowT);
      // にじみは高い太陽だけ（5° 以下で 0、20° で最大）。夕日は大気減衰でギラつかず円盤がそのまま見える
      u.aureole.value = 0;   // 空の球側のにじみは使わない（眩しさは renderFrame の選択的ブルームが担う。2026-09-16）
      // 月の円盤（2026-09-16 ユーザー指定）：太陽が地平線下の間だけ見せる（−0〜−6° で現れる）。欠け方は太陽の方向から
      if (Number.isFinite(mAz) && Number.isFinite(mEl)) {
        const ma = deg(mAz), me = deg(mEl);
        u.moonDir.value.set(Math.cos(me) * Math.sin(ma), Math.sin(me), Math.cos(me) * Math.cos(ma));
        // 欠けの向き：月から見た太陽の方向を、月の位置での接平面に射影した単位ベクトル。直交ベクトルも
        const sd = u.sunDir.value, md = u.moonDir.value;
        _mU.copy(sd).addScaledVector(md, -sd.dot(md));
        if (_mU.lengthSq() < 1e-6) _mU.set(1, 0, 0); else _mU.normalize();
        _mV.crossVectors(md, _mU).normalize();
        u.moonU.value.copy(_mU); u.moonV.value.copy(_mV);
        u.moonK.value = Number.isFinite(mK) ? mK : 1;
        const dusk = Math.min(1, Math.max(0, -el / 6));
        u.moonVis.value = (useSun && mEl > -(u.moonRad.value + 0.5 + stageCtx.bloom.dip)) ? dusk * (1 - cloud) * (1 - cloud) : 0;
      } else u.moonVis.value = 0;
      // 星：太陽が −6° を過ぎてから −15° にかけて現れる。雲で隠れる。極軸は北（舞台基準の方角 = 舞台の向き）・仰角 = 緯度、回転は時角
      const facing = o.sunAuto ? o.sunAuto.facing : (Number.isFinite(o.stageFacing) ? o.stageFacing : 180);
      const hourForStars = o.sunAuto ? o.sunAuto.hour : (Number.isFinite(o.hour) ? o.hour : 12);
      u.starVis.value = Math.min(1, Math.max(0, (-el - 6) / 9)) * (1 - cloud) * (1 - cloud);
      const pa = deg(facing);
      u.poleAxis.value.set(Math.cos(LAT) * Math.sin(pa), Math.sin(LAT), Math.cos(LAT) * Math.cos(pa));
      u.starRot.value = deg((hourForStars - 12) * 15);
      stageCtx.bloom.el = el; stageCtx.bloom.cloud = cloud; stageCtx.bloom.vis = Math.max(u.sunVis.value, 0.6 * u.moonVis.value * u.moonK.value);
      stageCtx.bloom.gain = Number.isFinite(o.sunBloom) ? o.sunBloom : 1;   // 「太陽の眩しさ」スライダー（2026-09-17）
      u.haloAmt.value = Math.min(1, stageCtx.bloom.gain);
    }
  }
  if (Number.isFinite(o.spot)) for (const sp of spots) sp.intensity = o.spot;
  if (Number.isFinite(o.spotCone) && o.spotCone !== lightState.cone) { lightState.cone = o.spotCone; for (const sp of spots) sp.angle = deg(o.spotCone); }
  if (Number.isFinite(o.spotBlur) && o.spotBlur !== lightState.blur) { lightState.blur = o.spotBlur; for (const sp of spots) sp.penumbra = o.spotBlur; } // 輪郭のぼけ（2026-09-12 ユーザー指定）
  const elev = Number.isFinite(o.spotElev) ? o.spotElev : lightState.elev, spread = Number.isFinite(o.spotSpread) ? o.spotSpread : lightState.spread;
  if (Number.isFinite(elev) && Number.isFinite(spread) && (elev !== lightState.elev || spread !== lightState.spread)) {
    lightState.elev = elev; lightState.spread = spread;
    const e = deg(elev), a = deg(spread);
    for (const sp of spots) sp.position.set(sp.userData.side * SPOT_R * Math.cos(e) * Math.sin(a), SPOT_R * Math.sin(e), -12 + SPOT_R * Math.cos(e) * Math.cos(a));
  }
  updateDomeLight();
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

/** 床の厚み（2026-09-17 ユーザー指定）：床の外周（前・左右・奥の弧）に、ひな壇の 1 段目と同じ高さ・同じ側面の絵の壁を付ける。天面は y=0 のまま */
export function buildFloorSkirt() {
  if (!stageCtx) return;
  const { skirt, stageMat } = stageCtx;
  skirt.traverse((o) => { o.geometry?.dispose?.(); if (o.material) { stageMats.delete(o.material); if (o.material.map?.__disposable) o.material.map.dispose(); o.material.dispose(); } });
  skirt.clear();
  const h = ROWS.woodwind.h;                                  // 1 段目と同じ高さ
  const X = FLOOR_X_HALF, F = FLOOR_Z_FRONT, R = FLOOR_BACK_R, cy = -SEAT_SHIFT_Z;
  const yEdge = cy + Math.sqrt(Math.max(0, R * R - X * X)); // 左右の辺と弧が交わる位置（shape 座標。世界の z = −yEdge）
  const mat = (uLen) => stageMat({ ...wallSkin(uLen, h, '#5f4c2f'), side: THREE.DoubleSide });
  const add = (mesh) => { mesh.receiveShadow = true; mesh.renderOrder = -41; skirt.add(mesh); };
  // 前（z = +F、+z を向く）
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, h), mat(2 * X));
  front.position.set(0, -h / 2, F); add(front);
  // 左右（x = ±X、外向き）。z は +F 〜 −yEdge
  const sideLen = F + yEdge;
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sideLen, h), mat(sideLen));
    m.position.set(sgn * X, -h / 2, (F - yEdge) / 2);
    m.rotation.y = sgn * Math.PI / 2;
    add(m);
  }
  // 奥の弧（中心 (0, SEAT_SHIFT_Z)・半径 R）。ひな壇の壁と同じく CylinderGeometry の角 φ = π − θ（θ は −z から）
  const thE = Math.atan2(X, yEdge - cy);
  const segs = Math.max(8, Math.ceil((2 * thE) / deg(4)));
  const back = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, segs, 1, true, Math.PI - thE, 2 * thE), mat(R * 2 * thE));
  back.position.set(0, -h / 2, SEAT_SHIFT_Z); add(back);
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
    const rIn = row.r - (row.half ?? RISER_HALF), rOut = row.r + (row.half ?? RISER_HALF);
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
    // 左右対称にする（片側だけ広いと舞台らしくない）。ただし木管を右へずらした時（seats.asym）は奏者の範囲そのまま
    if (fam && seats.asym?.has(fam)) { thMin -= RISER_MARGIN; thMax += RISER_MARGIN; }
    else { const half = Math.max(Math.abs(thMin), Math.abs(thMax)) + RISER_MARGIN; thMin = -half; thMax = half; }
    const segs = Math.max(8, Math.ceil((thMax - thMin) / deg(4)));
    // clipX 指定の段は x = ±clipX の垂直面で切る。扇の弧は clipX の外まで作っておき、はみ出しをクリップで落とす
    const cx = row.clipX;
    const clip = cx ? [new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx), new THREE.Plane(new THREE.Vector3(1, 0, 0), cx)] : null;
    const matC = (o) => { const m = stageMat(o); if (clip) m.clippingPlanes = clip; return m; };

    // 天面：RingGeometry の角 a と世界角 θ（-z から）は a = π/2 - θ（rotation.x = -π/2 のため）
    const top = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, segs, 1, Math.PI / 2 - thMax, thMax - thMin), matC({ map: ringMapOf(groundTex, rOut), color: col }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = row.h;
    top.renderOrder = ro + 0.2; top.receiveShadow = true; risers.add(top);      // 同じ段では 壁 → 側面 → 天面 → 縁 の順
    // 前面（内径側の壁）：CylinderGeometry の角 φ は φ = π - θ
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(rIn, rIn, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      matC({ ...wallSkin(rIn * (thMax - thMin), row.h, '#5f4c2f'), side: THREE.DoubleSide }),
    );
    front.position.y = row.h / 2;
    front.renderOrder = ro; front.receiveShadow = true; risers.add(front);
    // 背面（外径側の壁）：後ろから見た時に中が見えないように（2026-09-10 ユーザー指摘）
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(rOut, rOut, row.h, segs, 1, true, Math.PI - thMax, thMax - thMin),
      matC({ ...wallSkin(rOut * (thMax - thMin), row.h, '#58452a'), side: THREE.DoubleSide }),
    );
    back.position.y = row.h / 2;
    back.renderOrder = ro; back.receiveShadow = true; risers.add(back);
    // 両端の側面。clipX 指定なら x = ±clipX の垂直な切り口（内径・外径との交点で幅が決まる）、
    // そうでなければ従来どおり扇の切り口
    if (cx) {
      const z1 = -Math.sqrt(Math.max(0, rIn * rIn - cx * cx));   // 内径との交点
      const z2 = -Math.sqrt(Math.max(0, rOut * rOut - cx * cx)); // 外径との交点
      for (const sx of [-cx, cx]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(z2 - z1), row.h), stageMat({ ...wallSkin(Math.abs(z2 - z1), row.h, '#514026'), side: THREE.DoubleSide }));
        side.position.set(sx, row.h / 2, (z1 + z2) / 2);
        side.rotation.y = Math.PI / 2;                            // 面の法線を x 方向へ
        side.renderOrder = ro + 0.1; risers.add(side);
      }
    } else {
      for (const th of [thMin, thMax]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(rOut - rIn, row.h), stageMat({ ...wallSkin(rOut - rIn, row.h, '#514026'), side: THREE.DoubleSide }));
        const rm = (rIn + rOut) / 2;
        side.position.set(rm * Math.sin(th), row.h / 2, -rm * Math.cos(th));
        side.rotation.y = -th + Math.PI / 2; // 面の法線を接線方向へ
        side.renderOrder = ro + 0.1; risers.add(side);
      }
    }
    // 段の縁（見切り線）：Torus は rotation.z で開始角を回す（Euler XYZ では z が先に掛かる）
    // 段の縁の色は天面の地面に合わせる（草原なら草と同じ黄緑、板目なら土色）。2026-09-13 ユーザー指定
    // 天面は「地面の絵 × col（奥の段ほど少し暗い灰）」なので、縁も同じ col を掛けて段ごとの明るさを揃える
    // 深緑の草原も草の色に（それぞれの色セットの LIGHT。2026-09-17 ユーザー指定）
    const rimBase = stageCtx.groundTex === stageCtx.grassTex ? GRASS_PALETTES.normal.LIGHT
      : stageCtx.groundTex === stageCtx.grassDarkTex ? GRASS_PALETTES.dark.LIGHT : '#b08a55';
    const rimCol = new THREE.Color(rimBase).multiply(new THREE.Color(col));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.07, 6, segs * 2, thMax - thMin), matC({ color: rimCol }));
    rim.rotation.x = -Math.PI / 2; rim.rotation.z = Math.PI / 2 - thMax; rim.position.y = row.h + 0.01;
    rim.renderOrder = ro + 0.3; risers.add(rim);

    // スクリーンを立てる段なら、その寸法を控えておく（スクリーン自体は buildScreens が作る）
    if (row.screen) stageCtx.screenBase = { rIn, rOut, y: row.h, thMin, thMax, segs, clip, cx, ro };
  }
  buildScreens();   // 土台の寸法が変わるので組み直す
}

// ---- スカイドーム（遠景。3 層固定。2026-09-13 ユーザー指定）----
// ひな壇の弧とは無関係に、舞台をぐるりと覆う半球の一部（既定は半円 = 180°）。
// 素材は横に繰り返して流せるので、雲を層ごとに違う速さで動かすと奥行きが出る
export const DOME_DEFAULT = [
  { name: '遠景', r: 46, y: -10, span: 180, tiles: 3, speed: 0, opacity: 1, show: true, src: '', srcRaw: '', key: '#00ff00', thr: 0, flip: false, fade: 0.12 },
  { name: '中景', r: 38, y: -10, span: 180, tiles: 2, speed: 0, opacity: 1, show: true, src: '', srcRaw: '', key: '#00ff00', thr: 0, flip: false, fade: 0.12 },
  { name: '近景', r: 30, y: -10, span: 180, tiles: 1, speed: 0, opacity: 1, show: true, src: '', srcRaw: '', key: '#00ff00', thr: 0, flip: false, fade: 0.12 },
];
let domeList = DOME_DEFAULT.map((o) => ({ ...o }));

/** スカイドームの構成を差し替えて組み直す */
// ---- 床に置く 3D モデル（GLB。2026-10-01 ユーザー指定：樹木などを床に置く）----
// 1 件 = { src（media/… の URL）, x, z（床の上の位置 [unit]）, y（床からの高さ）, rot（向き [度]）, scale（大きさの倍率）, texPix（テクスチャの粗さ 0〜1）, show }。
// GLB はメートル単位・Y 上・原点が根元の想定。MODEL_M で舞台の単位に直す（立った指揮者 ≒ 3.35 unit を背丈 1.7m とみると 1m ≒ 2 unit）。
// 楽器と同じく実物の 1.25 倍にそろえて 2.5（2026-10-02 ユーザー指定：実寸のままだと、大きめに作った楽器・奏者の中で木が小さく見えた）
const MODEL_M = 2.5;
let modelList = [];
const GLB = new Map();   // url → { scene, err, loading }
export function setModels(list) { modelList = (list || []).map((o) => ({ ...o })); buildModels(); }
function loadGlb(url) {
  let e = GLB.get(url);
  if (e) return e;
  e = { scene: null, err: null, loading: true };
  GLB.set(url, e);
  if (!THREE.GLTFLoader) { e.err = 'GLTFLoader が読み込めていません'; e.loading = false; return e; }
  new THREE.GLTFLoader().load(url, (g) => {
    e.scene = g.scene; e.loading = false;
    // 材質は Lambert に置き換える（2026-10-01 ユーザー指摘：光を受けていないように見えた）。GLB の PBR 材質は金属度 1 のことがあり、
    // 環境マップの無いこの舞台では直接の光で明るさが変わらなかった。奏者・舞台と同じ Lambert なら時刻・照明に同じように反応する
    const conv = new Map();
    e.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      // テクスチャは舞台と同じ「そのままの値」で扱う。GLTFLoader は sRGB の印を付けるが、この舞台は出力をリニアのまま出すので
      // 中間の明るさが沈み、葉が黒く見えた（2026-10-01）
      const raw = (t) => { if (t && t.encoding !== THREE.LinearEncoding) { t.encoding = THREE.LinearEncoding; t.needsUpdate = true; } return t; };
      const toLambert = (m) => {
        if (!m || m.isMeshLambertMaterial) return m;
        raw(m.map); raw(m.emissiveMap);
        if (!conv.has(m)) conv.set(m, new THREE.MeshLambertMaterial({
          map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, vertexColors: !!m.vertexColors,
          emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveMap: m.emissiveMap || null,
          transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest || 0, side: m.side ?? THREE.FrontSide,
        }));
        conv.get(m).userData = { ...m.userData };   // GLB の印（verdantMaterial：幹・葉など）を風の判定に使う
        plantMat(conv.get(m));
        return conv.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(toLambert) : toLambert(o.material);
    });
    e.wind = windInfo(e.scene);
    buildModels();
    buildStones();
    buildGrass();
    e.waiters?.splice(0).forEach((f) => f());
  }, undefined, (err) => { e.err = err?.message || String(err); e.loading = false; e.waiters = null; console.warn('[models] GLB を読めません:', url, e.err); });
  return e;
}
// ---- 植物の明るさ（2026-10-03 ユーザー指定）----
// 植物（VERDANT の印のある幹・葉など。岩は含まない）の色に倍率を掛ける。葉は向きがばらばらで、樹冠の内側は葉どうしの影に入り、
// 裏から透ける光も無いので、同じ太陽の下でも岩より暗く見える。その分を持ち上げるための倍率。
// 材質は粗さ・風で複製されるので、作った複製を全部控えておき、元の色 × 倍率を入れ直す（色だけなので作り直しは要らない）
const PLANT_MATS = new Set();
let plantK = 1;
function plantMat(m) {
  const kind = m?.userData?.verdantMaterial;
  if (!kind || WIND_STATIC.has(kind) || !m.color) return m;
  m.userData.pxoBase ??= m.color.toArray();   // 複製は元の色（倍率を掛ける前）を userData ごと引き継ぐ
  m.color.fromArray(m.userData.pxoBase).multiplyScalar(plantK);
  PLANT_MATS.add(m);
  return m;
}
/** 植物の明るさの倍率（1 で GLB のまま） */
export function setPlantBrightness(k) {
  k = Number.isFinite(k) ? Math.max(0, k) : 1;
  if (k === plantK) return;
  plantK = k;
  for (const m of PLANT_MATS) m.color.fromArray(m.userData.pxoBase).multiplyScalar(k);
}
// ---- 3D モデルの風（2026-10-02 ユーザー指定）----
// FABOTANIC（VERDANT）の書き出し ZIP に付く src/VerdantVegetation.js（MIT。AMIX｜トミナガハルキ）の「高さで曲げる」風を r128 用に移した。
// GLB は静止したまま、描く時に頂点を風下へずらす：ずらす量は（高さ ÷ 木の高さ）の 2 乗に比例し、上ほど遅れて揺れる（しなりが上へ伝わる）。
// 2 つの波を重ね（2 つ目が突風）、木の位置で位相をずらす。面の向きも傾けて陰影を合わせ、影用の描き方にも同じずらしを入れる。
// 揺らすのは GLB に VERDANT の印（ノードの extras.verdant と材質の extras.verdantMaterial）がある植物だけ（岩などは揺らさない）。
// 時刻は曲と合わせず実時間で進める（曲を止めても揺れる。2026-10-02 ユーザー指定）
const WIND_STATIC = new Set(['soil', 'stone', 'moss', 'litter', 'succulent', 'hardLeaf', 'lowpolyGround', 'impostor']);   // 揺らさない材質（元のコードと同じ）
// 種類ごとの揺れ方（しなり flex・周期 freq・上への遅れ lag）。ZIP の manifest.json の windProfiles をそのまま写した
const WIND_PROFILES = {
  cactuscolumn: [0, 1, 0], cactuspad: [0, 1, 0], palmpinnate: [0.34, 0.78, 0.78], palmfan: [0.38, 0.74, 0.82], cycad: [0.14, 0.68, 0.52],
  succulent: [0, 1, 0], field: [1.05, 1.12, 0.85], grass: [1.2, 1.22, 1], pampas: [1.3, 0.74, 1.35], deadgrass: [1, 0.9, 1],
  bamboo: [0.5, 0.78, 1.05], sasa: [0.8, 1, 0.9], tree: [0.25, 0.8, 0.8], oak: [0.23, 0.78, 0.75], cherry: [0.32, 0.85, 0.85],
  maple: [0.33, 0.9, 0.85], ginkgo: [0.29, 0.84, 0.8], zelkova: [0.3, 0.86, 0.8], cedar: [0.25, 0.94, 0.7], fir: [0.23, 0.85, 0.7],
  pine: [0.26, 0.76, 0.8], fern: [0.8, 1, 0.9], fernb: [0.72, 0.92, 0.88], cloverb: [0.62, 1.12, 0.72], plumegrassb: [1, 1.05, 0.95],
  finegrassb: [0.86, 1.16, 0.84], floweringtreeb: [0.48, 0.82, 0.7], succulentb: [0, 0.65, 0.4], succulentc: [0, 0.8, 0.58],
  ficus: [0.4, 0.86, 0.7], splitleaf: [0.35, 0.82, 0.72], hardleaf: [0, 0.72, 0.42], dandelion: [0.85, 1.08, 0.9], plantain: [0.65, 1, 0.8],
  daisy: [0.8, 1.1, 0.9], poppy: [1, 0.9, 1.05], yarrow: [0.8, 1, 0.9], clover: [0.6, 1.18, 0.7], meadow: [1.05, 1.2, 0.9],
  meadowb: [0.85, 1.1, 0.9], meadowc: [1.05, 0.96, 1.15],
};
const WIND_DEFAULT = [0.3, 0.85, 0.8];   // 表に無い種類（木の平均くらい）
// 全モデル共通の値（uniform を共有するので、ここを書き換えれば全部に効く）
const WIND_U = { vdTime: { value: 0 }, vdSpeed: { value: 6 }, vdGust: { value: 0.25 }, vdStrength: { value: 1 }, vdDirection: { value: new THREE.Vector2(1, 0) } };
/** 3D モデルの風（2026-10-02 ユーザー指定で「揺れ幅」と「揺れの速さ」に分けた）。
 *  on：オフで揺れない（まっすぐの形）。amp：揺れ幅の倍率（1 で風速 6 相当）。dirDeg：向き [度]（0 で客席から見て右へ）。gust：突風 0〜1。
 *  揺れの速さ（周期）は tickModelWind に渡す時間の進め方で変える。元の式の「風速」は揺れ幅と周期の両方に効いていたので、
 *  周期側は WIND_SPEED_REF に固定し、揺れ幅は vdStrength で別に掛ける */
const WIND_SPEED_REF = 6;
export function setModelWind({ on = true, amp = 1, dirDeg = 0, gust = 0.25 } = {}) {
  WIND_U.vdStrength.value = on ? Math.max(0, amp) : 0;
  WIND_U.vdSpeed.value = WIND_SPEED_REF;
  WIND_U.vdGust.value = Math.max(0, Math.min(1, gust));
  WIND_U.vdDirection.value.set(Math.cos(deg(dirDeg)), -Math.sin(deg(dirDeg)));   // 舞台の x・z（+z が客席側。プラスの角度で奥へ回る）
}
/** 風の時刻を進める（毎フレーム、実時間の経過秒で呼ぶ） */
export function tickModelWind(dt) { WIND_U.vdTime.value += Math.max(0, Math.min(0.1, dt || 0)); }
function windInfo(scene) {
  let species = null;
  scene.traverse((o) => { species ??= o.userData?.verdant?.state?.species ?? null; });
  if (!species) return null;                                           // VERDANT の GLB でなければ揺らさない
  const [flex, freq, lag] = WIND_PROFILES[species] ?? WIND_DEFAULT;
  if (!flex) return null;                                              // サボテン・多肉など（揺れない種類）
  const H = Math.max(0.001, new THREE.Box3().setFromObject(scene).max.y);   // 木の高さ（GLB の単位 ＝ m。原点が根元）
  return { H, flex, freq, lag, key: `${species}:${H.toFixed(4)}` };
}
const WIND_GLSL = [
  'uniform float vdTime, vdSpeed, vdGust, vdStrength, vdHeight, vdFlex, vdFreq, vdLag;',
  'uniform vec2 vdDirection;',
  'vec3 verdantBend(vec3 p, vec3 root, vec2 direction, out float slope) {',
  '  float H = max(.001, vdHeight), h = clamp(p.y / H, 0., 1.), phase = dot(root.xz, vec2(.91, 1.31));',
  '  float a = vdTime * vdFreq * (1. + vdSpeed * .075) + phase - vdLag * h;',
  '  float b = vdTime * vdFreq * 2.07 + phase * 1.7 - vdLag * h * .55;',
  '  float w = sin(a) + sin(b) * vdGust * .42, dh = -vdLag * cos(a) - vdLag * .55 * cos(b) * vdGust * .42;',
  '  float strength = .012 * vdSpeed * vdFlex * vdStrength, d = H * strength * h * h * w;',
  '  slope = (p.y > 0. && p.y < H) ? strength * (2. * h * w + h * h * dh) : 0.;',
  '  p.xz += direction * d; return p; }',
  // 風向きを物体の中の向きに直す：回転＋等倍の拡大なので、逆行列の代わりに転置（各軸との内積）でよい（向きは正規化する）
  // まとめて描く時（草のジェネレーター。2026-10-03）は 1 本ずつの置き方（instanceMatrix）も含める（元のコードと同じ）
  'vec2 verdantDirection() { mat3 m = mat3(modelMatrix);',
  '#ifdef USE_INSTANCING',
  '  m = m * mat3(instanceMatrix);',
  '#endif',
  '  vec3 v = vec3(vdDirection.x, 0., vdDirection.y);',
  '  vec3 d = vec3(dot(m[0], v), dot(m[1], v), dot(m[2], v)); float len = length(d.xz); return len > 1.e-8 ? d.xz / len : vec2(1., 0.); }',
  'vec3 verdantRoot() {',
  '#ifdef USE_INSTANCING',
  '  return (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;',
  '#else',
  '  return modelMatrix[3].xyz;',
  '#endif',
  '}',
].join('\n');
function windPatch(material, w) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WIND_U, { vdHeight: { value: w.H }, vdFlex: { value: w.flex }, vdFreq: { value: w.freq }, vdLag: { value: w.lag } });
    shader.vertexShader = WIND_GLSL + '\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat vdSlope; transformed = verdantBend(transformed, verdantRoot(), verdantDirection(), vdSlope);')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat vdNormalSlope; vec3 vdIgnore = verdantBend(position, verdantRoot(), verdantDirection(), vdNormalSlope); objectNormal.y -= vdNormalSlope * dot(objectNormal.xz, verdantDirection());');
  };
  material.customProgramCacheKey = () => `pxo-wind-v1:${w.key}`;   // 揺れ方の値ごとに別のプログラム（風なしの材質とも分ける）
  return material;
}
const WIND_MAT = new Map(), WIND_DEPTH = new Map();
function windMaterial(m, w) {
  const key = `${m.uuid}:${w.key}`;
  if (!WIND_MAT.has(key)) WIND_MAT.set(key, plantMat(windPatch(m.clone(), w)));
  return WIND_MAT.get(key);
}
function windDepth(w, m) {   // 影（太陽などの平行光）用。揺れていない影が残らないよう、同じずらしを入れる
  // 葉の透明部分が影に出るよう、元の材質の絵・抜き・面の向きを写す（three が自動で作る影用の材質と同じ。2026-10-03 修正：
  // 最初は 1 つの材質を全部に使っていて、葉を抜いている GLB だと影が四角い板の集まりになっていた）
  const key = `${w.key}:${m.uuid}`;
  if (!WIND_DEPTH.has(key)) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: m.side ?? THREE.FrontSide });
    if (m.alphaTest > 0) { d.map = m.map || null; d.alphaMap = m.alphaMap || null; d.alphaTest = m.alphaTest; }
    WIND_DEPTH.set(key, windPatch(d, w));
  }
  return WIND_DEPTH.get(key);
}
function applyWind(o, w) {
  o.traverse((n) => {
    if (!n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    const kind = mats[0]?.userData?.verdantMaterial;
    if (!kind || WIND_STATIC.has(kind)) return;
    n.material = Array.isArray(n.material) ? mats.map((x) => windMaterial(x, w)) : windMaterial(n.material, w);
    n.customDepthMaterial = windDepth(w, mats[0]);
  });
}
// ---- 3D モデル（木など）の影を奏者に落とす（2026-10-03 ユーザー指定）----
// 奏者は影を受けない（楽器や頭の影が胸に落ちて黒く潰れ、ノイズに見えたため。2026-09-11）。three の影は「光ごとに 1 枚の影の地図」を
// 受ける物すべてに落とすので、受けるようにすると奏者自身の影も戻ってくる。しかも r128 は影の地図に入れる物を光ごとに選べない
// （メインのカメラのレイヤーで決まる）。そこで太陽と同じ向き・範囲の直交カメラで 3D モデルだけを描いて奥行きを取り、
// 奏者の材質にはその奥行きだけを読ませて、太陽（夜は月）の直射を落とす。奏者どうし・自分の影は出ない
const MODEL_SHADOW_LAYER = 5;   // 1：太陽の円盤、2：天気、3：金属、4：奏者のドット化（各 const の定義を参照）
const MODEL_SHADOW_PX = 2048;   // 奥行きの画像の 1 辺（太陽の影の地図と同じ）
const MODEL_SHADOW_BIAS = 0.002;   // 奥行きの比較の余裕（奥行き 149 unit に対して 0.3 unit ほど）
const MODEL_SHADOW_EVERY = 1;   // 何フレームに 1 回描き直すか。1 ＝毎フレーム（2026-10-03：4 に減らしても fps はほぼ変わらず（重さの原因は奏者の部品数）、影のカクつきだけが目立ったので戻した）
const TS_U = { pxoTsMap: { value: null }, pxoTsMatrix: { value: new THREE.Matrix4() }, pxoTsOn: { value: 0 }, pxoTsBias: { value: MODEL_SHADOW_BIAS } };
const MSH = { rt: null, cam: new THREE.OrthographicCamera(-34, 34, 34, -34, 1, 150), roots: [], frame: 0 };
MSH.cam.layers.set(MODEL_SHADOW_LAYER);
const TS_DONE = new WeakSet();
/** 3D モデルの影を受ける奏者（体・楽器・椅子）。毎フレーム呼んでよい（材質は 1 度だけ書き換える。持ち替えで増えた部品も拾う） */
export function setModelShadowReceivers(roots) { MSH.roots = roots || []; }
function patchModelShadow(mat) {
  if (!mat || TS_DONE.has(mat) || !(mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshStandardMaterial)) return;
  TS_DONE.add(mat);
  const prev = mat.onBeforeCompile, baseKey = mat.customProgramCacheKey();   // 元の書き換え（金属・発光など）とそのキーは先に控える
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    Object.assign(shader.uniforms, TS_U);
    shader.vertexShader = 'uniform mat4 pxoTsMatrix;\nvarying vec4 pxoTsCoord;\n' + shader.vertexShader
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\npxoTsCoord = pxoTsMatrix * ( modelMatrix * vec4( transformed, 1.0 ) );');
    // 直射（太陽・月）だけを落とす。環境光（天空光・照り返し）はそのまま
    shader.fragmentShader = 'uniform sampler2D pxoTsMap;\nuniform float pxoTsOn, pxoTsBias;\nvarying vec4 pxoTsCoord;\n' + shader.fragmentShader
      .replace('#include <aomap_fragment>', [
        '{ vec3 tsC = pxoTsCoord.xyz / pxoTsCoord.w;',
        '  if ( pxoTsOn > 0.5 && all( greaterThanEqual( tsC, vec3( 0.0 ) ) ) && all( lessThanEqual( tsC, vec3( 1.0 ) ) ) ) {',
        '    float tsS = step( tsC.z - pxoTsBias, texture2D( pxoTsMap, tsC.xy ).r );',
        '    reflectedLight.directDiffuse *= tsS; reflectedLight.directSpecular *= tsS; } }',
        '#include <aomap_fragment>'].join('\n'));
  };
  mat.customProgramCacheKey = () => `${baseKey}|pxoModelShadow1`;
  mat.needsUpdate = true;
}
function updateModelShadow(renderer, scene) {
  const sun = stageCtx?.sun;
  for (const r of MSH.roots) r?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) patchModelShadow(m); });
  const on = !!(sun && sun.visible && sun.castShadow && (stageCtx.models.children.length || stageCtx.stones.children.length));
  TS_U.pxoTsOn.value = on ? 1 : 0;
  if (!on) { MSH.frame = 0; return; }   // 次にオンになった時はすぐ描く
  const first = !MSH.rt;
  if (!first && (MSH.frame++ % MODEL_SHADOW_EVERY) !== 0) return;   // 間のフレームは前の奥行きと位置合わせをそのまま使う（両方そろって古いのでずれない）
  if (!MSH.rt) {
    MSH.rt = new THREE.WebGLRenderTarget(MODEL_SHADOW_PX, MODEL_SHADOW_PX, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
    MSH.rt.depthTexture = new THREE.DepthTexture(MODEL_SHADOW_PX, MODEL_SHADOW_PX);
    MSH.rt.depthTexture.type = THREE.UnsignedIntType;
    TS_U.pxoTsMap.value = MSH.rt.depthTexture;
  }
  // 太陽の影のカメラと同じ範囲・向き
  const c = MSH.cam, sc = sun.shadow.camera;
  c.left = sc.left; c.right = sc.right; c.top = sc.top; c.bottom = sc.bottom; c.near = sc.near; c.far = sc.far; c.updateProjectionMatrix();
  c.position.copy(sun.position); c.lookAt(sun.target.position); c.updateMatrixWorld();
  TS_U.pxoTsMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
  // モデルだけを描いて奥行きを取る（材質はそのまま使うので、葉の抜きと風の揺れが影にも乗る。色は捨てる）
  const prevRT = renderer.getRenderTarget(), autoShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;   // この描画で太陽の影の地図まで作り直さない
  renderer.setRenderTarget(MSH.rt); renderer.clear(); renderer.render(scene, c);
  renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = autoShadow;
}
// ---- 石のジェネレーター（2026-10-03 ユーザー指定）----
// 石の GLB（石1・石2…）を形のもととして、個数・ばらけ具合・大きさ・大きさのばらつきから並べ方を決め、形ごとにまとめて 1 回で描く
// （InstancedMesh。このアプリの重さは描画の回数で決まるので、数百個でも軽い）。並べ方は種から決まるので、同じ値なら同じ並び。
// 1 群れ = { x, z, y（中心と高さ [unit]）, spread（ばらけ具合 [unit]）, count, size（大きさの倍率）, sizeVar（0〜1）, seed, show }
const STONE_MAX = 400;          // 1 群れ・1 形あたりの上限（個数スライダーの最大と同じ）
const STONE_TRIES = 30;         // 重ならない場所を探す回数（見つからなければその石は置かない）
const STONE_GAP = 0.85;         // 重なりの判定の甘さ（外接円の半径の和 × これ未満なら重なりとみなす。1 未満で少し寄り添える）
// 大きい石は岩の形に替える（2026-10-03 ユーザー指定：引き伸ばした小石は粗く、点々も大きくなるため）。
// 幅 ROCK_FROM〜ROCK_TO [m] の間は、大きいほど岩になる確率を上げて混ぜる（境目で形の種類が急に変わらないように。真ん中の約 60cm で半々）
const ROCK_FROM = 0.45, ROCK_TO = 0.8;
let stonePatterns = [], rockPatterns = [], stoneList = [];
const STONE_POOL = new Map();   // `${群れ}:${url}` → InstancedMesh（作り直さず個数と並びだけ変える）
/** 石の形のもと（GLB の URL の一覧） */
export function setStonePatterns(urls, rockUrls = []) { stonePatterns = [...(urls || [])]; rockPatterns = [...(rockUrls || [])]; buildStones(); }
/** 石の群れの一覧 */
export function setStones(list) { stoneList = (list || []).map((o) => ({ ...o })); buildStones(); }
function stoneShape(url) {   // GLB の最初の形を、ノードの位置・向きごと焼き込んで使う
  const e = loadGlb(url);
  if (!e.scene) return null;
  if (!e.stone) {
    let mesh = null;
    e.scene.updateMatrixWorld(true);
    e.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    if (!mesh) return null;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    const pa = geometry.attributes.position; let rc = 0;
    for (let i = 0; i < pa.count; i++) rc = Math.max(rc, Math.hypot(pa.getX(i), pa.getZ(i)));
    // r：並べる時の大きさの目安 [m]、rc：原点（底面の中央）から一番遠い点までの横の距離 [m]（床の縁にかかるかの判定）
    e.stone = { geometry, material: mesh.material, r: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2, rc };
  }
  return e.stone;
}
// 床の外に出た部分を切る（2026-10-03 ユーザー指定：床の縁でスパッと切れて断面が見える）。
// 床の縁にかかった石だけ、形のデータを床の縁で実際に切り、切り口に面を張って閉じた立体にする（本物の断面。影も光も正しく当たる）。
// 床の形は insideFloor と同じ（手前・左右は直線、奥は弧）。弧は石 1 個の幅ではほぼ直線なので、その石の位置での接線の平面で切る。
// ※ 最初は裏側の面を断面の色で塗って断面に見せていたが、角では奥の裏側の面も消えて向こうが透け、空洞に見えたのでやめた
const STONE_CAP = new THREE.Color(0.70, 0.68, 0.64);       // 断面の地の色（石の地の色と同じ）
const STONE_CAP_DOT = new THREE.Color(0.10, 0.10, 0.10);   // 点の色（make_rock.py・make_stone.py の DOT）
const STONE_DOTS_PER_M = 46;   // 点の間隔（1m あたりのます目の数。Blender の焼き込みと同じ）
// 断面の材質：石の表面と同じ四角い点々（ます目ごとに点 1 つ、半分ほど間引き、大きさ・濃さ 30〜70% をばらつかせる）を、
// 断面の平面上の座標で並べる。ます目の大きさは石ごとの倍率（頂点の pxoScale）に合わせ、表面の焼き込みと同じ実寸にする
const STONE_CAP_MAT = (() => {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const c = (v) => `vec3( ${v.r.toFixed(4)}, ${v.g.toFixed(4)}, ${v.b.toFixed(4)} )`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float pxoScale, pxoShade;\nvarying vec3 pxoCapW, pxoCapN;\nvarying float pxoCapS, pxoCapK;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\npxoCapW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; pxoCapN = normalize( ( modelMatrix * vec4( objectNormal, 0.0 ) ).xyz ); pxoCapS = pxoScale; pxoCapK = pxoShade;');
    shader.fragmentShader = `varying vec3 pxoCapW, pxoCapN;
varying float pxoCapS, pxoCapK;
float pxoHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 n = normalize( pxoCapN ), t = normalize( abs( n.y ) > 0.9 ? vec3( 1.0, 0.0, 0.0 ) : cross( vec3( 0.0, 1.0, 0.0 ), n ) ), bt = cross( n, t );
  vec2 g = vec2( dot( pxoCapW, t ), dot( pxoCapW, bt ) ) / max( 1e-4, pxoCapS / ${STONE_DOTS_PER_M.toFixed(1)} ), id = floor( g ), f = fract( g ) - 0.5;
  float h1 = pxoHash( id ), h2 = pxoHash( id + 17.31 ), h3 = pxoHash( id + 53.77 );
  float rad = mix( 0.057, 0.21, clamp( ( h1 - 0.45 ) / 0.55, 0.0, 1.0 ) );   // 点の半分の幅（ます目に対する割合。焼き込みのボロノイと同じ値）
  vec2 off = ( vec2( h2, h3 ) - 0.5 ) * ( 1.0 - 2.0 * rad );
  float dt = step( 0.45, h1 ) * step( max( abs( f.x - off.x ), abs( f.y - off.y ) ), rad ) * mix( 0.3, 0.7, h3 );
  diffuseColor.rgb = mix( ${c(STONE_CAP)}, ${c(STONE_CAP_DOT)}, dt ) * pxoCapK; }`);   // pxoCapK：石ごとの色の濃さ（表面と同じ倍率）
  };
  m.customProgramCacheKey = () => 'pxo-stonecap-v2';
  return m;
})();
// 床の縁の平面（外向きの法線 n・n·p ≤ d が床の側）のうち、中心 (x, z)・半径 rc の円にかかるもの。全部外なら null
function floorPlanesFor(x, z, rc) {
  const X = FLOOR_X_HALF, F = FLOOR_Z_FRONT, R = FLOOR_BACK_R, cz = SEAT_SHIFT_Z;
  const dc = Math.hypot(x, z - cz);
  if (z - rc > F || Math.abs(x) - rc > X || dc - rc > R) return null;   // 丸ごと床の外
  const planes = [];
  if (z + rc > F) planes.push({ n: new THREE.Vector3(0, 0, 1), d: F });
  if (x + rc > X) planes.push({ n: new THREE.Vector3(1, 0, 0), d: X });
  if (x - rc < -X) planes.push({ n: new THREE.Vector3(-1, 0, 0), d: X });
  if (dc + rc > R && dc > 1e-6) { const n = new THREE.Vector3(x / dc, 0, (z - cz) / dc); planes.push({ n, d: R + n.z * cz }); }   // 弧：その位置での接線の平面
  return planes;
}
// 閉じた三角形の集まり（頂点 = { p, n, uv }、三角形 = [v0, v1, v2, cap?]）を平面で切り、床の側だけ残して切り口に面を張る
function clipClosed(tris, pl) {
  const out = [], segs = [], EPS = 1e-6;
  const sd = (v) => pl.n.dot(v.p) - pl.d;
  const cut = (a, b) => {   // 辺 a-b と平面の交点。どちらの三角形から求めても同じ点になるよう、端の順を座標で決める
    if (a.p.x > b.p.x || (a.p.x === b.p.x && (a.p.y > b.p.y || (a.p.y === b.p.y && a.p.z > b.p.z)))) [a, b] = [b, a];
    const sa = sd(a), sb = sd(b), t = sa / (sa - sb);
    return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv && b.uv ? a.uv.clone().lerp(b.uv, t) : null };
  };
  for (const tri of tris) {
    const v = tri.slice(0, 3), cap = tri[3], s3 = v.map(sd), inn = s3.map((x) => x <= EPS);
    const ni = inn.filter(Boolean).length;
    if (ni === 3) { out.push(tri); continue; }
    if (ni === 0) continue;
    if (ni === 1) {   // 中の 1 点を先頭に回してから切る（向きを保つ）
      const i = inn.indexOf(true), a = v[i], b = v[(i + 1) % 3], c = v[(i + 2) % 3];
      const ab = cut(a, b), ac = cut(a, c);
      out.push([a, ab, ac, cap]); segs.push([ab.p, ac.p]);
    } else {          // 外の 1 点を最後に回してから切る
      const i = inn.indexOf(false), c = v[i], a = v[(i + 1) % 3], b = v[(i + 2) % 3];
      const bc = cut(b, c), ac = cut(a, c);
      out.push([a, b, bc, cap], [a, bc, ac, cap]); segs.push([bc.p, ac.p]);
    }
  }
  // 切り口の線分を輪につなぎ、平面上で三角形に分けて蓋をする
  const key = (p) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
  const adj = new Map();
  for (const [a, b] of segs) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    if (!adj.has(ka)) adj.set(ka, { p: a, nb: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, nb: [] });
    adj.get(ka).nb.push(kb); adj.get(kb).nb.push(ka);
  }
  const t1 = new THREE.Vector3(0, 1, 0).cross(pl.n).normalize(), t2 = pl.n.clone().cross(t1);
  const used = new Set();
  for (const [k0] of adj) {
    if (used.has(k0)) continue;
    const loop = []; let prev = null, cur = k0;
    for (let guard = 0; guard < 100000; guard++) {   // 途切れた輪は捨てる（上限で必ず止める）
      used.add(cur); loop.push(adj.get(cur).p);
      const next = adj.get(cur).nb.find((x) => x !== prev && !used.has(x)) ?? (adj.get(cur).nb.includes(k0) && loop.length > 2 ? k0 : null);
      if (next == null || next === k0) break;
      prev = cur; cur = next;
    }
    if (loop.length < 3) continue;
    const c2 = loop.map((p) => new THREE.Vector2(p.dot(t1), p.dot(t2)));
    const faces = THREE.ShapeUtils.triangulateShape(c2, []);
    const mk = (p) => ({ p, n: pl.n.clone(), uv: null });
    for (const [i, j, l] of faces) {
      let a = loop[i], b = loop[j], c = loop[l];
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(pl.n) < 0) [b, c] = [c, b];   // 外（床の外）を向くように
      out.push([mk(a), mk(b), mk(c), true]);
    }
  }
  return out;
}
// 1 個の石を世界の座標に置いて、床の縁で切った 2 つの形（表面・断面）にする
function cutStoneMeshes(shape, matrix, planes, scale, shade = 1) {
  const g = shape.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, idx = g.index;
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const vert = (i) => ({ p: new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(matrix), n: na ? new THREE.Vector3().fromBufferAttribute(na, i).applyMatrix3(nm).normalize() : new THREE.Vector3(0, 1, 0), uv: ua ? new THREE.Vector2().fromBufferAttribute(ua, i) : null });
  const verts = []; for (let i = 0; i < pa.count; i++) verts.push(vert(i));
  let tris = [];
  const n3 = idx ? idx.count : pa.count;
  for (let i = 0; i < n3; i += 3) { const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2; tris.push([verts[a], verts[b], verts[c], false]); }
  for (const pl of planes) tris = clipClosed(tris, pl);
  const build = (list, withUv) => {
    const pos = new Float32Array(list.length * 9), nor = new Float32Array(list.length * 9), uv = withUv ? new Float32Array(list.length * 6) : null;
    list.forEach((t, i) => t.slice(0, 3).forEach((v, j) => {
      pos.set([v.p.x, v.p.y, v.p.z], i * 9 + j * 3); nor.set([v.n.x, v.n.y, v.n.z], i * 9 + j * 3);
      if (uv) uv.set(v.uv ? [v.uv.x, v.uv.y] : [0, 0], i * 6 + j * 2);
    }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    else {
      geo.setAttribute('pxoScale', new THREE.BufferAttribute(new Float32Array(list.length * 3).fill(scale), 1));
      geo.setAttribute('pxoShade', new THREE.BufferAttribute(new Float32Array(list.length * 3).fill(shade), 1));
    }
    return geo;
  };
  const surf = tris.filter((t) => !t[3]), caps = tris.filter((t) => t[3]);
  const meshes = [];
  if (surf.length) {   // 表面：色の濃さを掛けた材質の複製（組み直すたびに捨てる）
    const mat = shape.material.clone(); mat.color.multiplyScalar(shade); mat.userData.pxoOwned = true;
    meshes.push(new THREE.Mesh(build(surf, true), mat));
  }
  if (caps.length) meshes.push(new THREE.Mesh(build(caps, false), STONE_CAP_MAT));
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.layers.enable(MODEL_SHADOW_LAYER); }
  return meshes;
}
let STONE_EDGE = [];   // 縁で切った石の形（組み直すたびに作り直して、前のは捨てる）
function rng32(seed) {   // mulberry32（種から決まる乱数）
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
const _sc = new THREE.Color(), _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _sp = new THREE.Vector3(), _ss = new THREE.Vector3(), _sy = new THREE.Vector3(0, 1, 0);
function buildStones() {
  if (!stageCtx) return;
  const g = stageCtx.stones;
  g.clear();   // プールの InstancedMesh は捨てずに使い回す
  HL_VER++;
  for (const m of STONE_EDGE) { m.geometry.dispose(); if (m.material.userData?.pxoOwned) m.material.dispose(); }   // 縁で切った形は毎回作り直す（断面の材質は共有なので捨てない）
  STONE_EDGE = [];
  const stoneShapes = stonePatterns.map((u) => ({ url: u, s: stoneShape(u) })).filter((p) => p.s);
  const rockShapes = rockPatterns.map((u) => ({ url: u, s: stoneShape(u) })).filter((p) => p.s);
  if (!stoneShapes.length) return;
  const shapes = [...stoneShapes, ...rockShapes];   // per[] の添字：石が先、岩が後
  const stoneW = stoneShapes.reduce((a, p) => a + p.s.r * 2, 0) / stoneShapes.length;   // 石の形の平均の幅 [m]（大きさ 1 のとき）
  stoneList.forEach((st, ci) => {
    if (st.show === false) return;
    const r = rng32(st.seed ?? 1);
    const count = Math.max(0, Math.min(STONE_MAX, Math.round(st.count ?? 20)));
    const spread = Math.max(0, st.spread ?? 3), size = Math.max(0.01, st.size ?? 1), sizeVar = Math.max(0, Math.min(1, st.sizeVar ?? 0.4));
    const placed = [];   // { x, z, rad }
    const per = shapes.map(() => []), perShade = shapes.map(() => []);
    // 色の濃さ（2026-10-03 ユーザー指定）：1 で元の色、1 上がるごとに明るさが半分。ばらつきは石ごと（±2σ まで）。
    // 並びとは別の乱数を使う（このスライダーを足す前に作った群れの並びが変わらないように）
    const rc = rng32(((st.seed ?? 1) ^ 0x9e3779b9) >>> 0);
    const shadeOf = () => Math.pow(0.5, (st.shade ?? 1) + Math.max(-2, Math.min(2, gauss(rc))) * (st.shadeVar ?? 0) * 0.5 - 1);
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < STONE_TRIES; t++) {
        // 中心ほど多く、外ほどまばら（正規分布。σ = ばらけ具合の半分、外れすぎはばらけ具合の 1.5 倍で止める）
        const rad0 = Math.min(1.5 * spread, Math.abs(gauss(r)) * spread / 2), a = r() * Math.PI * 2;
        const x = (st.x ?? 0) + Math.cos(a) * rad0, z = (st.z ?? 0) + Math.sin(a) * rad0;
        const sc = size * Math.pow(2, Math.max(-2, Math.min(2, gauss(r))) * sizeVar * 1.5);   // 大きさのばらつき：1 で 1/8〜8 倍（±2σ まで）
        const w = stoneW * sc;   // この石の幅 [m]
        const u = Math.max(0, Math.min(1, (w - ROCK_FROM) / (ROCK_TO - ROCK_FROM))), pRock = u * u * (3 - 2 * u);
        const useRock = rockShapes.length > 0 && r() < pRock;
        const pi = useRock ? stoneShapes.length + (Math.floor(r() * rockShapes.length) % rockShapes.length) : Math.floor(r() * stoneShapes.length) % stoneShapes.length;
        const rot = r() * Math.PI * 2;
        const k = useRock ? w / (shapes[pi].s.r * 2) : sc;   // 岩は同じ幅になるように縮める
        const rad = shapes[pi].s.r * k * MODEL_M;
        if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < (q.rad + rad) * STONE_GAP)) continue;
        placed.push({ x, z, rad });
        const mat = _sm.compose(_sp.set(x, st.y ?? 0, z), _sq.setFromAxisAngle(_sy, rot), _ss.setScalar(k * MODEL_M)).clone();
        const planes = floorPlanesFor(x, z, shapes[pi].s.rc * k * MODEL_M);
        if (!planes) break;                                    // 丸ごと床の外：置かない
        if (WATER_AVOID.length && waterSdfAt(x, z) < rad) break;   // 「草・石をよける」水場に少しでも重なる：置かない（2026-10-03）
        const shade = shadeOf();
        if (planes.length) { for (const m of cutStoneMeshes(shapes[pi].s, mat, planes, k * MODEL_M, shade)) { m.userData.pxoCard = ci; STONE_EDGE.push(m); g.add(m); } break; }   // 縁にかかる：切った形で置く
        per[pi].push(mat); perShade[pi].push(shade);           // 床の中：まとめて描く
        break;
      }
    }
    shapes.forEach((p, pi) => {
      if (!per[pi].length) return;
      const key = `${ci}:${p.url}`;
      let im = STONE_POOL.get(key);
      if (!im || im.geometry !== p.s.geometry) {
        im = new THREE.InstancedMesh(p.s.geometry, p.s.material, STONE_MAX);
        im.setColorAt(0, new THREE.Color(1, 1, 1));   // 石ごとの色の入れ物を、上限の個数ぶん先に作る（個数を減らした後に作ると足りなくなる）
        im.castShadow = true; im.receiveShadow = true;
        im.frustumCulled = false;   // 境界は元の形 1 個分しか無いので、画面外と誤判定させない
        im.layers.enable(MODEL_SHADOW_LAYER);   // 奏者に落とす影の元
        STONE_POOL.set(key, im);
      }
      im.count = per[pi].length;
      per[pi].forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, _sc.setScalar(perShade[pi][i])); });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.userData.pxoCard = ci;
      g.add(im);
    });
  });
}
// ---- 草のジェネレーター（2026-10-03 ユーザー指定）----
// FABOTANIC の「野草パッチ」の GLB（草1・草2…）を形のもととして、個数・ばらけ具合・群生のまとまり・大きさ・色からばらまく。
// 石と違って重なってよい（隙間を空ける判定はしない）。部品（葉・茎・花・穂）ごとにまとめて 1 回で描き、3D モデル欄の風で揺らす。
// 床の外に出た部分は描かない（薄い草なので断面は要らない）。中心が床の外になる株は置かない。
// 1 群れ = { x, z, y, spread, count, clump（群生のまとまり 0〜1）, size, sizeVar, shade, shadeVar, seed, show }
const GRASS_MAX = 600;          // 1 群れ・1 部品あたりの上限（個数スライダーの最大と同じ）
let grassPatterns = [], grassList = [];
const GRASS_POOL = new Map();   // `${群れ}:${url}:${部品}` → InstancedMesh
/** 草の形のもと（[{ url, name }]。name は割合の鍵：「草1」など） */
export function setGrassPatterns(list) { grassPatterns = [...(list || [])]; buildGrass(); }
/** 草の群れの一覧 */
export function setGrass(list) { grassList = (list || []).map((o) => ({ ...o })); buildGrass(); }
const FLOOR_GLSL = `bool pxoOutsideFloor( vec3 w ) {
  if ( abs( w.x ) > ${FLOOR_X_HALF.toFixed(4)} || w.z > ${FLOOR_Z_FRONT.toFixed(4)} ) return true;
  float dz = w.z - ( ${SEAT_SHIFT_Z.toFixed(4)} );
  return w.x * w.x + dz * dz > ${(FLOOR_BACK_R * FLOOR_BACK_R).toFixed(4)};
}`;
function grassPatch(m, w) {   // 風で揺らし（w があれば）、床の外を描かない
  m.onBeforeCompile = (shader) => {
    if (w) Object.assign(shader.uniforms, WIND_U, { vdHeight: { value: w.H }, vdFlex: { value: w.flex }, vdFreq: { value: w.freq }, vdLag: { value: w.lag } });
    let vs = 'varying vec3 pxoGrassW;\n' + shader.vertexShader;
    if (w) vs = WIND_GLSL + '\n' + vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat vdSlope; transformed = verdantBend(transformed, verdantRoot(), verdantDirection(), vdSlope);');
    shader.vertexShader = vs.replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 gp = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  gp = instanceMatrix * gp;
#endif
  pxoGrassW = ( modelMatrix * gp ).xyz; }`);
    shader.fragmentShader = 'varying vec3 pxoGrassW;\n' + FLOOR_GLSL + '\n' + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( pxoOutsideFloor( pxoGrassW ) ) discard;');
  };
  m.customProgramCacheKey = () => `pxo-grass-v1:${w ? w.key : '-'}:${m.isMeshDepthMaterial ? 'd' : 'c'}`;
  return m;
}
function grassShape(url) {   // GLB の部品ごとの形（ノードの位置・向きを焼き込む）と材質。風の揺れ方は GLB の印から
  const e = loadGlb(url);
  if (!e.scene) return null;
  if (!e.grass) {
    const parts = [];
    e.scene.updateMatrixWorld(true);
    e.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      parts.push({ name: o.name, geometry, material: plantMat(grassPatch(src.clone(), e.wind)),   // plantMat：植物の明るさ（3D モデル欄）も効かせる
         depth: grassPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), e.wind) });
    });
    const bb = new THREE.Box3(); for (const p of parts) { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); }
    e.grass = { parts, wind: e.wind, r: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2 };   // r：株の半径 [m]
  }
  return e.grass;
}
function buildGrass() {
  if (!stageCtx) return;
  HL_VER++;
  const g = stageCtx.grass;
  g.clear();
  const shapes = grassPatterns.map((p) => ({ url: p.url, name: p.name, s: grassShape(p.url) })).filter((p) => p.s && p.s.parts.length);
  if (!shapes.length) return;
  grassList.forEach((st, ci) => {
    if (st.show === false) return;
    const r = rng32(st.seed ?? 1), rc = rng32(((st.seed ?? 1) ^ 0x9e3779b9) >>> 0);
    const count = Math.max(0, Math.min(GRASS_MAX, Math.round(st.count ?? 60)));
    const spread = Math.max(0, st.spread ?? 4), clump = Math.max(0, Math.min(1, st.clump ?? 0.4));
    const size = Math.max(0.01, st.size ?? 1), sizeVar = Math.max(0, Math.min(1, st.sizeVar ?? 0.3));
    // 群生（2026-10-04 作り直し。ユーザー指摘：並べ直したようにしか見えない）：塊の中心は株の数から決めて（12 株に 1 つ）、群生の値では変えない。
    // 株はまず一様に散らばった位置を持ち、群生を上げるほど一番近い塊の中心へ引き寄せる（1 で中心からの距離が 12%）。
    // 塊の中心は別の乱数で決めるので、群生を動かしても株は入れ替わらず、なめらかに寄ったり散ったりする
    // （以前は群生で塊の数と乱数の順番が変わり、全部の株が置き直された。塊も重なり合って一面に溶けていた）
    const rk = rng32(((st.seed ?? 1) ^ 0x85ebca6b) >>> 0);
    const nC = Math.max(2, Math.round(count / 12)), centers = [];
    for (let i = 0; i < nC; i++) {
      const a = rk() * Math.PI * 2, d = Math.min(1.5 * spread, Math.abs(gauss(rk)) * spread / 2);
      centers.push([(st.x ?? 0) + Math.cos(a) * d, (st.z ?? 0) + Math.sin(a) * d]);
    }
    const pull = 1 - 0.88 * clump;   // 中心からの距離に掛ける倍率
    const sigma = spread / 2;
    // 使う草の割合（2026-10-03 ユーザー指定）。名前ごとの重み（無ければ 1）の比で選ぶ。全部 0 なら何も置かない。
    // 乱数は今まで通り 1 回だけ引くので、割合を変えても株の位置は変わらない
    const wts = shapes.map((p) => Math.max(0, st.mix?.[p.name] ?? 1)), wSum = wts.reduce((a, b) => a + b, 0);
    const pickShape = (u) => { let t = u * wSum; for (let k = 0; k < wts.length; k++) { if (wts[k] > 0 && t < wts[k]) return k; t -= wts[k]; } return wts.findLastIndex((w) => w > 0); };
    const per = shapes.map(() => []);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = Math.min(1.5 * spread, Math.abs(gauss(r)) * sigma);
      const x0 = (st.x ?? 0) + Math.cos(a) * d, z0 = (st.z ?? 0) + Math.sin(a) * d;   // 群生 0 の時の位置
      let c = centers[0], best = Infinity;
      for (const q of centers) { const dd = (q[0] - x0) ** 2 + (q[1] - z0) ** 2; if (dd < best) { best = dd; c = q; } }
      const x = c[0] + (x0 - c[0]) * pull, z = c[1] + (z0 - c[1]) * pull;
      const sc = size * Math.pow(2, Math.max(-2, Math.min(2, gauss(r))) * sizeVar);   // 大きさのばらつき：1 で 1/4〜4 倍（±2σ まで）
      const pi = pickShape(r()), rot = r() * Math.PI * 2;
      const shade = Math.pow(0.5, (st.shade ?? 1) + Math.max(-2, Math.min(2, gauss(rc))) * (st.shadeVar ?? 0) * 0.5 - 1);
      if (pi < 0 || !insideFloor(x, z)) continue;
      // 「草・石をよける」水場：株の中心が水に近い（株の半径の半分以内）ものは置かない。1 株が大きいので、少しでも重なったら除くと岸の草が消えすぎる
      if (WATER_AVOID.length && waterSdfAt(x, z) < shapes[pi].s.r * sc * MODEL_M * 0.5) continue;
      if (st.avoidPlayers && playersSdfAt(x, z) < shapes[pi].s.r * sc * MODEL_M * 0.5) continue;   // 「奏者をよける」：株の中心が奏者のまわりの陸地に近いものは置かない（2026-10-04）   // 中心が床の外の株は置かない（はみ出した分は描く時に消す）
      per[pi].push([_sm.compose(_sp.set(x, st.y ?? 0, z), _sq.setFromAxisAngle(_sy, rot), _ss.setScalar(sc * MODEL_M)).clone(), shade]);
    }
    shapes.forEach((p, pi) => {
      if (!per[pi].length) return;
      p.s.parts.forEach((part, k) => {
        const key = `${ci}:${p.url}:${k}`;
        let im = GRASS_POOL.get(key);
        if (!im || im.geometry !== part.geometry) {
          im = new THREE.InstancedMesh(part.geometry, part.material, GRASS_MAX);
          im.setColorAt(0, new THREE.Color(1, 1, 1));   // 色の入れ物を上限ぶん先に作る
          im.customDepthMaterial = part.depth;          // 影も揺らし、床の外は落とさない
          im.castShadow = true; im.receiveShadow = true;
          im.frustumCulled = false;
          GRASS_POOL.set(key, im);
        }
        im.userData.pxoCard = ci; im.userData.pxoWind = p.s.wind || null;
        im.count = per[pi].length;
        per[pi].forEach(([m, shade], i) => { im.setMatrixAt(i, m); im.setColorAt(i, _sc.setScalar(shade)); });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        g.add(im);
      });
    });
  });
}
// ---- 水のジェネレーター（2026-10-03 ユーザー指定）----
// 川・湖・水たまりを 1 つの仕組みで作る：水面を「たくさんの円をなめらかにくっつけた形」として、描く時に計算する。
// 円を線に沿って並べれば川（長さ・太さ・蛇行・向き）、長さ 0 なら 1 か所にまとまって湖、分かれを増やすと離れた水たまりが散らばる。
// 見た目は平らなアニメ調：岸からの距離で 3 段の色（浅い・中・深い）、岸に泡の白い線、その外に濡れて暗い床の輪。
// 波はドット単位のコマ送りの線で、川は「向き」に沿って流れる（流れ 0 で止まって、ときどききらめくだけ）。
// 床の上（+2cm）に 1 枚の板を張り、水の外は描かない。照明（Lambert）と影を受ける。床の外は描かない。
// 1 水場 = { x, z, y, len（長さ）, width（太さ）, meander（蛇行 0〜1）, dir（向き [度]）, pieces（分かれ）, scatter（散らばり）,
//           smooth（縁のなめらかさ 0〜1）, flow（流れ 0〜2）, seed, show }
const WATER_MAX_C = 64;          // 1 水場の円の数の上限（シェーダーの配列の大きさ）
const WATER_LIFT = 0.02;         // 床からの浮かせ [unit]（床とのちらつき防止）
const WATER_WET = 0.3;           // 板の外周の余白 [unit]（2026-10-03：岸の外にはみ出し・打ち寄せる泡の粒のぶん）
const WATER_U = { uWT: { value: 0 } };   // 水の時刻（全水場で共有。曲と関係なく実時間で進める）
// ドット絵（範囲に 3D モデル）の時の 1 ドットの大きさ [画素]。0 でドットにしない（2026-10-04 ユーザー指定）。pixelPass が毎フレーム決める
const WATER_PIX = { uPixDot: { value: new THREE.Vector2() }, uPixLv: { value: 32 } };   // uPixLv：階調の細かさ（ドットにした物と同じ。32 で制限なし）
// 奏者の位置（「奏者をよける」用。全水場で共有）。x, z と陸地とみなす半径 [unit]
const WATER_MAX_PL = 128, WATER_PL_R = 1.3, WATER_COND_R = 1.9;   // 奏者（椅子・楽器ぶん）と、指揮者（一辺 2.2 の指揮台の角まで陸に）の半径
const WATER_PL = { uPl: { value: Array.from({ length: WATER_MAX_PL }, () => new THREE.Vector3()) }, uPlN: { value: 0 } };
const _plv = new THREE.Vector3();
/** 奏者の root と指揮者の root。毎フレーム呼んでよい（位置を写すだけ） */
export function setWaterPlayers(roots, conductorRoot = null) {
  let n = 0;
  for (const r of roots || []) {
    if (!r || n >= WATER_MAX_PL) continue;
    r.getWorldPosition(_plv);
    WATER_PL.uPl.value[n++].set(_plv.x, _plv.z, r === conductorRoot ? WATER_COND_R : WATER_PL_R);
  }
  WATER_PL.uPlN.value = n;
  // 草の「奏者をよける」（2026-10-04 ユーザー指定）：奏者の位置が変わった時（MIDI の読み込み・並びの変更）だけ草を並べ直す
  let sig = '';
  for (let i = 0; i < n; i++) { const v = WATER_PL.uPl.value[i]; sig += `${v.x.toFixed(1)},${v.y.toFixed(1)};`; }
  if (sig !== plSig) { plSig = sig; if (grassList.some((g) => g.avoidPlayers && g.show !== false)) buildGrass(); }
}
let plSig = '';
// 奏者のまわりの陸地までの距離（負が陸地の中）。水のシェーダー（pxoWaterSDF0 の「奏者をよける」）と同じ半径・同じなめらかなつなぎ方
function playersSdfAt(x, z) {
  let l = 1e5;
  for (let i = 0; i < WATER_PL.uPlN.value; i++) {
    const v = WATER_PL.uPl.value[i], li = Math.hypot(x - v.x, z - v.y) - v.z;
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (li - l)) / 1.2));
    l = li * (1 - h) + l * h - 1.2 * h * (1 - h);
  }
  return l;
}
// 映り込む空の色（2026-10-03 ユーザー指定）：画面の空のグラデーション（上の色・地平線の色・中間点・上下反転。露出を掛けた後の色）
const WATER_SKY = { uSkyTop: { value: new THREE.Color('#3d6fb0') }, uSkyBot: { value: new THREE.Color('#a9cfe8') }, uSkyMid: { value: 0.5 }, uSkyFlip: { value: 0 } };
/** 水に映る空の色（main.js の applyBackground と同じ値。top・bottom は露出を掛けた後の色、mid は 0〜100） */
export function setWaterSky(top, bottom, mid, flip) {
  WATER_SKY.uSkyTop.value.set(top); WATER_SKY.uSkyBot.value.set(bottom);
  WATER_SKY.uSkyMid.value = Math.max(0.01, Math.min(0.99, (+mid || 50) / 100)); WATER_SKY.uSkyFlip.value = flip ? 1 : 0;
}
let waterList = [];
/** 水場の一覧 */
export function setWater(list) { waterList = (list || []).map((o) => ({ ...o })); buildWater(); buildStones(); buildGrass(); }   // 「草・石をよける」ため石・草も組み直す
// 「草・石をよける」水場の形（2026-10-03 ユーザー指定）：画面と同じ「円をなめらかにくっつけた形」を JS でも計算して、石・草を水の上に置かない
let WATER_AVOID = [];   // [{ cs: [[x, z, r]…], k }]
function waterSdfAt(x, z) {   // 一番近い「よける」水場の岸までの距離（負が水の中）。無ければ大きな値
  let best = 1e9;
  for (const w of WATER_AVOID) {
    let d = 1e5;
    for (const [cx, cz, r] of w.cs) {
      const di = Math.hypot(x - cx, z - cz) - r, h = Math.max(0, Math.min(1, 0.5 + 0.5 * (di - d) / w.k));
      d = di * (1 - h) + d * h - w.k * h * (1 - h);
    }
    best = Math.min(best, d);
  }
  return best;
}
/** 水の時刻を進める（毎フレーム、実時間の経過秒で） */
export function tickWater(dt) { WATER_U.uWT.value += Math.max(0, Math.min(0.1, dt || 0)); }
const c3 = (h) => { const c = new THREE.Color(h); return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`; };
function waterMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.userData.u = { uC: { value: Array.from({ length: WATER_MAX_C }, () => new THREE.Vector4()) }, uN: { value: 0 }, uK: { value: 0.5 },
    uDeep: { value: 1 }, uDepth: { value: 1 }, uJag: { value: 0 }, uGlit: { value: 1 }, uWindK: { value: 1 }, uAvoidPl: { value: 1 }, uFlow: { value: new THREE.Vector2(1, 0) }, uSpeed: { value: 1 }, uHL: { value: 0 },
    uType: { value: 0 }, uRapid: { value: 0 } };   // uType：0 川／1 湖・池／2 水たまり、uRapid：川の瀬（2026-10-04）
  m.onBeforeCompile = (shader) => {
    const su = stageCtx.sky.material.uniforms;   // 夕焼けの層は空の球と同じ値を共有する（太陽の向き・夕焼けの色と強さ・光の広がり）
    Object.assign(shader.uniforms, WATER_U, WATER_PIX, WATER_SKY, WIND_U, WATER_PL, m.userData.u, { sunDir: su.sunDir, glowColor: su.glowColor, glowAmt: su.glowAmt, spread: su.spread || { value: 1 } });
    // pxoVV：視点から見た座標で、この点からカメラへの向き（2026-10-03：r128 は Lambert に cameraPosition を渡さないので自分で持つ）
    shader.vertexShader = 'varying vec3 pxoWW, pxoVV;\n' + shader.vertexShader
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\npxoWW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; pxoVV = -( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = `varying vec3 pxoWW, pxoVV;
uniform vec4 uC[ ${WATER_MAX_C} ];
uniform int uN;
uniform float uK, uDeep, uDepth, uJag, uGlit, uWindK, uAvoidPl, uSpeed, uHL, uWT;
uniform vec3 uPl[ ${WATER_MAX_PL} ];   // 奏者の位置（x, z, 半径）
uniform int uPlN;
uniform float vdTime, vdGust, vdStrength;   // 3D モデル欄の風（WIND_U を共有。2026-10-03）
uniform vec2 vdDirection;
uniform vec2 uFlow, uPixDot;
uniform float uPixLv;
uniform float uType, uRapid;   // 種類（0 川／1 湖・池／2 水たまり）と川の瀬（2026-10-04）
${PIX_QUANT_GLSL}
uniform vec3 uSkyTop, uSkyBot, sunDir, glowColor;
uniform float uSkyMid, uSkyFlip, glowAmt, spread;
${FLOOR_GLSL}
vec3 pxoSkyColor( vec3 d ) {   // 向き d（世界の座標）に見える空の色：画面の空のグラデーション＋太陽側の夕焼け（空の球と同じ式を簡単にしたもの）
  float y = uSkyFlip > 0.5 ? -d.y : d.y;
  // 画面に見えている空は地平線からおよそ 30° まで。その高さで上の色に達するように合わせる（2026-10-03：最初は真上を上の色にしていて、
  // ふつうの角度の水面には地平線寄りの色ばかりが映り、空の上の色を変えても水色のままだった）
  float u = 1.0 - clamp( y / 0.5, 0.0, 1.0 );   // 0：高さ 30° より上 … 1：地平線
  float tt = pow( u, log( 0.5 ) / log( uSkyMid ) );   // CSS の linear-gradient の中間点（色の折り返し）に合わせる
  vec3 c = mix( uSkyTop, uSkyBot, tt );
  vec3 sdn = normalize( sunDir );
  float ang = acos( clamp( dot( d, sdn ), -1.0, 1.0 ) ), sg = radians( 12.0 + 45.0 * spread );
  float lobe3 = exp( -( ang * ang ) / ( sg * sg ) );
  vec2 hh = normalize( d.xz + vec2( 1e-5, 0.0 ) );
  float cc = dot( hh, normalize( sdn.xz + vec2( 1e-5, 0.0 ) ) ), k = clamp( 0.45 * spread, 0.0, 0.9 );
  float lobeAz = pow( clamp( cc * ( 1.0 - k ) + k, 0.0, 1.0 ), 1.5 ), hz = exp( -max( y, 0.0 ) * 2.2 / max( 0.25, spread ) );
  float lowSun = 1.0 - clamp( sdn.y / 0.26, 0.0, 1.0 );
  return mix( c, glowColor, clamp( glowAmt * mix( lobe3, lobeAz * hz, lowSun ), 0.0, 1.0 ) );
}
float pxoWH( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float pxoWN( vec2 p ) {   // なめらかな値ノイズ（0〜1）
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pxoWH( i ), pxoWH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pxoWH( i + vec2( 0.0, 1.0 ) ), pxoWH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// さざ波の高さ（3 重のなめらかなノイズ）。q：流れの座標、T：流れ方向にずらす量（一定の速さなら uWT × 速さ）
float pxoRip( vec2 q, float T ) {
  return pxoWN( q * vec2( 2.2, 3.4 ) - vec2( T * 1.3, uWT * 0.15 ) )
       + 0.5 * pxoWN( q * vec2( 5.5, 7.0 ) - vec2( T * 2.1, -uWT * 0.25 ) )
       + 0.22 * pxoWN( q * vec2( 13.0, 15.0 ) - vec2( T * 3.4, uWT * 0.4 ) );
}
float pxoWaterSDF0( vec2 p ) {   // 円をなめらかにくっつけた形（多項式の smooth min）。負が水の中。ギザギザ抜き
  float d = 1e5;
  for ( int i = 0; i < ${WATER_MAX_C}; i ++ ) {
    if ( i >= uN ) break;
    float di = length( p - uC[ i ].xy ) - uC[ i ].z;
    float h = clamp( 0.5 + 0.5 * ( di - d ) / uK, 0.0, 1.0 );
    d = mix( di, d, h ) - uK * h * ( 1.0 - h );
  }
  // 奏者をよける（2026-10-03 ユーザー指定）：奏者のまわりを陸地とみなし（近くの奏者どうしはなめらかにつないで楽団全体をひとかたまりの陸に）、
  // 水はその手前で岸になる。岸の泡・打ち寄せ・濡れた跡も、この新しい岸に沿う
  if ( uAvoidPl > 0.5 && uPlN > 0 ) {
    float l = 1e5;
    for ( int i = 0; i < ${WATER_MAX_PL}; i ++ ) {
      if ( i >= uPlN ) break;
      float li = length( p - uPl[ i ].xy ) - uPl[ i ].z;
      float h = clamp( 0.5 + 0.5 * ( li - l ) / 1.2, 0.0, 1.0 );
      l = mix( li, l, h ) - 1.2 * h * ( 1.0 - h );
    }
    float h2 = clamp( 0.5 - 0.5 * ( -l - d ) / 0.3, 0.0, 1.0 );   // なめらかな max( d, −l )
    d = mix( -l, d, h2 ) + 0.3 * h2 * ( 1.0 - h2 );
  }
  return d;
}
// 岸の細かいギザギザ（2026-10-03 ユーザー指定）：数 cm と十数 cm の 2 種類のノイズで、岸の線を内外に揺らす（uJag 1 で最大 約 5cm）
float pxoJag( vec2 p ) { return uJag > 0.0 ? uJag * 0.12 * ( ( pxoWN( p * 15.0 ) * 0.55 + pxoWN( p * 5.5 + 3.7 ) * 0.45 ) * 2.0 - 1.0 ) : 0.0; }
float pxoWaterSDF( vec2 p ) { return pxoWaterSDF0( p ) + pxoJag( p ); }
` + shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  if ( uPixDot.x > 0.0 ) {   // 階調の細かさ（ドットに揃えた時だけ）。透明度も丸めて、泡の消え方・水の縁も段にする
    gl_FragColor.rgb = pxoQuant( gl_FragColor.rgb, uPixLv );
    gl_FragColor.a = pxoQuantA( gl_FragColor.a, uPixLv );
    if ( gl_FragColor.a <= 0.0 ) discard;
  }`).replace('#include <color_fragment>', `#include <color_fragment>
{
  // ドット絵（2026-10-04 ユーザー指定）：画面を石・草のドットと同じます目で区切り、ます目の中は真ん中の点の位置で計算する。
  // 水は半透明で奥行きを書かないので、ドットの粗い画像には入れず本編で描き（入れると床に塗られて消えた）、ここでドットに揃える。
  // 水面は平らなので、真ん中の点の位置は画素の位置から画面上の変化率で外挿すれば足りる
  vec3 pxoP = pxoWW, pxoV = pxoVV;
  if ( uPixDot.x > 0.0 ) {
    vec2 dc = ( floor( gl_FragCoord.xy / uPixDot ) + 0.5 ) * uPixDot - gl_FragCoord.xy;
    pxoP += dFdx( pxoWW ) * dc.x + dFdy( pxoWW ) * dc.y;
    pxoV += dFdx( pxoVV ) * dc.x + dFdy( pxoVV ) * dc.y;
  }
  if ( pxoOutsideFloor( pxoP ) ) discard;
  float sd = pxoWaterSDF( pxoP.xz );
  if ( sd > 0.3 ) discard;   // 岸の外は、はみ出した・打ち寄せた泡の粒だけ描く（濡れて暗い床の輪はやめた。2026-10-03）
  // 泡：岸に沿った大小の粒の集まり（2026-10-03 ユーザー指定）。粒を置くかどうかは「粒の中心」の位置で決め、粒は丸ごと描く
  // （水の外にはみ出してよい）。こうすると輪郭そのものが丸の並びでできて見える（最初は 1 粒ずつ水の形の線で切っていて、
  // 輪郭の線がそのまま見えた）。粒は流さず、置き場所も固定で、1 粒ずつ大きさだけがゆっくり膨らんだり縮んだりする（出たり消えたりは
  // 炭酸の泡のように見えたのでやめた。2026-10-03）。中心はます目の中のどこでもよく、隣にはみ出す
  // （周り 3×3 のます目を調べる。ずれが小さいと碁盤の目に見えた）。きわではほぼ全部のます目に入り、線のように連なる
  // 打ち寄せ（2026-10-03 ユーザー指定）：泡の帯が陸側へ最大 SURGE_A 押し出されては引く。陸側に出た時ほど粒が大きい。
  // 岸に沿って場所ごとにタイミングをずらし、波が岸を伝うように見せる。粒の置き場所（元の位置）は固定。
  // 重さ対策：この点の水の形の距離 sd と外向き（岸に垂直）の向き gn を 1 回だけ求め、近くの粒の距離は sd + gn·(粒 − この点) で近似する
  float dotF = 0.0, dotB = 0.0;
  const float SURGE_A = 0.1;
  // 風（2026-10-03 ユーザー指定）：W ＝ 風の強さ（揺れ幅、オフで 0）× 風の影響。wD ＝ 風下の向き（世界の xz）、wT ＝ 風の時刻（揺れの速さで進む）。
  // W ＝ 1（揺れ幅 1）の時に、風を入れる前の見た目とほぼ同じになるように合わせてある
  float W = vdStrength * uWindK, Wc = min( W, 2.0 );
  vec2 wD = length( vdDirection ) > 1e-6 ? normalize( vdDirection ) : vec2( 1.0, 0.0 );
  float wT = vdTime;
  float sa = SURGE_A * ( uType < 0.5 ? 0.5 : uType < 1.5 ? 0.6 : 0.0 );   // この点での打ち寄せの幅（風下の岸ほど大きい）。川は流れに沿うので小さく、水たまりは無し（2026-10-04）
  vec2 gn = vec2( 0.0, 1.0 );
  if ( sd > -0.6 && uType < 1.5 ) {   // 水たまりは泡を出さない
    // 粒の判定はギザギザ抜きのなめらかな形から見積もり、粒の中心でのギザギザを足す（画素ごとのギザギザで判定すると粒がちぎれた。2026-10-03）
    float sd0 = pxoWaterSDF0( pxoP.xz );
    gn = vec2( pxoWaterSDF0( pxoP.xz + vec2( 0.02, 0.0 ) ) - sd0, pxoWaterSDF0( pxoP.xz + vec2( 0.0, 0.02 ) ) - sd0 );
    gn = length( gn ) > 1e-6 ? normalize( gn ) : vec2( 0.0, 1.0 );
    // 風下の岸（岸の外向き gn が風下を向く）ほど強く、風上の岸ほど穏やかに打ち寄せる
    float dw = dot( gn, wD );
    sa *= clamp( 1.0 + 0.8 * Wc * max( dw, 0.0 ) - 0.5 * Wc * max( -dw, 0.0 ), 0.3, 2.0 );
    vec2 p = pxoP.xz, p0 = p - gn * sa * 0.5;
    vec2 drift = uType < 0.5 ? normalize( uFlow ) * uWT * uSpeed * 0.3 : vec2( 0.0 );   // 川：泡が下流へ流れる（2026-10-04）   // 押し出しの真ん中に戻した位置の周りのます目を調べる
    {   // 小さい粒：7cm ます目。元の中心が内側 25cm〜きわのすぐ外（1.5cm）の間（2026-10-03：内側の小さい泡を減らした。40cm → 25cm、内側ほど急に減る）
      vec2 fb = floor( ( p0 - drift ) / 0.07 );
      for ( int j = -2; j <= 2; j ++ ) for ( int i = -2; i <= 2; i ++ ) {
        vec2 fid = fb + vec2( float( i ), float( j ) );
        float f1 = pxoWH( fid ), f2 = pxoWH( fid + 41.7 ), f3 = pxoWH( fid + 83.3 ), f4 = pxoWH( fid + 29.9 ), f5 = pxoWH( fid + 7.7 );
        vec2 cs = ( fid + vec2( f4, f3 ) ) * 0.07, cw = cs + drift;   // 元の中心（世界の座標）
        float sdc = sd0 + dot( gn, cw - p ) + pxoJag( cw );
        if ( sdc > 0.015 || sdc < -0.25 ) continue;
        if ( f1 > min( 1.0, pow( 1.0 - clamp( -sdc / 0.25, 0.0, 1.0 ), 2.0 ) * 2.4 ) ) continue;   // きわほど多い
        float th = uWT * 1.2 + pxoWN( cs * 0.6 ) * 6.283, surge = 0.5 + 0.5 * sin( th );
        // 押し寄せている間（cos θ ≥ 0）だけ見え、引き始めると薄く縮みながら消える（波打ち際の泡。2026-10-03 ユーザー指定）
        float vis = smoothstep( -0.5, 0.15, cos( th ) );
        float r = mix( 0.22, 0.5, f2 ) * 0.07 * mix( 0.6, 1.2, surge ) * mix( 0.6, 1.0, vis ) * ( 0.92 + 0.08 * sin( uWT * mix( 0.9, 2.1, f5 ) + f5 * 6.283 ) );
        float d = length( p - ( cw + gn * sa * surge ) );
        dotF = max( dotF, ( 1.0 - smoothstep( r - 0.0056, r, d ) ) * mix( 0.6, 1.0, f3 ) * vis );
      }
    }
    {   // 大きい粒：16cm ます目（直径 7〜14cm ほど）。元の中心が内側 30cm〜きわのすぐ外（3cm）の間（2026-10-03：約 1.6 倍に増やした）
      vec2 bb = floor( ( p0 - drift + 0.37 ) / 0.16 );
      for ( int j = -1; j <= 1; j ++ ) for ( int i = -1; i <= 1; i ++ ) {
        vec2 bid = bb + vec2( float( i ), float( j ) );
        float b1 = pxoWH( bid + 3.3 ), b2 = pxoWH( bid + 61.1 ), b3 = pxoWH( bid + 97.7 ), b4 = pxoWH( bid + 11.3 ), b5 = pxoWH( bid + 19.9 );
        vec2 cs = ( bid + vec2( b4, b3 ) ) * 0.16 - 0.37, cw = cs + drift;
        float sdc = sd0 + dot( gn, cw - p ) + pxoJag( cw );
        if ( sdc > 0.03 || sdc < -0.3 ) continue;
        if ( b1 > pow( 1.0 - clamp( -sdc / 0.3, 0.0, 1.0 ), 1.4 ) * 1.8 ) continue;
        float th = uWT * 1.2 + pxoWN( cs * 0.6 ) * 6.283, surge = 0.5 + 0.5 * sin( th );
        float vis = smoothstep( -0.5, 0.15, cos( th ) );   // 押し寄せている間だけ
        float r = mix( 0.22, 0.44, b2 ) * 0.16 * mix( 0.6, 1.2, surge ) * mix( 0.6, 1.0, vis ) * ( 0.92 + 0.08 * sin( uWT * mix( 0.9, 2.1, b5 ) + b5 * 6.283 ) );
        float d = length( p - ( cw + gn * sa * surge ) );
        dotB = max( dotB, ( 1.0 - smoothstep( r - 0.0096, r, d ) ) * mix( 0.7, 1.0, b3 ) * vis );
      }
    }
  }
  float foam = max( dotF, dotB );
  if ( sd > 0.0 ) {   // 岸の外：はみ出した・打ち寄せた泡の粒と、引いた後の濡れた跡
    // 濡れた跡（2026-10-03 ユーザー指定）：泡の先がこの点まで届いていた時から経った時間で、暗さを薄くしていく（約 1.5 秒で乾く）。
    // 泡の先の位置は SURGE_A × surge（＋粒の大きさぶん）。surge = 0.5 + 0.5 sin θ なので、届いているのは sin θ > k の間。
    // 最後に届き終えた位相からの経過を、記録を持たずにその場で求める（打ち寄せの周期 約 5 秒の間に乾くので、前の回は気にしなくてよい）
    float wet = 0.0;
    float k = sa > 0.0 ? 2.0 * ( sd - 0.02 ) / sa - 1.0 : 2.0;   // この点まで届くのに要る sin θ
    if ( k < 1.0 ) {
      float th = uWT * 1.2 + pxoWN( pxoP.xz * 0.6 ) * 6.283, hi = 3.14159 - asin( max( k, -1.0 ) );
      float sinT = sin( th );
      float since = sinT > k ? 0.0 : mod( th - hi, 6.283 ) / 1.2;   // 届き終えてからの秒数
      // 泡の先の所は境目がくっきりしないよう、届く少し手前からなめらかに濡らす。届く一番先（SURGE_A）の外へも少しぼかして消す
      wet = max( exp( -since / 1.5 ), smoothstep( k - 0.35, k + 0.05, sinT ) );
      wet *= 1.0 - smoothstep( sa * 0.8, sa + 0.06, sd );
    }
    float wa = 0.3 * wet;
    float a = foam + ( 1.0 - foam ) * wa;
    if ( a < 0.01 ) discard;
    diffuseColor = vec4( vec3( 0.95, 0.98, 1.0 ) * foam / a, a );   // 泡は白、濡れた跡は暗く（黒を薄く重ねる）
  } else {
    // 2026-10-03 リアル寄りに作り直し（ユーザー指摘：野草や石に比べて大味）。色の段・大きなドットの波をやめ、
    // なめらかな深さの色、細かいさざ波（2 重）、照り返しのきらめき、斜めから見た空の映り込み、細い泡の線にした
    // 岸からの深さ（0：岸 … 1：一番深い所の目安）に「深さ」スライダー（uDepth）を掛ける。1 を超えた分はさらに濃い紺へ（2026-10-03 ユーザー指定）
    float t = clamp( -sd / max( 0.05, uDeep ) * uDepth, 0.0, 3.0 );
    vec3 col = mix( ${c3('#6fc2d6')}, ${c3('#2c78ad')}, smoothstep( 0.0, 0.45, t ) );
    col = mix( col, ${c3('#1b4a82')}, smoothstep( 0.45, 1.0, t ) );
    col = mix( col, ${c3('#081a33')}, smoothstep( 1.0, 2.6, t ) * 0.85 );
    float alpha = mix( 0.5, 0.96, smoothstep( 0.0, 0.3, t ) );   // 浅い所は床が透ける
    // さざ波：流れに沿って動く 3 重のなめらかなノイズ（2026-10-03 さらにリアル寄りに：2 重 → 3 重）。止まった水はゆっくり漂うだけ
    vec2 f = normalize( uFlow ), pp = vec2( -f.y, f.x );
    float sp = max( uSpeed, 0.12 );
    // 風下へさざ波を流す（湖・水たまりでも。川は流れと合わさる）。速さは「揺れの速さ」で進む風の時刻 wT と強さで
    vec2 pR = pxoP.xz - wD * wT * 0.55 * Wc;
    // 風紋（突風）：ときどき水面のまだらがザワッと波立ち、風下へ走る
    float gustP = vdGust * Wc * smoothstep( 0.55, 0.8, pxoWN( pxoP.xz * 0.3 - wD * wT * 0.9 ) );
    float ampW = ( 0.15 + 0.85 * Wc ) * ( 1.0 + 1.2 * gustP );   // 波立ちの強さ（無風でほぼ鏡）
    if ( uType > 1.5 ) ampW *= 0.4;   // 水たまりは浅いので波立ちが小さい
    vec2 q = vec2( dot( pR, f ), dot( pR, pp ) );
    float e = 0.04;
    vec2 ex = vec2( e / 2.2, 0.0 ), ey = vec2( 0.0, e / 3.4 );   // 傾きを取るずらし（流れの座標で。どの重なりでも 1 段目の e と同じ量）
    // 川（2026-10-04 ユーザー指定）：流れの速さを岸からの距離で変える（中央が速く、岸際は 3 割）。場所ごとに速さが違うと模様が
    // 時間とともに引き伸ばされるので、5 秒ごとに巻き戻す 2 枚の層を半周期ずらして重ねる（フローマップの 2 相）。湖・水たまりは一定の速さ
    float prof = uType < 0.5 ? mix( 0.3, 1.0, smoothstep( 0.0, 0.7, clamp( -sd / max( 0.05, uDeep ), 0.0, 1.0 ) ) ) : 1.0;
    float h0, hx, hy;
    if ( uType < 0.5 ) {
      float ph0 = fract( uWT * 0.2 ), ph1 = fract( uWT * 0.2 + 0.5 ), w0 = 1.0 - abs( 1.0 - 2.0 * ph0 ), w1 = 1.0 - w0;
      float T0 = ph0 * 5.0 * sp * prof, T1 = ph1 * 5.0 * sp * prof + 17.3;
      h0 = w0 * pxoRip( q, T0 ) + w1 * pxoRip( q, T1 );
      hx = w0 * pxoRip( q + ex, T0 ) + w1 * pxoRip( q + ex, T1 );
      hy = w0 * pxoRip( q + ey, T0 ) + w1 * pxoRip( q + ey, T1 );
    } else {
      h0 = pxoRip( q, uWT * sp ); hx = pxoRip( q + ex, uWT * sp ); hy = pxoRip( q + ey, uWT * sp );
    }
    vec2 g = vec2( hx - h0, hy - h0 ) / e;
    vec2 gw = f * g.x + pp * g.y;   // 流れの座標から世界の xz へ
    vec3 n = normalize( vec3( -gw.x * 0.06 * ampW, 1.0, -gw.y * 0.06 * ampW ) );
    vec3 nV = normalize( ( viewMatrix * vec4( n, 0.0 ) ).xyz ), vV = normalize( pxoV );   // 視点から見た座標の、面の向きとカメラへの向き
    col *= 1.0 + ( 0.16 * h0 - 0.1 ) * min( ampW, 2.0 );   // さざ波の明暗（風が強いほど強い）
    col *= 1.0 - 0.18 * gustP;   // 風紋はザワッと暗く
    // 水底のゆらめく光（コースティクス）：浅い所ほど強い。2 つのずれたノイズの差が 0 に近い所が細い光の網になる
    vec2 cq = pxoP.xz * 3.2;
    float ca = pxoWN( cq + vec2( uWT * 0.35, uWT * 0.21 ) ), cb = pxoWN( cq * 1.13 + vec2( -uWT * 0.27, uWT * 0.31 ) + 5.0 );
    float caus = pow( 1.0 - clamp( abs( ca - cb ) * 3.0, 0.0, 1.0 ), 6.0 );
    col += caus * ( 1.0 - smoothstep( 0.0, 1.0, t ) ) * vec3( 0.6, 0.66, 0.56 ) * ( 0.3 + 0.7 * min( Wc, 1.5 ) );   // 2026-10-03 ユーザー指定で強く（0.32 → 0.6、消える深さ 0.55 → 1.0）
    // 空の映り込み：波の向きで反射した方向に見える空の色（画面の空のグラデーション＋夕焼け）を映す（2026-10-03 ユーザー指定）。
    // 斜めから見るほど強い（シュリックの近似、水の反射率 2%）。空は「見えている色」なので照明を掛けず、発光として足す
    vec3 rW = transpose( mat3( viewMatrix ) ) * reflect( -vV, nV );   // 反射の向き（世界の座標）
    if ( rW.y < 0.02 ) rW.y = 0.02;   // 下向きの反射は地平線の色にとどめる
    float fr = 0.02 + 0.98 * pow( 1.0 - clamp( dot( nV, vV ), 0.0, 1.0 ), 5.0 );
    // 強さは演出として土台 35%（2026-10-03 ユーザー指摘：実物どおりの 2〜10% では、ふつうの角度から空を赤くしても水色のままだった）
    // 無風ほど空がくっきり映り、風が強いほど崩れて弱い（風 1 で前と同じ 35% ほど）。風紋の所はさらに弱い
    float rk = clamp( mix( 0.6, 0.25, clamp( Wc / 1.5, 0.0, 1.0 ) ) * ( 1.0 - 0.5 * gustP ) + 0.65 * fr, 0.0, 0.92 );
    col *= 1.0 - rk;
    totalEmissiveRadiance += pxoSkyColor( normalize( rW ) ) * rk;
    alpha = max( alpha, fr );
    // 白波（強風の時だけ）：深い所に、風と直角に伸びた白い筋がさざ波の山に立つ
    float wcap = smoothstep( 1.2, 2.2, W ) * smoothstep( 0.25, 0.6, t );
    if ( wcap > 0.0 ) {
      vec2 wq = vec2( dot( pR, wD ) * 2.5, dot( pR, vec2( -wD.y, wD.x ) ) * 0.7 );
      float ws = smoothstep( 0.72, 0.9, pxoWN( wq - vec2( wT * 0.8, 0.0 ) ) ) * smoothstep( 0.55, 0.85, h0 );
      foam = max( foam, ws * wcap * 0.85 );
    }
    // 瀬（2026-10-04 ユーザー指定）：川の中央寄り（流れの速い所）に、流れに沿って伸びた白い筋が立って下流へ流れる
    if ( uType < 0.5 && uRapid > 0.0 ) {
      vec2 rq = vec2( ( dot( pxoP.xz, f ) - uWT * sp * 0.6 ) * 0.9, dot( pxoP.xz, pp ) * 4.5 );
      float rs = smoothstep( 0.66, 0.9, pxoWN( rq ) ) * smoothstep( 0.45, 0.75, pxoWN( rq * vec2( 0.35, 0.5 ) + 9.1 ) );
      foam = max( foam, rs * smoothstep( 0.45, 0.9, prof ) * clamp( uRapid * ( 0.4 + 0.6 * min( sp, 2.0 ) ), 0.0, 1.0 ) * 0.9 );
    }
    col = mix( col, vec3( 0.95, 0.98, 1.0 ), foam );   // 泡（上で計算）
    // 水のふちは 10cm かけて透明にし、その下の地面は「濡れて暗い」として重ねる（2026-10-03 ユーザー指摘：ふちを 2cm で消していて、
    // その細い帯だけ乾いた明るい地面が見え、濡れた跡との境目がくっきりして水が浮いて見えた）。水 → 濡れた地面 → 乾いた地面となめらかに
    float aw = max( alpha * smoothstep( 0.0, -0.1, sd ), foam );
    float a2 = aw + ( 1.0 - aw ) * 0.3;
    diffuseColor = vec4( col * aw / a2, a2 );
    // 照り返しのきらめき（太陽・月の平行光の鏡面反射）：鋭い芯と広めのにじみ
    #if NUM_DIR_LIGHTS > 0
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        float rl = max( dot( reflect( -directionalLights[ i ].direction, nV ), vV ), 0.0 );
        totalEmissiveRadiance += ( pow( rl, 400.0 ) * 3.0 + pow( rl, 40.0 ) * 0.25 ) * directionalLights[ i ].color;
      }
    #endif
    // きらめき（2026-10-03 ユーザー指定）：鏡の反射の角度に関係なく、さざ波の山のところどころで小さな光の点が瞬く（演出）。
    // 5cm ほどのます目ごとに 1 点、粒ごとにずれた周期でふっと光って消える。明るさは太陽・月の光に合わせ、泡の上には出さない
    if ( uGlit > 0.0 ) {
      vec2 gq = pxoP.xz / 0.12, gid = floor( gq ), go = fract( gq ) - 0.5;   // 5cm ほどのます目（3cm ではふつうの距離で小さすぎた）
      float g1 = pxoWH( gid + 7.1 ), g2 = pxoWH( gid + 31.9 ), g3 = pxoWH( gid + 57.3 ), g4 = pxoWH( gid + 91.7 );
      float crest = smoothstep( 0.62, 0.95, h0 );   // さざ波の山ほど出やすい
      float tw = pow( max( 0.0, sin( uWT * mix( 1.5, 3.5, g2 ) + g3 * 6.283 ) ), 10.0 );   // ふっと光って消える
      float pt = 1.0 - smoothstep( 0.08, 0.26, length( go - ( vec2( g3, g4 ) - 0.5 ) * 0.4 ) );
      float glit = step( g1, 0.35 * min( uGlit, 2.0 ) * ( 0.5 + 0.5 * Wc ) ) * crest * tw * pt * ( 1.0 - foam );   // 風が強いほど多い
      vec3 lc = vec3( 0.0 );
      #if NUM_DIR_LIGHTS > 0
        for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) lc += directionalLights[ i ].color;
      #endif
      totalEmissiveRadiance += glit * ( lc * 1.8 + 0.15 ) * max( 0.5, uGlit );
    }
    totalEmissiveRadiance *= aw / a2;   // 空の映り込み・照り返しも水の濃さに合わせて薄める（ふちで光だけ残らないように）
  }
  if ( uHL > 0.5 && sd > -0.1 && sd < 0.03 ) diffuseColor = vec4( ${c3('#e2b348')}, 1.0 );   // カードのホバー：岸を金色に
}`);
  };
  m.extensions = { derivatives: true };   // dFdx（WebGL1 用。WebGL2 では標準）
  m.customProgramCacheKey = () => 'pxo-water-v35';
  return m;
}
function waterCircles(st) {   // 水場の円の並び（[x, z, r]）。種類ごとに決め方が違う（2026-10-04）
  if (st.type === 'lake') return lakeCircles(st);
  if (st.type === 'puddle') return puddleCircles(st);
  return riverCircles(st);
}
// 湖・池：楕円（長い方の半径 lakeSize、細長さ aspect、長い向き dir）の芯に円を並べ、そのまわりに小さめの円（ふくらみ）を足す
function lakeCircles(st) {
  const r = rng32(st.seed ?? 1), out = [];
  const a = Math.max(0.2, st.lakeSize ?? 5), asp = Math.max(1, st.aspect ?? 1.5), b = a / asp;
  const dir = deg(st.dir ?? 0), ux = Math.cos(dir), uz = -Math.sin(dir), vx = Math.sin(dir), vz = Math.cos(dir);   // 長い向き（川の向きと同じ取り方）とその直角
  const rough = 1 - Math.max(0, Math.min(1, st.smooth ?? 0.5)), cx = st.x ?? 0, cz = st.z ?? 0;
  const at = (u, v, rr) => out.push([cx + ux * u + vx * v, cz + uz * u + vz * v, rr]);
  const core = a - b, m = core > 0.01 ? Math.max(2, Math.ceil((2 * core) / (b * 0.6)) + 1) : 1;
  for (let i = 0; i < m; i++) {   // 芯：長い向きに半径 b の円を並べる（両端の円の外側がちょうど a）
    const u = m > 1 ? -core + (2 * core * i) / (m - 1) : 0;
    at(u, 0, b * (0.92 + 0.08 * r()) * (1 + rough * (r() - 0.5) * 0.5));
  }
  const lobes = Math.min(WATER_MAX_C - out.length, 5 + Math.round(3 * asp));
  for (let i = 0; i < lobes; i++) {   // ふくらみ：芯の縁の近くに小さめの円。ゴツゴツほど大小と出入りが大きい
    const t = r() * Math.PI * 2, u = Math.cos(t) * (core + b * 0.55), v = Math.sin(t) * b * 0.55;
    at(u, v, b * (0.3 + 0.25 * r()) * (1 + rough * (r() - 0.3)));
  }
  return out;
}
// 水たまり：数 puddles 個を、散らばり scatter の範囲（中心ほど多い）に置く。1 つは 1〜3 個の円（大きさ puddleSize ± ばらつき）
function puddleCircles(st) {
  const r = rng32(st.seed ?? 1), out = [];
  const n = Math.max(1, Math.min(16, Math.round(st.puddles ?? 6))), sz = Math.max(0.05, st.puddleSize ?? 0.8);
  const scatter = Math.max(0, st.scatter ?? 6), rough = 1 - Math.max(0, Math.min(1, st.smooth ?? 0.5));
  for (let k = 0; k < n; k++) {
    const a0 = r() * Math.PI * 2, d0 = n === 1 ? 0 : Math.min(1.5 * scatter, Math.abs(gauss(r)) * scatter / 2);
    const x = (st.x ?? 0) + Math.cos(a0) * d0, z = (st.z ?? 0) + Math.sin(a0) * d0, s = sz * (0.6 + 0.8 * r());
    out.push([x, z, s * 0.8]);
    const extra = Math.floor(r() * 3);
    for (let j = 0; j < extra && out.length < WATER_MAX_C; j++) {
      const t = r() * Math.PI * 2;
      out.push([x + Math.cos(t) * s * 0.5, z + Math.sin(t) * s * 0.5, s * (0.4 + 0.3 * r()) * (1 + rough * (r() - 0.5) * 0.6)]);
    }
  }
  return out;
}
function riverCircles(st) {   // 川（2026-10-03 から の形の決め方。分かれで小さな切れ端も散らす）。太さは 5 まで（2026-10-04 ユーザー指定：それより太いと川に見えない）
  const r = rng32(st.seed ?? 1);
  const pieces = Math.max(1, Math.min(4, Math.round(st.pieces ?? 1)));   // 分かれは 4 まで（2026-10-04 ユーザー指定）
  const len = Math.max(0, st.len ?? 12), wid = Math.max(0.1, Math.min(5, st.width ?? 2)), mean = Math.max(0, Math.min(1, st.meander ?? 0.4));
  const scatter = Math.max(0, st.scatter ?? 6), dir0 = deg(st.dir ?? 0), rough = 1 - Math.max(0, Math.min(1, st.smooth ?? 0.5));
  const perPiece = Math.floor(WATER_MAX_C / pieces), out = [];
  for (let k = 0; k < pieces; k++) {
    // 分かれ：1 つ目は中心、ほかは散らばりの範囲に。分かれた分だけ小さく（水たまり）
    const a0 = r() * Math.PI * 2, d0 = k === 0 ? 0 : scatter * (0.4 + 0.6 * r());
    let x = (st.x ?? 0) + Math.cos(a0) * d0, z = (st.z ?? 0) + Math.sin(a0) * d0;
    const sc = k === 0 ? 1 : 0.45 + 0.4 * r(), L = len * sc, W = wid * sc;
    const step = Math.max(W * 0.35, 0.05), n = Math.max(3, Math.min(perPiece, Math.ceil(L / step) + 1));
    const ph = r() * Math.PI * 2, fr = 0.6 + r() * 0.8, dir = dir0 + (k === 0 ? 0 : (r() - 0.5) * 2);
    // 線の真ん中が中心に来るよう、半分戻ってから歩く
    let ang = dir; x -= Math.cos(dir) * L / 2; z += Math.sin(dir) * L / 2;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      ang = dir + mean * 1.2 * Math.sin(t * Math.PI * 2 * fr + ph);   // 蛇行：向きを波打たせる
      const rr = (W / 2) * (1 + rough * (r() - 0.5) * 0.8);
      const j = rough * W * 0.35 * (r() - 0.5);   // 横へのゆがみ（縁がゴツゴツ）
      out.push([x + Math.sin(ang) * j, z + Math.cos(ang) * j, rr]);
      x += Math.cos(ang) * (L / Math.max(1, n - 1)); z -= Math.sin(ang) * (L / Math.max(1, n - 1));   // 0° で客席から見て右（+x）、プラスで奥（−z）
    }
  }
  return out;
}
function buildWater() {
  if (!stageCtx) return;
  HL_VER++;
  const g = stageCtx.water;
  for (const m of g.children) { m.geometry.dispose(); m.material.dispose(); }
  g.clear();
  WATER_AVOID = [];
  waterList.forEach((st, ci) => {
    if (st.show === false) return;
    const cs = waterCircles(st);
    if (!cs.length) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, rMax = 0;
    for (const [x, z, rr] of cs) { x0 = Math.min(x0, x - rr); x1 = Math.max(x1, x + rr); z0 = Math.min(z0, z - rr); z1 = Math.max(z1, z + rr); rMax = Math.max(rMax, rr); }
    const pad = WATER_WET + 0.2;
    if (st.avoid !== false) WATER_AVOID.push({ cs, k: Math.max(0.02, (st.smooth ?? 0.5) * rMax * 1.2) });   // 草・石をよける（既定でオン）
    const mat = waterMaterial(), u = mat.userData.u;
    cs.forEach(([x, z, rr], i) => u.uC.value[i].set(x, z, rr, 0));
    u.uN.value = cs.length;
    u.uK.value = Math.max(0.02, (st.smooth ?? 0.5) * rMax * 1.2);
    u.uDeep.value = Math.max(0.1, rMax);
    u.uDepth.value = Math.max(0.05, st.depth ?? 1);   // 深さ（2026-10-03）
    u.uJag.value = 1;   // 岸のギザギザ：最大で固定（2026-10-03 ユーザー指定。スライダーは外した）
    u.uGlit.value = Math.max(0, st.glitter ?? 1);   // きらめき（2026-10-03）
    u.uWindK.value = Math.max(0, Math.min(1, st.windK ?? 1));   // 風の影響（2026-10-03）
    u.uAvoidPl.value = st.avoidPlayers === false ? 0 : 1;   // 奏者をよける（2026-10-03）
    u.uFlow.value.set(Math.cos(deg(st.dir ?? 0)), -Math.sin(deg(st.dir ?? 0)));
    const type = st.type === 'lake' ? 1 : st.type === 'puddle' ? 2 : 0;   // 種類（2026-10-04）
    u.uType.value = type;
    u.uRapid.value = type === 0 ? Math.max(0, Math.min(1, st.rapids ?? 0)) : 0;
    u.uSpeed.value = type === 0 ? Math.max(0, st.flow ?? 1) : 0;   // 湖・水たまりは流れない
    const geo = new THREE.PlaneGeometry(x1 - x0 + pad * 2, z1 - z0 + pad * 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, (st.y ?? 0) + WATER_LIFT, (z0 + z1) / 2);
    mesh.receiveShadow = true; mesh.renderOrder = -10;
    mesh.userData.pxoCard = ci;
    g.add(mesh);
  });
}
// ---- カードのホバーで、そのオブジェクトの輪郭を色付ける（2026-10-03 ユーザー指定：どのカードを触ればよいか分かりにくい）----
// 3D モデル・石：形を画面上で少し太らせた複製の裏側だけを単色で描く（一回り大きい裏面。手前の本体からはみ出た分が輪郭になる）。
//   太らせる向きは、角で割れないよう同じ位置の頂点の法線をならしたもの。風で揺れる植物は輪郭も同じに揺らす。手前の物に隠れる所は出ない
// スクリーン・スカイドーム：厚みの無い 1 枚の面（絵の透明部分を抜いて見せる）なので、面の外周の線を描く（奥に隠れても見えるよう手前に描く）
const HL_COLOR = new THREE.Color('#e2b348');   // 画面の強調色（style.css の --accent）
const HL_PX = 3;                               // 輪郭の太さ [画素]
const HL_U = { pxoHlW: { value: HL_PX }, pxoHlRes: { value: new THREE.Vector2(1, 1) } };
let HL_VER = 0, hlTarget = null, hlBuilt = '', hlObjs = [];
/** ホバー中のカード（{ kind: 'model' | 'stone' | 'screen' | 'dome', index }。null で消す） */
export function setHighlight(t) { hlTarget = t ? { kind: t.kind, index: t.index } : null; }
const HULL_GEO = new WeakMap(), HULL_MAT = new Map();
function hullGeometry(g) {   // 位置が同じ頂点の法線をならした向き（pxoHullN）を足した複製。位置・面は元と共有
  if (HULL_GEO.has(g)) return HULL_GEO.get(g);
  const pa = g.attributes.position, na = g.attributes.normal, sum = new Map(), keyOf = [], v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    const k = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`; keyOf.push(k);
    if (na) n.fromBufferAttribute(na, i); else n.set(0, 1, 0);
    (sum.get(k) || sum.set(k, new THREE.Vector3()).get(k)).add(n);
  }
  const hn = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) { const s = sum.get(keyOf[i]).clone().normalize(); hn.set([s.x, s.y, s.z], i * 3); }
  const h = new THREE.BufferGeometry();
  h.setAttribute('position', pa); if (g.index) h.setIndex(g.index);
  if (na) h.setAttribute('normal', na);
  h.setAttribute('pxoHullN', new THREE.BufferAttribute(hn, 3));
  HULL_GEO.set(g, h);
  return h;
}
function hullMaterial(w) {   // w：風の揺れ方（植物）。null で揺らさない
  const key = w ? w.key : '-';
  if (HULL_MAT.has(key)) return HULL_MAT.get(key);
  const m = new THREE.MeshBasicMaterial({ color: HL_COLOR, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, HL_U);
    let vs = 'attribute vec3 pxoHullN;\nuniform float pxoHlW;\nuniform vec2 pxoHlRes;\n' + shader.vertexShader;
    if (w) {
      Object.assign(shader.uniforms, WIND_U, { vdHeight: { value: w.H }, vdFlex: { value: w.flex }, vdFreq: { value: w.freq }, vdLag: { value: w.lag } });
      vs = WIND_GLSL + '\n' + vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat vdSlope; transformed = verdantBend(transformed, verdantRoot(), verdantDirection(), vdSlope);');
    }
    shader.vertexShader = vs.replace('#include <project_vertex>', `#include <project_vertex>
{ vec3 hn = pxoHullN;
#ifdef USE_INSTANCING
  hn = mat3( instanceMatrix ) * hn;
#endif
  vec2 cn = ( projectionMatrix * vec4( normalize( mat3( modelViewMatrix ) * hn ), 0.0 ) ).xy;
  if ( length( cn ) > 1e-6 ) gl_Position.xy += normalize( cn ) * pxoHlW * gl_Position.w * 2.0 / pxoHlRes; }`);
  };
  m.customProgramCacheKey = () => `pxo-hull-v1:${key}`;
  HULL_MAT.set(key, m);
  return m;
}
const HL_LINE_MAT = new THREE.LineBasicMaterial({ color: HL_COLOR, depthTest: false, transparent: true, toneMapped: false });
// 面全体にうっすら重ねる色（線は WebGL では 1 画素より太くできず、それだけでは見えにくかった）
const HL_TINT_MAT = new THREE.MeshBasicMaterial({ color: HL_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
function borderLines(mesh) {   // 面の外周（1 つの三角形にしか使われていない辺）の線と、面に重ねる色
  const g = mesh.geometry, pa = g.attributes.position, idx = g.index, cnt = new Map();
  const n = idx ? idx.count : pa.count, at = (i) => (idx ? idx.getX(i) : i);
  for (let i = 0; i < n; i += 3) for (const [a, b] of [[at(i), at(i + 1)], [at(i + 1), at(i + 2)], [at(i + 2), at(i)]]) {
    const k = a < b ? `${a},${b}` : `${b},${a}`; cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const pts = [];
  for (const [k, c] of cnt) if (c === 1) { const [a, b] = k.split(',').map(Number); pts.push(new THREE.Vector3().fromBufferAttribute(pa, a), new THREE.Vector3().fromBufferAttribute(pa, b)); }
  const clip = mesh.material?.clippingPlanes || null;   // スクリーンは面と同じ所で切る
  const grp = new THREE.Group();
  const lm = HL_LINE_MAT.clone(); lm.clippingPlanes = clip;
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lm); l.renderOrder = 9999;
  const tm = HL_TINT_MAT.clone(); tm.clippingPlanes = clip;
  const t = new THREE.Mesh(mesh.geometry, tm); t.renderOrder = 9998;   // 形は面と共有（捨てない）
  grp.add(t, l);
  grp.userData.pxoHlDispose = () => { l.geometry.dispose(); lm.dispose(); tm.dispose(); };
  return grp;
}
function updateHighlight(renderer) {
  renderer.getDrawingBufferSize(HL_U.pxoHlRes.value);
  const key = hlTarget ? `${hlTarget.kind}:${hlTarget.index}:${HL_VER}` : '';
  if (key === hlBuilt) return;
  hlBuilt = key;
  for (const o of hlObjs) { o.parent?.remove(o); o.userData.pxoHlDispose?.(); }
  hlObjs = [];
  if (stageCtx) for (const m of stageCtx.water.children) m.material.userData.u.uHL.value = 0;   // 水は材質の岸の線で示す
  if (!hlTarget || !stageCtx) return;
  const { kind, index } = hlTarget;
  if (kind === 'water') { for (const m of stageCtx.water.children) if (m.userData.pxoCard === index) m.material.userData.u.uHL.value = 1; return; }
  const add = (parent, o) => { o.castShadow = false; o.receiveShadow = false; o.userData.pixSkip = true; parent.add(o); hlObjs.push(o); };
  if (kind === 'model' || kind === 'stone' || kind === 'grass') {
    const g = kind === 'model' ? stageCtx.models : kind === 'stone' ? stageCtx.stones : stageCtx.grass;
    for (const root of g.children) {
      if (root.userData.pxoCard !== index) continue;
      root.traverse((n) => {
        if (!n.isMesh || hlObjs.includes(n)) return;
        const w = n.customDepthMaterial?.onBeforeCompile && kind === 'model' ? (root.userData.pxoWind || null) : null;
        if (n.isInstancedMesh) {
          const h = new THREE.InstancedMesh(hullGeometry(n.geometry), hullMaterial(n.userData.pxoWind || null), n.instanceMatrix.count);   // 草は輪郭も一緒に揺らす
          h.instanceMatrix = n.instanceMatrix; h.count = n.count; h.frustumCulled = false;
          add(n, h);
        } else add(n, new THREE.Mesh(hullGeometry(n.geometry), hullMaterial(w)));
      });
    }
  } else {
    const g = kind === 'screen' ? stageCtx.screens : stageCtx.domes;
    for (const m of g.children) if (m.isMesh && m.name === `${kind}:${index}`) add(m, borderLines(m));
  }
}
// GLB のサムネイル（2026-10-02 ユーザー指定：カードに何も出なかった）。読み込んだモデルだけを斜め上から 1 回描いて画像（dataURL）にする。
// 舞台の renderer の状態（影・クリッピング・大きさ）を乱さないよう、専用の小さな renderer で描く。結果は url ごとに使い回す
const THUMB_PX = 160;   // サムネイル 1 辺の画素数（カードの表示は高さ 96px）
const THUMB = new Map();   // url → dataURL
let thumbRenderer = null;
export function modelThumb(url, cb) {
  if (!url) return;
  if (THUMB.has(url)) { cb(THUMB.get(url)); return; }
  const e = loadGlb(url);
  const draw = () => {
    if (!e.scene) return;
    if (!THUMB.has(url)) {
      if (!thumbRenderer) {
        thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbRenderer.setClearColor(0x000000, 0);
        thumbRenderer.setSize(THUMB_PX, THUMB_PX, false);
      }
      const scene = new THREE.Scene();
      const o = e.scene.clone(true);
      scene.add(o);
      scene.add(new THREE.AmbientLight(0xffffff, 0.4));
      const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(1, 2, 1.5); scene.add(sun);
      // 全体が収まる距離：外接球の半径を画角の半分で割る（少し余白）
      const box = new THREE.Box3().setFromObject(o);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
      const dist = (sph.radius / Math.sin(deg(15))) * 1.05;
      cam.position.copy(sph.center).add(new THREE.Vector3(0.8, 0.6, 1.2).normalize().multiplyScalar(dist));
      cam.lookAt(sph.center);
      thumbRenderer.render(scene, cam);
      THUMB.set(url, thumbRenderer.domElement.toDataURL('image/png'));
    }
    cb(THUMB.get(url));
  };
  if (e.loading) (e.waiters ||= []).push(draw); else draw();
}
// テクスチャだけドットにする（2026-10-01 ユーザー指定：形はなめらかなまま）。texPix 0〜1 → 一辺の画素数（0 は元のまま）。
// 縮めた画像を補間なし（最近傍）で貼る。縮めるのは粗さを変えた時だけ（キャッシュ）
const texPixSize = (v) => (v > 0 ? Math.max(8, Math.round(512 * (1 - Math.min(1, v)) ** 2)) : 0);
const PIX_TEX = new Map(), PIX_MAT = new Map();
function pixTexture(tex, size) {
  const img = tex?.image;
  if (!img || !img.width) return tex;
  const key = `${tex.uuid}:${size}`;
  if (PIX_TEX.has(key)) return PIX_TEX.get(key);
  const k = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);   // 縮める時はなめらかに平均（1 画素 ＝ その範囲の平均色）
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.flipY = tex.flipY; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.encoding = tex.encoding;
  t.offset.copy(tex.offset); t.repeat.copy(tex.repeat); t.rotation = tex.rotation; t.center.copy(tex.center);
  PIX_TEX.set(key, t);
  return t;
}
function pixMaterial(m, size) {
  const key = `${m.uuid}:${size}`;
  if (PIX_MAT.has(key)) return PIX_MAT.get(key);
  const c = plantMat(m.clone());
  if (m.map) c.map = pixTexture(m.map, size);
  if (m.emissiveMap) c.emissiveMap = pixTexture(m.emissiveMap, size);
  PIX_MAT.set(key, c);
  return c;
}
function buildModels() {
  if (!stageCtx) return;
  const g = stageCtx.models;
  g.clear();   // 形と材質は GLB の読み込み結果を使い回すので捨てない
  HL_VER++;   // 作り直すと輪郭（カードのホバー）の付け先が変わる
  modelList.forEach((m, ci) => {
    if (m.show === false || !m.src) return;
    const e = loadGlb(m.src);
    if (!e.scene) return;   // 読み込み中・失敗（読み終わったら組み直される）
    const o = e.scene.clone(true);
    o.userData.pxoCard = ci;   // どのカードの物か（ホバーの輪郭）
    o.position.set(m.x ?? 0, m.y ?? 0, m.z ?? 0);
    o.rotation.y = deg(m.rot ?? 0);
    o.scale.setScalar(MODEL_M * (m.scale > 0 ? m.scale : 1));
    const ps = texPixSize(m.texPix ?? 0);
    if (ps) o.traverse((n) => { if (n.isMesh) n.material = Array.isArray(n.material) ? n.material.map((x) => pixMaterial(x, ps)) : pixMaterial(n.material, ps); });
    if (e.wind) { applyWind(o, e.wind); o.userData.pxoWind = e.wind; }   // 植物（VERDANT の GLB）だけ風で揺らす。粗さの材質（複製）にも当て直す
    o.traverse((n) => { if (n.isMesh) n.layers.enable(MODEL_SHADOW_LAYER); });   // 奏者に落とす影の元（updateModelShadow で太陽から描く）
    g.add(o);
  });
}

export function setDomes(list) {
  domeList = (list || []).map((o) => ({ ...o }));
  buildDomes();
}

function buildDomes() {
  if (!stageCtx) return;
  HL_VER++;
  const g = stageCtx.domes;
  g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });   // 素材のテクスチャは使い回すので捨てない
  g.clear();
  // 半径の大きい（遠い）ものから描く。半透明の重なりを正しく出すため
  const order = domeList.map((d, i) => ({ d, i })).sort((a, b) => b.d.r - a.d.r);
  order.forEach(({ d, i }, k) => {
    if (d.show === false || !d.src) return;
    const tex = mediaTexture(d.src);
    const px = mediaSize(tex);
    if (!px) return;                                // まだ読み込めていない（読み終わったら組み直される）
    const span = deg(Math.max(20, Math.min(360, d.span ?? 180)));
    const tiles = Math.max(0.1, d.tiles ?? 1);
    const m = screenMaterial(d, tex);
    m.side = THREE.DoubleSide;                      // 外からカメラを引いた時も見えるように（2026-09-13 ユーザー指定）
    // 不透明なら奥行きも書く。手前に来たドームがパート名を隠せる（2026-09-13 ユーザー指定）。
    // 抜いた画素は discard するので、透明な部分が後ろを消すことはない
    m.depthWrite = (d.opacity ?? 1) >= 1;
    m.uniforms.uLoop.value = 1;
    m.uniforms.uRepeat.value = tiles;
    m.uniforms.uFill.value = 1;
    m.uniforms.uFade.value = Math.max(0, Math.min(0.49, d.fade ?? 0));   // 端のぼかし（範囲に対する割合）
    // 縦は横に連動させる：1 枚ぶんの横幅（角度）に素材の縦横比を掛けたぶんだけの帯にし、
    // 地平線の上にのせる。枚数を増やすと横も縦も一緒に小さくなる（2026-09-13 ユーザー指定）
    const thetaLen = Math.min(Math.PI / 2, (span / tiles) * (px.h / px.w));
    const thetaStart = Math.PI / 2 - thetaLen;
    // 正面（客席から見える側 = 舞台の奥 -z）が中心に来るよう phi を回す。
    // three.js の球は phi = π/2 が +z なので、-z は -π/2（2026-09-13 修正：180 度で右半分だけになっていた）
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(d.r, 96, 24, -Math.PI / 2 - span / 2, span, thetaStart, thetaLen), m,
    );
    mesh.name = `dome:${i}`;
    mesh.position.set(0, d.y ?? 0, SEAT_SHIFT_Z);
    mesh.userData.scroll = { speed: d.flow === false ? 0 : d.speed || 0, period: 360 / tiles };   // flow：「流れる速度」のチェック（オフで流さない）   // 1 周期 = 素材 1 枚ぶんの角度 [deg]
    mesh.renderOrder = -200 + k;                    // 何よりも先に描く
    g.add(mesh);
  });
}

// ---- 天気（雨・雪・雷）。2026-09-17 ユーザー指定 ----
// 一番奥のひな壇の上に、下段のスクリーンと同じ弧・同じ切り口の面を 3 枚立て、雨や雪の粒をシェーダーで描く（素材は要らない）。
// 3 枚はひな壇の奥行きの 奥・中・手前 に離して置くので、キャラクターのスクリーンの前にも後ろにも降る。
// 奥の層ほど粒を細かく・遅く・薄くして奥行きを出す。粒はドットの格子に合わせ、コマ送りで動かす（既定 12 コマ/秒。ドット絵の見た目を保つ）。
// 雷は一番奥の層だけが光る。同時に舞台も一瞬照らす（flashLight）。
// どれも「時刻 → 状態」の純関数（updateScreens と同じ。後でオフラインに書き出しても同じ絵になる）。
// ※ スカイドーム 3 枚の後ろに映す方式も試したが却下（2026-09-17）。コードはコミット fb918a1 に残っている
// 奥 → 手前の順。dot: 1 ドットの大きさ [unit]、fall: 雨が 1 秒に落ちるドット数（速さ 1 のとき）、alpha: 濃さ
const WEATHER_LAYERS = [
  { dot: 0.11, fall: 36, alpha: 0.45 },
  { dot: 0.16, fall: 48, alpha: 0.7 },
  { dot: 0.24, fall: 60, alpha: 1.0 },
];
const WEATHER_SHADER = {
  vertexShader: `
    varying vec2 vUv;
    #include <clipping_planes_pars_vertex>
    void main() {
      vUv = vec2(1.0 - uv.x, uv.y);   // 円筒を内側（客席側）から見るので左右を返す：x が増える向き = 客席から見て右
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
    }`,
  fragmentShader: `
    uniform float uTime;      // コマの刻みに切り捨てた時刻 [s]（コマ数は updateWeather が決める）
    uniform float uSpeed;     // 落ちる速さの倍率
    uniform float uWidth;     // 雨の筋の太さ（1 ドットの幅に対する割合 0〜1）
    uniform float uType;      // 0 なし / 1 雨 / 2 雪
    uniform float uAmount;    // 降りの強さ 0〜1
    uniform float uWind;      // 風 −1〜1（正で右へ流れる）
    uniform float uFall;      // 雨が 1 秒に落ちるドット数（速さ 1 のとき）
    uniform float uAlpha;
    uniform float uFade;      // 左右の端を消していく幅（範囲に対する割合）
    uniform vec2 uCells;      // 横・縦のドット数
    uniform vec3 uLight;      // スカイドームと共通の照明の倍率
    uniform float uFlash;     // 雷の明るさ 0〜1（一番奥の層だけ）
    uniform vec4 uBolt;       // x: 稲妻の横位置 0〜1 / y: 乱数の種 / z: 下端の高さ 0〜1 / w: 稲妻を描くか
    uniform float uBloomPass; // 1 = 全体ブルームの素材として描いている（renderFrame）。本編の深度で隠れた画素は捨てる
    uniform sampler2D uDepth; uniform vec2 uRes;
    // 輝き（2026-09-17 ユーザー指定）：一部の粒が一瞬だけ白熱して光る（雨は先頭の短い縦棒、雪は十字形）。光源（太陽・月）の方角に近いほど、逆光なほど当たりやすい
    uniform float uGlint;     // 「輝き」スライダー 0〜2
    uniform vec4 uSun;        // x: 光源の方角の横位置（面の 0〜1。外にもなる） / y: 方角に寄る分の量（逆光の度合い × 光量） / z: 横位置の差 → 角度の尺度 / w: どこでも光る分の量
    uniform vec3 uGlintCol;   // きらめきの色（光源の色を白に寄せたもの）
    uniform float uStorm;     // 雷の明るさ 0〜1（全層。光っている間は一斉にきらめく）
    varying vec2 vUv;
    #include <clipping_planes_pars_fragment>
    float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    // 雨：ドット d を通る筋を調べる。x: 筋の中か / y: 筋の先頭（一番下）のドットか / z: その筋が今きらめいているか。
    // 風のぶん斜めに傾けた「筋」ごとに、周期・長さ・位相を乱数で決めて流す。きらめきの縦棒を描くため、下のドットからも呼ぶ
    vec3 rainAt(vec2 d, float slot, float prob) {
      float cx = d.x + floor(d.y * uWind * 0.6);
      if (h11(cx) >= uAmount * 0.55) return vec3(0.0);
      float P = 26.0 + floor(h11(cx + 7.3) * 30.0);
      float L = 6.0 + floor(h11(cx + 3.1) * 8.0);   // 粒の長さ 6〜13 ドット（3〜6 の 2 倍。2026-09-17 ユーザー指定）
      float ph = floor(h11(cx + 11.7) * P);
      float fall = floor(uTime * uFall * uSpeed * (0.85 + 0.3 * h11(cx + 5.5)));
      float y = d.y + fall + ph, m = mod(y, P);
      if (m >= L) return vec3(0.0);
      float n = floor(y / P);                        // この筋の通し番号（同じ列を次々に落ちてくる粒を区別する）
      return vec3(1.0, m < 0.5 ? 1.0 : 0.0, h21(vec2(cx * 1.7 + n * 13.1, slot + n * 3.3)) < prob ? 1.0 : 0.0);
    }
    void main() {
      #include <clipping_planes_fragment>
      if (uBloomPass > 0.5 && gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 0.00002) discard;   // 奏者・舞台・不透明な雲の後ろ
      vec2 d = floor(vUv * uCells);   // ドットの座標（x: 左から、y: 下から）
      vec4 o = vec4(0.0);
      // きらめきの当たりやすさ（粒 1 つ・時間枠 1 つあたりの確率）。時間枠は 1/6 秒：12 コマ/秒なら 2 コマ光る
      float slot = floor(uTime * 6.0);
      float ang = (vUv.x - uSun.x) * uSun.z;
      float prob = uGlint * (0.02 * uSun.w + 0.10 * uSun.y * exp(-ang * ang)) + uStorm * 0.35 * min(1.0, uGlint);
      float glint = 0.0;   // 1 = きらめきの芯、0.7 = 腕（雨は下の 1 ドット、雪は上下左右）
      float addLight = 0.0;   // 1 = 背景に光を足して描く（雪の粒。明るい空の上で灰色の点に見えないように。2026-09-19 ユーザー指定）
      if (uType > 0.5 && uType < 1.5) {
        vec3 s = rainAt(d, slot, prob);
        float fx = fract(vUv.x * uCells.x) - 0.5;   // ドットの中での横位置（中央が 0）。筋はドットの中央に細く描く
        bool thin = abs(fx) < uWidth * 0.5;          // 筋の幅の内側か。きらめきの縦棒も筋と同じ太さにする（ドットいっぱいだと太すぎた。2026-09-17 ユーザー指定）
        if (thin && s.x > 0.5) {
          if (s.y * s.z > 0.5) glint = 1.0;          // きらめいている筋の先頭
          else o = s.z > 0.5 ? vec4(mix(vec3(0.72, 0.82, 1.0), uGlintCol, 0.7), 0.9 * uAlpha) : vec4(vec3(0.72, 0.82, 1.0), 0.6 * uAlpha);
        }
        if (thin && glint < 0.5 && prob > 0.0) {     // 雨は縦棒だけ（十字にしない。2026-09-17 ユーザー指定）：きらめいている先頭の、すぐ下のドットも光らせる
          vec3 c = rainAt(d + vec2(0.0, 1.0), slot, prob);
          if (c.y * c.z > 0.5) glint = 0.7;
        }
      } else if (uType > 1.5) {
        // 雪：7 ドット角のマスに 1 粒。全体を下へ送り、粒ごとに左右へゆらす
        float G = 7.0;
        float fy = floor(uTime * uSpeed * 6.0 * (0.6 + 0.4 * uFall / 60.0));   // 雪は 1 秒に 5〜6 ドット（速さ 1 のとき）
        vec2 q = vec2(d.x - floor(fy * uWind * 1.2), d.y + fy);
        vec2 cell = floor(q / G), loc = q - cell * G;
        float r = h21(cell);
        if (r < uAmount * 0.8) {
          vec2 fp = 1.0 + floor(vec2(h21(cell + 3.7), h21(cell + 9.1)) * (G - 3.0));
          fp.x = clamp(fp.x + floor(sin(uTime * 1.3 + r * 40.0) * 1.5 + 0.5), 0.0, G - 1.0);
          vec2 df = abs(loc - fp);
          // 雨の半分の当たりやすさ：雪のきらめきは 5 ドットの十字で雨の縦棒より大きく、同じ確率でも雨より光って見えた（2026-09-18〜19 ユーザー指定）
          bool g = h21(cell * 1.3 + vec2(slot, slot * 0.37)) < prob * 0.5;
          if (df.x < 0.5 && df.y < 0.5) { o = vec4(vec3(1.0), 0.95 * uAlpha); addLight = 1.0; if (g) glint = 1.0; }
          else if (g && df.x + df.y < 1.5 && (df.x < 0.5 || df.y < 0.5)) glint = 0.7;   // 十字の腕（上下左右の隣）
        }
      }
      // 上と左右の端は、ドットを乱数で間引いて消していく（半透明にしない＝ドット絵のまま）
      float keep = (1.0 - smoothstep(0.6, 1.0, vUv.y));
      if (uFade > 0.001) keep *= smoothstep(0.0, uFade, vUv.x) * smoothstep(0.0, uFade, 1.0 - vUv.x);
      if (h21(d + 0.5) > keep) { o.a = 0.0; glint = 0.0; }
      o.rgb *= max(uLight, vec3(0.12));   // 夜でも粒が完全には消えないように
      // きらめきは自分で光る（照明の倍率は掛けない）。ブルームの素材へ描く時だけ 2.5 倍にして、光った粒だけを強くにじませる
      if (glint > 0.0) o = vec4(uGlintCol * (0.6 + 0.4 * glint) * (uBloomPass > 0.5 ? 2.5 : 1.0), glint * mix(0.6, 1.0, uAlpha));
      // 雷：空（この層）が稲妻の方角を中心に光る。明るさは 5 段に丸め、段の間はドットで混ぜる
      if (uFlash > 0.001) {
        float dx = (vUv.x - uBolt.x) * 3.0;
        float gl = uFlash * (0.3 + 0.7 * exp(-dx * dx)) * (0.45 + 0.55 * vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
        gl *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(0.0, 0.3, 1.0 - vUv.x);   // 層の端に光の切れ目を出さない
        gl = floor(gl * 5.0 + h21(d + 1.5)) / 5.0 * 0.85;   // 段の境目はドットの乱数で混ぜる（輪郭線にしない）
        float a2 = gl + o.a * (1.0 - gl);
        if (a2 > 0.001) o = vec4((vec3(0.85, 0.9, 1.0) * gl + o.rgb * o.a * (1.0 - gl)) / a2, a2);
        if (uBolt.w > 0.5 && vUv.y > uBolt.z && vUv.y < 0.8) {
          // 稲妻：5 ドットごとの節を乱数で左右に振り、節の間を直線でつなぐ（太さ 2 ドット）
          float S = 5.0, k = floor(d.y / S), f = (d.y - k * S) / S;
          float o0 = (h11(k + uBolt.y * 91.0) - 0.5) * 16.0, o1 = (h11(k + 1.0 + uBolt.y * 91.0) - 0.5) * 16.0;
          float bx = floor(uBolt.x * uCells.x + mix(o0, o1, f) + 0.5);
          if (d.x - bx > -0.5 && d.x - bx < 1.5) o = vec4(1.0);
        }
      }
      if (o.a < 0.01) discard;
      gl_FragColor = o;
      #include <tonemapping_fragment>
      // 色に不透明度を掛けて出す（材質は premultipliedAlpha：画面 = 出した色 + 背景 ×(1 - a)）。
      // きらめきだけ a = 0 にして「背景に光を足す」：上塗りだと明るい空の上で背景より暗いグレーの点に見えた（2026-09-18 ユーザー指定）
      gl_FragColor.rgb *= gl_FragColor.a;
      if (glint > 0.0 || addLight > 0.5) gl_FragColor.a = 0.0;
    }`,
};
// 全体ブルームの対象にする（2026-09-17 ユーザー指定）：本編の「明るい部分」とは別に、天気の層だけを
// ブルームの素材（1/4 の絵）へ描き足す。閾値に関係なく光る。本編の 8bit の絵では粒が空に紛れて閾値を超えないため。
// レイヤー 1 は太陽の円盤（sunOnly）が使っている
const WEATHER_LAYER = 2;
const WEATHER_BLOOM = { pass: { value: 0 }, depth: { value: null }, res: { value: new THREE.Vector2(1, 1) } };
const WEATHER_GLINT_COL = { value: new THREE.Color(1, 1, 1) };   // きらめきの色（全層で共有。updateWeather が光源の色から決める）
const GLINT_SIGMA = 0.6;       // 光源の方角から、きらめきやすさが落ちていく角度の幅 [rad]
const _wDir = new THREE.Vector3(), _wWhite = new THREE.Color(1, 1, 1), _wStorm = new THREE.Color(0.9, 0.95, 1);
let weatherState = { type: 'none', amount: 0.5, wind: 0.2, thunder: 0, fps: 12, speed: 1, width: 0.3, pos: 0.5, height: 12, glint: 1 };

/** 天気の設定。type: 'none' | 'rain' | 'snow'、amount: 降りの強さ 0〜1、wind: 風 −1〜1、thunder: 雷の頻度 [回/分]（0 でなし）、
 *  fps: 粒の動きのコマ数 [1/s]、speed: 落ちる速さの倍率（コマ数を変えても 1 秒に落ちる距離は変わらない）、width: 雨の筋の太さ（ドット幅に対する割合）、
 *  pos: 中の層の奥行き 0〜1（奥の層は 1、手前の層は 0 に固定）、height: 面の高さ [unit]、glint: 輝き 0〜2（0 できらめかない） */
export function setWeather(o = {}) {
  const was = weatherState, now = { ...weatherState, ...o };
  weatherState = now;
  const need = (w) => w.type !== 'none' || w.thunder > 0;
  // 要らない時は層ごと外す（描画の負荷を残さない）。面の位置・寸法が変わった時も組み直す
  if (need(was) !== need(now) || was.pos !== now.pos || was.height !== now.height) buildWeather();
}

function buildWeather() {
  if (!stageCtx) return;
  const g = stageCtx.weather;
  g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  g.clear();
  if (weatherState.type === 'none' && !(weatherState.thunder > 0)) return;
  // 面を 1 枚作る。r: 半径、phi0 / phiLen: 円筒の角（+z から）、h: 高さ、yBottom: 下端の高さ、L: 層の設定、fade: 左右の端を消す幅、clip: 切り口
  const sheet = ({ r, phi0, phiLen, h, yBottom, L, fade, clip, segs }) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSpeed: { value: 1 }, uWidth: { value: 0.3 }, uType: { value: 0 }, uAmount: { value: 0 }, uWind: { value: 0 },
        uFall: { value: L.fall }, uAlpha: { value: L.alpha },
        uFade: { value: Math.max(0, Math.min(0.49, fade ?? 0)) },
        uCells: { value: new THREE.Vector2(Math.round((r * phiLen) / L.dot), Math.round(h / L.dot)) },
        uLight: DOME_LIGHT,
        uFlash: { value: 0 }, uBolt: { value: new THREE.Vector4(0.5, 0, 0.1, 0) },
        uGlint: { value: 0 }, uSun: { value: new THREE.Vector4(0.5, 0, 1, 0) }, uGlintCol: WEATHER_GLINT_COL, uStorm: { value: 0 },
        uBloomPass: WEATHER_BLOOM.pass, uDepth: WEATHER_BLOOM.depth, uRes: WEATHER_BLOOM.res,   // 全層で共有（renderFrame が切り替える）
      },
      vertexShader: WEATHER_SHADER.vertexShader, fragmentShader: WEATHER_SHADER.fragmentShader,
      transparent: true, premultipliedAlpha: true, side: THREE.DoubleSide, depthWrite: false, clipping: true, toneMapped: true,
    });
    if (clip) m.clippingPlanes = clip;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs, 1, true, phi0, phiLen), m);
    mesh.position.set(0, yBottom + h / 2, SEAT_SHIFT_Z);
    mesh.layers.enable(WEATHER_LAYER);              // 本編（0）に加えて、ブルーム用の描画でも拾う
    return mesh;
  };

  if (!stageCtx.screenBase) return;   // スクリーンを立てる段（BACK_ROWS の screen: true）が無ければ出さない
  const { rIn, rOut, y, thMin, thMax, segs, clip, ro } = stageCtx.screenBase;
  const pos = Math.max(0, Math.min(1, weatherState.pos ?? 0.5));
  const h = Math.max(1, weatherState.height ?? 12);
  // 3 層をひな壇の奥行きいっぱいに離して置く（2026-09-17 ユーザー指定）：奥の層 = 一番奥（1）、中の層 = 「奥行き」スライダー、手前の層 = 一番手前（0）。
  // キャラクターのスクリーンの前にも後ろにも降る
  const layerPos = [1, pos, 0];
  WEATHER_LAYERS.forEach((L, k) => {
    const lp = layerPos[k];
    const r = rIn + (rOut - rIn) * lp;
    // キャラクターのスクリーンとの前後：buildScreens は奥（pos 大）から k = 0,1,2… の順に ro − 1 + k × 0.05 で描く。
    // 天気の各層は「自分より奥のスクリーンの枚数」ぶんだけ後＝その直後に描く
    const nFar = screenList.filter((sc) => sc.pos > lp).length;
    // 円筒の角 φ = π − θ（θ は −z から。ひな壇の壁・スクリーンと同じ）。左右の端は幅の 8% だけ粒を間引いて切り口をやわらげる
    const mesh = sheet({ r, phi0: Math.PI - thMax, phiLen: thMax - thMin, h, yBottom: y, L, fade: 0.08, clip, segs });
    mesh.name = `weather:${k}`;
    mesh.userData.th = { min: thMin, max: thMax };   // 面の左端・右端の方角（−z から +x へ）。光源の方角を面の横位置に直すのに使う
    mesh.renderOrder = ro - 1 + (nFar - 0.5) * 0.05 + k * 0.001;
    mesh.userData.far = k === 0;                    // 雷で光るのは一番奥の層だけ
    g.add(mesh);
  });
}

// 雷の時刻表：2 秒ごとの枠に、頻度に応じた確率で 1 回。枠の番号から乱数を引くので、同じ時刻なら必ず同じ雷になる
const THUNDER_SLOT = 2;
const rnd1 = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function lightningAt(t, perMin) {
  let flash = 0, bolt = null;
  if (!(perMin > 0)) return { flash, bolt };
  const k0 = Math.floor(t / THUNDER_SLOT);
  for (const k of [k0, k0 - 1]) {   // 前の枠の雷の余韻も拾う
    if (k < 0 || rnd1(k) >= (perMin * THUNDER_SLOT) / 60) continue;
    const tau = t - (k + rnd1(k + 0.5) * 0.9) * THUNDER_SLOT;
    if (tau < 0 || tau > 1.2) continue;
    // 1 発目 → 0.16 秒後に 2 発目 → 半分の雷は 0.4 秒後に 3 発目（ちらつき）
    let e = Math.exp(-tau * 8);
    if (tau > 0.16) e += 0.8 * Math.exp(-(tau - 0.16) * 10);
    if (tau > 0.4 && rnd1(k + 0.7) > 0.5) e += 0.5 * Math.exp(-(tau - 0.4) * 12);
    flash = Math.max(flash, Math.min(1, e));
    // 稲妻の線が見えるのは光り始めの一瞬だけ。4 割は線の無い雷（雲の中が光るだけ）
    if (rnd1(k + 0.3) < 0.6 && (tau < 0.1 || (tau > 0.16 && tau < 0.24))) bolt = { x: 0.15 + 0.7 * rnd1(k + 0.1), seed: rnd1(k + 0.9), low: 0.04 + 0.22 * rnd1(k + 0.2) };
  }
  return { flash, bolt };
}

/** 天気を時刻から決める。毎フレーム呼ぶ（setShadows の後。屋内では出さない） */
export function updateWeather(t) {
  if (!stageCtx) return;
  const { weather, flashLight } = stageCtx, w = weatherState;
  const on = lightState.mode === 'sun';
  weather.visible = on;
  const { flash, bolt } = on ? lightningAt(t, w.thunder) : { flash: 0, bolt: null };
  flashLight.intensity = flash * 1.4;
  if (!on) return;
  const type = w.type === 'rain' ? 1 : w.type === 'snow' ? 2 : 0;
  const fps = Math.max(1, w.fps || 12), tq = Math.floor(t * fps) / fps;   // コマの刻みに切り捨てる
  // 輝き：空に見えている太陽・月（空の球の円盤）の向き・色・見えている度合いから決める。
  // 舞台を照らす直射の強さは使わない：夕方は直射がほぼ 0 になり、逆光の雨がいちばん映える時にきらめきが消えてしまう（2026-09-17 実測）
  const su = stageCtx.sky.material.uniforms;
  const sunAmt = Math.sqrt(Math.max(0, su.sunVis.value)), moonAmt = 0.7 * Math.sqrt(Math.max(0, su.moonVis.value * su.moonK.value));   // 雲で薄れる分は平方根でやわらげる
  const useMoon = moonAmt > sunAmt, amt = Math.min(1, useMoon ? moonAmt : sunAmt);
  _wDir.copy(useMoon ? su.moonDir.value : su.sunDir.value);    // 舞台 → 光源（+z が客席側、−z が舞台の奥）
  const hx = Math.hypot(_wDir.x, _wDir.z) || 1;
  const thL = Math.atan2(_wDir.x, -_wDir.z);                   // 光源の方角（−z = 舞台の奥 から、+x = 客席から見て右 へ）
  const back = Math.max(0, -_wDir.z / hx);                     // 逆光の度合い（光源が舞台の奥側にあるほど 1）
  WEATHER_GLINT_COL.value.copy(useMoon ? su.moonCol.value : su.sunCol.value).lerp(_wWhite, 0.35).multiplyScalar(0.6 + 0.4 * amt).lerp(_wStorm, flash);   // 夕方は金〜赤橙、月は青白。雷の間は稲妻の色
  for (const m of weather.children) {
    const u = m.material.uniforms, th = m.userData.th;
    u.uTime.value = tq; u.uSpeed.value = w.speed; u.uWidth.value = w.width;
    u.uType.value = type; u.uAmount.value = w.amount; u.uWind.value = w.wind;
    u.uGlint.value = w.glint ?? 1; u.uStorm.value = flash;
    u.uSun.value.set((thL - th.min) / (th.max - th.min), back * amt, (th.max - th.min) / GLINT_SIGMA, 0.4 + 0.6 * amt);
    u.uFlash.value = m.userData.far ? flash : 0;
    if (m.userData.far && bolt) u.uBolt.value.set(bolt.x, bolt.seed, bolt.low, 1); else u.uBolt.value.w = 0;
  }
}

/**
 * スクリーンを組み直す。ひな壇の奥行き（内径〜外径）の中で、pos = 0（手前の辺）〜 1（奥の辺）の
 * 好きな位置に何枚でも立てられる。左右の切り口はひな壇と同じ垂直面。
 */
function buildScreens() {
  if (!stageCtx || !stageCtx.screenBase) return;
  HL_VER++;
  const { screens } = stageCtx;
  screens.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });   // 素材のテクスチャは MEDIA で使い回すので捨てない
  screens.clear();
  const { rIn, rOut, y, thMin, thMax, segs, clip, cx, ro } = stageCtx.screenBase;
  // 手前のものが後に描かれるよう、奥（pos 大）から順に並べる（半透明の重なりを正しく出すため）
  const order = screenList.map((sc, i) => ({ sc, i })).sort((a, b) => b.sc.pos - a.sc.pos);
  const cTh = (thMin + thMax) / 2, halfTh = (thMax - thMin) / 2;
  order.forEach(({ sc, i }, k) => {
    if (sc.show === false || !sc.src) return;      // 素材の無いスクリーンは何も描かない（色は持たない）
    const tex = mediaTexture(sc.src);
    const px = mediaSize(tex);
    if (!px) return;                               // まだ読み込めていない（読み終わったら組み直される）
    const r = rIn + (rOut - rIn) * Math.max(0, Math.min(1, sc.pos));
    // 素材の実寸（1 ドット = SCREEN_PX × 倍率）。はみ出す時だけ弧の幅に収める
    const scale = sc.scale > 0 ? sc.scale : 1;
    const hgt = px.h * SCREEN_PX * scale;
    // 「繰り返す」時（雲など）は弧いっぱいに広げ、素材 1 枚ぶんの幅ごとに並べる。
    // 1 枚の幅は実寸 × 大きさなので、繰り返しても縦横比は変わらない（2026-09-13 修正）
    const wid = px.w * SCREEN_PX * scale;
    const loop = !!sc.loop;
    const gap = Math.max(1, sc.gap ?? 1);            // 1 周期の幅 ÷ 絵の幅（1 で隙間なし）
    const period = wid * gap;
    const half = loop ? halfTh : Math.min(halfTh, wid / 2 / r);
    const ctr = loop ? cTh : cTh + (sc.at ?? 0) * (halfTh - half);   // 横位置（-1 = 左端 / 0 = 中央 / 1 = 右端）
    const m = litScreenMaterial(sc, tex);   // 照明と影を受ける
    m.uniforms.uFade.value = Math.max(0, Math.min(0.49, sc.fade ?? 0));   // 端のぼかし（スカイドームと同じ。2026-09-29 ユーザー指定）
    m.color.setScalar(Math.max(0, sc.bright ?? 1));   // 明度：絵の色に掛ける倍率（2026-09-29 ユーザー指定）
    // 端のぼかしは「見えている範囲」の両端に掛ける（2026-09-29 ユーザー指摘：ブツ切れのままだった）。面はひな壇の壁の位置 x = ±cx の
    // 切り口で切られて見えるので、面の本当の端（切り口の外）でぼかしても見えない。切り口の角 ±asin(cx/r) を面の横の座標 u に直す
    // （u = 0 が角 ctr + half、u = 1 が ctr − half）
    if (cx && cx < r) {
      const thc = Math.asin(cx / r), toU = (th) => (ctr + half - th) / (2 * half);
      m.uniforms.uVis.value.set(Math.max(0, toU(thc)), Math.min(1, toU(-thc)));
    }
    if (loop) {
      m.uniforms.uLoop.value = 1;
      m.uniforms.uRepeat.value = (r * half * 2) / period;
      m.uniforms.uFill.value = 1 / gap;
    }
    if (clip) m.clippingPlanes = clip;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, hgt, Math.max(4, Math.round(segs * (half / halfTh))), 1, true,
        Math.PI - (ctr + half), half * 2), m,
    );
    mesh.name = `screen:${i}`;
    mesh.receiveShadow = true;
    mesh.userData.scroll = loop ? { speed: sc.flow === false ? 0 : sc.speed || 0, period } : null;   // flow：「流れる速度」のチェック
    mesh.position.y = y + (sc.lift ?? 0) + hgt / 2;    // 下端はひな壇の天面から lift だけ上（宙に浮かせる）
    mesh.renderOrder = ro - 1 + k * 0.05;               // 奥 → 手前 の順
    screens.add(mesh);
  });
  buildWeather();   // 天気の面も同じ土台に立つ。土台の寸法と、キャラクターとの前後の順が変わるので組み直す
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

// キャンバスの平均色（太陽光の「地面の色」に使う。2026-09-16 ユーザー指定：床の色は平均でよい）。
// 生成時に 1 回だけ計算し、texture.avgColor に持つ
function avgColorOf(canvas) {
  const g = canvas.getContext('2d'), d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }   // 4 px おきで十分
  return new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
}

// 草原の色セット。'dark' は深緑（2026-09-16 ユーザー指定）
const GRASS_PALETTES = {
  normal: { BASE: '#4f9a3e', DARK: '#3b7c2f', LIGHT: '#66b44b', HI: '#86cc63', SOIL: '#6b8f3a' },
  dark:   { BASE: '#2f6b2a', DARK: '#20511f', LIGHT: '#3d8236', HI: '#4f9a44', SOIL: '#3f6b2c' },
};
function grassTexture(palette = 'normal') {
  const S = 768, DOT = 4;            // 板目と同じ 768px（床では 40×32 unit に 1 枚）
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const { BASE, DARK, LIGHT, HI, SOIL } = GRASS_PALETTES[palette] || GRASS_PALETTES.normal;
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
  tex.avgColor = avgColorOf(c);   // r128 の Texture には userData が無いので直に持たせる
  tex.albedo = 0.22;              // 草地の反射率（実測の目安 0.2〜0.25）
  tex.tileScale = 2;              // タイルを細かく（1 枚 20×16 unit。2026-09-17 ユーザー指定）
  return tex;
}

// 壁の土（草原の床の時だけ使う）：ドット絵の画像を 1 unit = WALL_DPU ドットの実寸でループさせる。
// 絵は参考画像（2026-09-13 ユーザー提供）から元のドットを復元し、左右がつながる窓を切り出したもの。
// ?wall=<画像URL> で差し替えて試せる
const WALL_DPU = 6;            // 1 unit あたりのドット数（草原の床の 192 ドット ÷ 32 unit と同じ）。草原の tileScale を掛けて使う
const WALL_IMG = new URLSearchParams(location.search).get('wall') || 'assets/wall_dirt.png';
let wallImgTex = null;
// 読み込みは非同期なので、届いてからひな壇を組み直す（clone は clone した時点の画像しか持たないため）
wallImgTex = new THREE.TextureLoader().load(WALL_IMG, (t) => {
  t.needsUpdate = true;
  if (stageCtx && stageCtx.seats) { buildRisers(stageCtx.seats); buildFloorSkirt(); }
});
wallImgTex.magFilter = THREE.NearestFilter; wallImgTex.minFilter = THREE.NearestFilter;
wallImgTex.wrapS = wallImgTex.wrapT = THREE.RepeatWrapping;

// 壁が絵 1 枚より高い時、絵をそのまま縦に繰り返すと「草との境目」が壁の途中にもう一度出てしまう。
// 上端だけ境目の絵にして、その下は土の行だけを繰り返した絵を、壁の高さ（ドット行数）ごとに組む（2026-09-17 ユーザー指定）。
// 絵の構成は wall_dirt.png の前提：上 2 行が草との境目、最下 1 行が次の層の境目、その間が土
const WALL_TOP_ROWS = 2, WALL_BOTTOM_ROWS = 1;
const WALL_GRASS_RGB = [0x62, 0xac, 0x3e];   // 絵に描き込まれている草の粒の色（wall_dirt.png）
const wallCanvasCache = new Map();   // 「行数|草の粒の色」 → canvas
/** grass：草の粒を塗り替える色（'#rrggbb'）。null なら絵のまま */
function wallCanvasOf(img, rows, grass = null) {
  const key = `${rows}|${grass}`;
  let c = wallCanvasCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width; c.height = rows;
  const g = c.getContext('2d');
  const first = img.height - WALL_BOTTOM_ROWS;                 // 1 周目：境目＋土（最下行は使わない）
  const body = first - WALL_TOP_ROWS;                          // 2 周目以降：土だけ
  g.drawImage(img, 0, 0, img.width, first, 0, 0, img.width, first);
  // 土の層は 1 段おきに絵の半分だけ横へずらす（レンガ積み。単調な繰り返しに見せない。2026-09-17 ユーザー指定）
  const half = Math.floor(img.width / 2);
  for (let y = first, i = 1; y < rows; y += body, i++) {
    const dx = i % 2 ? half : 0;
    for (const x of dx ? [dx - img.width, dx] : [0]) g.drawImage(img, 0, WALL_TOP_ROWS, img.width, body, x, y, img.width, body);   // はみ出した分は反対側から回り込ませる
  }
  if (grass) {   // 深緑の草原では、絵の草の粒も深緑に（2026-09-17 ユーザー指定）
    const to = new THREE.Color(grass), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    const [r0, g0, b0] = WALL_GRASS_RGB;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === r0 && d[i + 1] === g0 && d[i + 2] === b0) { d[i] = Math.round(to.r * 255); d[i + 1] = Math.round(to.g * 255); d[i + 2] = Math.round(to.b * 255); }
    }
    g.putImageData(id, 0, 0);
  }
  wallCanvasCache.set(key, c);
  return c;
}

/** 壁 1 枚ぶんの材質。草原の時は土の絵、板目の時は従来どおりの無地（2026-09-13 ユーザー指定） */
function wallSkin(uLen, vLen, col) {
  const img = wallImgTex.image;
  const isGrass = stageCtx.groundTex === stageCtx.grassTex || stageCtx.groundTex === stageCtx.grassDarkTex;
  if (!img || !isGrass) return { color: col };
  const dpu = WALL_DPU * (stageCtx.groundTex.tileScale || 1);   // 草原のタイルを細かくしたら壁のドットも同じ大きさに（2026-09-17 ユーザー指定）
  const rows = Math.max(1, Math.ceil(vLen * dpu - 1e-6));
  const grass = stageCtx.groundTex === stageCtx.grassDarkTex ? GRASS_PALETTES.dark.LIGHT : null;   // 縁の見切り線と同じ色
  const m = new THREE.CanvasTexture(wallCanvasOf(img, rows, grass));
  m.magFilter = THREE.NearestFilter; m.minFilter = THREE.NearestFilter;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  const tw = img.width / dpu, th = rows / dpu;
  m.repeat.set(uLen / tw, vLen / th);
  m.offset.set(0, 1 - vLen / th);   // 絵の上端（草との境目）を壁の上端に合わせ、足りない下側は切る
  m.__disposable = true;            // 作り直しのたびに捨てる（天面の地面テクスチャは共有なので捨てない）
  return { map: m, color: '#ffffff' };   // 絵の色をそのまま出す
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
  tex.avgColor = avgColorOf(c);   // r128 の Texture には userData が無いので直に持たせる
  tex.albedo = 0.30;              // 木の床の反射率（目安 0.25〜0.35）
  return tex;
}

/**
 * トラック配列 → 座席位置リスト
 * @returns {Array<{track, positions:[{x,y,z}], puppets:number}>}
 */
/**
 * @param {Array} tracks
 * @param {(track) => {minX:number, maxX:number, minZ:number, maxZ:number} | null} [footprintOf]
 *   奏者 1 人の占有範囲 [unit]（奏者の原点基準、+x = 奏者の左 = 角度が増す向き、+z = 奏者の前 = 指揮者側）。楽器が大きいトラックは
 *   自動的に間隔を広げ、占有範囲の中心が座席の中心に来るよう奏者をずらす（2026-09-10 ユーザー指定：大きな楽器の隣に隙間を空ける）。
 *   奥行き（minZ/maxZ）は row.depthCenter の段だけで使い、楽器を含めた中心がひな壇の帯の中心に来るよう半径をずらす（2026-09-23）
 */
export function layoutSeats(tracks, footprintOf = null) {
  // トラックごとの奏者 1 人分の間隔 [unit] と、座席中心からの横ずらし [unit]
  const slotOf = (tr) => {
    const f = footprintOf?.(tr);
    if (!f) return { gap: PUPPET_GAP, off: 0, dr: 0, front: 1, back: 1 };
    // 手持ち楽器（弓・バイオリン等）は隣と少し重なってよいので 0.3 の食い込みを許す。これが無いと弦の間隔が 1.87 に広がり、
    // 独奏トラックが 1 つ増えただけで弦の扇が溢れて各セクションの人数が削られる（2026-09-10 ユーザー報告）
    const w = f.maxX - f.minX - 0.3;
    // 奥行きのずらし量 [unit]。+z = 奏者の前（指揮者側）なので、楽器が前に出ているほど半径を増やして後ろへ下げる
    const dr = Number.isFinite(f.minZ) ? (f.minZ + f.maxZ) / 2 : 0;
    // front / back：座席から手前（指揮者側）・奥へ張り出す量 [unit]（鍵盤群の流動的な段の奥行きに使う）
    return { gap: Math.max(PUPPET_GAP, w), off: -(f.minX + f.maxX) / 2, dr, front: Math.max(0, f.maxZ), back: Math.max(0, -f.minZ) };
  };
  // 鍵盤群が 3 台以上の時は、チェレスタを木管のひな壇の左の床に置き、木管をその分だけ右へずらす（2026-09-25 ユーザー指定）
  const kbTracks = tracks.filter((t) => rowKeyOf(t) === 'keyboard');
  const celSide = kbTracks.length >= KB_CROWDED ? kbTracks.find((t) => t.variant === 'celesta') : null;
  const celSlot = celSide ? slotOf(celSide) : null;
  // 実際の幅は配置用の gap より 0.3 広い（slotOf）
  const celHalfW = celSide ? celSlot.gap / 2 + 0.15 : 0;
  const byFam = {};
  for (const tr of tracks) if (tr !== celSide) (byFam[rowKeyOf(tr)] ||= []).push(tr);
  const seats = [];
  if (celSide) seats.asym = new Set(['woodwind']);   // 木管のひな壇は左右非対称に作る（buildRisers）
  const centerAngle = new Map(); // track → 列内の中心角（後ろに置く楽器の基準）

  // 「beside」指定の列は基準になる列（木管）の後で処理する
  const famKeys = Object.keys(byFam).sort((a, b) => (ROWS[a]?.beside ? 1 : 0) - (ROWS[b]?.beside ? 1 : 0));
  for (const fam of famKeys) {
    const row = ROWS[fam];
    if (!row) continue;
    // 高音を左（-x）、低音を右（+x）。楽器順が固定されたファミリーはその順
    const order = VARIANT_ORDER[fam];
    // SAME_VARIANT_RANK の楽器は、ほかの楽器と比べる時は同じ楽器の中で一番高い平均音高を使い、まとまって並ぶようにする。
    // 楽器ごとに違う物差しで比べると順番が一周して（グランカッサ 48 ＞ スネア 38 ＞ バスドラ 36 ＞ グランカッサ）並べ替えが定まらなかった
    const groupPitch = new Map();
    for (const tr of byFam[fam]) if (SAME_VARIANT_RANK[tr.variant]) groupPitch.set(tr.variant, Math.max(groupPitch.get(tr.variant) ?? -Infinity, tr.meanPitch));
    const pitchKey = (tr) => groupPitch.get(tr.variant) ?? tr.meanPitch;
    const list = byFam[fam].slice().sort((a, b) => {
      if (order) {
        const ia = order.indexOf(a.variant), ib = order.indexOf(b.variant);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      const dp = pitchKey(b) - pitchKey(a);
      if (dp) return dp;
      // 同じ楽器どうしをトラック名で並べる（SAME_VARIANT_RANK。小さいほど左）。無ければ音高順
      const rk = a.variant === b.variant && SAME_VARIANT_RANK[a.variant];
      if (rk) { const d = rk(a) - rk(b); if (d) return d; }
      return b.meanPitch - a.meanPitch;
    });

    // 各トラックの人数（横×奥行き）。列の角度幅に収まらない時は横の人数を均等に減らす
    // 合計の人数（total）で指定されたトラックは、列ごとの人数（perRow）を半径に比例して配る
    const radii = (rows) => { const k0 = row.rowsCenter ? (rows - 1) / 2 : 0, g = row.rowGap ?? ROW_GAP; return Array.from({ length: rows }, (_, k) => row.r + (k - k0) * g); };
    // cols は角度の幅の見積もり用：一番広い列の幅を「最前列の半径での人数」に直した値（小数あり）。
    // 最前列の人数だけで見積もると、後ろの列が比率より多い時（ヴィオラ 3・5 など）に隣のセクションへはみ出した
    const fill = (s) => { if (s.total) { const rr = radii(s.rows); s.perRow = spreadByRadius(s.total, rr); s.cols = Math.max(...s.perRow.map((n, k) => (n * row.r) / rr[k])); } return s; };
    const sizes = list.map((tr) => fill(sizeOf(tr)));
    const span = deg(row.span);
    // gapScale：その列の奏者の横の間隔の倍率（コントラバス。2026-09-24 ユーザー指定：左右の隙間を広げて客席側へ）
    const slots = list.map(slotOf).map((sl) => ({ ...sl, gap: sl.gap * (row.gapScale ?? 1) }));
    const angleOf = (cols, i) => (cols * slots[i].gap) / row.r; // 1トラックが占める角度 [rad]
    if (!row.beside && list.length > 1) {
      // 収まらない時は「横の人数が最も多いトラック」から 1 列ずつ減らす（全トラック一斉に減らすと独奏 1 本で全セクションが痩せる）
      for (let guard = 0; guard < 16; guard++) { // 中断条件付き
        const total = sizes.reduce((a, s, i) => a + angleOf(s.cols, i), 0);
        if (total <= span + PUPPET_GAP / row.r || sizes.every((s) => s.cols <= 1)) break;
        let k = -1;
        sizes.forEach((s, i) => { if (s.cols > 1 && (k < 0 || s.cols >= sizes[k].cols)) k = i; });
        if (k < 0) break;
        if (sizes[k].total) { sizes[k].total = Math.max(sizes[k].rows, sizes[k].total - sizes[k].rows); fill(sizes[k]); }   // 合計の指定：各列 1 人ずつ減らして配り直す
        else sizes[k].cols--;
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
      // チェレスタを木管の隣へ移した時は、チューブラーベルをハープと同じ段（チェレスタが抜けた場所）へ（2026-09-25 ユーザー指定）
      list.forEach((tr, i) => { const k = celSide && tr.variant === 'tubularbells' ? 1 : row.depthOf ? row.depthOf(tr.variant) : 0; (levels.get(k) || levels.set(k, []).get(k)).push(i); });
      const levelGap = row.levelGap ?? ROW_GAP;
      let prevBack = null;
      [...levels.entries()].sort((a, b) => a[0] - b[0]).forEach(([k0, idxs], k) => {
        // レベルごとに隣接先を変えられる（3 段目は金管の端）。基準列が無ければ木管の端
        const edgeB = row.besideAt?.[k] ? edgeOf(row.besideAt[k]) : null;
        const edge = edgeB ?? edge0;
        // トラック同士の余白。これが無いと鍵盤群（シロフォンとマリンバ等）が密着する（2026-09-22 ユーザー指摘）。
        // 幅は扇の列（beside でない列）と同じ考え方＝奏者間隔の半分
        // behind 指定の段（besideAt で金管に付けない段）は、その楽器の**内側（舞台の中央寄り）の端**に揃える（2026-09-23 ユーザー指定）。
        // いったん並べてから、この段の奏者の内側の端の角度を、基準の楽器の内側の端の角度まで回す
        const refPs = edgeB == null && row.behind ? seats.filter((st) => st.track.variant === row.behind).flatMap((st) => st.positions) : [];
        const refTh = refPs.map((p) => Math.atan2(p.x, -p.z));
        // behindR：半径も基準の楽器の一番後ろの列 + 列の間隔にする（コントラバスをチェロのすぐ後ろに 1 列で。2026-09-24 ユーザー指定）。
        // 角度の間隔はこの半径で計算する（後から半径だけ縮めると奏者が詰まる）
        let rb = row.behindR && refPs.length ? Math.max(...refPs.map((p) => Math.hypot(p.x, p.z))) + (row.rowGap ?? ROW_GAP) : row.r;
        // fluid（鍵盤群。2026-09-24 ユーザー指定）：2 段目以降は、前の段の楽器の奥の端 + 隙間 + この段の楽器の手前への張り出し。
        // ひな壇の列（木管・金管）に縛られず、楽器の大きさに合わせて詰める
        const fluidR = row.fluid && k > 0 && prevBack != null;
        if (fluidR) rb = prevBack + FLUID_MARGIN + Math.max(...idxs.map((i) => slots[i].front));
        const aOf = (cols, i) => (cols * slots[i].gap) / rb;
        const trackGap = (PUPPET_GAP / rb) * 0.5;
        const total = idxs.reduce((a, i) => a + aOf(sizes[i].cols, i), 0) + trackGap * Math.max(0, idxs.length - 1);
        let cursor = row.side > 0 ? edge + gap : edge - gap - total;
        const start = seats.length;
        const rowK = { r: row.r + k * levelGap, h: row.h };
        for (const i of idxs) {
          const c = cursor + aOf(sizes[i].cols, i) / 2; cursor += aOf(sizes[i].cols, i) + trackGap;
          const tr = list[i];
          centerAngle.set(tr, c);
          // 角度間隔は最前列の半径基準（gridPositions は row.r を使う）。奥のレベルは半径だけ大きくする
          const positions = gridPositions({ r: rb, h: row.h, rowGap: row.rowGap, depthCenter: row.depthCenter }, c, sizes[i].cols, sizes[i].rows, slots[i], sizes[i].perRow).map((p) => {
            const th = Math.atan2(p.x, -p.z), r = Math.hypot(p.x, p.z) + (fluidR || row.fluid ? 0 : k * levelGap);
            return { x: r * Math.sin(th), y: rowK.h, z: -r * Math.cos(th), row: p.row + k };
          });
          // clear：ひな壇を避ける後処理（layoutSeats の最後）が使う、楽器の手前・奥・横の張り出しと並べる側
          seats.push({ track: tr, puppets: positions.length, positions, clear: row.fluid ? { front: slots[i].front, back: slots[i].back, halfW: slots[i].gap / 2, side: row.side, level: k0 } : null });
        }
        prevBack = Math.max(...idxs.map((i) => rb + slots[i].back));   // この段の楽器の奥の端（次の段の fluid 用）
        if (refTh.length) {
          const mine = seats.slice(start).flatMap((st) => st.positions);
          const ths = mine.map((p) => Math.atan2(p.x, -p.z));
          const delta = row.side > 0 ? Math.min(...refTh) - Math.min(...ths) : Math.max(...refTh) - Math.max(...ths);
          for (const p of mine) { const th = Math.atan2(p.x, -p.z) + delta, r = Math.hypot(p.x, p.z); p.x = r * Math.sin(th); p.z = -r * Math.cos(th); }
        }
        const out = row.outDeg?.[k0];   // 外側（客席側）へ回す。side -1（左）は角度を減らす向き
        if (out) {
          for (const p of seats.slice(start).flatMap((st) => st.positions)) {
            const th = Math.atan2(p.x, -p.z) + row.side * deg(out), r = Math.hypot(p.x, p.z); p.x = r * Math.sin(th); p.z = -r * Math.cos(th);
          }
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

    // 弦：弦全体を 1 つの扇として、弧の列ごとにセクションをまたいで等間隔に左から詰める（2026-09-24 ユーザー指定：
    // セクションごとの扇形でなくてよいので、列ごとに均等に）。どの列も左端を揃え、1 列目がちょうど中央に来る位置から始める。
    // 偶数の列は半人分ずらす。セクションの形は列ごとにずれる。1 列目より幅の広い列は中央揃え
    if (fam === 'strings') {
      // 横の間隔は奏者の占有幅の STRING_GAP_SCALE 倍（2026-09-24 ユーザー指定：左右の間隔を広げ、客席側へ広げる。
      // 列の半径は変えないので、両端が客席側へ伸びる）
      const g = Math.max(...slots.map((sl) => sl.gap)) * STRING_GAP_SCALE;
      const counts = sizes.map((sz) => sz.perRow || Array(sz.rows).fill(Math.round(sz.cols)));
      const rowsMax = Math.max(...counts.map((c) => c.length));
      const rr = (k) => row.r + k * (row.rowGap ?? ROW_GAP);
      const th0 = -(counts.reduce((a, c) => a + (c[0] || 0), 0) * g / rr(0)) / 2;   // 左端（1 列目を中央に）
      const pos = list.map(() => []);
      for (let k = 0; k < rowsMax; k++) {
        const r = rr(k), stagger = (k % 2) * 0.5;
        // 1 列目より幅の広い列は中央に揃える（左端揃えのままだと右へはみ出す：2 列目のチェロ。2026-09-24 ユーザー指定）
        const w = (counts.reduce((a, c) => a + (c[k] || 0), 0) * g) / r;
        const cen = -w / 2 - (stagger * g) / r;          // 中央揃え（半人分のずらしも打ち消して左右対称に）
        const start = cen < th0 ? cen : th0;
        let j = 0;
        list.forEach((tr, i) => {
          for (let m = 0; m < (counts[i][k] || 0); m++, j++) {
            const th = start + ((j + 0.5 + stagger) * g) / r;
            pos[i].push({ x: r * Math.sin(th), y: row.h, z: -r * Math.cos(th), row: k });
          }
        });
      }
      list.forEach((tr, i) => { centerAngle.set(tr, centers[i]); seats.push({ track: tr, puppets: pos[i].length, positions: pos[i] }); });
      continue;
    }
    list.forEach((tr, i) => {
      const { cols, rows } = sizes[i];
      const center = centers[i];
      centerAngle.set(tr, center);
      const positions = gridPositions(row, center, cols, rows, slots[i], sizes[i].perRow);
      seats.push({ track: tr, puppets: positions.length, positions });
    });
  }
  // 床に並べる流動的な段（鍵盤群）が、ひな壇（木管・金管・打楽器）に埋もれないようにする（2026-09-25 ユーザー指摘：
  // チューブラーベルが打楽器のひな壇の端に食い込んでいた）。ひな壇の角度の範囲は buildRisers と同じ求め方
  // （その段の奏者の角度の最大 + RISER_MARGIN、左右対称）。半径の帯と重なる楽器は、同じ弧の上を外側（side の向き）へ、ひな壇の端の外まで回す
  // チェレスタ（木管の隣。木管と同じ半径の床）：ピアノがいればそのすぐ隣（中央寄り）に置き、木管のひな壇の左端がチェレスタに
  // 近すぎる時だけ、木管を必要な分だけ右へ回す（2026-09-25 ユーザー指定：一律にずらすとピアノとの間が空きすぎた）。
  // ピアノがいなければ、ひな壇の左端のすぐ外
  if (celSide) {
    const ang = (p) => Math.atan2(p.x, -p.z), r = ROWS.woodwind.r;
    const ww = seats.filter((o) => rowKeyOf(o.track) === 'woodwind').flatMap((o) => o.positions);
    const edge = Math.min(...ww.map(ang)) - RISER_MARGIN;   // 木管のひな壇の左端
    const pf = seats.find((o) => o.track.variant === 'piano');
    let c;
    if (pf) {
      const pp = pf.positions[0], rp = Math.hypot(pp.x, pp.z);
      const pianoInner = ang(pp) + (pf.clear.halfW + 0.15) / rp;   // ピアノの中央寄りの端
      c = pianoInner + (CEL_PIANO_GAP + celHalfW) / r;
    } else c = edge - (celHalfW + CEL_RISER_GAP) / r;
    const need = c + (celHalfW + CEL_RISER_GAP) / r - edge;       // ひな壇の左端をここまで右へ出したい
    if (need > 0) for (const p of ww) { const th = ang(p) + need, rr = Math.hypot(p.x, p.z); p.x = rr * Math.sin(th); p.z = -rr * Math.cos(th); }
    centerAngle.set(celSide, c);
    seats.push({ track: celSide, puppets: 1, positions: gridPositions({ r, h: 0 }, c, 1, 1, celSlot) });
  }
  // ひな壇の角度の範囲（buildRisers と同じ求め方。asym の段は奏者の範囲そのまま、それ以外は左右対称）
  const riserRange = (fam) => {
    const row = ROWS[fam];
    const ths = seats.filter((o) => rowKeyOf(o.track) === fam && o.track !== celSide).flatMap((o) => o.positions).map((p) => Math.atan2(p.x, -p.z));
    if (!ths.length) return [-deg(row.span) / 2 - RISER_MARGIN, deg(row.span) / 2 + RISER_MARGIN];
    if (seats.asym?.has(fam)) return [Math.min(...ths) - RISER_MARGIN, Math.max(...ths) + RISER_MARGIN];
    const half = Math.max(...ths.map(Math.abs)) + RISER_MARGIN;
    return [-half, half];
  };
  // 段（level）ごとにまとめて回す：1 台だけ回すと隣の楽器にぶつかる（チェレスタとハープ）。
  // 余白：配置用の幅は隣との重なりを許して実際より 0.3 狭く、奥行きには奏者の後ろの椅子が入っていないので、その分と少しの隙間を足して判定する
  const CLEAR_PAD_W = 0.4, CLEAR_PAD_R = 0.6;
  const levels = new Map();
  for (const st of seats) if (st.clear) (levels.get(st.clear.level) || levels.set(st.clear.level, []).get(st.clear.level)).push(st);
  for (const group of levels.values()) {
    let delta = 0;
    const side = group[0].clear.side;
    for (const fam of ['woodwind', 'brass', 'percussion']) {
      const row = ROWS[fam];
      if (!(row.h > 0)) continue;
      const [thLo, thHi] = riserRange(fam);
      const rIn = row.r - (row.half ?? RISER_HALF), rOut = row.r + (row.half ?? RISER_HALF);
      for (const st of group) for (const p of st.positions) {
        const c = st.clear, r = Math.hypot(p.x, p.z);
        if (r + c.back + CLEAR_PAD_R < rIn || r - c.front - CLEAR_PAD_R > rOut) continue;   // 半径の帯と重ならない
        const inner = Math.atan2(p.x, -p.z) - side * ((c.halfW + CLEAR_PAD_W) / r);      // 楽器の内側（舞台の中央寄り）の端の角度
        const need = (side > 0 ? thHi : thLo) - inner;                                  // 端をひな壇の外へ出すのに要る回転
        if (need * side > 0) delta = side > 0 ? Math.max(delta, need) : Math.min(delta, need);
      }
    }
    if (delta) for (const st of group) for (const p of st.positions) {
      const th = Math.atan2(p.x, -p.z) + delta, r = Math.hypot(p.x, p.z); p.x = r * Math.sin(th); p.z = -r * Math.cos(th);
    }
  }
  // 指揮者以外を奥へ平行移動（座席の角度計算は指揮者中心のまま、最後にずらす。ひな壇は buildRisers 側で同じ量ずらす）
  for (const st of seats) for (const p of st.positions) p.z += SEAT_SHIFT_Z;
  return seats;
}

/** 合計 total 人を、各列の半径 radii に比例して配る（最大剰余法。各列 1 人以上）。後ろの列ほど多い＝扇形 */
function spreadByRadius(total, radii) {
  const sum = radii.reduce((a, r) => a + r, 0);
  const raw = radii.map((r) => (total * r) / sum);
  const n = raw.map((x) => Math.max(1, Math.floor(x)));
  let rest = total - n.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) n[order[j][1]]++;
  return n;
}

// 中心角 center を軸に座らせる。奥の列ほど半径が大きい。**扇形**：奏者の間隔はどの列も同じ（slot.gap）で、
// 後ろの列ほど人数を増やして同じ角度の幅を埋める（列の人数 = cols × その列の半径 ÷ 最前列の半径。2026-09-24 ユーザー指定）。
// 人数が前の列と同じ列だけ、偶数列を半人分ずらす（重なり防止・自然な見た目）
// slot = { gap: 奏者間隔 [unit], off: 占有範囲の中心を座席中心に合わせるための横ずらし [unit], dr: 同じく奥行きのずらし [unit]（row.depthCenter の段だけ効く） }
function gridPositions(row, center, cols, rows, slot = { gap: PUPPET_GAP, off: 0, dr: 0 }, perRow = null) {
  const positions = [];
  const rowGap = row.rowGap ?? ROW_GAP;
  const dr = row.depthCenter ? (slot.dr || 0) : 0;  // 楽器を含めた占有範囲の中心を座席の中心に合わせる
  const k0 = row.rowsCenter ? (rows - 1) / 2 : 0;  // 列全体の中心を r（＝ひな壇の帯の中心）に合わせる
  const r0 = row.r - k0 * rowGap + dr;             // 最前列の半径
  for (let k = 0; k < rows; k++) {
    const r = row.r + (k - k0) * rowGap + dr;
    const n = perRow ? perRow[k] : Math.max(1, Math.round(cols * r / r0));   // perRow：合計の人数から配った列ごとの人数
    const stagger = n === cols ? (k % 2) * 0.5 : 0;
    for (let j = 0; j < n; j++) {
      // 横の間隔は**その列の半径**で角度にする（2026-09-24 ユーザー指定）。以前は最前列の半径（row.r）で割っていたので、
      // 後ろの列ほど弧の上の間隔が開き、1st バイオリンの 3 列目（r 11.8）は 1.8 倍の隙間になっていた
      const th = center + (slot.off + (j - (n - 1) / 2 + stagger) * slot.gap) / r;
      positions.push({ x: r * Math.sin(th), y: row.h, z: -r * Math.cos(th), row: k });
    }
  }
  return positions;
}

// 角度 0 = 指揮者の真後ろ（-z 方向）。x = r sinθ, z = -r cosθ
function seatPos(row, th) {
  return { x: row.r * Math.sin(th), y: row.h, z: -row.r * Math.cos(th) };
}
