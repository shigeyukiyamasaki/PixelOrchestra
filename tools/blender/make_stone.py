# blender --background --python make_stone.py -- <出力.glb> [種] [横 奥行 高さ の比率] [幅 m]
# 小さくてシンプルな石（2026-10-03）。岩（make_rock.py）の応用：細かい凸凹の 3 段はやめて、ゆるい凹凸＋面の割れ＋欠け 5〜7 か所（角を付ける）、面数を少なく。
# 見た目（ベタ塗りの地に四角い点々・濃さ 30〜70%）と点の実寸は岩と同じ
import bpy, bmesh, sys, random
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
SEED = int(args[1]) if len(args) > 1 else 7
SHAPE = tuple(float(a) for a in args[2:5]) if len(args) >= 5 else (1.1, 0.85, 0.6)
WIDTH = float(args[5]) if len(args) >= 6 else 0.3   # 一番長い辺 [m]
random.seed(SEED)
# ノイズをずらす量（種 7 は 0 ＝完成版と同じ）
_r = random.Random(SEED * 101)
OFF = Vector((_r.uniform(-50, 50), _r.uniform(-50, 50), _r.uniform(-50, 50)))   # ノイズをずらす量（種ごとに別の形）
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# 形：楕円の球 → 大きなうねり → ボロノイで角ばった割れ
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.5)
rock = bpy.context.active_object
rock.name = 'Stone'
rock.scale = SHAPE
bpy.ops.object.transform_apply(scale=True)

def displace(tex_type, size, strength, vg=None, **kw):
    t = bpy.data.textures.new(f'{tex_type}_{size}', tex_type)
    for k, v in kw.items(): setattr(t, k, v)
    if hasattr(t, 'noise_scale'): t.noise_scale = size
    m = rock.modifiers.new(t.name, 'DISPLACE')
    m.texture = t; m.strength = strength; m.texture_coords = 'GLOBAL'
    if vg: m.vertex_group = vg
    rock.location = OFF; bpy.context.view_layer.update()  # ノイズを種ごとにずらす（形の位置は動かさない）
    bpy.ops.object.modifier_apply(modifier=m.name)
    rock.location = (0, 0, 0); bpy.context.view_layer.update()

displace('CLOUDS', 0.7, 0.1, noise_depth=1)   # ゆるい凹凸（岩は 0.18 と強めのボロノイ）
displace('VORONOI', 0.4, 0.05, distance_metric='DISTANCE')   # 面の割れ（角を付ける。2026-10-03 ユーザー指定「丸すぎる」）

