"""The stone pylon crowned in gilt (reference A1): public/assets/kit/pylon.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_pylon.py -- --out public/assets/kit/pylon.glb

One piece, `pylon` (an empty with pylon_stone and pylon_gilt). It stands beside a walkway, not on it, carried by a
stepped corbel that tapers away 3.4 m below the deck (no shaft of its own into the haze). The origin is at deck level
in the middle of its 1.74 m plinth. Above the deck: plinth, a shaft with a pilaster on each corner and a sunk panel
with a gilt wreath on each face, architrave, frieze, a deep cornice, an attic and a stepped pedestal (6.9 m), then
the gilt winged finial to 8.5 m. The wings spread along X. The stone's tone varies from course to course.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/pylon.glb")
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
MATS = [STONE, GILT]
COURSE = 0.56
SHAFT = (0.95, 4.85)  # the shaft between the plinth and the architrave
CORE = 0.6  # half width of the shaft's core: the sunk panels
PIL = 0.68  # half width over the corner pilasters

bm = bmesh.new()
c = 0.03
# the corbel under the deck and the plinth on it
K.loft(bm, [(0.06, -3.4, 0.02), (0.3, -3.0, c), (0.46, -2.3, c), (0.62, -1.62, c), (0.62, -1.45, c), (0.76, -1.3, c), (0.76, -0.92, c),
            (0.87, -0.78, c), (0.87, 0.5, c), (0.8, 0.6, c), (0.76, 0.62, c), (0.76, 0.86, c), (0.7, SHAFT[0], c)], 0)
# the core in courses, so each course can take its own tone
n = round((SHAFT[1] - SHAFT[0]) / COURSE)
K.loft(bm, [(CORE, SHAFT[0] + (SHAFT[1] - SHAFT[0]) * i / n, 0.01) for i in range(n + 1)], 0)
for sx in (-1, 1):
    for sy in (-1, 1):
        x0, x1 = sorted((sx * (PIL - 0.2), sx * PIL))
        y0, y1 = sorted((sy * (PIL - 0.2), sy * PIL))
        # the pilasters in the same courses
        K.loft(bm, [(0.1, SHAFT[0] + (SHAFT[1] - SHAFT[0]) * i / n, 0.006) for i in range(n + 1)], 0, centre=(sx * (PIL - 0.1), sy * (PIL - 0.1)))
        K.box(bm, (x0 - 0.03 * (sx < 0), y0 - 0.03 * (sy < 0), SHAFT[0]), (x1 + 0.03 * (sx > 0), y1 + 0.03 * (sy > 0), SHAFT[0] + 0.16), 0)
        K.box(bm, (x0 - 0.03 * (sx < 0), y0 - 0.03 * (sy < 0), SHAFT[1] - 0.14), (x1 + 0.03 * (sx > 0), y1 + 0.03 * (sy > 0), SHAFT[1]), 0)
# a raised tablet in each sunk panel
for nx, ny in ((0, -1), (0, 1), (1, 0), (-1, 0)):
    d0, d1 = CORE - 0.01, CORE + 0.035
    if nx:
        K.box(bm, (min(nx * d0, nx * d1), -0.27, 2.25), (max(nx * d0, nx * d1), 0.27, 3.55), 0)
    else:
        K.box(bm, (-0.27, min(ny * d0, ny * d1), 2.25), (0.27, max(ny * d0, ny * d1), 3.55), 0)
# architrave, frieze, deep cornice, attic, stepped pedestal for the finial
K.loft(bm, [(0.7, SHAFT[1], c), (0.72, 4.9, c), (0.72, 5.06, c), (0.66, 5.08, c), (0.66, 5.34, c), (0.72, 5.37, c), (0.8, 5.43, c),
            (1.0, 5.58, c), (1.05, 5.61, c), (1.05, 5.78, c), (0.9, 5.84, c), (0.64, 5.86, c), (0.64, 6.3, c), (0.7, 6.33, c),
            (0.7, 6.42, c), (0.5, 6.44, c), (0.5, 6.56, c), (0.38, 6.58, c), (0.38, 6.84, c), (0.44, 6.87, c), (0.44, 6.92, c)], 0)
stone = K.finish(K.new_object("pylon_stone", bm, materials=MATS), smooth_angle=30)

# gilt: a wreath on each tablet, and the finial (a base, an orb, a spire, two wings swept up and back)
bm = bmesh.new()
ring = [math.radians(8 + 344 * i / 16) for i in range(17)]
for nx, ny in ((0, -1), (0, 1), (1, 0), (-1, 0)):
    d = CORE + 0.06
    if nx:
        K.tube(bm, [(nx * d, 0.17 * math.cos(a), 2.9 + 0.17 * math.sin(a)) for a in ring], 0.032, 6, 1, side=(1, 0, 0))
    else:
        K.tube(bm, [(0.17 * math.cos(a), ny * d, 2.9 + 0.17 * math.sin(a)) for a in ring], 0.032, 6, 1)
S, Z = 0.72, 6.92  # the finial was drawn 1.39 times larger with its base at 8.7
f = lambda r, z: (r * S, (z - 8.7) * S + Z)  # noqa: E731
K.lathe(bm, [f(*p) for p in ((0.5, 8.7), (0.52, 8.8), (0.3, 8.92), (0.22, 9.05), (0.36, 9.25), (0.4, 9.42), (0.33, 9.6), (0.16, 9.72),
                             (0.12, 9.9), (0.17, 10.0), (0.05, 10.6), (0.0, 10.9))], 14, 1)
for sx in (-1, 1):
    outline = [f(*p) for p in ((0.12, 9.25), (0.7, 9.5), (1.35, 10.25), (1.28, 10.42), (0.95, 10.2), (0.98, 10.0), (0.62, 9.85), (0.66, 9.68),
                               (0.2, 9.62))]
    front = [bm.verts.new((sx * x, -0.04, z)) for x, z in outline]
    back = [bm.verts.new((sx * x, 0.04, z)) for x, z in outline]
    k = len(outline)
    faces = [bm.faces.new((front[i], front[(i + 1) % k], back[(i + 1) % k], back[i])) for i in range(k)]
    faces.append(bm.faces.new(front))
    faces.append(bm.faces.new(list(reversed(back))))
    for face in faces:
        face.material_index = 1
gilt = K.finish(K.new_object("pylon_gilt", bm, materials=MATS), smooth_angle=45)

parts = [stone, gilt]
for ob in parts:
    K.world_uv(ob)
bm = bmesh.new()
K.box(bm, (1.1, -6, -K.SLAB), (8, 6, 0))
deck = K.new_object("bake_deck", bm)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.006)
ao = K.bake_ao(parts, "pylon_ao", 512, occluders=[deck], distance=1.2, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.6, skip=("M_gilt",))
K.depth_weathering([stone], -0.6, -3.0, tint="#7C7E78")  # the corbel under the deck
K.depth_weathering([stone], 30.0, 29.0, tint="#D6D4CD")  # all of the stone, a shade under the parapets
K.course_tint([stone], COURSE, 0.08)
bpy.data.objects.remove(deck)
for ob in parts:
    K.check_mesh(ob, closed=True)
top = max(v.co.z for v in gilt.data.vertices)
low = min(v.co.z for v in stone.data.vertices)
if abs(low + 3.4) > 1e-3 or not 8.4 < top < 8.6:
    raise RuntimeError(f"pylon spans {low:.3f} .. {top:.3f}")
root = bpy.data.objects.new("pylon", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
