"""The Core Gate, the goal of the stage: public/assets/kit/gate.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_gate.py -- --out public/assets/kit/gate.glb

A ring of gilt bronze 9.1 m across that sits in a bronze saddle on a plinth of ashlar (references A1 and A2: stone
carrying gilt, large dressed blocks, plain strong steps). Frame: the deco module's; the origin is the floor centre of
the gate's cell, the ring stands in the XZ plane (it faces north and south) with its centre 6.15 m up.

Pieces (nodes):
  gate      an empty with
            gate_stone   two steps 3.96 m long and 3.3 m deep, and on them a plinth: a moulded base (plinth course,
                         torus, cavetto), a die with a raised tablet and a cartouche on its front and its back, and a
                         capital (fillet, ovolo, corona) 1.47 m up;
            gate_saddle  the cradle the ring sits in, in the set pieces' bronze (M_bronze_trim): 3.2 m long, its bed
                         following the ring's underside 8 mm below it, a lip before and behind the ring that rises
                         20 cm up its faces, a stop block across each end and four straps over the lips;
            gate_ring    the ring, modelled: on each face a raised outer bead and a raised inner bead with a hollow
                         (a cavetto) between them, so no part of it is a flat face that mirrors the sun as one patch;
                         and inside them a thin plate, sunk behind the beads and fluted like a sunburst, with sixteen
                         ridged rays in bold relief on both its faces. Its colour is the kit's gilt (#E3C16F: with the
                         brief's deeper #D4AF37 the low warm sun rendered it at a saturation of 0.9); its vertex
                         colours hold the hollows and the furrows down to a quarter (brief: gilt is dark in its
                         recesses) and leave the beads and the rays' ridges full;
            gate_frame   the frame round the portal, in the same bronze: a bead between two fillets;
            gate_trim    the pylons' gilt: the winged finial on the ring's crown, a laurel wreath round each
                         cartouche, an orb on each corner of the capital.
  CoreDisc  the portal's disc (5.9 m across, UVs, one side, facing south): the game draws its own shader on it. Its
            node stands at the ring's centre.
All the stone stands inside the gate's own cell (4 m square): 1.98 m to each side, 1.75 m to the front, 1.55 m to the
back (the parapet behind stands at 1.68 m). The player walks the two cells beside it, under the ring's line: the ring's
underside is 2.04 m up at the cell's edge and rises from there (the script fails under 2.0 m). Nothing crosses anything
else: the script fails if the ring, the saddle or the gilt trim meet the stone, the saddle the ring, or the disc anything.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

RING_Z = 6.15
R_OUT = 4.56  # the ring's outer radius
R_IN = 3.88  # the inner edge of its moulded band
RING_DEEP = 0.3  # half its depth, at the outer bead
R_HOOP = 3.14
R_DISC = 2.94  # the game lets it breathe to 1.03 of this: still inside the frame's inner edge at 3.04
DEEP = 0.93  # half the depth of the plinth, at its base and its capital
WIDE = 1.98  # everything of stone keeps this near the middle: the goal's cell is 2 m to each side
COURSE = 0.56
HEAD_ROOM = 2.0  # the ring's underside is at least this high wherever a player can stand (from the cell's edge outwards)
PLINTH_TOP = 1.47
SADDLE = 1.6  # half the saddle's length
SADDLE_GAP = 0.008  # between the saddle's bed and the ring
LIP = (RING_DEEP + 0.01, RING_DEEP + 0.1)  # the saddle's lips, from the ring's middle plane

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/gate.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))
RING_ROUGHNESS = float(opts.get("ring-roughness", "0.3"))
RING_COLOUR = opts.get("ring-colour", "#E3C16F")
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.28)
# the ring's own gilt: the kit's colour and a roughness inside the brief's 0.25-0.4. It has its own name because the game
# gives M_gilt 2.4 times the sky's reflection (small ornaments); on a ring 9 m across that is a white disc
BROAD = K.plain_material("M_gilt_broad", RING_COLOUR, metallic=1.0, roughness=RING_ROUGHNESS)
BRONZE = K.bronze_trim_material(opts)
CORE = K.plain_material("M_gate_core", "#0B2A30", metallic=0.0, roughness=0.2, emission="#5FF2FF", strength=1.0)


def rect_loft(bm, sections, centre=(0.0, 0.0), material_index=0):
    """Skin rectangles (half x, half y, z, corner cut) from bottom to top, capped at both ends."""
    rings = []
    for hx, hy, z, cut in sections:
        pts = []
        for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1)):
            if sx * sy < 0:
                pts += [(sx * (hx - cut), sy * hy), (sx * hx, sy * (hy - cut))]
            else:
                pts += [(sx * hx, sy * (hy - cut)), (sx * (hx - cut), sy * hy)]
        rings.append([bm.verts.new((centre[0] + x, centre[1] + y, z)) for x, y in pts])
    n = len(rings[0])
    faces = [bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])) for a, b in zip(rings, rings[1:]) for i in range(n)]
    faces += [bm.faces.new(list(reversed(rings[0]))), bm.faces.new(rings[-1])]
    for f in faces:
        f.material_index = material_index
    return faces


def ring_under(x, r=R_OUT):
    """Height of the ring's underside over x (or of the circle of radius `r` about its centre)."""
    return RING_Z - math.sqrt(r ** 2 - x ** 2)


