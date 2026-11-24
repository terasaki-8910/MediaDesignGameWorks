"""The Core Gate, the goal of the stage: public/assets/kit/gate.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_gate.py -- --out public/assets/kit/gate.glb

A ring of gilt bronze 9.1 m across that stands in a stepped cradle of ashlar (references A1 and A2: stone carrying
gilt, large dressed blocks, plain strong steps). Frame: the deco module's; the origin is the floor centre of the
gate's cell, the ring stands in the XZ plane (it faces north and south) with its centre 5.6 m up.

Pieces (nodes):
  gate      an empty with
            gate_stone  two steps 9.8 m long and 3.3 m deep, a plinth, and on it the cradle: blocks that climb in
                        five steps from under the ring's foot to 2.84 m at both ends, each a little under the ring;
                        the end blocks carry a moulded cap, a raised tablet and a cartouche on their two fronts;
            gate_ring   the ring: one broad band 0.6 m deep with cut edges (7 by 10 cm), the hoop round
                        the portal, and between the two a thin plate, sunk behind the ring's faces, with sixteen
                        rays in relief on both its faces;
            gate_trim   the pylons' gilt: the winged finial on the ring's crown, a laurel wreath round each
                        cartouche, an orb on each end block.
  CoreDisc  the portal's disc (5.9 m across, UVs, one side, facing south): the game draws its own shader on it. Its
            node stands at the ring's centre.
The steps are 3.3 m deep where the old base was 9.1 m: it stays inside the gate's own cell, clear of the parapet
behind it (1.68 m from the centre) and of the cells a player crosses to reach the goal.
Nothing crosses anything else: the script fails if the ring or the gilt trim meet the stone, or the disc the ring.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

RING_Z = 5.6
R_OUT = 4.56  # the ring's outer radius
R_HOOP = 3.14
R_DISC = 2.94  # the game lets it breathe to 1.03 of this: still inside the hoop's inner edge at 3.04
DEEP = 0.85  # half the depth of the cradle
COURSE = 0.56

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/gate.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.28)
# the ring's own gilt: broad faces that look straight at the low sun and at the player who comes up to the gate. With the
# ornaments' gilt (roughness 0.26, and the extra sky the game gives M_gilt) they bloomed to a white disc; this is the brief's
# darker gilt, rougher than its 0.25-0.4 so the sun's highlight is spread out, and the game leaves its reflection as it is
BROAD = K.plain_material("M_gilt_broad", "#D4AF37", metallic=1.0, roughness=0.52)
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


def ring_under(x):
    """Height of the ring's underside over x."""
    return RING_Z - math.sqrt(R_OUT ** 2 - x ** 2)


# stone: steps, plinth, cradle
bm = bmesh.new()
c = 0.03
# (the steps reach 1.75 m to the front, towards the player, and 1.55 m to the back: the goal's cell is 2 m to each side, the parapet behind stands at 1.68 m)
rect_loft(bm, [(4.9, 1.65, 0.0, c), (4.9, 1.65, 0.23, c), (4.87, 1.62, 0.26, c), (4.62, 1.3, 0.26, c), (4.62, 1.3, 0.49, c), (4.59, 1.27, 0.52, c)], centre=(0.0, -0.1))
rect_loft(bm, [(4.46, 0.91, 0.5, c), (4.46, 0.91, 0.68, c), (4.4, DEEP, 0.74, c), (4.4, DEEP, 0.98, c)])
# the cradle's blocks: (inner edge, outer edge, top); each top is at least 2 cm under the ring at its inner edge
BLOCKS = [(1.25, 2.25, 1.18), (2.25, 3.05, 1.6), (3.05, 3.75, 2.18)]
END = (3.75, 4.45, 2.84)
rect_loft(bm, [(1.25, DEEP - 0.03, 0.955, c), (1.25, DEEP - 0.03, 1.0, c)])
for k, (x0, x1, top) in enumerate(BLOCKS):  # (each block a little shallower than the one below it: separate stones, no shared corners)
    for sx in (-1, 1):
        deep = DEEP - 0.05 - 0.015 * k
        rect_loft(bm, [((x1 - x0) / 2, deep, 0.96 + 0.002 * k, c), ((x1 - x0) / 2, deep, top, c)], centre=(sx * (x0 + x1) / 2, 0.0))
