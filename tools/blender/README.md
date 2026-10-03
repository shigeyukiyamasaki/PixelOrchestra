# Blender で作る 3D モデル（岩・石）

床に置く 3D モデル（3D モデル欄で読み込む GLB）を Blender のヘッドレスで作るスクリプト。2026-10-02〜03 に作成。
見た目はすべて共通：ベタ塗りの地に四角い点々（濃さ 30〜70%）。模様は描かず、凸凹は形で出す。

- 出力先：素材フォルダの `PixelOrchestra_ドロップ/3Dモデル/`（`tools/media_roots.txt` の最初のフォルダの中）
- 単位は m。原点は底面の中央。舞台では 3D モデル欄の「大きさ」1 で実物の 1.25 倍（`src/stage.js` の `MODEL_M`）
- Blender 5.1 で確認

| スクリプト | 作るもの |
|---|---|
| `make_rock.py` | 岩（幅 約 1m。3 段の粗さのまだら・欠け 7 か所・約 2,000 面） |
| `make_stone.py` | 小さな石（幅 25〜35cm。ゆるい凹凸＋欠け 5〜7 か所・約 150〜250 面） |
| `make_stone_set.py` | 石 3 つを寄せて 1 つの GLB に（重なりは自動でずらす。間隔は `SPREAD`） |

## 今ある素材を作ったコマンド

`B=/Applications/Blender.app/Contents/MacOS/Blender`、出力先は `D="/Volumes/SunDisk 4TB/動画編集/PixelOrchestra_ドロップ/3Dモデル"` とする。

```bash
# 岩1〜3：引数は 出力 種 横 奥行 高さ（比率）
$B --background --python make_rock.py -- "$D/岩1.glb"            # 種 7・比率 1.1 0.85 0.75（既定）
$B --background --python make_rock.py -- "$D/岩2.glb" 23 0.85 0.8 0.95
$B --background --python make_rock.py -- "$D/岩3.glb" 41 1.35 0.9 0.55

# 石1〜3：引数は 出力 種 横 奥行 高さ（比率） 幅[m]
$B --background --python make_stone.py -- "$D/石1.glb" 3 1.1 0.85 0.6 0.32
$B --background --python make_stone.py -- "$D/石2.glb" 17 1.0 0.9 0.75 0.26
$B --background --python make_stone.py -- "$D/石3.glb" 29 1.3 0.8 0.45 0.35

# 石セット（石1〜3 を寄せて 1 つに）
$B --background --python make_stone_set.py -- "$D/石1.glb" "$D/石2.glb" "$D/石3.glb" "$D/石セット.glb"
```

形違いを作るときは種（と比率）を変える。同じ値なら同じ形になる。
既存のファイルを上書きする前に、`_backup` を付けて退避しておくこと。
