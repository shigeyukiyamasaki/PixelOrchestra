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

- **2D パペット × ドット絵 × 3D ステージ**（billboard の板）。ユーザーがアングルを回せることが要件
- **MIDI→動きのエンジン（midiEngine.js）と描画を分離**する。動きの数式は `puppet.js` のファミリー別テンプレートに閉じる
- ドット絵は最近傍補間・ブルーム無し（`TOOL_CRAFT_MEDIA.md` §1-3）
- 設定は id 付き input の自動収集で保存（`TOOL_CRAFT_RULES.md` §3-1）

### ローカル確認

ポート **8766 固定**（`python3 tools/serve.py`＝キャッシュ無効版。ES module の import はキャッシュバスターが効かないため）。`?midi=samples/test_orchestra.mid` で自動読み込み。
Chrome MCP で確認する時はタブを前面化してから（背面だと rAF が止まる）。