# stone: two steps, and on them a plinth with a moulded base (a plinth course, a torus, a cavetto), a die and a capital
# (a fillet, an ovolo, a corona)
bm = bmesh.new()
c = 0.03
# (the steps reach 1.75 m to the front, towards the player, and 1.55 m to the back: the parapet behind stands at 1.68 m)
rect_loft(bm, [(WIDE, 1.65, 0.0, c), (WIDE, 1.65, 0.23, c), (WIDE - 0.03, 1.62, 0.26, c), (1.82, 1.3, 0.26, c), (1.82, 1.3, 0.49, c), (1.79, 1.27, 0.52, c)], centre=(0.0, -0.1))
D = DEEP
rect_loft(bm, [(1.68, D, 0.5, c), (1.68, D, 0.62, c), (1.665, D - 0.015, 0.64, c), (1.68, D, 0.665, c), (1.68, D, 0.7, c), (1.665, D - 0.015, 0.725, c),
               (1.62, D - 0.06, 0.74, c), (1.58, D - 0.1, 0.78, c), (1.56, D - 0.12, 0.84, c),
               (1.56, D - 0.12, 1.2, c), (1.575, D - 0.105, 1.2, c), (1.575, D - 0.105, 1.23, c), (1.6, D - 0.08, 1.25, c), (1.64, D - 0.04, 1.29, c),
               (1.66, D - 0.02, 1.33, c), (1.68, D, 1.34, c), (1.68, D, 1.44, c), (1.65, D - 0.03, PLINTH_TOP, c)])
