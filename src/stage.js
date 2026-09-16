/*
 * PixelOrchestra — stage.js
 * 最終更新: 2026-09-09 / v0.1 / 生成元: PixelOrchestra
 *
 * シーン・カメラ・OrbitControls・ステージ（床・ひな壇・指揮台）と、
 * トラック → 座席位置（扇形配置）の計算。
 */

import { PX } from './sprites.js';

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

const deg = (d) => (d * Math.PI) / 180;
// 打楽器の後ろに置く、奏者のいないひな壇（キャラクター等を置く想定。2026-09-13 ユーザー指定）。
// ここに足すだけで段が増える。r = 中心からの半径、h = 高さ、span = 扇の開き [deg]
export const BACK_ROWS = [
  // clipX を指定すると、扇形の切り口ではなく x = ±clipX の垂直面で切る（2026-09-13 ユーザー指定）。
  // span は clipX より外まで届く広さにしておき、実際の端は clipX が決める
  { r: 27, h: 4.0, span: 130, clipX: 18, screen: true },
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
      float u = (flip > 0.5 ? 1.0 - vUv.x : vUv.x) * uRepeat + uScroll;
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
        uniform float uRepeat; uniform float uScroll; uniform float uLoop; uniform float uFill; uniform float uFade;
        varying vec2 vScreenUv;`)
      .replace('#include <map_fragment>', `
        float u = (flip > 0.5 ? 1.0 - vScreenUv.x : vScreenUv.x) * uRepeat + uScroll;
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
        if (uFade > 0.001) sa *= smoothstep(0.0, uFade, vScreenUv.x) * smoothstep(0.0, uFade, 1.0 - vScreenUv.x);
        if (sa * diffuseColor.a < 0.01) discard;
        diffuseColor.rgb *= sc.rgb; diffuseColor.a *= sa;`);
  };
  m.customProgramCacheKey = () => 'litScreen' + (tex ? ':map' : '');
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
const RISER_HALF = 2;        // ひな壇の帯の半幅 [unit]（内径 r-2 〜 外径 r+2）
const RISER_MARGIN = deg(7); // 座席の両端に足す余白角
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
  // 太陽光（屋外。2026-09-16 ユーザー指定）：平行光 1 本。スポットライトとは併用せず setShadows の mode で切り替える。
  // 影は直交カメラで舞台全体（±34 unit）を覆う。位置は方角・高度から setShadows が置く
  const sun = new THREE.DirectionalLight('#ffffff', 1.2);
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
                sunCol: { value: new THREE.Color('#ffffff') }, sunVis: { value: 0 }, sunRad: { value: 2.0 }, aureole: { value: 0.7 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform vec3 glowColor; uniform float glowAmt; uniform float flip;
      uniform vec3 sunCol; uniform float sunVis; uniform float sunRad; uniform float aureole; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float y = flip > 0.5 ? -d.y : d.y;
        vec3 dd = flip > 0.5 ? vec3(d.x, -d.y, d.z) : d;
        vec2 h = normalize(d.xz + vec2(1e-5, 0.0));
        float c = dot(h, normalize(sunDir.xz));
        float lobe = pow(clamp(c * 0.55 + 0.45, 0.0, 1.0), 1.5);   // 太陽の方角ほど強い。真横で約 3 割、145° で消える（さらに広め。2026-09-16 ユーザー指定）
        float hz = exp(-max(y, 0.0) * 2.2);       // 地平線に近いほど強い（天頂で消える）
        float a = glowAmt * lobe * hz;
        // 太陽の円盤（見かけの半径 sunRad 度、縁を 0.4 度ぼかす）と弱いハロー。夕焼けの層の上に通常合成（2026-09-16 ユーザー指定）
        float cs = dot(dd, normalize(sunDir));
        float disc = smoothstep(cos(radians(sunRad + 0.4)), cos(radians(sunRad)), cs);
        float halo = pow(max(cs, 0.0), 140.0) * 0.5;
        // にじみ（周日光環）：太陽に近いほど明るく、約 20° で半分・40° でほぼ 0 のなだらかな勾配（2026-09-16 ユーザー指定）
        float aur = pow(max(cs, 0.0), 12.0) * aureole;
        float sa = sunVis * clamp(disc + halo + aur, 0.0, 1.0);
        vec3 sunc = sunCol;   // 色は JS 側で高度に応じて決める（高いと白っぽく、夕日は赤橙）
        float outA = sa + a * (1.0 - sa);
        vec3 outC = outA > 1e-4 ? (sunc * sa + glowColor * a * (1.0 - sa)) / outA : glowColor;
        gl_FragColor = vec4(outC, outA);
      }`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), skyMat);
  sky.renderOrder = -1000; sky.visible = false; sky.frustumCulled = false;
  scene.add(sky);
  // 太陽のグレア（2026-09-16 ユーザー指定：明るさでなく加算の光で眩しさを出す）。Three.js の Lensflare を使う。
  // 加算合成・深度無視で舞台や奏者の縁を光が越える。太陽が物に隠れている割合はフレームバッファから測って隠れるほど消える。
  // 3 層：飽和した芯（白）・太陽色の輪・広く薄い輪。大きさと強さは updateSky が毎フレーム高度・雲量から決める
  const flare = new THREE.Lensflare();
  const flareEls = [
    new THREE.LensflareElement(flareTexture(0.0, 0.55), 60, 0, new THREE.Color('#ffffff')),   // 芯
    new THREE.LensflareElement(flareTexture(0.0, 0.35), 220, 0, new THREE.Color('#ffd28a')),  // 輪
    new THREE.LensflareElement(flareTexture(0.0, 0.18), 700, 0, new THREE.Color('#ffd28a')),  // 広い輪
  ];
  for (const e of flareEls) flare.addElement(e);
  flare.visible = false;
  scene.add(flare);

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
  const screens = new THREE.Group();   // スクリーンはひな壇とは別に組み直す（枚数や位置を UI から頻繁に変えるため）
  screens.position.z = SEAT_SHIFT_Z;
  scene.add(screens);
  const domes = new THREE.Group();     // スカイドーム（遠景。3 層固定）
  scene.add(domes);
  stageCtx = { scene, floorTex, grassTex: null, groundTex: floorTex, floorMat, stageMat, addStage, risers, screens, domes, hemi, spots, sun, sky, flare, flareEls, flareState: { el: 0, cloud: 0, vis: 0 }, seats: [] };
  buildRisers([]);

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
const SUN_SET_RED = new THREE.Color('#ff9a1a'), _sunHigh = new THREE.Color();   // 夕日の円盤の色
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
export function sunFromTime(hour, cloud, facing) {
  const H = deg((hour - 12) * 15);                                   // 時角。正午 0、午前が負
  const elev = Math.asin(Math.cos(LAT) * Math.cos(H));               // 赤緯 0 の高度。南中で 90−35 = 55°
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT));  // 南から西回りの方位角
  const compass = (180 + azS / Math.PI * 180 + 360) % 360;           // 北 0・東 90・南 180・西 270
  const azimuth = ((facing - compass) % 360 + 360) % 360;            // 舞台基準：客席の方位 − 太陽の方位。東の太陽は南向き舞台で「客席から見て右」
  const elDeg = elev / Math.PI * 180;
  const up = Math.max(0, Math.sin(elev));
  const air = Math.pow(up, 0.35);                                    // 低いほど大気を長く通って弱まる（空気量の近似）
  const c = Math.min(1, Math.max(0, cloud));
  const intensity = 1.6 * air * (1 - c) * (1 - c);                   // 雲で直射は消える
  const skyLight = SKY_BASE * (0.35 + 0.65 * Math.sqrt(up || 0)) * (1 + 1.2 * c);   // 天空光。日没後も薄明の分は残し、曇りは拡散光が増える
  const tEl = Math.min(0.5, 0.5 * Math.max(0, elDeg) / 30);          // 地平線で橙、30° 以上で白
  const temp = tEl + (0.85 - tEl) * c;                               // 雲で青白へ
  return { azimuth, elev: elDeg, temp, intensity, skyLight, sky: skyColorFromTime(elDeg, c), horizon: horizonColorFromTime(elDeg, c) };
}
// 地平線の色を高度と雲量から決める（2026-09-16 ユーザー指定：夕焼けのシミュレート。方向は無視）。
// 橙になるのは太陽が地平線の ±6° にいる間だけ。薄雲（雲量 〜0.5）は色を派手に、厚い雲は灰色へ
// 太陽側（球に重ねる夕焼け）
const HZ_CLEAR = [[20, '#bfe0f5'], [6, '#f2d9a0'], [0, '#f28a3c'], [-4, '#e46f7a'], [-8, '#6b4a8c'], [-12, '#131c4d']];
const HZ_VIVID = [[20, '#bfe0f5'], [6, '#f7c97a'], [0, '#ff7a1f'], [-4, '#ff5f7e'], [-8, '#7a3fa0'], [-12, '#131c4d']];
// 太陽と反対側（CSS の地平線の色）：青灰 → 地球の影の帯（ピンク〜紫）→ 濃紺。薄雲でピンクが濃くなる
const HZ_ANTI_CLEAR = [[20, '#bfe0f5'], [6, '#c6d4ea'], [0, '#a9a6c9'], [-4, '#7a6ea6'], [-8, '#45407e'], [-12, '#131c4d']];
const HZ_ANTI_VIVID = [[20, '#bfe0f5'], [6, '#d2cfe6'], [0, '#c9a0bd'], [-4, '#8e6aa8'], [-8, '#4d3f8a'], [-12, '#131c4d']];
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
  _hz.lerp(keyColor(_skyTmp, vivid, el), Math.min(1, cloud / 0.5));   // 薄雲で派手に
  const lum = 0.2126 * _hz.r + 0.7152 * _hz.g + 0.0722 * _hz.b;
  const grey = _skyTmp.copy(SKY_OVERCAST).multiplyScalar(Math.min(1.1, lum / 0.5 + 0.05));   // 厚い雲の灰は明るさに合わせる
  const overcast = Math.max(0, (cloud - 0.5) / 0.5);
  return '#' + _hz.lerp(grey, overcast).getHexString();
}
function horizonColorFromTime(el, cloud) { return horizonPalette(HZ_ANTI_CLEAR, HZ_ANTI_VIVID, el, cloud); }   // 反対側（土台）
function horizonGlowColorFromTime(el, cloud) { return horizonPalette(HZ_CLEAR, HZ_VIVID, el, cloud); }         // 太陽側（球）
// 空の上端の色を高度と雲量から決める（2026-09-16 ユーザー指定）。
// 昼の青 → 低い太陽で深い青紫 → 地平線下は濃紺。雲は灰色へ寄せ、暗いほど灰も暗く
const SKY_DAY = new THREE.Color('#0058ff'), SKY_LOW = new THREE.Color('#062ccc'), SKY_NIGHT = new THREE.Color('#040e5c');   // 彩度高め（2026-09-16 ユーザー指定）   // 夜（−12°）は薄明の濃紺。黒にしない（2026-09-16 ユーザー指摘）
const SKY_OVERCAST = new THREE.Color('#9aa3ad');
const _sky = new THREE.Color();
function skyColorFromTime(el, cloud) {
  if (el >= 30) _sky.copy(SKY_DAY);
  else if (el >= 0) _sky.copy(SKY_LOW).lerp(SKY_DAY, el / 30);
  else if (el >= -12) _sky.copy(SKY_NIGHT).lerp(SKY_LOW, (el + 12) / 12);   // 高度 0° で上からの色（SKY_LOW）と一致させる
  else _sky.copy(SKY_NIGHT);
  const lum = 0.2126 * _sky.r + 0.7152 * _sky.g + 0.0722 * _sky.b;
  const grey = _skyTmp.copy(SKY_OVERCAST).multiplyScalar(Math.min(1, lum / 0.16 + 0.05));   // 曇りの灰は空の明るさに合わせる
  return '#' + _sky.lerp(grey, cloud).getHexString();
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
  m.repeat.set(1 / 40, 1 / 32);
  return m;
}

