"""The stone pylon crowned in gilt (reference A1): public/assets/kit/pylon.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_pylon.py -- --out public/assets/kit/pylon.glb

One piece, `pylon` (an empty with pylon_detail, pylon_shaft and pylon_crown). It stands beside a walkway, not on it:
the origin is at deck level in the middle of its 1.66 m footprint, the shaft below the deck goes 46 m down into the
haze, the stone tower rises 6.3 m above the deck and carries a gilt winged finial to 7.8 m. The wings spread along X.
Its stone is a shade darker than the parapets (weathered), so that the paving and the gilt stay the lightest things.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

DEPTH = 46.6
SQUASH = 0.04
SIZE = 0.72  # the profile below is written at the first design size and scaled by this

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/pylon.glb")
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
MATS = [STONE, GILT]

# stone: plinth at deck level, shaft with cut corners, entablature with a strong cornice, attic block
c = 0.07
sections = [(1.15, -1.0, c), (1.15, 0.35, c), (1.05, 0.5, c), (0.98, 0.55, c), (0.98, 0.95, c), (0.86, 1.05, 0.1),
            (0.84, 6.6, 0.1), (0.9, 6.7, c), (0.9, 6.95, c), (0.96, 7.0, c), (1.02, 7.2, c), (1.2, 7.42, c), (1.2, 7.62, c),
            (0.9, 7.7, c), (0.86, 8.45, c), (0.94, 8.52, c), (0.94, 8.7, c)]
bm = bmesh.new()
K.loft(bm, sections, 0)
# a sunk panel on each face of the shaft would need a boolean; four raised bands read as well at play distance
for z in (2.4, 5.2):
    K.loft(bm, [(0.875, z, 0.1), (0.9, z + 0.03, 0.1), (0.9, z + 0.19, 0.1), (0.875, z + 0.22, 0.1)], 0)
detail = K.finish(K.new_object("pylon_detail", bm, materials=MATS), smooth_angle=30)

bm = bmesh.new()
K.loft(bm, [(1.0, -DEPTH / SIZE, 0.12), (1.0, -1.0, 0.12)], 0)
shaft = K.finish(K.new_object("pylon_shaft", bm, materials=MATS), smooth_angle=30)

# gilt: a base, an orb, a spire, and two wings swept up and back
bm = bmesh.new()
K.lathe(bm, [(0.5, 8.7), (0.52, 8.8), (0.3, 8.92), (0.22, 9.05), (0.36, 9.25), (0.4, 9.42), (0.33, 9.6), (0.16, 9.72), (0.12, 9.9),
             (0.17, 10.0), (0.05, 10.6), (0.0, 10.9)], 14, 1)
for sx in (-1, 1):
    outline = [(0.12, 9.25), (0.7, 9.5), (1.35, 10.25), (1.28, 10.42), (0.95, 10.2), (0.98, 10.0), (0.62, 9.85), (0.66, 9.68), (0.2, 9.62)]
    front = [bm.verts.new((sx * x, -0.05, z)) for x, z in outline]
    back = [bm.verts.new((sx * x, 0.05, z)) for x, z in outline]
    n = len(outline)
    faces = [bm.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i])) for i in range(n)]
    faces.append(bm.faces.new(front))
    faces.append(bm.faces.new(list(reversed(back))))
    for f in faces:
        f.material_index = 1
crown = K.finish(K.new_object("pylon_crown", bm, materials=MATS), smooth_angle=45)

parts = [detail, shaft, crown]
for ob in parts:
    for v in ob.data.vertices:
        v.co *= SIZE
    ob.data.update()
    K.world_uv(ob)
bm = bmesh.new()
K.box(bm, (1.2 * SIZE, -6, -K.SLAB), (8, 6, 0))
deck = K.new_object("bake_deck", bm)
for v in shaft.data.vertices:
    v.co.z *= SQUASH
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.008)
for v in shaft.data.vertices:
    v.co.z /= SQUASH
shaft.data.update()
bpy.context.view_layer.update()
ao = K.bake_ao(parts, "pylon_ao", 512, occluders=[deck], distance=1.5, strength=1.2)
K.grime_vertex_colours(parts, ao, skip=("M_gilt",))
K.depth_weathering([detail, shaft], -0.6, -4.0, tint="#7C7E78")
K.depth_weathering([detail], 30.0, 29.0, tint="#CFCDC6")  # all of the stone above the deck, evenly
bpy.data.objects.remove(deck)
for ob in parts:
    K.check_mesh(ob, closed=True)
low = min(v.co.z for v in shaft.data.vertices)
if abs(low + DEPTH) > 1e-3:
    raise RuntimeError(f"pylon shaft ends at {low:.3f}")
root = bpy.data.objects.new("pylon", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
