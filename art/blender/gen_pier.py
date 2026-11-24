"""Stone piers under the walkways: public/assets/kit/pier.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_pier.py -- --out public/assets/kit/pier.glb

Pieces (nodes): pier_a (2.2 m shaft, for walkways one cell wide), pier_b (4.4 m shaft, for plazas) and pier_pivot (a round
pier as thick as the others, 2.7 m, with a bronze bearing ring, which stands under the middle of a turning bridge). Each is an empty with two
meshes, <name>_detail (capital and base mouldings) and <name>_shaft. The origin is the floor centre of the
cell above; the capital meets the underside of the slab at -0.6 m and the pier goes down 132 m, through the haze and into the
ground of the city below (which lies 108 to 130 m under the walkways, whatever way it is folded); the game stands a
masonry foot (cityprops.glb, pier_foot) round it there.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

DEPTH = 132.0
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


def pivot_pier(name):
    """Round pier for a turning bridge: bearing ring under the slab, a flaring capital, a shaft and a base ring."""
    top = -K.SLAB
    bm = bmesh.new()
    K.lathe(bm, [(1.75, top), (1.75, top - 0.16), (1.6, top - 0.16)], 24, 1)
    K.lathe(bm, [(1.95, top - 0.16), (1.95, top - 0.46), (1.82, top - 0.55), (1.76, top - 0.57), (1.6, top - 0.95), (1.46, top - 1.45),
                 (1.4, top - 2.1), (1.4, top - 2.2), (1.47, top - 2.24), (1.47, top - 2.44), (1.35, top - 2.48), (1.35, top - 2.8)], 24, 0)
    K.lathe(bm, [(1.35, -15.0), (1.47, -15.04), (1.47, -15.35), (1.6, -15.6), (1.7, -16.0), (1.7, -16.6)], 24, 0)
    detail = K.finish(K.new_object(f"{name}_detail", bm, materials=[STONE, BRONZE]), smooth_angle=40)
    bm = bmesh.new()
    K.lathe(bm, [(1.35, top - 2.8), (1.35, -15.0)], 24, 0)
    K.lathe(bm, [(1.7, -16.6), (1.7, -DEPTH)], 24, 0)
    shaft = K.finish(K.new_object(f"{name}_shaft", bm, materials=[STONE, BRONZE]), smooth_angle=40)
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    detail.parent = shaft.parent = root
    return root, detail, shaft


BRONZE = K.plain_material("M_bronze_dark", "#3D3A2E", metallic=1.0, roughness=0.45)
piers = [pier("pier_a", 1.0, -15.0), pier("pier_b", 2.0, -17.0), pivot_pier("pier_pivot")]
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
K.grime_vertex_colours(meshes, ao, skip=("M_bronze_dark",))
K.depth_weathering(meshes, -0.6, -4.0, tint="#7C7E78")
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
