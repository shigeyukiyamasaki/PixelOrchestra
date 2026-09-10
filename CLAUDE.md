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

### 未着手タスク

- **打楽器の大きさを「実物の 1.25 倍」に揃える**（2026-09-11 記録。他の楽器は揃えた）。ティンパニ・スネア・グランカッサ・シロフォン・マリンバ・シンバルは現状 1.4〜1.7 倍で大きめ。
  打点（`strike` の hit/rest/head、`fixedHand`、鍵盤打楽器の `pitchSpread`）が奏者座標（rig px）で決めてあるため、楽器を拡縮すると打面と合わなくなる。
  やるなら「打点を楽器ローカル座標で持ち、`instPoint` で変換する」か「楽器の倍率で打点を同時に拡縮する」仕組みを先に入れる。シンバルは手持ち（held）なので `INST_SCALE` が効かず、絵の寸法を変える。