def flatten_bottom(bm, lift):
    zmin = min(v.co.z for v in bm.verts)
    r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zmin + lift), plane_no=(0, 0, -1), clear_outer=True)
    edges = [e for e in r['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges: bmesh.ops.holes_fill(bm, edges=edges)

# 平らな切断面を数枚（岩らしい欠け）
bm = bmesh.new(); bm.from_mesh(rock.data)
for _ in range(random.choice((5, 6, 7))):   # 欠けは 5〜7 か所（角を付ける。2026-10-03 ユーザー指定。最初の 1〜2 か所・固定の深さでは浅すぎて丸いままだった）
    n = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(0, 0.8))).normalized()
    # 深さはその方向の厚みに合わせる：一番出ている所から 14〜28% 削る（平たい石でも上を削りすぎない）
    reach = max(v.co.dot(n) for v in bm.verts)
    co = n * reach * random.uniform(0.72, 0.86)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=n, clear_outer=True)
    edges = [e for e in r['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges: bmesh.ops.holes_fill(bm, edges=edges)
# 底を平らに（床に座る）
flatten_bottom(bm, 0.12)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(rock.data); bm.free()

# 原点を底面中央へ
mn = Vector([min(v.co[i] for v in rock.data.vertices) for i in range(3)])
mx = Vector([max(v.co[i] for v in rock.data.vertices) for i in range(3)])
off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for v in rock.data.vertices: v.co -= off
# 小さく：一番長い辺を WIDTH にそろえる
dims = [max(v.co[i] for v in rock.data.vertices) - min(v.co[i] for v in rock.data.vertices) for i in range(3)]
k = WIDTH / max(dims)
for v in rock.data.vertices: v.co *= k

# 面数を減らす
# 全体を一律に減らしてから、ほぼ同じ向きの隣どうしの面だけをまとめる（平らな所ほど大きな面になる）
m = rock.modifiers.new('dec', 'DECIMATE'); m.ratio = min(1.0, 350 / len(rock.data.polygons))   # 岩は 3000
bpy.ops.object.modifier_apply(modifier='dec')
m = rock.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = 0.07
bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_flat()

# UV
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')

# 材質：ベタ塗りの地に細かい黒い点々（2026-10-02 ユーザー指定）。濃淡のまだらは描かず、凸凹は形で出す
# 点は 3D のボロノイで置く（面の向き・UV の継ぎ目に関係なく均一）。各セルに点 1 つ、セルの乱数で半分ほど間引き、大きさもばらつかせる
BASE = (0.70, 0.68, 0.64, 1); DOT = (0.10, 0.10, 0.10, 1)
mat = bpy.data.materials.new('RockMat'); mat.use_nodes = True
N = mat.node_tree.nodes; L = mat.node_tree.links
bsdf = N['Principled BSDF']; out_node = N['Material Output']
tc = N.new('ShaderNodeTexCoord')
# 点は四角（2026-10-02 ユーザー指定）。立体のままだと斜めの面で切り口が六角形などになるので、展開図（UV）の平面で正方形に置く。
# 展開図 1 単位が何 m かを面積の比で求め、点の数を立体で置いていた時（丸い点の版）と同じくらいに合わせる（46/m）
uvl = rock.data.uv_layers.active.data
def tri_area(a, b, c): return abs((b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])) / 2
area3 = sum(p.area for p in rock.data.polygons)
area_uv = 0
for p in rock.data.polygons:
    uv = [uvl[i].uv for i in p.loop_indices]
    for k in range(1, len(uv) - 1): area_uv += tri_area(uv[0], uv[k], uv[k + 1])
uv_m = (area3 / area_uv) ** 0.5
vor = N.new('ShaderNodeTexVoronoi'); vor.voronoi_dimensions = '2D'; vor.distance = 'CHEBYCHEV'
vor.inputs['Scale'].default_value = 46 * uv_m; vor.inputs['Randomness'].default_value = 1
L.new(tc.outputs['UV'], vor.inputs['Vector'])
# セルの乱数（Color の R）→ 点の半径。0.45 未満のセルは点なし
sep = N.new('ShaderNodeSeparateColor'); L.new(vor.outputs['Color'], sep.inputs[0])
rad = N.new('ShaderNodeMapRange'); rad.inputs['From Min'].default_value = 0.45; rad.inputs['From Max'].default_value = 1
rad.inputs['To Min'].default_value = 0.057; rad.inputs['To Max'].default_value = 0.21; rad.clamp = True
L.new(sep.outputs[0], rad.inputs['Value'])
keep = N.new('ShaderNodeMath'); keep.operation = 'GREATER_THAN'; keep.inputs[1].default_value = 0.45
L.new(sep.outputs[0], keep.inputs[0])
inside = N.new('ShaderNodeMath'); inside.operation = 'LESS_THAN'
L.new(vor.outputs['Distance'], inside.inputs[0]); L.new(rad.outputs['Result'], inside.inputs[1])
dot = N.new('ShaderNodeMath'); dot.operation = 'MULTIPLY'
L.new(inside.outputs[0], dot.inputs[0]); L.new(keep.outputs[0], dot.inputs[1])
# 点ごとの濃さ：セルの乱数（Color の G）で 0.3（薄い灰）〜 0.7（一番濃い点も黒まではいかない）
dens = N.new('ShaderNodeMapRange'); dens.inputs['To Min'].default_value = 0.3; dens.inputs['To Max'].default_value = 0.7
L.new(sep.outputs[1], dens.inputs['Value'])
dot2 = N.new('ShaderNodeMath'); dot2.operation = 'MULTIPLY'
L.new(dot.outputs[0], dot2.inputs[0]); L.new(dens.outputs['Result'], dot2.inputs[1])
mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
mix.inputs['A'].default_value = BASE; mix.inputs['B'].default_value = DOT
L.new(dot2.outputs[0], mix.inputs['Factor'])
emit = N.new('ShaderNodeEmission'); L.new(mix.outputs['Result'], emit.inputs['Color'])
L.new(emit.outputs[0], out_node.inputs['Surface'])
# 舞台は色をリニアのまま出すので、画像には値をそのまま入れる（sRGB で保存すると明るさが変わる）
img = bpy.data.images.new('rock_tex', 2048, 2048); img.colorspace_settings.name = 'Non-Color'
it = N.new('ShaderNodeTexImage'); it.image = img; N.active = it
rock.data.materials.append(mat)
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
bpy.ops.object.bake(type='EMIT', margin=4)
img.pack()
for n in list(N):
    if n not in (bsdf, out_node, it): N.remove(n)
L.new(it.outputs['Color'], bsdf.inputs['Base Color']); L.new(bsdf.outputs[0], out_node.inputs['Surface'])
bsdf.inputs['Metallic'].default_value = 0; bsdf.inputs['Roughness'].default_value = 1

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False)
print('OK', out, 'faces', len(rock.data.polygons), 'size', [round(d, 3) for d in rock.dimensions])
