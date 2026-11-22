"""The fold console: public/assets/kit/console.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_console.py -- --out public/assets/kit/console.glb

One piece, `console` (an empty with console_body, console_head and console_glass): a dark bronze pedestal with a
slanted desk, a gilt crown round the desk and a glass panel whose material is named M_console_glass, so the game can
drive its cyan emission. Origin at the base centre; the panel faces -Y in Blender (+Z in three.js), towards the
player when the console stands on the north side of its cell.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/console.glb")
K.reset()
BRONZE = K.plain_material("M_bronze_dark", "#3D3A2E", metallic=1.0, roughness=0.45)
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
GLASS = K.plain_material("M_console_glass", "#0B2A30", metallic=0.0, roughness=0.12, emission="#5FF2FF", strength=1.0)
MATS = [BRONZE, GILT, GLASS]

# pedestal (bronze) with two gilt collars
bm = bmesh.new()
K.lathe(bm, [(0.36, 0.0), (0.36, 0.05), (0.33, 0.09), (0.27, 0.12), (0.23, 0.16), (0.2, 0.22), (0.17, 0.3), (0.15, 0.5),
             (0.14, 0.7), (0.15, 0.8), (0.2, 0.85), (0.2, 0.88), (0.16, 0.91), (0.16, 0.95), (0.21, 0.99), (0.0, 0.99)], 16, 0)
for z, h in ((0.07, 0.035), (0.3, 0.035), (0.84, 0.045)):
    r = 0.365 if z < 0.2 else 0.172 if z < 0.5 else 0.203
    K.lathe(bm, [(r - 0.04, z - h), (r + 0.02, z - h * 0.6), (r + 0.02, z + h * 0.6), (r - 0.04, z + h)], 16, 1)
body = K.finish(K.new_object("console_body", bm, materials=MATS), smooth_angle=45)

# desk: a slab tilted towards the player, a gilt rim round it and a crest of gilt finials along its upper edge
W, D, T = 0.62, 0.46, 0.09
RIM = 0.05
bm = bmesh.new()
K.box(bm, (-W / 2, -D / 2, 0), (W / 2, D / 2, T), 0)
for lo, hi in (((-W / 2 - 0.012, -D / 2 - 0.012, T - 0.03), (W / 2 + 0.012, -D / 2 + RIM, T + 0.02)),
               ((-W / 2 - 0.012, D / 2 - RIM, T - 0.03), (W / 2 + 0.012, D / 2 + 0.012, T + 0.02)),
               ((-W / 2 - 0.009, -D / 2 + RIM - 0.006, T - 0.027), (-W / 2 + RIM, D / 2 - RIM + 0.006, T + 0.017)),
               ((W / 2 - RIM, -D / 2 + RIM - 0.006, T - 0.027), (W / 2 + 0.009, D / 2 - RIM + 0.006, T + 0.017))):
    K.box(bm, lo, hi, 1)
for i in range(5):
    x = (i - 2) * 0.13
    h = 0.12 if i == 2 else 0.085
    K.lathe(bm, [(0.034, T + 0.02), (0.022, T + 0.04), (0.036, T + 0.02 + h * 0.5), (0.012, T + 0.02 + h * 0.85), (0.0, T + 0.02 + h)],
            8, 1, centre=(x, D / 2 - RIM / 2 + 0.006))
tilt = Matrix.Translation((0, -0.03, 1.04)) @ Matrix.Rotation(math.radians(32), 4, "X")
bm.transform(tilt)
# the crown: a gilt armillary behind the desk (two rings at right angles round an orb, a finial on top), large enough
# to catch the sun and to read from the play camera from any side (the desk's rim alone was a few pixels)
RING_C, RING_R = (0.0, 0.22, 1.52), 0.29
angles = [math.radians(-84 + 348 * i / 28) for i in range(29)]
K.tube(bm, [(RING_C[0] + RING_R * math.cos(a), RING_C[1], RING_C[2] + RING_R * math.sin(a)) for a in angles], 0.032, 8, 1)
K.tube(bm, [(RING_C[0], RING_C[1] + (RING_R - 0.07) * math.cos(a), RING_C[2] + (RING_R - 0.07) * math.sin(a)) for a in angles], 0.03, 8, 1,
       side=(1, 0, 0))


def orb(cx, cy, cz, r):
    K.lathe(bm, [(0.0, cz - r)] + [(r * math.cos(math.radians(b)), cz + r * math.sin(math.radians(b))) for b in range(-60, 61, 30)]
            + [(0.0, cz + r)], 10, 1, centre=(cx, cy))


orb(RING_C[0], RING_C[1], RING_C[2], 0.1)
orb(RING_C[0], RING_C[1], RING_C[2] + RING_R + 0.05, 0.07)
K.lathe(bm, [(0.03, RING_C[2] + RING_R + 0.1), (0.012, RING_C[2] + RING_R + 0.24), (0.0, RING_C[2] + RING_R + 0.27)], 8, 1, centre=(RING_C[0], RING_C[1]))
K.lathe(bm, [(0.05, 0.99), (0.05, RING_C[2] - RING_R + 0.02), (0.03, RING_C[2] - RING_R + 0.04), (0.0, RING_C[2] - RING_R + 0.04)], 8, 0,
        centre=(0.0, RING_C[1]))
K.lathe(bm, [(0.018, RING_C[2] - RING_R + 0.2), (0.018, RING_C[2] - 0.08), (0.0, RING_C[2] - 0.08)], 6, 1, centre=(0.0, RING_C[1]))
head = K.finish(K.new_object("console_head", bm, materials=MATS), bevel=0.006, smooth_angle=45)

bm = bmesh.new()
K.box(bm, (-W / 2 + RIM + 0.004, -D / 2 + RIM + 0.004, T - 0.004), (W / 2 - RIM - 0.004, D / 2 - RIM - 0.004, T + 0.008), 2)
bm.transform(tilt)
glass = K.finish(K.new_object("console_glass", bm, materials=MATS))

parts = [body, head, glass]
bm = bmesh.new()
K.box(bm, (-3, -3, -0.5), (3, 3, 0))
ground = K.new_object("bake_ground", bm)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV0", margin=0.008)
ao = K.bake_ao(parts, "console_ao", 512, layer="UV0", occluders=[ground], distance=0.5, strength=1.2)
# verdigris and dirt in the recesses of the metal; the glass stays clean
K.grime_vertex_colours(parts, ao, layer="UV0", tint="#6F8E7A", amount=0.75, power=1.2, skip=("M_console_glass",))
bpy.data.objects.remove(ground)
K.check_mesh(body, closed=True, standing=0.0)
K.check_mesh(head, closed=True)
K.check_mesh(glass, closed=True)
root = bpy.data.objects.new("console", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
