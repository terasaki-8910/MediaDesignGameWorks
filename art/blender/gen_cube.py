"""The path cube of the second puzzle: public/assets/kit/cube.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_cube.py -- --out public/assets/kit/cube.glb

A 12 m block of ashlar bound in dark bronze with gilt corners, each face nine 4 m cells. Which cells carry a path is the stage's data
(`m_cube.params.faces`), so nothing of it is modelled here: the game lays the pieces out (src/game/setPieces.ts).

Pieces (nodes). The cell and inlay pieces are modelled on a face that looks up: the face is the plane z = 0, the
piece's "north" is +Y, the origin is the middle of the cell (cells) or of the face (inlays).
  cube_cell_blank  a carved coffer: a flush margin, a panel sunk 9 cm and an octagonal boss in its middle
  cube_cell_path   a paved cell, flush with the face: the kit's paving, so a face's path is its lightest part
  cube_inlay_hub   the roundel of the path line in the middle of a face: cyan glass (material M_path_glass) set in a
                   bevelled ring of bronze
  cube_inlay_arm   the path line from the roundel north to the bound edge of the face: a strip of the glass 20 cm
                   wide between two bevelled rims of bronze that stand 1.2 cm over it (a channel)
  cube_frame       the binding: a bead of dark bronze (M_bronze_trim) along each of the twelve edges, rounded over the
                   edge so that it shades from one face to the next, and a gilt boss on each corner; its origin is the
                   cube's centre. It stands 2.5 cm proud of the faces (the bosses 4.5 cm). Gilt is ornament: it does
                   not draw the outline of a piece the player works (the brief: cyan does that).
The cube turns about every axis, so nothing here knows which way is up: no directional light, no tone by facing
(the game tones the upright faces in the shader), no ground under the bake.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

HALF = 6.0  # half the cube
H = K.CELL / 2
BAND = 0.18  # how far the bead laps on to a face
PROUD = 0.025
LINE = 0.1  # half width of the path line
LINE_TOP = 0.014
RIM = 0.07  # width of the bronze rim on each side of it
RIM_TOP = 0.026
HUB = 0.42  # the roundel's glass

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/cube.glb")
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
PAVING = K.stone_material("M_paving", dict(K.PAVING))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
GLASS = K.plain_material("M_path_glass", "#0B2A30", metallic=0.0, roughness=0.2, emission="#5FF2FF", strength=1.0)
BRONZE = K.bronze_trim_material(opts)
MATS = [STONE, PAVING, GILT, GLASS, BRONZE]

# the coffer, from its edge inwards: (half width, height, how much of the corner is cut): a panel sunk 9 cm, and in it a
# boss that rises to 2 cm under the face, with a dished middle
bm = bmesh.new()
K.loft(bm, [(H, 0.0, 0.0), (1.72, 0.0, 0.0), (1.6, -0.09, 0.0), (0.78, -0.09, 0.22), (0.66, -0.02, 0.2), (0.42, -0.02, 0.14),
            (0.36, -0.06, 0.11)], 0, cap_bottom=False)
blank = K.finish(K.new_object("cube_cell_blank", bm, materials=MATS), smooth_angle=15)  # every step of the panel is a sharp edge
K.face_up(blank)

# the paved cell, split 4 x 4 like the kit's slabs
bm = bmesh.new()
N = 4
grid = [[bm.verts.new((-H + K.CELL * i / N, -H + K.CELL * j / N, 0.0)) for i in range(N + 1)] for j in range(N + 1)]
for j in range(N):
    for i in range(N):
        bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])).material_index = 1
path = K.finish(K.new_object("cube_cell_path", bm, materials=MATS))
K.face_up(path)


bm = bmesh.new()
K.slab_outline(bm, [(HUB * math.cos(2 * math.pi * i / 24), HUB * math.sin(2 * math.pi * i / 24)) for i in range(24)], 0.0, LINE_TOP, 0.004, 3)
K.annulus(bm, HUB - 0.004, HUB + RIM + 0.01, RIM_TOP, 24, 4, cut=0.01)
hub = K.finish(K.new_object("cube_inlay_hub", bm, materials=MATS), smooth_angle=40)

bm = bmesh.new()
K.slab_outline(bm, [(-LINE, HUB - 0.03), (LINE, HUB - 0.03), (LINE, HALF - BAND + 0.01), (-LINE, HALF - BAND + 0.01)], 0.0, LINE_TOP, 0.004, 3)
for x0, x1 in ((-LINE - RIM, -LINE + 0.004), (LINE - 0.004, LINE + RIM)):
    K.slab_outline(bm, [(x0, HUB + RIM - 0.02), (x1, HUB + RIM - 0.02), (x1, HALF - BAND + 0.01), (x0, HALF - BAND + 0.01)], 0.0, RIM_TOP, 0.01, 4)
arm = K.finish(K.new_object("cube_inlay_arm", bm, materials=MATS), smooth_angle=40)

# the binding: the section of the angle in the plane across an edge, as (along one face, along the other)
E0, E1 = HALF - BAND, HALF + PROUD
# (a fillet where it leaves each face, a flat, and a quarter round over the edge)
ROUND = 0.08
SECTION = ([(E0, HALF), (E0 + 0.012, E1 - 0.01), (E0 + 0.03, E1), (HALF - ROUND, E1)]
           + [(HALF - ROUND + (ROUND + PROUD) * math.cos(math.radians(a)), HALF - ROUND + (ROUND + PROUD) * math.sin(math.radians(a))) for a in (72, 54, 36, 18)]
           + [(E1, HALF - ROUND), (E1, E0 + 0.03), (E1 - 0.01, E0 + 0.012), (HALF, E0), (HALF - 0.1, HALF - 0.1)])
bm = bmesh.new()
for axis in range(3):
    b, c = (axis + 1) % 3, (axis + 2) % 3
    for sb in (-1, 1):
        for sc in (-1, 1):
            ends = []
            for t in (-E0, E0):
                ring = []
                for u, v in SECTION:
                    p = [0.0, 0.0, 0.0]
                    p[axis], p[b], p[c] = t, sb * u, sc * v
                    ring.append(bm.verts.new(p))
                ends.append(ring)
            n = len(SECTION)
            faces = [bm.faces.new((ends[0][i], ends[0][(i + 1) % n], ends[1][(i + 1) % n], ends[1][i])) for i in range(n)]
            faces += [bm.faces.new(ends[0]), bm.faces.new(ends[1])]
            for f in faces:
                f.material_index = 4
bars = K.finish(K.new_object("cube_frame_bars", bm, materials=MATS), smooth_angle=25)
bm = bmesh.new()
B0, B1 = HALF - BAND - 0.04, HALF + PROUD + 0.02
for sx in (-1, 1):
    for sy in (-1, 1):
        for sz in (-1, 1):
            lo = [min(s * B0, s * B1) for s in (sx, sy, sz)]
            hi = [max(s * B0, s * B1) for s in (sx, sy, sz)]
            K.box(bm, lo, hi, 2)
bosses = K.finish(K.new_object("cube_frame_bosses", bm, materials=MATS), bevel=0.018, smooth_angle=30)

parts = [blank, path, hub, arm, bars, bosses]
for ob in parts:
    K.world_uv(ob, offset=(H, H, 0.0) if ob is path else (0, 0, 0))
    print(f"{ob.name}: {K.triangles(ob)} triangles")

# bake: each piece on its own, far from the others (no ground: any face can look down)
for k, ob in enumerate(parts):
    ob.location = (30.0 * k, 0, 0)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.01)
ao = K.bake_ao(parts, "cube_ao", 256, distance=0.5, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.35, skip=("M_gilt", "M_path_glass", "M_paving", "M_bronze_trim"))
for ob in parts:
    ob.location = (0, 0, 0)
bpy.context.view_layer.update()
for ob in (blank, path):
    K.check_mesh(ob, closed=False)
for ob in (hub, arm, bars, bosses):
    K.check_mesh(ob, closed=True)
reach = max(max(abs(c) for c in v.co) for ob in (bars, bosses) for v in ob.data.vertices)
if reach > HALF + 0.05:
    raise RuntimeError(f"the binding stands {reach - HALF:.3f} m proud of the cube: plates and neighbours leave room for 0.05")
frame = bpy.data.objects.new("cube_frame", None)
bpy.context.collection.objects.link(frame)
bars.parent = bosses.parent = frame
bpy.context.view_layer.update()
K.export(OUT, [blank, path, hub, arm, frame, bars, bosses])
