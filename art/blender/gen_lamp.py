"""The street lamp: public/assets/kit/lamp.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_lamp.py -- --out public/assets/kit/lamp.glb

One piece, `lamp` (an empty with lamp_post and lamp_bulbs): an ornate dark bronze candelabrum, 2.2 m tall, that stands
on a parapet pier (parapet.glb, post_lamp). The globes use the material M_lamp_bulb, which the game lights warm.
The arms run along X, the direction of the parapet under a lamp on a north or south edge.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/lamp.glb")
K.reset()
BRONZE = K.plain_material("M_bronze_dark", "#3D3A2E", metallic=1.0, roughness=0.45)
GILT = K.plain_material("M_gilt", "#DDB95A", metallic=1.0, roughness=0.32)
BULB = K.plain_material("M_lamp_bulb", "#FFE9C4", metallic=0.0, roughness=0.3, emission="#FFD9A0", strength=3.0)
MATS = [BRONZE, GILT, BULB]
SEG = 12


def globe(bm, centre, z, r):
    K.lathe(bm, [(0.0, z - r)] + [(r * math.cos(math.radians(a)), z + r * math.sin(math.radians(a))) for a in range(-60, 61, 30)]
            + [(0.0, z + r)], SEG, 2, centre=centre)


bm = bmesh.new()
K.lathe(bm, [(0.17, 0.0), (0.17, 0.04), (0.14, 0.07), (0.15, 0.1), (0.13, 0.14), (0.085, 0.24), (0.06, 0.33), (0.088, 0.37),
             (0.088, 0.4), (0.055, 0.44), (0.046, 0.9), (0.04, 1.34), (0.072, 1.38), (0.072, 1.42), (0.046, 1.46), (0.04, 1.7),
             (0.06, 1.74), (0.11, 1.8), (0.122, 1.845), (0.1, 1.865), (0.0, 1.865)], SEG, 0)
K.lathe(bm, [(0.05, 0.375), (0.096, 0.378), (0.096, 0.392), (0.05, 0.395)], SEG, 1)
K.lathe(bm, [(0.04, 1.385), (0.08, 1.39), (0.08, 1.41), (0.04, 1.415)], SEG, 1)
K.lathe(bm, [(0.06, 2.045), (0.085, 2.06), (0.035, 2.11), (0.014, 2.19), (0.0, 2.22)], SEG, 0)
for sx in (-1, 1):
    path = [(sx * 0.03, 0, 1.40), (sx * 0.12, 0, 1.345), (sx * 0.21, 0, 1.35), (sx * 0.29, 0, 1.41), (sx * 0.32, 0, 1.5), (sx * 0.32, 0, 1.585)]
    K.tube(bm, path, 0.017, 6, 0)
    K.lathe(bm, [(0.03, 1.57), (0.075, 1.61), (0.085, 1.645), (0.07, 1.66), (0.0, 1.66)], 10, 0, centre=(sx * 0.32, 0))
    K.lathe(bm, [(0.045, 1.80), (0.06, 1.812), (0.02, 1.85), (0.0, 1.88)], 10, 0, centre=(sx * 0.32, 0))
post = K.finish(K.new_object("lamp_post", bm, materials=MATS), smooth_angle=45)

bm = bmesh.new()
globe(bm, (0, 0), 1.955, 0.115)
for sx in (-1, 1):
    globe(bm, (sx * 0.32, 0), 1.735, 0.085)
bulbs = K.finish(K.new_object("lamp_bulbs", bm, materials=MATS), smooth_angle=60)

parts = [post, bulbs]
bm = bmesh.new()
K.box(bm, (-3, -3, -0.5), (3, 3, 0))
ground = K.new_object("bake_ground", bm)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV0", margin=0.008)
ao = K.bake_ao(parts, "lamp_ao", 512, layer="UV0", occluders=[ground], distance=0.4, strength=1.2)
K.grime_vertex_colours(parts, ao, layer="UV0", tint="#6F8E7A", amount=0.75, power=1.2, skip=("M_lamp_bulb",))
bpy.data.objects.remove(ground)
K.check_mesh(post, closed=True, standing=0.0)
K.check_mesh(bulbs, closed=True)
root = bpy.data.objects.new("lamp", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
