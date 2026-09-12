## PixelOrchestra プロジェクトルール

## 📎 参照ルール（上位層）

- **運用共通**: [COMMON_RULES.md](~/shared-claude-rules/COMMON_RULES.md)
- **全ツール共通**: [TOOL_CRAFT_RULES.md](~/shared-claude-rules/TOOL_CRAFT_RULES.md)
- **メディア系共通**: [TOOL_CRAFT_MEDIA.md](~/shared-claude-rules/TOOL_CRAFT_MEDIA.md)

上記に書かれているルールは本ファイルには重複させない。

---

### 位置付け

`趣味/MIDIOrchestra` とは**別ツール**（2026-09-09 ユーザー確定）。MIDIOrchestra が大規模化したため分離した。
コードは共有しない。共通化したくなったら先に確認する。

### 設計の柱（変えるときは確認）

- **パペット × ドット絵 × 3D ステージ**。絵は「ボクセル（ドット絵の押し出し）」固定（2026-09-10 ユーザー確定。2D の板は UI から撤去、実装は sprites.js に残置）。体の向きは指揮者固定。ユーザーがアングルを回せることが要件
- **MIDI→動きのエンジン（midiEngine.js）と描画を分離**する。動きの数式は `puppet.js` のファミリー別テンプレートに閉じる
- ドット絵は最近傍補間・ブルーム無し（`TOOL_CRAFT_MEDIA.md` §1-3）
- 設定は id 付き input の自動収集で保存（`TOOL_CRAFT_RULES.md` §3-1）

### ローカル確認

ポート **8766 固定**（`python3 tools/serve.py`＝キャッシュ無効版。ES module の import はキャッシュバスターが効かないため）。`?midi=samples/test_orchestra.mid` で自動読み込み。
Chrome MCP で確認する時はタブを前面化してから（背面だと rAF が止まる）。

**「何度かリロードしないとプレビューが真っ暗」は `tools/serve.py` が原因だった**（2026-09-12 解決）。
Python 標準の `request_queue_size` は 5（listen backlog）、`protocol_version` は HTTP/1.0（keep-alive 無し＝ファイル 1 本ごとに新規接続）。
module を十数本まとめて取りに来ると待ち行列があふれ、OS が接続を RST で落とす → `ERR_CONNECTION_RESET` → その module だけ import に失敗してアプリが起動しない。
`request_queue_size = 128` と `HTTP/1.1` で解消（60 並列 ×3 回で reset 0。修正前は 60 中 8〜20 が reset）。
**同種の「時々動かない」を見たら、まず DevTools の Network でローカルの js が失敗していないか見ること。**

### 未着手タスク

- **打楽器の大きさを「実物の 1.25 倍」に揃える**（2026-09-11 記録。他の楽器は揃えた）。ティンパニ・スネア・グランカッサ・シロフォン・マリンバ・シンバルは現状 1.4〜1.7 倍で大きめ。
  打点（`strike` の hit/rest/head、`fixedHand`、鍵盤打楽器の `pitchSpread`）が奏者座標（rig px）で決めてあるため、楽器を拡縮すると打面と合わなくなる。
  やるなら「打点を楽器ローカル座標で持ち、`instPoint` で変換する」か「楽器の倍率で打点を同時に拡縮する」仕組みを先に入れる。シンバルは手持ち（held）なので `INST_SCALE` が効かず、絵の寸法を変える。

### 確認用の MIDI

- `samples/test_cc_decay.mid`：1st バイオリンが 4 秒のロングトーンを弾きながら CC11 が 127 → 5 へ直線的に下がる。
  「CC に従って前傾が緩むか」を目で確かめる用（2026-09-12）。`?midi=samples/test_cc_decay.mid` で読み込む。