// ひな壇の天面用のテクスチャ。RingGeometry の UV は外径の正方形を [0,1] に写すので、
// そのまま貼ると段の半径によって粒の大きさが変わってしまう（2026-09-13 ユーザー指摘）。
// 床と同じ「40×32 unit に 1 枚」の実寸になるよう繰り返しを設定し、原点も床に合わせる
function ringMapOf(tex, rOut) {
  const m = tex.clone(); m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.repeat.set(2 * rOut / 40, 2 * rOut / 32);
  m.offset.set(-rOut / 40, -rOut / 32);
  m.__disposable = true;            // 作り直しのたびに捨てる（元の共有テクスチャは触らない）
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

/**
 * 光源の切替と太陽光の項目（2026-09-16 ユーザー指定）：
 *   mode: 'spot'（屋内。スポットライト 2 灯）| 'sun'（屋外。太陽光 1 本）。併用しない
 *   sun: 太陽光の強さ  sunAzimuth: 方角 [deg]（0 で客席正面、90 で客席から見て右、180 で奥）  sunElev: 高度 [deg]（90 で真上）
 *   sunTemp: 色温度 0〜1  groundColor: 半球光の下色。省略時は床テクスチャの平均色 × 照り返し（屋内では固定色）。上色は太陽側の地平線色の暖色成分だけ
 *   bgFlip: 背景を上下反転中なら空の球も反転  sunAmbient: 天空光の強さ（太陽光・手動）  sunAuto: {hour, cloud, facing} があれば sun/sunTemp/sunAzimuth/sunElev/sunAmbient を時刻・天気から決める
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
const _flareDir = new THREE.Vector3();
export function updateSky(camera, renderer) {
  if (!stageCtx?.sky.visible) return;
  stageCtx.sky.position.copy(camera.position);
  // グレア：太陽の方向 120 unit 先（空の球の内側）に置く。大きさは画面の高さに対する割合、強さは高度・雲量から
  const { flare, flareEls, flareState: fs } = stageCtx;
  _flareDir.copy(stageCtx.sky.material.uniforms.sunDir.value).normalize();
  flare.position.copy(camera.position).addScaledVector(_flareDir, 120);
  const H = renderer ? renderer.domElement.height : 1080;
  const high = Math.min(1, Math.max(0, (fs.el - 3) / 17));          // 高い太陽ほど眩しい（20° で最大）。夕日は大気減衰で弱い
  const vis = fs.vis;                                               // 地平線下 0、雲で薄れる
  const haze = 1 + 0.6 * Math.min(1, fs.cloud / 0.5);               // 薄雲でにじみが広がる
  const disc = stageCtx.sky.material.uniforms.sunCol.value;
  const k = vis * (0.35 + 0.65 * high);
  flareEls[0].size = H * 0.045; flareEls[0].color.setRGB(k, k, k);                                   // 芯：白く飽和
  flareEls[1].size = H * 0.16 * haze; flareEls[1].color.copy(disc).multiplyScalar(0.9 * k);            // 輪：太陽色
  flareEls[2].size = H * 0.55 * haze; flareEls[2].color.copy(disc).multiplyScalar(0.35 * k * high);   // 広い輪：高い太陽だけ
}

export function setShadows(o = {}) {
  if (!stageCtx) return;
  const { hemi, spots, sun } = stageCtx;
  if (o.mode && o.mode !== lightState.mode) {
    lightState.mode = o.mode;
    const outdoor = o.mode === 'sun';
    for (const sp of spots) sp.visible = !outdoor;
    sun.visible = outdoor;
    stageCtx.sky.visible = outdoor;
    stageCtx.flare.visible = outdoor;
    if (!outdoor) { hemi.color.set(HEMI_SKY_INDOOR); hemi.groundColor.set(HEMI_GROUND_INDOOR); }
  }
  if (o.enabled !== undefined && o.enabled !== lightState.enabled) {
    lightState.enabled = !!o.enabled;
    for (const sp of spots) sp.castShadow = lightState.enabled;
    sun.castShadow = lightState.enabled;
  }
  if (Number.isFinite(o.ambient) && lightState.mode !== 'sun') hemi.intensity = o.ambient;   // 屋内の環境光（跳ね返り光）
  if (lightState.mode === 'sun') {
    let sunI = o.sun, sunT = o.sunTemp, sunAz = o.sunAzimuth, sunEl = o.sunElev, sky = o.sunAmbient;
    if (o.sunAuto) {   // 時刻・天気・舞台の向きから決める（手動でない時）
      const a = sunFromTime(o.sunAuto.hour, o.sunAuto.cloud, o.sunAuto.facing);
      sunI = a.intensity; sunT = a.temp; sunAz = a.azimuth; sunEl = a.elev; sky = a.skyLight;
    }
    if (Number.isFinite(sky)) hemi.intensity = sky;   // 天空光。屋外の環境光はこれ（屋内の「環境光」とは別の値）
    const elNow = Number.isFinite(sunEl) ? sunEl : lightState.sunEl;
    if (Number.isFinite(sunI)) sun.intensity = (Number.isFinite(elNow) && elNow <= 0) ? 0 : sunI;   // 地平線下なら直射なし（手動でも物理どおり）
    sun.castShadow = lightState.enabled && sun.intensity > 0.03;   // 直射が消えたら影も消す（曇天・日没後）
    if (Number.isFinite(sunT) && sunT !== lightState.sunTemp) { lightState.sunTemp = sunT; sun.color.copy(sunColorOf(sunT)); }
    if (Number.isFinite(elNow)) hemi.color.copy(skyLightColorOf(horizonGlowColorFromTime(elNow, o.sunAuto ? o.sunAuto.cloud : 0)));   // 色相は太陽側の地平線（夕焼け）から。青は乗せない
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
    }
    const az = Number.isFinite(sunAz) ? sunAz : lightState.sunAz, el = Number.isFinite(sunEl) ? sunEl : lightState.sunEl;
    if (Number.isFinite(az) && Number.isFinite(el) && (az !== lightState.sunAz || el !== lightState.sunEl)) {
      lightState.sunAz = az; lightState.sunEl = el;
      const a = deg(az), e = deg(el);
      // 方角 0 = 客席側（+z）から。客席から見て右（+x）が 90。舞台中心 (0,0,-12) を向く
      sun.position.set(SUN_R * Math.cos(e) * Math.sin(a), SUN_R * Math.sin(e), -12 + SUN_R * Math.cos(e) * Math.cos(a));
      stageCtx.sky.material.uniforms.sunDir.value.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));   // 太陽の円盤用に高度も入れる
    }
    // 太陽側の低い空の色（夕焼け）。反対側の色は CSS の地平線の色が担う。曇天では両方灰色になって差が消える
    if (Number.isFinite(el)) {
      const cloud = o.sunAuto ? o.sunAuto.cloud : 0;
      const u = stageCtx.sky.material.uniforms;
      u.glowColor.value.set(horizonGlowColorFromTime(el, cloud));
      u.glowAmt.value = 1;
      u.flip.value = o.bgFlip ? 1 : 0;
      // 太陽そのもの：地平線下では消す。雲で薄れる（(1−雲量)²）。色は直射の色
      u.sunVis.value = el > -1 ? (1 - cloud) * (1 - cloud) : 0;
      // 円盤の色：高度 20° 以上は直射の色を白へ半分寄せた色、地平線に向かって実際の夕日の赤橙へ（2026-09-16 ユーザー指定）
      const lowT = Math.min(1, Math.max(0, el / 20));
      u.sunCol.value.copy(SUN_SET_RED).lerp(_sunHigh.copy(sun.color).lerp(SUN_WHITE, 0.5), lowT);
      // にじみは高い太陽だけ（5° 以下で 0、20° で最大）。夕日は大気減衰でギラつかず円盤がそのまま見える
      u.aureole.value = 0;   // 空の球側のにじみは使わない（グレアは Lensflare が担う。2026-09-16）
      stageCtx.flareState.el = el; stageCtx.flareState.cloud = cloud; stageCtx.flareState.vis = u.sunVis.value;
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
    const rimCol = new THREE.Color(stageCtx.groundTex === stageCtx.grassTex ? '#66b44b' : '#b08a55').multiply(new THREE.Color(col));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rIn, 0.07, 6, segs * 2, thMax - thMin), matC({ color: rimCol }));
    rim.rotation.x = -Math.PI / 2; rim.rotation.z = Math.PI / 2 - thMax; rim.position.y = row.h + 0.01;
    rim.renderOrder = ro + 0.3; risers.add(rim);

    // スクリーンを立てる段なら、その寸法を控えておく（スクリーン自体は buildScreens が作る）
    if (row.screen) stageCtx.screenBase = { rIn, rOut, y: row.h, thMin, thMax, segs, clip, ro };
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
export function setDomes(list) {
  domeList = (list || []).map((o) => ({ ...o }));
  buildDomes();
}

function buildDomes() {
  if (!stageCtx) return;
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
    mesh.userData.scroll = { speed: d.speed || 0, period: 360 / tiles };   // 1 周期 = 素材 1 枚ぶんの角度 [deg]
    mesh.renderOrder = -200 + k;                    // 何よりも先に描く
    g.add(mesh);
  });
}

/**
 * スクリーンを組み直す。ひな壇の奥行き（内径〜外径）の中で、pos = 0（手前の辺）〜 1（奥の辺）の
 * 好きな位置に何枚でも立てられる。左右の切り口はひな壇と同じ垂直面。
 */
function buildScreens() {
  if (!stageCtx || !stageCtx.screenBase) return;
  const { screens } = stageCtx;
  screens.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });   // 素材のテクスチャは MEDIA で使い回すので捨てない
  screens.clear();
  const { rIn, rOut, y, thMin, thMax, segs, clip, ro } = stageCtx.screenBase;
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
    mesh.userData.scroll = loop ? { speed: sc.speed || 0, period } : null;
    mesh.position.y = y + (sc.lift ?? 0) + hgt / 2;    // 下端はひな壇の天面から lift だけ上（宙に浮かせる）
    mesh.renderOrder = ro - 1 + k * 0.05;               // 奥 → 手前 の順
    screens.add(mesh);
  });
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

