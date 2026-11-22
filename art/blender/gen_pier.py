"""Stone piers under the walkways: public/assets/kit/pier.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_pier.py -- --out public/assets/kit/pier.glb

Pieces (nodes): pier_a (2.2 m shaft, for walkways one cell wide) and pier_b (4.4 m shaft, for plazas). Each is an empty
with two meshes, <name>_detail (capital and base mouldings) and <name>_shaft. The origin is the floor centre of the
cell above; the capital meets the underside of the slab at -0.6 m and the pier goes down 46 m into the haze.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

DEPTH = 46.6
SQUASH = 0.04

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/pier.glb")
K.reset()
ashlar = dict(K.ASHLAR)
if "ashlar" in opts:
    ashlar.update(id=opts["ashlar"], size=float(opts.get("ashlar-size", ashlar["size"])))
    K.TEXTURES = opts.get("textures", K.TEXTURES)
STONE = K.stone_material("M_stone", ashlar, saturation=K.STONE_SATURATION)


def pier(name, s, base_z):
    """`s` scales the plan (1 = the 2.2 m shaft); the mouldings grow in height more slowly."""
    v = 0.6 + 0.4 * s
    top = -K.SLAB
    c = 0.16 * s
    capital = [(1.70 * s, top, 0.03), (1.70 * s, top - 0.26 * v, 0.03), (1.58 * s, top - 0.34 * v, 0.03),
               (1.52 * s, top - 0.36 * v, 0.05), (1.36 * s, top - 0.62 * v, 0.08), (1.24 * s, top - 0.95 * v, 0.1),
               (1.17 * s, top - 1.4 * v, c), (1.17 * s, top - 1.52 * v, c), (1.22 * s, top - 1.55 * v, c),
               (1.22 * s, top - 1.72 * v, c), (1.10 * s, top - 1.76 * v, c), (1.10 * s, top - 2.4 * v, c)]
    cap_end = capital[-1][1]
    base = [(1.10 * s, base_z, c), (1.20 * s, base_z - 0.04, c), (1.20 * s, base_z - 0.3 * v, c), (1.32 * s, base_z - 0.52 * v, c),
            (1.40 * s, base_z - 0.9 * v, c), (1.40 * s, base_z - 1.6 * v, c)]
    base_end = base[-1][1]
    bm = bmesh.new()
    K.loft(bm, list(reversed(capital)))
    K.loft(bm, list(reversed(base)))
    detail = K.finish(K.new_object(f"{name}_detail", bm, STONE), smooth_angle=30)
    bm = bmesh.new()
    K.loft(bm, [(1.10 * s, base_z, c), (1.10 * s, cap_end, c)])
    K.loft(bm, [(1.40 * s, -DEPTH, c), (1.40 * s, base_end, c)])
    shaft = K.finish(K.new_object(f"{name}_shaft", bm, STONE), smooth_angle=30)
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    detail.parent = shaft.parent = root
    return root, detail, shaft


piers = [pier("pier_a", 1.0, -15.0), pier("pier_b", 2.0, -17.0)]
meshes = [ob for _, d, s in piers for ob in (d, s)]
for k, ob in enumerate(meshes):
    K.world_uv(ob, offset=(0.4 * k, 0.9 * k, 0.55 * k))

# bake: each pier under its own slab; the long shafts are squashed while unwrapping so they take little of the atlas
slabs = []
for k, (root, detail, shaft) in enumerate(piers):
    root.location = (30.0 * k, 0, 0)
    bm = bmesh.new()
    K.box(bm, (-8, -8, -K.SLAB), (8, 8, 0))
    s = K.new_object(f"bake_slab_{k}", bm)
    s.location = root.location
    slabs.append(s)
    for vert in shaft.data.vertices:
        vert.co.z *= SQUASH
bpy.context.view_layer.update()
K.unwrap_atlas(meshes, "UV1", margin=0.01)
for _, _, shaft in piers:
    for vert in shaft.data.vertices:
        vert.co.z /= SQUASH
    shaft.data.update()
bpy.context.view_layer.update()
ao = K.bake_ao(meshes, "pier_ao", 512, occluders=slabs, distance=2.5, strength=1.2)
K.grime_vertex_colours(meshes, ao)
for root, _, _ in piers:
    root.location = (0, 0, 0)
for s in slabs:
    bpy.data.objects.remove(s)
for ob in meshes:
    K.check_mesh(ob, closed=True)
bpy.context.view_layer.update()
for root, detail, shaft in piers:
    hi = max((detail.matrix_world @ v.co).z for v in detail.data.vertices)
    lo = min((shaft.matrix_world @ v.co).z for v in shaft.data.vertices)
    if abs(hi + K.SLAB) > 1e-4 or abs(lo + DEPTH) > 1e-3:
        raise RuntimeError(f"{root.name}: spans {lo:.3f} .. {hi:.3f}, expected {-DEPTH} .. {-K.SLAB}")
K.export(OUT, [ob for root, d, s in piers for ob in (root, d, s)])