DIE = D - 0.12  # the die's faces
PANEL = (1.14, 0.9, 1.14)  # the raised tablet on the die's front and back: half its length, its lower and upper edge
for sy in (-1, 1):
    ya, yb = sorted((sy * (DIE - 0.02), sy * (DIE + 0.035)))
    K.box(bm, (-PANEL[0], ya, PANEL[1]), (PANEL[0], yb, PANEL[2]), 0)
    # a cartouche lying in its middle
    ya, yb = sorted((sy * (DIE - 0.02), sy * (DIE + 0.07)))
    oval = [(0.3 * math.sin(2 * math.pi * i / 16), (PANEL[1] + PANEL[2]) / 2 + 0.075 * math.cos(2 * math.pi * i / 16)) for i in range(16)]
    a = [bm.verts.new((x, ya, z)) for x, z in oval]
    b = [bm.verts.new((x, yb, z)) for x, z in oval]
    faces = [bm.faces.new((a[i], a[(i + 1) % 16], b[(i + 1) % 16], b[i])) for i in range(16)] + [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
stone = K.finish(K.new_object("gate_stone", bm, STONE), smooth_angle=30)

# the saddle: a cradle of bronze on the plinth, its bed following the ring's underside 8 mm below it, with a lip before and
# behind the ring that rises a fifth of a metre up its faces: the ring is seen to sit in it
bm = bmesh.new()
N = 20
Z0 = PLINTH_TOP + 0.003
stations = []
for i in range(N + 1):
    x = -SADDLE + 2 * SADDLE * i / N
    bed = ring_under(x, R_OUT + SADDLE_GAP)
    lip = ring_under(x, R_OUT - 0.2) - 0.05 * (abs(x) / SADDLE) ** 2  # (the lips fall away a little towards the ends)
    y0, y1 = LIP
    # across: a foot, a splayed base, a waist, and a rounded lip
    half = [(y1 + 0.08, Z0), (y1 + 0.08, Z0 + 0.05), (y1 + 0.02, Z0 + 0.09), (y1 - 0.01, bed - 0.02), (y1 - 0.01, lip - 0.1), (y1 + 0.015, lip - 0.07),
            (y1 + 0.015, lip - 0.03), (y1 - 0.02, lip), (y0, lip), (y0, bed)]
    stations.append([bm.verts.new((x, y, z)) for y, z in [(-y, z) for y, z in half] + [(y, z) for y, z in reversed(half)]])
n = len(stations[0])
for a, b in zip(stations, stations[1:]):
    for i in range(n):
        bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
bm.faces.new(list(reversed(stations[0])))
bm.faces.new(stations[-1])
# a stop block across each end, and four straps over the lips, riveted: where the load is taken
for sx in (-1, 1):
    xa, xb = sorted((sx * (SADDLE - 0.01), sx * (SADDLE + 0.07)))
    top = ring_under(SADDLE + 0.07, R_OUT + 0.03)
    K.box(bm, (xa, -LIP[1] - 0.1, Z0), (xb, LIP[1] + 0.1, top), 0)
    for x in (sx * 0.5, sx * 1.15):
        lip = ring_under(abs(x) + 0.06, R_OUT - 0.2) - 0.05 * ((abs(x) + 0.06) / SADDLE) ** 2
        for sy in (-1, 1):
            ya, yb = sorted((sy * (LIP[1] - 0.03), sy * (LIP[1] + 0.045)))
            K.box(bm, (x - 0.06, ya, Z0 + 0.1), (x + 0.06, yb, lip - 0.11), 0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
saddle = K.finish(K.new_object("gate_saddle", bm, BRONZE), bevel=0.012, segments=1, smooth_angle=30)

# the ring: half of its section as (radius, half depth) from the inner edge out, mirrored to the other face and revolved about
# the axis through its centre. An inner bead, a hollow, an outer bead, and a rim between the two outer beads: every part is
# curved across, so the low sun draws a line of light on each instead of lighting a whole face at once
HALF_SECTION = [(R_IN, 0.13), (3.9, 0.21), (3.925, 0.262), (3.97, 0.28), (4.015, 0.262), (4.04, 0.215),
                (4.075, 0.188), (4.14, 0.168), (4.21, 0.16), (4.28, 0.168), (4.345, 0.188),
                (4.38, 0.215), (4.405, 0.272), (4.46, RING_DEEP), (4.515, 0.272), (R_OUT, 0.2), (R_OUT, 0.12), (4.535, 0.09)]
SECTION = [(r, -d) for r, d in HALF_SECTION] + [(r, d) for r, d in reversed(HALF_SECTION)]
# the frame round the portal, in bronze: a bead between two fillets, the inner one splayed towards the disc
HALF_FRAME = [(R_HOOP - 0.1, 0.05), (R_HOOP - 0.07, 0.1), (R_HOOP - 0.035, 0.1), (R_HOOP - 0.02, 0.125), (R_HOOP + 0.015, 0.14), (R_HOOP + 0.05, 0.125),
              (R_HOOP + 0.065, 0.1), (R_HOOP + 0.11, 0.1), (R_HOOP + 0.12, 0.07)]
FRAME = [(r, -d) for r, d in HALF_FRAME] + [(r, d) for r, d in reversed(HALF_FRAME)]
SEG = 64
frame_bm = bmesh.new()
bm = bmesh.new()
for section, into in ((SECTION, bm), (FRAME, frame_bm)):
    loops = [[into.verts.new((r * math.cos(2 * math.pi * k / SEG), y, RING_Z + r * math.sin(2 * math.pi * k / SEG))) for r, y in section] for k in range(SEG)]
    n = len(section)
    for a, b in zip(loops, loops[1:] + loops[:1]):
        for i in range(n):
            into.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])).material_index = 0
frame = K.finish(K.new_object("gate_frame", frame_bm, BRONZE), smooth_angle=35)
# a plate between the hoop and the ring, sunk behind the beads and fluted like a sunburst (a flat plate of metal mirrors the
# sun as one white patch from where the reflection falls; flutes break it into lines), and on both its faces rays in relief,
# every other one slighter
FLUTES = 96
RAYS = 16
PLATE_DEEP = (0.03, 0.066)  # half the plate's depth in a flute's furrow and on its ridge
# a ray: (half width at the hoop, half width at the ring, half depth at its ridge), the major and the minor. They are two to
# three flutes wide and stand 9 to 15 cm over the flutes' ridges (a plain field round each was tried: it mirrors the sun white)
RAY = ((0.1, 0.23, 0.215), (0.065, 0.15, 0.155))
loops = [[bm.verts.new((r * math.cos(math.pi * k / FLUTES), y, RING_Z + r * math.sin(math.pi * k / FLUTES)))
          for r, y in ((R_HOOP + 0.05, -PLATE_DEEP[k % 2]), (3.9, -PLATE_DEEP[k % 2]), (3.9, PLATE_DEEP[k % 2]), (R_HOOP + 0.05, PLATE_DEEP[k % 2]))]
         for k in range(2 * FLUTES)]