// グレア用の放射状テクスチャ：中心 1 → 半径 inner まで 1、外周で 0（滑らかな肩）。輝度は inner の位置で層の性格を変える
function flareTexture(inner, mid) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(Math.max(0.01, inner), 'rgba(255,255,255,1)');
  grad.addColorStop(mid, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
// キャンバスの平均色（太陽光の「地面の色」に使う。2026-09-16 ユーザー指定：床の色は平均でよい）。
// 生成時に 1 回だけ計算し、texture.avgColor に持つ
function avgColorOf(canvas) {
  const g = canvas.getContext('2d'), d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }   // 4 px おきで十分
  return new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
}

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
  tex.avgColor = avgColorOf(c);   // r128 の Texture には userData が無いので直に持たせる
  tex.albedo = 0.22;              // 草地の反射率（実測の目安 0.2〜0.25）
  return tex;
}

// 壁の土（草原の床の時だけ使う）：ドット絵の画像を 1 unit = WALL_DPU ドットの実寸でループさせる。
// 絵は参考画像（2026-09-13 ユーザー提供）から元のドットを復元し、左右がつながる窓を切り出したもの。
// ?wall=<画像URL> で差し替えて試せる
const WALL_DPU = 6;            // 1 unit あたりのドット数（草原の床の 192 ドット ÷ 32 unit と同じ）
const WALL_IMG = new URLSearchParams(location.search).get('wall') || 'assets/wall_dirt.png';
let wallImgTex = null;
// 読み込みは非同期なので、届いてからひな壇を組み直す（clone は clone した時点の画像しか持たないため）
wallImgTex = new THREE.TextureLoader().load(WALL_IMG, (t) => {
  t.needsUpdate = true;
  if (stageCtx && stageCtx.seats) buildRisers(stageCtx.seats);
});
wallImgTex.magFilter = THREE.NearestFilter; wallImgTex.minFilter = THREE.NearestFilter;
wallImgTex.wrapS = wallImgTex.wrapT = THREE.RepeatWrapping;

/** 壁 1 枚ぶんの材質。草原の時は土の絵、板目の時は従来どおりの無地（2026-09-13 ユーザー指定） */
function wallSkin(uLen, vLen, col) {
  const img = wallImgTex.image;
  if (!img || stageCtx.groundTex !== stageCtx.grassTex) return { color: col };
  const m = wallImgTex.clone(); m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  const tw = img.width / WALL_DPU, th = img.height / WALL_DPU;
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
