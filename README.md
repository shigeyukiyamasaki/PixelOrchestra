# Pixel Orchestra

MIDI に連動して動くドット絵オーケストラ（2D パペット × 3D ステージ）＋ 滝型ピアノロール。
ブラウザで鑑賞・公開する前提のツール。`趣味/MIDIOrchestra` とは独立した別ツール。

## 起動（ローカル）

```bash
cd 趣味/PixelOrchestra
python3 tools/serve.py   # ポート 8766 固定・キャッシュ無効（localStorage はオリジン単位なのでポートは変えない）
open -a "Google Chrome" "http://localhost:8766/index.html?midi=samples/test_orchestra.mid"
```

- `?midi=<パス>` で MIDI を自動読み込み、`&audio=<パス>` で音声も同時に読み込む（公開デモ用）
- 通常はパネルの「MIDI ファイル」「音声ファイル」から選ぶ
- Space = 再生/一時停止、ドラッグ = 視点回転、ホイール = ズーム

## 構成

| ファイル | 役割 |
|---|---|
| `src/midiEngine.js` | MIDI 解析・楽器ファミリー判定・エネルギー包絡線・時刻 t の状態取得（描画非依存） |
| `src/sprites.js` | プログラム生成の仮ドット絵パーツ（本番絵に差し替える単位） |
| `src/puppet.js` | 2D パペット（pivot 回転）とファミリー別の動きテンプレート |
| `src/stage.js` | シーン・カメラ・ひな壇・扇形の座席計算 |
| `src/pianoRoll.js` | 滝型ピアノロール（InstancedMesh） |
| `src/main.js` | UI・再生クロック・音声同期・設定の自動保存 |
| `tools/make_test_midi.py` | テスト用 14 トラック MIDI の生成（依存なし） |

## MIDI → 動き の対応

| MIDI 情報 | 動き |
|---|---|
| Note On / velocity | 弦: 弓の往復（振り幅）／打: 振り下ろし／木管・金管: 沈み込み・ベル上げ |
| ノート長 | 弦: ストロークの速さ／金管: ベルを上げ続ける時間 |
| エネルギー包絡線（直近の velocity を減衰） | 体の揺れ幅・頭の傾き・足元の光 |
| テンポマップ・拍 | 全員の揺れ周期、指揮者の振り |
| 音程 | 弦: 左手のビブラート／フルート: 楽器の角度／ピアノ: 手の左右位置 |

## キースイッチの除外（音域フィルター）

トラック表の各行の下に「音域 下限 〜 上限」（MIDI ノート番号、横に Logic 表記の音名 C3=60）。
範囲外のノートは動き・ロール・エネルギー計算のすべてから除外される。
設定は **トラック名** をキーに localStorage へ保存（MIDIOrchestra と同じ方式。別ファイルでも同名トラックなら効く）。

## 本番のドット絵への差し替え

`src/sprites.js` の各 `makePart(w, h, pivotX, pivotY, draw)` を、同じサイズ・同じ pivot の PNG 読み込みに置き換える。
pivot は「体＝足元中央」「頭＝首の付け根」「腕＝肩」「手持ち物＝手で持つ点」「楽器＝体への取り付け点」。

## 公開先（予定）

romashige.com `/pixel-orchestra/`（音楽系は Xserver。`~/CLAUDE.md` のデプロイ先ルール参照）。