for a, b in zip(loops, loops[1:] + loops[:1]):
    for i in range(4):
        bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i])).material_index = 0
RAY_FOOT = PLATE_DEEP[0] + 0.01  # where a ray's flanks leave the plate
for k in range(RAYS):
    t = 2 * math.pi * (k + 0.5) / RAYS
    w0, w1, d = RAY[k % 2]
    u = (math.cos(t), math.sin(t))
    v = (-math.sin(t), math.cos(t))
    ends = []
    for r, w in ((R_HOOP + 0.06, w0), (3.9, w1)):  # a ridge down the middle of each face: two flanks that take the light differently
        ends.append([bm.verts.new((r * u[0] + sw * w * v[0], y, RING_Z + r * u[1] + sw * w * v[1]))
                     for sw, y in ((-1, -RAY_FOOT), (0, -d), (1, -RAY_FOOT), (1, RAY_FOOT), (0, d), (-1, RAY_FOOT))])
    faces = [bm.faces.new((ends[0][i], ends[0][(i + 1) % 6], ends[1][(i + 1) % 6], ends[1][i])) for i in range(6)]
    faces += [bm.faces.new(ends[0]), bm.faces.new(ends[1])]
    for f in faces:
        f.material_index = 0
ring = K.finish(K.new_object("gate_ring", bm, BROAD), smooth_angle=42)
# the flutes are cut sharp
bm = bmesh.new()
bm.from_mesh(ring.data)
for e in bm.edges:
    if all(R_HOOP + 0.04 < math.hypot(v.co.x, v.co.z - RING_Z) < 3.91 for v in e.verts) and len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(12):
        e.smooth = False
bm.to_mesh(ring.data)
bm.free()
# the gilt's tone, by where a point lies in the section (no baked occlusion: on smooth metal it shows as blotches): the plate
# and the hollows are held down and a little browner, the beads, the hoop and the rays' ridges keep the full colour
RECESS = tuple(float(v) for v in opts.get("recess", "0.24,0.215,0.175").split(","))  # the furrows of the plate: darker, hardly yellower
attr = ring.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
for poly in ring.data.polygons:
    for li, vi in zip(poly.loop_indices, poly.vertices):
        co = ring.data.vertices[vi].co
        r, d = math.hypot(co.x, co.z - RING_Z), abs(co.y)
        if r > R_IN - 1e-4:
            k = 1.0 if r > R_OUT - 0.03 else min(max((d - 0.16) / 0.1, 0.0), 1.0)  # the band: by how far it stands out
            k = 0.25 + 0.75 * k
        else:
            k = min(max((d - PLATE_DEEP[0]) / 0.09, 0.0), 1.0)  # the plate from furrow to ridge, and a ray up to its own ridge
        attr.data[li].color = (*(a + (1.0 - a) * k for a in RECESS), 1.0)
ring.data.color_attributes.active_color = attr

# the trim: the pylons' winged finial on the crown, wreaths, orbs
bm = bmesh.new()
S, Z = 0.72, RING_Z + R_OUT - 0.03
f = lambda r, z: (r * S, (z - 8.7) * S + Z)  # noqa: E731
K.lathe(bm, [f(*p) for p in ((0.45, 8.7), (0.47, 8.82), (0.32, 8.94), (0.22, 9.05), (0.36, 9.25), (0.4, 9.42), (0.33, 9.6), (0.16, 9.72),
                             (0.12, 9.9), (0.17, 10.0), (0.05, 10.6), (0.0, 10.9))], 16, 0)
