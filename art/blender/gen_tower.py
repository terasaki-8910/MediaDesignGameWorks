"""The arm tower of the third puzzle, below and above its deck: public/assets/kit/tower.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_tower.py -- --out public/assets/kit/tower.glb

The deck (the hub cell and its arms) is made of the kit's floor pieces by the game, like every other walkway. This file
has what carries and crowns it. Frame: the tower module's; the origin is the floor centre of the hub cell, the tower
turns about the vertical through it. The solver's box for the shaft is 3.2 m square and 30 m deep.

Pieces (nodes):
  tower_shaft    an empty with tower_shaft_detail and tower_shaft_run: a gilt bronze bearing ring under the hub's slab
                 (2.32 m in radius, like the old one: it shows beyond the slab's edges and catches the sun),
                 a flaring capital, a shaft with cut corners (3.0 m across, 3.66 m over the corners) in courses of
                 1.15 m with a pilaster on each face and two band courses, and a stepped foot that tapers away to a
                 gilt drop 30 m below the deck: like the pylons' corbels, it ends on purpose and has no pier of its own.
  tower_bracket  the stone console under an arm, modelled under the north arm
  tower_crown    a slender pier (0.45 m square) on the corner of the hub between two sides without an arm (modelled on
                 the north-east corner; it encloses the parapet's post there), crowned with the pylons' gilt winged
                 finial at 0.42 of its size, 3.2 m over the deck (brief: towers crowned in gilt). The game hides it
                 while the tower turns, as it does the parapets: the corner sweeps over the neighbours' parapets.
  tower_ring     the mark of the turntable on the hub's paving: a ring of cyan glass (M_path_glass), 2 cm proud
The tower only turns about the vertical, so its upright faces are toned and its foot weathered like the kit's.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

DEPTH = 30.0
TOP = -K.SLAB
HALF = 1.5  # half the shaft across its faces
CUT = 0.45  # its corners are cut by this much
COURSE = 1.15
SHAFT = (-3.3, -24.0)  # the run of courses between the capital and the foot
LINE = 1.84  # the parapets' centre line, where the crown stands
SQUASH = 0.08

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/tower.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
GLASS = K.plain_material("M_path_glass", "#0B2A30", metallic=0.0, roughness=0.2, emission="#5FF2FF", strength=1.0)
MATS = [STONE, GILT, GLASS]

# capital and foot (the mouldings), with the bearing ring
bm = bmesh.new()
K.lathe(bm, [(1.78, TOP), (2.26, TOP), (2.32, TOP - 0.05), (2.32, TOP - 0.12), (2.26, TOP - 0.16), (2.32, TOP - 0.2), (2.32, TOP - 0.27),
             (2.26, TOP - 0.32), (1.78, TOP - 0.32)], 32, 1)
K.loft(bm, [(HALF, SHAFT[0], CUT), (HALF, -2.9, CUT), (1.56, -2.86, CUT), (1.56, -2.7, CUT), (HALF, -2.66, CUT), (HALF, -2.25, CUT),
            (1.6, -1.75, 0.4), (1.74, -1.3, 0.3), (1.8, -1.14, 0.24), (1.88, -1.1, 0.2), (1.88, TOP - 0.3, 0.2)], 0)
FOOT = [(HALF, SHAFT[1], CUT), (1.54, SHAFT[1] - 0.05, CUT), (1.54, -24.5, CUT), (HALF, -24.56, CUT), (1.28, -25.2, 0.4), (1.28, -25.8, 0.4),
        (0.98, -26.4, 0.3), (0.98, -27.0, 0.3), (0.68, -27.6, 0.2), (0.68, -28.2, 0.2), (0.4, -28.8, 0.12), (0.4, -29.1, 0.12),
        (0.16, -29.45, 0.05)]
K.loft(bm, list(reversed(FOOT)), 0)
K.lathe(bm, [(0.0, -DEPTH), (0.05, -29.9), (0.13, -29.74), (0.17, -29.62), (0.13, -29.5), (0.07, -29.44), (0.0, -29.44)], 12, 1)
detail = K.finish(K.new_object("tower_shaft_detail", bm, materials=MATS), smooth_angle=30)

# the run of the shaft in courses (each takes its own tone), two band courses, a pilaster on each face
bm = bmesh.new()
n = round((SHAFT[0] - SHAFT[1]) / COURSE)
rings = []
for i in range(n + 1):
    z = SHAFT[1] + (SHAFT[0] - SHAFT[1]) * i / n
    rings.append((HALF, z, CUT))
    if i in (6, 12):  # a band course on top of this one
        rings += [(HALF + 0.04, z + 0.03, CUT), (HALF + 0.04, z + 0.2, CUT), (HALF, z + 0.23, CUT)]
K.loft(bm, rings, 0)
for k in range(4):
    a = k * math.pi / 2
    c, s = round(math.cos(a)), round(math.sin(a))
    for lo, hi in (((-0.5, HALF - 0.05, SHAFT[1] + 0.5), (0.5, HALF + 0.07, SHAFT[0] - 0.35)),  # the strip
                   ((-0.58, HALF - 0.05, SHAFT[0] - 0.35), (0.58, HALF + 0.11, SHAFT[0] - 0.1)),  # its cap
                   ((-0.58, HALF - 0.05, SHAFT[1] + 0.2), (0.58, HALF + 0.11, SHAFT[1] + 0.5))):  # its foot
        pts = [(c * x - s * y, s * x + c * y, z) for x, y, z in (lo, hi)]
        K.box(bm, [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)], 0)
run = K.finish(K.new_object("tower_shaft_run", bm, materials=MATS), bevel=0.02, smooth_angle=30)

# the console under an arm: a cavetto from the shaft out to the arm's end, with a fillet at the tip
bm = bmesh.new()
profile = ([(1.42, TOP), (5.3, TOP), (5.3, TOP - 0.26), (5.0, TOP - 0.32)]
           + K.arc(5.0, TOP - 1.9, 3.05, 1.58, 90, 180, 10)[1:] + [(1.95, TOP - 2.05), (1.42, TOP - 2.05)])
K.prism(bm, profile, -0.42, 0.42)
K.prism(bm, [(1.42, TOP - 0.02), (5.36, TOP - 0.02), (5.36, TOP - 0.2), (1.42, TOP - 0.2)], -0.5, 0.5)
bracket = K.finish(K.new_object("tower_bracket", bm, materials=MATS), bevel=0.02, smooth_angle=30)

# the crown: a pier on the hub's blind corner and the pylons' finial on it
PIER_TOP = 2.3
bm = bmesh.new()
c = 0.02
# (no wider than the kit's post it encloses, 0.42 m: when the street lies flat beside the hub, the street's own parapet runs
# 0.32 m from this corner, and the player can come as close to the pier as to any post)
P = 0.225
K.loft(bm, [(P, 0.0, c), (P, 1.9, c), (P + 0.03, 1.94, c), (P + 0.05, 2.0, c), (P + 0.05, 2.1, c), (P - 0.03, 2.15, c), (P - 0.03, 2.24, c),
            (P, 2.27, c), (P, PIER_TOP, c)], 0, centre=(LINE, LINE))
for nx, ny in ((0, -1), (-1, 0)):  # a raised tablet on the two faces that look on to the deck
    lo = (LINE - 0.13 if nx == 0 else LINE - P - 0.025, LINE - P - 0.025 if nx == 0 else LINE - 0.13, 1.05)
    hi = (LINE + 0.13 if nx == 0 else LINE - P + 0.01, LINE - P + 0.01 if nx == 0 else LINE + 0.13, 1.8)
    K.box(bm, lo, hi, 0)
S = 0.42  # of the pylon's finial as drawn (base at 8.7)
f = lambda r, z: (r * S, (z - 8.7) * S + PIER_TOP)  # noqa: E731
K.lathe(bm, [f(*p) for p in ((0.5, 8.7), (0.52, 8.8), (0.3, 8.92), (0.22, 9.05), (0.36, 9.25), (0.4, 9.42), (0.33, 9.6), (0.16, 9.72),
                             (0.12, 9.9), (0.17, 10.0), (0.05, 10.6), (0.0, 10.9))], 12, 1, centre=(LINE, LINE))
for sx in (-1, 1):  # the wings, across the corner's diagonal
    outline = [f(*p) for p in ((0.12, 9.25), (0.7, 9.5), (1.35, 10.25), (1.28, 10.42), (0.95, 10.2), (0.98, 10.0), (0.62, 9.85), (0.66, 9.68),
                               (0.2, 9.62))]
    d = 1 / math.sqrt(2)
    front = [bm.verts.new((LINE + sx * x * d - 0.03 * d, LINE - sx * x * d - 0.03 * d, z)) for x, z in outline]
    back = [bm.verts.new((LINE + sx * x * d + 0.03 * d, LINE - sx * x * d + 0.03 * d, z)) for x, z in outline]
    k = len(outline)
    faces = [bm.faces.new((front[i], front[(i + 1) % k], back[(i + 1) % k], back[i])) for i in range(k)]
    faces += [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    for face in faces:
        face.material_index = 1
crown = K.finish(K.new_object("tower_crown", bm, materials=MATS), smooth_angle=35)

# the turntable's ring on the paving
bm = bmesh.new()
SEG = 48
R0, R1, H0, H1 = 1.16, 1.34, 0.012, 0.02
rows = [(R0, 0.0), (R0, H0), (R0 + 0.008, H1), (R1 - 0.008, H1), (R1, H0), (R1, 0.0)]
loops = [[bm.verts.new((r * math.cos(2 * math.pi * i / SEG), r * math.sin(2 * math.pi * i / SEG), z)) for i in range(SEG)] for r, z in rows]
for a, b in zip(loops, loops[1:] + loops[:1]):
    for i in range(SEG):
        bm.faces.new((a[i], a[(i + 1) % SEG], b[(i + 1) % SEG], b[i])).material_index = 2
ring = K.finish(K.new_object("tower_ring", bm, materials=MATS), smooth_angle=40)

parts = [detail, run, bracket, crown, ring]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.4 * k, 0.9 * k, 0.55 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")

# bake: under its own deck (hub and the two arms of the stage), the long run squashed while unwrapping
bm = bmesh.new()
K.box(bm, (-2, -2, -K.SLAB), (2, 2, 0))
K.box(bm, (-2, 2, -K.SLAB), (2, 5.6, 0))
K.box(bm, (-5.6, -2, -K.SLAB), (-2, 2, 0))
deck = K.new_object("bake_deck", bm)
for ob in (run, detail):
    for vert in ob.data.vertices:
        if vert.co.z < -3.0:
            vert.co.z = -3.0 + (vert.co.z + 3.0) * SQUASH
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.008)
for ob in (run, detail):
    for vert in ob.data.vertices:
        if vert.co.z < -3.0:
            vert.co.z = -3.0 + (vert.co.z + 3.0) / SQUASH
    ob.data.update()
bpy.context.view_layer.update()
ao = K.bake_ao(parts, "tower_ao", 512, occluders=[deck], distance=1.5, strength=0.85)
K.grime_vertex_colours(parts, ao, amount=0.5, skip=("M_gilt", "M_path_glass"))
K.depth_weathering([detail, run, bracket], -0.6, -4.0, tint="#7C7E78")  # under the deck: damp, never in the sun (as the piers)
K.course_tint([run], COURSE, 0.07)
K.face_weathering([crown], vertical=UPRIGHT_TONE, skip=("M_gilt",))
bpy.data.objects.remove(deck)
for ob in parts:
    K.check_mesh(ob, closed=True)
bpy.context.view_layer.update()
lo = min(v.co.z for v in detail.data.vertices)
hi = max(v.co.z for ob in (detail, bracket) for v in ob.data.vertices)
if abs(lo + DEPTH) > 1e-3 or abs(hi - TOP) > 1e-4:
    raise RuntimeError(f"the tower spans {lo:.3f} .. {hi:.3f} under its deck, expected {-DEPTH} .. {TOP}")
reach = max(math.hypot(v.co.x, v.co.y) for ob in (detail, run) for v in ob.data.vertices if v.co.z < -3.0)
if reach > 1.9:
    raise RuntimeError(f"the shaft reaches {reach:.3f} m from its axis: the old column left room for 1.9")
shaft = bpy.data.objects.new("tower_shaft", None)
bpy.context.collection.objects.link(shaft)
detail.parent = run.parent = shaft
bpy.context.view_layer.update()
K.export(OUT, [shaft, *parts])