x0, x1, top = END
h = (x1 - x0) / 2
for sx in (-1, 1):
    rect_loft(bm, [(h, DEEP, 0.96, c), (h, DEEP, top - 0.3, c), (h + 0.03, DEEP + 0.03, top - 0.26, c), (h + 0.06, DEEP + 0.06, top - 0.16, c),
                   (h + 0.06, DEEP + 0.06, top - 0.04, c), (h, DEEP, top, c)], centre=(sx * (x0 + x1) / 2, 0.0))
    for sy in (-1, 1):  # a raised tablet and an oval cartouche on the two fronts
        cx = sx * (x0 + x1) / 2
        ya, yb = sorted((sy * (DEEP - 0.02), sy * (DEEP + 0.035)))
        K.box(bm, (cx - 0.24, ya, 1.12), (cx + 0.24, yb, 2.36), 0)
        ya, yb = sorted((sy * (DEEP - 0.02), sy * (DEEP + 0.075)))
        oval = [(cx + 0.13 * math.sin(2 * math.pi * i / 12), 1.74 + 0.36 * math.cos(2 * math.pi * i / 12)) for i in range(12)]
        a = [bm.verts.new((x, ya, z)) for x, z in oval]
        b = [bm.verts.new((x, yb, z)) for x, z in oval]
        faces = [bm.faces.new((a[i], a[(i + 1) % 12], b[(i + 1) % 12], b[i])) for i in range(12)] + [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
stone = K.finish(K.new_object("gate_stone", bm, STONE), smooth_angle=30)
for x0, x1, top in [(0.0, 1.25, 1.0), *BLOCKS, (END[0] - 0.06, END[1], END[2])]:
    if top > ring_under(x0) - 0.02:
        raise RuntimeError(f"the block from {x0} m is {top} m high: the ring's underside is at {ring_under(x0):.3f} m there")

# the ring: its section as (radius, depth), revolved about the axis through its centre
SECTION = [(3.88, -0.2), (3.95, -0.3), (4.49, -0.3), (R_OUT, -0.2), (R_OUT, 0.2), (4.49, 0.3), (3.95, 0.3), (3.88, 0.2)]
HOOP = [(R_HOOP + 0.1 * math.cos(2 * math.pi * i / 8 + math.pi / 8), 0.1 * math.sin(2 * math.pi * i / 8 + math.pi / 8)) for i in range(8)]
SEG = 72
bm = bmesh.new()
for section in (SECTION, HOOP):
    loops = [[bm.verts.new((r * math.cos(2 * math.pi * k / SEG), y, RING_Z + r * math.sin(2 * math.pi * k / SEG))) for r, y in section] for k in range(SEG)]
    n = len(section)
    for a, b in zip(loops, loops[1:] + loops[:1]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])).material_index = 0
# a plate between the hoop and the ring, and on both its faces rays in low relief, every other one slighter
PLATE = [(R_HOOP + 0.05, -0.04), (3.9, -0.04), (3.9, 0.04), (R_HOOP + 0.05, 0.04)]  # sunk 26 cm behind the ring's faces
loops = [[bm.verts.new((r * math.cos(2 * math.pi * k / SEG), y, RING_Z + r * math.sin(2 * math.pi * k / SEG))) for r, y in PLATE] for k in range(SEG)]
for a, b in zip(loops, loops[1:] + loops[:1]):
    for i in range(4):
        bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i])).material_index = 0
RAYS = 16
for k in range(RAYS):
    t = 2 * math.pi * (k + 0.5) / RAYS
    w0, w1, d = (0.05, 0.11, 0.1) if k % 2 == 0 else (0.035, 0.07, 0.08)
    u = (math.cos(t), math.sin(t))
    v = (-math.sin(t), math.cos(t))
    ends = []
    for r, w in ((R_HOOP + 0.06, w0), (3.9, w1)):
        ends.append([bm.verts.new((r * u[0] + sw * w * v[0], sd * d, RING_Z + r * u[1] + sw * w * v[1])) for sw, sd in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    faces = [bm.faces.new((ends[0][i], ends[0][(i + 1) % 4], ends[1][(i + 1) % 4], ends[1][i])) for i in range(4)]
    faces += [bm.faces.new(ends[0]), bm.faces.new(ends[1])]
    for f in faces:
        f.material_index = 0
ring = K.finish(K.new_object("gate_ring", bm, BROAD), smooth_angle=30)
# the sunk plate is darker than the ring and the rays (brief: gilt is dark in its recesses); smooth metal shows no form without it
attr = ring.data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
for poly in ring.data.polygons:
    sunk = all(abs(ring.data.vertices[i].co.y) < 0.045 for i in poly.vertices)
    for li in poly.loop_indices:
        attr.data[li].color = (0.5, 0.5, 0.5, 1.0) if sunk else (0.88, 0.88, 0.88, 1.0)
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
for sx in (-1, 1):
    cx = sx * (END[0] + END[1]) / 2
    for sy in (-1, 1):
        path = [(cx + 0.21 * math.sin(t), sy * (DEEP + 0.08), 1.74 + 0.45 * math.cos(t)) for t in (math.radians(14 + 332 * i / 12) for i in range(13))]
        K.tube(bm, path, 0.034, 5, 0)
    K.lathe(bm, [(0.0, END[2] + 0.004), (0.16, END[2] + 0.004), (0.16, END[2] + 0.05), (0.09, END[2] + 0.09)]
            + [(0.15 * math.cos(math.radians(a)), END[2] + 0.22 + 0.15 * math.sin(math.radians(a))) for a in range(-50, 91, 28)][:-1]
            + [(0.0, END[2] + 0.37)], 12, 0, centre=(cx, 0.0))
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

parts = [stone, ring, trim]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.35 * k, 0.6 * k, 0.25 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")
bpy.context.view_layer.update()
K.check_no_overlap(stone, ring)
K.check_no_overlap(stone, trim)
K.check_no_overlap(disc, ring)
K.check_no_overlap(disc, stone)

# bake: on the plateau's paving
bm = bmesh.new()
K.box(bm, (-6, -6, -K.SLAB), (6, 6, 0))
ground = K.new_object("bake_ground", bm)
bpy.context.view_layer.update()
# (only the stone: on the ring's broad smooth faces a baked occlusion map shows as blotches)
K.unwrap_atlas([stone], "UV1", margin=0.006)
ao = K.bake_ao([stone], "gate_ao", 512, occluders=[ground, ring, trim], distance=1.2, strength=1.0)
K.grime_vertex_colours([stone], ao, amount=0.25)
K.course_tint([stone], COURSE, 0.03)
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
root = bpy.data.objects.new("gate", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts, disc])