for sx in (-1, 1):
    outline = [f(*p) for p in ((0.12, 9.25), (0.7, 9.5), (1.35, 10.25), (1.28, 10.42), (0.95, 10.2), (0.98, 10.0), (0.62, 9.85), (0.66, 9.68),
                               (0.2, 9.62))]
    front = [bm.verts.new((sx * x, -0.045, z)) for x, z in outline]
    back = [bm.verts.new((sx * x, 0.045, z)) for x, z in outline]
    k = len(outline)
    faces = [bm.faces.new((front[i], front[(i + 1) % k], back[(i + 1) % k], back[i])) for i in range(k)]
    faces += [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    for face in faces:
        face.material_index = 0
for sy in (-1, 1):
    # a laurel wreath round each cartouche, and an orb on each corner of the capital
    mid = (PANEL[1] + PANEL[2]) / 2
    path = [(0.37 * math.sin(t), sy * (DIE + 0.075), mid + 0.115 * math.cos(t)) for t in (math.radians(8 + 344 * i / 20) for i in range(21))]
    K.tube(bm, path, 0.022, 5, 0)
    for sx in (-1, 1):
        cx, cy, top = sx * 1.36, sy * 0.68, PLINTH_TOP
        K.lathe(bm, [(0.0, top + 0.004), (0.13, top + 0.004), (0.13, top + 0.045), (0.075, top + 0.08)]
                + [(0.125 * math.cos(math.radians(a)), top + 0.19 + 0.125 * math.sin(math.radians(a))) for a in range(-50, 91, 28)][:-1]
                + [(0.0, top + 0.315)], 12, 0, centre=(cx, cy))
trim = K.finish(K.new_object("gate_trim", bm, GILT), smooth_angle=40)

# the portal's disc, in its own frame at the ring's centre
bm = bmesh.new()
bm.faces.new([bm.verts.new((R_DISC * math.cos(2 * math.pi * i / 64), 0.0, R_DISC * math.sin(2 * math.pi * i / 64))) for i in range(64)])
disc = K.face_up(K.new_object("CoreDisc", bm, CORE), axis=(0.0, -1.0, 0.0))
uv = disc.data.uv_layers.new(name="UV0")
for loop in disc.data.loops:
    co = disc.data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = (0.5 + co.x / (2 * R_DISC), 0.5 + co.z / (2 * R_DISC))
disc.location = (0.0, 0.0, RING_Z)

parts = [stone, ring, trim, saddle, frame]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.35 * k, 0.6 * k, 0.25 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")
bpy.context.view_layer.update()
K.check_no_overlap(stone, ring)
K.check_no_overlap(stone, trim)
K.check_no_overlap(disc, ring)
K.check_no_overlap(disc, stone)
K.check_no_overlap(disc, frame)
K.check_no_overlap(saddle, ring)
K.check_no_overlap(saddle, stone)
K.check_no_overlap(saddle, trim)

# bake: on the plateau's paving
bm = bmesh.new()
K.box(bm, (-6, -6, -K.SLAB), (6, 6, 0))
ground = K.new_object("bake_ground", bm)
bpy.context.view_layer.update()
# (only the stone: on the ring's broad smooth faces a baked occlusion map shows as blotches)
K.unwrap_atlas([stone], "UV1", margin=0.006)
ao = K.bake_ao([stone], "gate_ao", 512, occluders=[ground, ring, trim, saddle], distance=1.2, strength=1.0)
K.grime_vertex_colours([stone], ao, amount=0.35)
K.course_tint([stone], COURSE, 0.05)
K.face_weathering([stone], vertical=UPRIGHT_TONE)
bpy.data.objects.remove(ground)
for ob in parts:
    K.check_mesh(ob, closed=True)
K.check_mesh(disc, closed=False)
K.check_mesh(stone, closed=True, standing=0.0)
deep = max(-v.co.y for ob in parts for v in ob.data.vertices)
back = max(v.co.y for ob in parts for v in ob.data.vertices)
if back > 1.56:
    raise RuntimeError(f"the gate reaches {back:.3f} m to the back: the parapet stands 1.68 m behind its centre")
if deep > 1.76:
    raise RuntimeError(f"the gate reaches {deep:.3f} m to the front: the player stands 2 m before its centre when the goal is reached")
wide = max(abs(v.co.x) for ob in (stone, trim, saddle) for v in ob.data.vertices if v.co.z < 3.0)
if wide > WIDE + 1e-4:
    raise RuntimeError(f"the gate's stone reaches {wide:.3f} m to a side: the goal's cell ends at 2 m, and the player walks the cells beside it")
reach = max(abs(v.co.y) for v in ring.data.vertices if math.hypot(v.co.x, v.co.z - RING_Z) > R_IN - 0.01)
if reach > RING_DEEP + 1e-4:
    raise RuntimeError(f"the ring is {reach:.3f} m deep to a side: the saddle's lips leave room for {RING_DEEP}")
# head room: the player walks the cells beside the goal's, under the ring's line (the ring is a polygon inside this circle)
if ring_under(WIDE) < HEAD_ROOM:
    raise RuntimeError(f"at the edge of the goal's cell the ring's underside is {ring_under(WIDE):.3f} m up: a player walks there, and needs {HEAD_ROOM} m")
print(f"head room under the ring at the cell's edge ({WIDE} m from the middle): {ring_under(WIDE):.3f} m")
root = bpy.data.objects.new("gate", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts, disc])
