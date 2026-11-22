"""Parapets for closed walkway edges: public/assets/kit/parapet.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_parapet.py -- --out public/assets/kit/parapet.glb

Pieces (nodes), all modelled on the north edge of a 4 m cell, centre line 0.16 m inside the edge:
  balustrade        empty; children: balustrade_body (plinth, handrail coping, a newel in the middle) and
                    baluster_00..11, twelve nodes sharing one mesh (the game instances them)
  wall_a, wall_b    low ashlar wall with coping; the two differ only in where the stone pattern falls
  post              newel / wall pier, origin at its base centre; the game puts one wherever segments meet or turn
  post_lamp         a slightly larger pier that carries a lamp (it encloses the balustrade's middle newel)
Segments stop 4 cm short of the cell boundary so that posts cover straight joints, outer and inner corners.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

LINE = 1.84  # centre line of the parapet, metres north of the cell centre
HALF = 1.96  # half length of a segment
PLINTH = 0.18
RAIL = 0.84  # underside of the coping
TOP = 0.98
BALUSTERS_PER_BAY = 6
NEWEL_HALF = 0.18
POST_HALF = 0.21

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/parapet.glb")
K.reset()
ashlar = dict(K.ASHLAR)
if "ashlar" in opts:  # comparison builds: --ashlar <id> --ashlar-size <m> --textures <dir>
    ashlar.update(id=opts["ashlar"], size=float(opts.get("ashlar-size", ashlar["size"])))
    K.TEXTURES = opts.get("textures", K.TEXTURES)
STONE = K.stone_material("M_stone", ashlar, saturation=K.STONE_SATURATION)


def at_line(profile):
    return [(LINE + y, z) for y, z in profile]


# balustrade body: plinth, coping, middle newel
bm = bmesh.new()
K.prism(bm, at_line([(-0.16, 0), (0.16, 0), (0.16, 0.13), (0.13, PLINTH), (-0.13, PLINTH), (-0.16, 0.13)]), -HALF, HALF)
K.prism(bm, at_line([(-0.13, RAIL), (0.13, RAIL), (0.17, RAIL + 0.035), (0.17, 0.94), (0.11, TOP), (-0.11, TOP),
                     (-0.17, 0.94), (-0.17, RAIL + 0.035)]), -HALF, HALF)
K.box(bm, (-NEWEL_HALF, LINE - 0.15, PLINTH), (NEWEL_HALF, LINE + 0.15, RAIL))
body = K.finish(K.new_object("balustrade_body", bm, STONE), bevel=0.012)

# one baluster: square in plan with cut corners, a belly low down and a neck under the cap (reference A3)
H = RAIL - PLINTH
sections = [(0.085, 0.0, 0.012), (0.085, 0.055, 0.012), (0.062, 0.07, 0.014), (0.056, 0.095, 0.02), (0.074, 0.14, 0.03),
            (0.086, 0.2, 0.036), (0.082, 0.26, 0.032), (0.064, 0.36, 0.026), (0.049, 0.455, 0.02), (0.046, 0.495, 0.02),
            (0.062, 0.525, 0.02), (0.062, 0.548, 0.014), (0.052, 0.568, 0.014), (0.08, 0.598, 0.012), (0.08, H, 0.012)]
bm = bmesh.new()
K.loft(bm, sections)
baluster_mesh = K.finish(K.new_object("baluster", bm, STONE), smooth_angle=50).data
bpy.data.objects.remove(bpy.data.objects["baluster"])
bay = HALF - 0.17 - NEWEL_HALF  # between the middle newel and where the end post starts
step = bay / BALUSTERS_PER_BAY
xs = sorted(s * (NEWEL_HALF + step * (i + 0.5)) for s in (-1, 1) for i in range(BALUSTERS_PER_BAY))
balusters = []
for i, x in enumerate(xs):
    ob = bpy.data.objects.new(f"baluster_{i:02d}", baluster_mesh)
    bpy.context.collection.objects.link(ob)
    ob.location = (x, LINE, PLINTH)
    balusters.append(ob)
bpy.context.view_layer.update()
for a, b in zip(balusters, balusters[1:]):
    K.check_no_overlap(a, b)

# low wall with coping
WALL = [(-0.17, 0), (0.17, 0), (0.17, 0.12), (0.15, 0.15), (0.15, 0.80), (0.19, 0.82), (0.19, 0.90), (0.12, 0.96),
        (-0.12, 0.96), (-0.19, 0.90), (-0.19, 0.82), (-0.15, 0.80), (-0.15, 0.15), (-0.17, 0.12)]
walls = []
for name in ("wall_a", "wall_b"):
    bm = bmesh.new()
    K.prism(bm, at_line(WALL), -HALF, HALF)
    walls.append(K.finish(K.new_object(name, bm, STONE), bevel=0.012))


def post(name, half, top):
    bm = bmesh.new()
    c = 0.018
    K.loft(bm, [(half, 0, c), (half, 0.14, c), (half - 0.025, 0.17, c), (half - 0.025, top - 0.15, c), (half + 0.012, top - 0.12, c),
                (half + 0.012, top - 0.05, c), (half * 0.55, top, c)])
    return K.finish(K.new_object(name, bm, STONE), bevel=0.008)


posts = [post("post", POST_HALF, 1.1), post("post_lamp", 0.235, 1.18)]

unique = [body, balusters[2], *walls, *posts]
baked = [body, balusters[2], walls[0], *posts]  # wall_b reuses wall_a's place in the atlas
for ob in [body, *walls, *posts]:
    K.world_uv(ob)
K.world_uv(walls[1], offset=(1.37, 0.0, 0.83))
K.world_uv(balusters[2])

# bake layout: every piece stands on its own patch of ground, the balustrade with its balusters and end posts in place
ground = K.new_object("bake_ground", (lambda b: (K.box(b, (-60, -60, -0.5), (60, 60, 0.0)), b)[1])(bmesh.new()))
spots = {walls[0]: (0, 12, 0), walls[1]: (0, 24, 0), posts[0]: (12, 0, 0), posts[1]: (24, 0, 0)}
for ob, loc in spots.items():
    ob.location = loc
ends = []
for sx in (-1, 1):
    e = bpy.data.objects.new(f"bake_end_{sx}", posts[0].data)
    bpy.context.collection.objects.link(e)
    e.location = (sx * 2.0, LINE, 0)
    ends.append(e)
bpy.context.view_layer.update()
K.unwrap_atlas(baked, "UV1")
K.copy_uv(walls[0], walls[1], "UV1")
ao = K.bake_ao(baked, "parapet_ao", 1024, occluders=[ground, *ends, *balusters], distance=0.9, strength=1.25)
K.grime_vertex_colours(unique, ao)
for ob in spots:
    ob.location = (0, 0, 0)
for ob in [ground, *ends]:
    bpy.data.objects.remove(ob)

for ob in unique:
    K.check_mesh(ob, closed=True)
for ob in [body, *walls, *posts]:
    K.check_mesh(ob, standing=0.0)
if abs(balusters[0].location.z - PLINTH) > 1e-6:
    raise RuntimeError("balusters do not stand on the plinth")

root = bpy.data.objects.new("balustrade", None)
bpy.context.collection.objects.link(root)
for ob in [body, *balusters]:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, body, *balusters, *walls, *posts])
