# blender --background --python make_stone_set.py -- <石1.glb> <石2.glb> <石3.glb> <出力.glb>
# 石 3 つを近くに寄せて 1 つの GLB にする（2026-10-03 ユーザー指定）。重なっていたら外へ 1cm ずつずらす。原点は全体の底面の中央
import bpy, sys, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]; srcs, out = a[:3], a[3]
bpy.ops.wm.read_factory_settings(use_empty=True)
# 並べ方（Blender の座標：x 横・y 奥・z 上）と向き [度]
LAYOUT = [((-0.13, 0.05), 20), ((0.17, 0.11), -35), ((0.03, -0.18), 70)]
SPREAD = 1.6   # 間隔の倍率（2026-10-03 ユーザー指定「もう少し離して」。1.0 が最初の版）
cx = sum(p[0][0] for p in LAYOUT) / 3; cy = sum(p[0][1] for p in LAYOUT) / 3
LAYOUT = [((cx + (x - cx) * SPREAD, cy + (y - cy) * SPREAD), rz) for (x, y), rz in LAYOUT]
objs = []
for f, ((x, y), rz) in zip(srcs, LAYOUT):
    bpy.ops.import_scene.gltf(filepath=f)
    meshes = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    o = meshes[0]
    o.parent = None
    o.location = (x, y, 0); o.rotation_euler = (0, 0, math.radians(rz)); o.scale = (1, 1, 1)
    objs.append(o)
dg = bpy.context.evaluated_depsgraph_get()
def bvh(o):
    o.data.update(); bpy.context.view_layer.update()
    return BVHTree.FromPolygons([o.matrix_world @ v.co for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons])
center = Vector((0, 0, 0))
for _ in range(60):   # 重なりを外へずらして解く（上限 60 回）
    moved = False
    for i in range(3):
        for j in range(i + 1, 3):
            if bvh(objs[i]).overlap(bvh(objs[j])):
                d = (objs[j].location - objs[i].location); d.z = 0; d.normalize()
                objs[j].location += d * 0.01; objs[i].location -= d * 0.01; moved = True
    if not moved: break
print('OVERLAP_FREE', not moved)
# 1 つにまとめ、原点を全体の底面の中央へ
for o in bpy.context.scene.objects: o.select_set(False)
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
st = bpy.context.active_object; st.name = 'StoneSet'
vs = [v.co for v in st.data.vertices]
mn = Vector([min(v[i] for v in vs) for i in range(3)]); mx = Vector([max(v[i] for v in vs) for i in range(3)])
off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for v in st.data.vertices: v.co -= off
for o in list(bpy.context.scene.objects):
    if o is not st: bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
print('OK', out, 'faces', len(st.data.polygons), 'mats', len(st.data.materials), 'size', [round(mx[i] - mn[i], 3) for i in range(3)])
