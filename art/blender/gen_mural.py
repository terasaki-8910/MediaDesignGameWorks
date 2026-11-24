"""The mural of the second puzzle: public/assets/kit/mural.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_mural.py -- --out public/assets/kit/mural.glb

A limestone stele 9.2 m long that stands outside the south parapet of its cell, on a plinth carried by corbels
against the slab's edge (it used to stand inside the parapet's line, in the player's way). Frame: the deco module's;
the origin is the floor centre of its cell, +Y is north.

Pieces (nodes):
  mural       an empty with mural_body (plinth, die, cornice, end piers, corbels, the relief and the tablets),
              mural_gilt (the fillets of the two frames, the sun of the relief, the cresting and the piers' finials)
              and six empties tablet_0 .. tablet_5 in the middle of the tablets' faces.
              North face, the one the player sees: a relief of the folded city in a raised frame (a street of stepped
              blocks along the ground, a second city standing on the right-hand edge, a third hanging from the top,
              a gilt sun between them).
              South face, seen from outside: a dark bronze plaque with six pale tablets, one for each face of the
              path cube. The game inlays each face's path on its tablet from the stage's data (below) and letters them.
  mural_hub   the middle of a tablet's path, in the cyan glass of the cube's own path lines (M_path_glass)
  mural_arm   the path from the middle to the tablet's edge
The two inlay pieces are modelled on a face that looks up (the plane z = 0, "north" +Y, the origin in the middle
of the tablet), like the cube's.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

HALF = 4.6
MID = -2.42  # the middle plane of the stele, metres from the cell centre (the slab ends at -2.0, the posts of the parapet at -2.05)
NORTH, SOUTH = MID + 0.16, MID - 0.16  # the two faces of the die
DIE = (0.55, 3.25)
TOP = 3.55
TABLET = 0.5  # half a tablet
TABLET_Z = 2.2
PITCH = 1.3
FIELD = (-3.85, 3.85, 0.95, 2.95)  # the relief's field on the north face: x0, x1, z0, z1

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/mural.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
PAVING = K.stone_material("M_paving", dict(K.PAVING))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
BRONZE = K.plain_material("M_bronze_dark", "#3D3A2E", metallic=1.0, roughness=0.45)
GLASS = K.plain_material("M_path_glass", "#0B2A30", metallic=0.0, roughness=0.2, emission="#5FF2FF", strength=1.0)
MATS = [STONE, PAVING, GILT, BRONZE, GLASS]

bm = bmesh.new()
# plinth, die and cornice as one section along the stele
K.prism(bm, [(MID + y, z) for y, z in ((-0.22, 0.0), (0.22, 0.0), (0.22, 0.38), (0.19, 0.44), (0.19, 0.5), (0.16, DIE[0]), (0.16, DIE[1]),
                                       (0.19, DIE[1] + 0.03), (0.19, DIE[1] + 0.1), (0.25, DIE[1] + 0.18), (0.25, TOP - 0.05), (0.21, TOP),
                                       (-0.21, TOP), (-0.25, TOP - 0.05), (-0.25, DIE[1] + 0.18), (-0.19, DIE[1] + 0.1),
                                       (-0.19, DIE[1] + 0.03), (-0.16, DIE[1]), (-0.16, DIE[0]), (-0.19, 0.5), (-0.19, 0.44),
                                       (-0.22, 0.38))], -HALF + 0.1, HALF - 0.1, 0)
# an end pier on each side, a little taller than the cornice
c = 0.02
for sx in (-1, 1):
    K.loft(bm, [(0.3, 0.0, c), (0.3, 0.4, c), (0.27, 0.46, c), (0.27, 3.3, c), (0.3, 3.34, c), (0.33, 3.44, c), (0.33, TOP + 0.08, c),
                (0.24, TOP + 0.14, c), (0.24, TOP + 0.22, c)], 0, centre=(sx * (HALF - 0.28), MID))
# corbels under the plinth, against the slab's cornice (whose face is 2.15 m from the cell centre)
for x in (-3.6, -1.8, 0.0, 1.8, 3.6):
    K.prism(bm, [(-2.16, -0.001), (MID - 0.22, -0.001), (MID - 0.22, -0.2), (-2.16, -0.56)], x - 0.2, x + 0.2, 0)


def raised(x0, x1, z0, z1, proud, face, material_index=0):
    """A block standing `proud` of the north (+1) or south (-1) face of the die."""
    y = NORTH if face > 0 else SOUTH
    K.box(bm, (x0, min(y - 0.02 * face, y + proud * face), z0), (x1, max(y - 0.02 * face, y + proud * face), z1), material_index)


# north: the frame of the relief
x0, x1, z0, z1 = FIELD
B = 0.09
for a in ((x0 - B, x1 + B, z0 - B, z0), (x0 - B, x1 + B, z1, z1 + B), (x0 - B, x0, z0 - 0.003, z1 + 0.003), (x1, x1 + B, z0 - 0.003, z1 + 0.003)):
    raised(*a, 0.06, 1)
# the city on the ground: (left edge, width, height, setback top or 0)
GROUND = [(-3.8, 0.42, 0.55, 0), (-3.34, 0.36, 0.8, 0.16), (-2.94, 0.5, 0.62, 0), (-2.4, 0.3, 1.05, 0.2), (-2.06, 0.46, 0.7, 0.12),
          (-1.56, 0.34, 0.5, 0), (-1.18, 0.4, 0.88, 0.18), (-0.74, 0.3, 0.6, 0), (-0.4, 0.36, 0.42, 0), (0.0, 0.42, 0.64, 0.14),
          (0.46, 0.3, 0.4, 0), (0.8, 0.44, 0.52, 0)]
for left, w, h, top in GROUND:
    raised(left, left + w, z0 + 0.003, z0 + h, 0.05, 1)
    if top:
        raised(left + w * 0.28, left + w * 0.72, z0 + h - 0.01, z0 + h + top, 0.035, 1)
# the city standing on the right-hand edge: (lower edge, width, how far it reaches into the field, setback)
WALL = [(z0 + 0.06, 0.34, 0.6, 0), (z0 + 0.44, 0.3, 0.95, 0.2), (z0 + 0.78, 0.4, 0.7, 0.14), (z0 + 1.22, 0.28, 1.15, 0.22), (z0 + 1.54, 0.38, 0.62, 0)]
for low, w, reach, top in WALL:
    raised(x1 - reach, x1 - 0.003, low, low + w, 0.05, 1)
    if top:
        raised(x1 - reach - top, x1 - reach + 0.01, low + w * 0.28, low + w * 0.72, 0.035, 1)
# and the one hanging from the top
ROOF = [(-1.5, 0.36, 0.34, 0), (-1.08, 0.3, 0.52, 0.12), (-0.72, 0.44, 0.3, 0), (-0.22, 0.32, 0.46, 0.1), (0.16, 0.4, 0.36, 0), (0.62, 0.3, 0.58, 0.14),
        (0.98, 0.42, 0.32, 0), (1.46, 0.34, 0.44, 0), (1.86, 0.4, 0.28, 0), (2.3, 0.3, 0.36, 0)]
for left, w, h, top in ROOF:
    raised(left, left + w, z1 - h, z1 - 0.003, 0.05, 1)
    if top:
        raised(left + w * 0.28, left + w * 0.72, z1 - h - top, z1 - h + 0.01, 0.035, 1)
# south: a dark bronze plaque in a raised stone frame, and on it six tablets of pale stone
S0, S1 = -HALF + 0.7, HALF - 0.7
raised(S0 + 0.004, S1 - 0.004, 1.024, 2.996, 0.02, -1, 3)
for i in range(6):
    x = (i - 2.5) * PITCH
    raised(x - TABLET, x + TABLET, TABLET_Z - TABLET, TABLET_Z + TABLET, 0.04, -1, 1)
for a in ((S0 - B, S1 + B, 1.02 - B, 1.02), (S0 - B, S1 + B, 3.0, 3.0 + B), (S0 - B, S0, 1.017, 3.003), (S1, S1 + B, 1.017, 3.003)):
    raised(*a, 0.05, -1)
body = K.finish(K.new_object("mural_body", bm, materials=MATS), bevel=0.012, segments=1, smooth_angle=30)

# gilt: a fillet inside each frame, the sun, the cresting, the piers' finials
bm = bmesh.new()
F = 0.03
for face, (a0, a1, b0, b1) in ((1, (x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02)), (-1, (S0 + 0.02, S1 - 0.02, 1.04, 2.98))):
    y = NORTH if face > 0 else SOUTH
    for lo, hi in (((a0, b0), (a1, b0 + F)), ((a0, b1 - F), (a1, b1)), ((a0, b0 + F + 0.002), (a0 + F, b1 - F - 0.002)), ((a1 - F, b0 + F + 0.002), (a1, b1 - F - 0.002))):
        if face > 0 and lo[1] == b0:
            continue  # the relief's ground line is stone
        near, far = (0.004, 0.02) if face > 0 else (0.024, 0.04)  # (on the south it lies on the plaque)
        K.box(bm, (lo[0], min(y + near * face, y + far * face), lo[1]), (hi[0], max(y + near * face, y + far * face), hi[1]), 2)
# the sun: a low dome between the three cities
SUN = (1.75, z0 + 0.62, 0.3)
rings = [(SUN[2] * math.cos(math.radians(a)), 0.004 + 0.05 * math.sin(math.radians(a))) for a in (0, 30, 60)] + [(0.0, 0.058)]
verts = []
for r, d in rings:
    verts.append([bm.verts.new((SUN[0] + r * math.cos(2 * math.pi * i / 24), NORTH + d, SUN[1] + r * math.sin(2 * math.pi * i / 24))) for i in range(24)]
                 if r > 1e-6 else [bm.verts.new((SUN[0], NORTH + d, SUN[1]))])
faces = [bm.faces.new(verts[0])]
for a, b in zip(verts, verts[1:]):
    for i in range(24):
        j = (i + 1) % 24
        faces.append(bm.faces.new((a[i], a[j], b[0])) if len(b) == 1 else bm.faces.new((a[i], a[j], b[j], b[i])))
for f in faces:
    f.material_index = 2
# the cresting: a low ridge with a row of small fleurons, and a finial on each pier
K.prism(bm, [(MID - 0.06, TOP + 0.002), (MID + 0.06, TOP + 0.002), (MID + 0.03, TOP + 0.1), (MID - 0.03, TOP + 0.1)], -HALF + 0.62, HALF - 0.62, 2)
for i in range(15):
    x = (i - 7) * 0.52
    K.lathe(bm, [(0.05, TOP + 0.09), (0.03, TOP + 0.15), (0.075, TOP + 0.24), (0.03, TOP + 0.34), (0.0, TOP + 0.42)], 8, 2, centre=(x, MID))
for sx in (-1, 1):
    K.lathe(bm, [(0.2, TOP + 0.222), (0.2, TOP + 0.27), (0.11, TOP + 0.33), (0.08, TOP + 0.4), (0.15, TOP + 0.5), (0.17, TOP + 0.6), (0.13, TOP + 0.7),
                 (0.05, TOP + 0.78), (0.03, TOP + 0.95), (0.0, TOP + 1.05)], 12, 2, centre=(sx * (HALF - 0.28), MID))
gilt = K.finish(K.new_object("mural_gilt", bm, materials=MATS), smooth_angle=40)

# the inlay pieces for the tablets
bm = bmesh.new()
K.slab_outline(bm, [(0.13 * math.cos(2 * math.pi * i / 16), 0.13 * math.sin(2 * math.pi * i / 16)) for i in range(16)], 0.0, 0.045, 0.01, 4)
hub = K.finish(K.new_object("mural_hub", bm, materials=MATS), smooth_angle=40)
bm = bmesh.new()
K.slab_outline(bm, [(-0.075, 0.08), (0.075, 0.08), (0.075, TABLET - 0.02), (-0.075, TABLET - 0.02)], 0.0, 0.04, 0.01, 4)
arm = K.finish(K.new_object("mural_arm", bm, materials=MATS), smooth_angle=40)

parts = [body, gilt, hub, arm]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.3 * k, 0.0, 0.2 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")

# bake: the stele against its slab (not the parapet: the north face is in the shade all day and must not go black)
bm = bmesh.new()
K.box(bm, (-8, -2.0, -K.SLAB), (8, 4, 0))
slab = K.new_object("bake_slab", bm)
for k, ob in enumerate((hub, arm)):
    ob.location = (30.0 * (k + 1), 0, 0)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.006)
ao = K.bake_ao(parts, "mural_ao", 512, occluders=[slab], distance=0.3, strength=1.0)
K.grime_vertex_colours(parts, ao, amount=0.4, skip=("M_gilt", "M_bronze_dark", "M_path_glass"))
K.course_tint([body], 0.675, 0.05, skip=("M_gilt", "M_paving", "M_bronze_dark"))
K.face_weathering([body], vertical=UPRIGHT_TONE, skip=("M_bronze_dark",))
bpy.data.objects.remove(slab)
for ob in (hub, arm):
    ob.location = (0, 0, 0)
bpy.context.view_layer.update()
for ob in parts:
    K.check_mesh(ob, closed=True)
near = max(v.co.y for ob in (body, gilt) for v in ob.data.vertices)
if near > -2.06:
    raise RuntimeError(f"the mural reaches {near:.3f}: it must stay clear of the posts of the parapet at -2.05")
root = bpy.data.objects.new("mural", None)
bpy.context.collection.objects.link(root)
body.parent = gilt.parent = root
tablets = []
for i in range(6):
    e = bpy.data.objects.new(f"tablet_{i}", None)
    e.location = ((i - 2.5) * PITCH, SOUTH - 0.04, TABLET_Z)
    bpy.context.collection.objects.link(e)
    e.parent = root
    tablets.append(e)
bpy.context.view_layer.update()
K.export(OUT, [root, body, gilt, *tablets, hub, arm])
