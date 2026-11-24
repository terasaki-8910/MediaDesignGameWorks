"""The plate that slides out across the gap between a walkway and the path cube: public/assets/kit/plate.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_plate.py -- --out public/assets/kit/plate.glb

One piece, `plate` (an empty with plate_body and plate_line): a slab of the kit's paving 3.8 m wide and
0.25 m thick on a stone body, a gilt bronze rail along each side and a gilt nosing on the leading edge, and the path
line (cyan glass, material M_path_glass) down its middle, which carries the cube's path across the gap.
Frame: the game's plate holder. The origin is on the edge the plate comes out of, at floor level; the plate runs 4 m
towards -Y (the game's +Z) and the game stretches it along that axis from nothing, so nothing here depends on its length.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

HALF = 1.9
RAIL = 0.12
LENGTH = K.CELL
THICK = 0.25
LINE = 0.13  # half width of the path line, as on the cube

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/plate.glb")
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
PAVING = K.stone_material("M_paving", dict(K.PAVING))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
GLASS = K.plain_material("M_path_glass", "#0B2A30", metallic=0.0, roughness=0.2, emission="#5FF2FF", strength=1.0)
MATS = [STONE, PAVING, GILT, GLASS]
IN = HALF - RAIL

bm = bmesh.new()
faces = K.slab_outline(bm, [(-IN, -LENGTH + RAIL), (IN, -LENGTH + RAIL), (IN, 0.0), (-IN, 0.0)], -THICK, 0.0, material_index=0)
faces[-1].material_index = 1  # the top is paved
for x0, x1 in ((-HALF, -IN), (IN, HALF)):
    K.box(bm, (x0, -LENGTH + RAIL, -THICK - 0.02), (x1, 0.0, 0.014), 2)
K.box(bm, (-HALF, -LENGTH, -THICK - 0.03), (HALF, -LENGTH + RAIL, 0.02), 2)  # the nosing, a little stouter than the rails
body = K.finish(K.new_object("plate_body", bm, materials=MATS), bevel=0.01)

bm = bmesh.new()
K.slab_outline(bm, [(-LINE, -LENGTH + RAIL - 0.01), (LINE, -LENGTH + RAIL - 0.01), (LINE, 0.0), (-LINE, 0.0)], 0.0, 0.02, 0.008, 3)
line = K.finish(K.new_object("plate_line", bm, materials=MATS), smooth_angle=40)

parts = [body, line]
for ob in parts:
    K.world_uv(ob, offset=(2.0, LENGTH, 0.0))
    print(f"{ob.name}: {K.triangles(ob)} triangles")
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.02)
ao = K.bake_ao(parts, "plate_ao", 128, distance=0.4, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.6, skip=("M_gilt", "M_path_glass", "M_paving"))
K.check_mesh(body, closed=True)
K.check_mesh(line, closed=True)
root = bpy.data.objects.new("plate", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
