"""Floor slabs for `tile` and `bridge` modules: public/assets/kit/floor.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_floor.py -- --out public/assets/kit/floor.glb

Pieces (nodes), in the frame of one 4 m cell (origin at the floor centre; the slab is 0.6 m thick):
  slab_top       the paved top; UV0 is the position / 4 m, so the paving runs on across cells at one texel density
  slab_bottom    the underside
  edge_cornice   north edge of a cell on the open side of a slab: a kerb with a 2.5 cm bevel, a corona,
                 a fillet, an ovolo and a second fillet above the fascia; it projects 0.15 m
  edge_flush     north edge where another slab can stand against this one: a plain face
  corner_outer   the cornice turning round the north-east corner of a cell
  corner_inner   a block where two cornices meet in an inside corner (the north-east corner of the cell that is
                 diagonal to the open one)
The game turns the edge and corner pieces by quarter turns for the other sides.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

H = K.CELL / 2
PROJECTION = 0.15
BEVEL = 0.025

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/floor.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))  # colour factor of upright faces (the tops keep 1.0); see K.face_weathering
K.reset()
paving, ashlar = dict(K.PAVING), dict(K.ASHLAR)
if "paving" in opts:  # comparison builds: --paving <id> --paving-size <m> --paving-res 1k --textures <dir>
    paving.update(id=opts["paving"], size=float(opts.get("paving-size", 4)), res=opts.get("paving-res", "1k"), nor_res=opts.get("paving-res", "1k"))
    K.TEXTURES = opts.get("textures", K.TEXTURES)
if "ashlar" in opts:
    ashlar.update(id=opts["ashlar"], size=float(opts.get("ashlar-size", ashlar["size"])))
    K.TEXTURES = opts.get("textures", K.TEXTURES)
PAVING = K.stone_material("M_paving", paving)
STONE = K.stone_material("M_stone", ashlar, saturation=K.STONE_SATURATION)

# the cornice profile as (projection from the edge, height), from the paving outwards and down
PROFILE = ([(0.0, 0.0), (PROJECTION - BEVEL, 0.0), (PROJECTION, -BEVEL), (PROJECTION, -0.16), (0.12, -0.16), (0.12, -0.19)]
           + K.arc(0.04, -0.19, 0.08, 0.11, 0, -90, 6)[1:]
           + [(0.04, -0.33), (0.02, -0.33), (0.02, -K.SLAB), (0.0, -K.SLAB)])

# paved top, split 8 x 8 so the game can vary its colour by place
bm = bmesh.new()
N = 8
grid = [[bm.verts.new((-H + K.CELL * i / N, -H + K.CELL * j / N, 0.0)) for i in range(N + 1)] for j in range(N + 1)]
for j in range(N):
    for i in range(N):
        bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
top = K.finish(K.new_object("slab_top", bm, PAVING))

bm = bmesh.new()
bm.faces.new([bm.verts.new(p) for p in ((-H, -H, -K.SLAB), (-H, H, -K.SLAB), (H, H, -K.SLAB), (H, -H, -K.SLAB))])
bottom = K.finish(K.new_object("slab_bottom", bm, STONE))

bm = bmesh.new()
K.prism(bm, [(H + o, z) for o, z in PROFILE], -H, H)
cornice = K.finish(K.new_object("edge_cornice", bm, STONE), smooth_angle=30)

bm = bmesh.new()
bm.faces.new([bm.verts.new(p) for p in ((-H, H, -K.SLAB), (H, H, -K.SLAB), (H, H, 0.0), (-H, H, 0.0))])
flush = K.finish(K.new_object("edge_flush", bm, STONE))

# outer corner: the profile carried from the north edge (plane x = H) over the mitre to the east edge (plane y = H)
polys = []
n = len(PROFILE)
for i in range(n - 1):
    (o0, z0), (o1, z1) = PROFILE[i], PROFILE[i + 1]
    a0, a1 = (H, H + o0, z0), (H, H + o1, z1)
    d0, d1 = (H + o0, H + o0, z0), (H + o1, H + o1, z1)
    b0, b1 = (H + o0, H, z0), (H + o1, H, z1)
    polys.append([a0, d0, d1, a1])
    polys.append([d0, b0, b1, d1])
polys.append([(H, H + o, z) for o, z in PROFILE])
polys.append([(H + o, H, z) for o, z in reversed(PROFILE)])
bm = bmesh.new()
K.keyed_faces(bm, polys)
outer = K.finish(K.new_object("corner_outer", bm, STONE), smooth_angle=30)

bm = bmesh.new()
K.box(bm, (H, H, -0.37), (H + PROJECTION + 0.02, H + PROJECTION + 0.02, 0.02))
inner = K.finish(K.new_object("corner_inner", bm, STONE), bevel=0.012)

stone = [bottom, cornice, flush, outer, inner]
for ob in [top, *stone]:
    K.world_uv(ob, offset=(H, H, 0.0) if ob is top else (0, 0, 0))

# bake: every stone piece against its own slab, 10 m apart
slabs = []
for k, ob in enumerate(stone):
    ob.location = (10.0 * (k + 1), 0, 0)
    bm = bmesh.new()
    K.box(bm, (-H, -H, -K.SLAB + 0.001), (H, H, -0.001))
    s = K.new_object(f"bake_slab_{k}", bm)
    s.location = ob.location
    slabs.append(s)
bpy.context.view_layer.update()
K.unwrap_atlas(stone, "UV1", margin=0.01)
ao = K.bake_ao(stone, "floor_ao", 512, occluders=slabs, distance=0.6, strength=1.2)
K.grime_vertex_colours(stone, ao)
K.depth_weathering([bottom], 1.0, 0.0, tint="#7C7E78")  # the underside: damp, never in the sun
K.face_weathering([cornice, flush, outer, inner], vertical=UPRIGHT_TONE)  # the same stone as the parapets: sunlit upright faces stay under the paving
for ob in stone:
    ob.location = (0, 0, 0)
for s in slabs:
    bpy.data.objects.remove(s)

# the paving has nothing above it in the kit: no occlusion map, white vertex colours (the game tints them)
attr = top.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
for c in attr.data:
    c.color = (1, 1, 1, 1)
top.data.color_attributes.active_color = attr

for ob in (cornice, outer, inner):
    K.check_mesh(ob, closed=True)
for ob in (top, bottom, flush):
    K.check_mesh(ob, closed=False)
bpy.context.view_layer.update()
K.export(OUT, [top, *stone])
