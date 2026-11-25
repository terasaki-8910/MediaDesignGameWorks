"""What makes a lamped bridge of four cells or more a piece of street: public/assets/kit/street.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_street.py -- --out public/assets/kit/street.glb

The deck, the cornices, the parapets and the lamps are the kit's. This file adds, on top of the paving:
  street_side  the north side of one 4 m cell: a kerb of dressed stone (6 cm high, with a rounded nose), a narrow
               pavement behind it up to the foot of the parapet, and two stone bollards on the kerb. The carriageway
               between the kerbs stays the kit's paving: it is where the player walks, and stays the lightest.
               The game leaves a side out where the street has a side port (a dropped kerb).
  street_arch  the archway at the street's far end: two piers on moulded plinths, an impost, eleven voussoirs that
               stand alternately proud, and a gilt keystone. Modelled across X; the origin is on the deck under its
               crown. It keeps inside the old arch's envelope (2.35 m to each side, 6.6 m high, 0.3 m deep): the
               solver knows nothing of it.
  street_edge  the edge of the deck (modelled on the north edge of a cell, like the kit's edge pieces; the game uses it
               where the kit would put its plain edge, which is baked against a neighbour and is a dark blank strip when
               the street hangs and is seen edge-on): the kit's kerb and cornice cut into the slab, so that nothing
               passes the cell's edge and the street can lie against its neighbours.
  street_soffit    the underside of one cell (the game uses it in place of the kit's plain slab_bottom: while the street
                   hangs its underside is an upright face 16 m tall, seen from the walkways): a coffer cut into the
                   slab, with a flat margin (the margins of two cells make a rib across the street), a panel sunk 10 cm
                   in two steps and an octagonal patera in its middle. Nothing passes the slab's underside.
  street_brackets  eight consoles under the cornice of one cell's open edge (modelled on the north edge): scrolled
                   blocks 16 cm wide that carry the kit's cornice, half a metre apart. They stand out 13.5 cm, inside
                   the cornice's 15.
The street's parapets while it hangs are the kit's balustrade, laid out by the game (world.ts).
The street folds down from hanging, so nothing here knows which way is up: no ground under the bake, one tone for
every face of a piece.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

H = K.CELL / 2
KERB = (1.1, 1.3)  # the kerb, metres north of the cell centre
PAVE = 1.7  # the pavement ends at the parapet's plinth
RISE = 0.06
SPAN = 2.1  # the arch's mid radius: its piers stand astride the parapets
SPRING = 4.2

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/street.glb")
ARCH_TONE = float(opts.get("arch-tone", "0.7"))  # every face of the arch (the kit's upright stone is at 0.6, its tops at 1)
KERB_TONE = float(opts.get("kerb-tone", "0.85"))
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
PAVING = K.stone_material("M_paving", dict(K.PAVING))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
MATS = [STONE, PAVING, GILT]

# kerb, pavement, bollards
bm = bmesh.new()
K.prism(bm, [(KERB[0], 0.0), (KERB[0], RISE - 0.02), (KERB[0] + 0.03, RISE), (KERB[1], RISE), (KERB[1], 0.0)], -H, H, 0)
faces = K.slab_outline(bm, [(-H, KERB[1] + 0.001), (H, KERB[1] + 0.001), (H, PAVE), (-H, PAVE)], 0.0, RISE - 0.004, material_index=0)
faces[-1].material_index = 1
for x in (-1.0, 1.0):
    K.lathe(bm, [(0.115, RISE - 0.01), (0.115, 0.1), (0.09, 0.14), (0.078, 0.5), (0.098, 0.56), (0.098, 0.6), (0.06, 0.67), (0.0, 0.71)], 10, 0,
            centre=(x, (KERB[0] + KERB[1]) / 2 + 0.02))
side = K.finish(K.new_object("street_side", bm, materials=MATS), smooth_angle=40)

# the archway
bm = bmesh.new()
c = 0.02
for sx in (-1, 1):
    K.loft(bm, [(0.25, 0.0, c), (0.25, 0.34, c), (0.21, 0.4, c), (0.21, SPRING - 0.3, c), (0.23, SPRING - 0.25, c), (0.25, SPRING - 0.12, c),
                (0.25, SPRING, c)], 0, centre=(sx * SPAN, 0.0))
piers = K.finish(K.new_object("street_arch_piers", bm, materials=MATS), smooth_angle=30)
bm = bmesh.new()
VOUSSOIRS = 11
for k in range(VOUSSOIRS):
    key = k == VOUSSOIRS // 2
    proud = k % 2 == 0
    r0, r1 = (SPAN - 0.25, SPAN + 0.3) if key else (SPAN - 0.22, SPAN + (0.25 if proud else 0.21))
    half = 0.3 if key else 0.27 if proud else 0.24
    gap = 0.004  # each stone is its own closed block
    a0 = math.pi * k / VOUSSOIRS + gap
    a1 = math.pi * (k + 1) / VOUSSOIRS - gap
    am = (a0 + a1) / 2
    ring = [(r0, a0), (r0, am), (r0, a1), (r1, a1), (r1, am), (r1, a0)]
    a = [bm.verts.new((r * math.cos(t), -half, SPRING + r * math.sin(t))) for r, t in ring]
    b = [bm.verts.new((r * math.cos(t), half, SPRING + r * math.sin(t))) for r, t in ring]
    n = len(ring)
    faces = [bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])) for i in range(n)]
    faces += [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
    for f in faces:
        f.material_index = 2 if key else 0
ring = K.finish(K.new_object("street_arch_ring", bm, materials=MATS), bevel=0.015, smooth_angle=30)

# the deck's edge
bm = bmesh.new()
K.sunk_edge(bm, H, K.SLAB)
edge = K.finish(K.new_object("street_edge", bm, materials=MATS), smooth_angle=30)

# the underside: a coffer cut up into the slab
bm = bmesh.new()
Z0 = -K.SLAB
K.loft(bm, [(H, Z0, 0.0), (1.62, Z0, 0.0), (1.56, Z0 + 0.05, 0.0), (1.5, Z0 + 0.05, 0.0), (1.44, Z0 + 0.1, 0.0), (0.7, Z0 + 0.1, 0.2),
            (0.6, Z0 + 0.035, 0.17), (0.34, Z0 + 0.035, 0.1), (0.28, Z0 + 0.075, 0.08)], 0, cap_bottom=False)
soffit = K.finish(K.new_object("street_soffit", bm, materials=MATS), smooth_angle=15)
K.face_up(soffit, axis=(0.0, 0.0, -1.0))

# the consoles under the cornice: (how far out from the cell's edge, height), a scroll from the cornice's bed down to the
# foot of the fascia
CONSOLE = [(-0.02, -0.335), (0.135, -0.335), (0.135, -0.37), (0.12, -0.4), (0.085, -0.44), (0.06, -0.49), (0.05, -0.54), (0.03, -0.585), (-0.02, -0.585)]
bm = bmesh.new()
for k in range(8):
    x = -1.75 + 0.5 * k
    K.prism(bm, [(H + o, z) for o, z in CONSOLE], x - 0.08, x + 0.08, 0)
brackets = K.finish(K.new_object("street_brackets", bm, materials=MATS), smooth_angle=30)

parts = [side, piers, ring, edge, soffit, brackets]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.7 * k, 0.3 * k, 0.45 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")
for ob in (piers, ring):
    ob.location = (20.0, 0, 0)
edge.location = (0, 20.0, 0)
soffit.location = (0, 40.0, 0)
brackets.location = (20.0, 40.0, 0)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.008)
ao = K.bake_ao(parts, "street_ao", 256, distance=0.8, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.6, skip=("M_gilt",))
K.face_weathering([piers, ring, edge, soffit, brackets], vertical=ARCH_TONE, top=ARCH_TONE, skip=("M_gilt",))
K.face_weathering([side], vertical=KERB_TONE, top=KERB_TONE)
for ob in (piers, ring, edge, soffit, brackets):
    ob.location = (0, 0, 0)
bpy.context.view_layer.update()
if max(v.co.y for v in edge.data.vertices) > H + 1e-4:
    raise RuntimeError("the street's edge stands out of its cell: the street lies against its neighbours")
if min(v.co.z for v in soffit.data.vertices) < -K.SLAB - 1e-4 or max(max(abs(v.co.x), abs(v.co.y)) for v in soffit.data.vertices) > H + 1e-4:
    raise RuntimeError("the street's soffit passes the slab: the street lies against its neighbours")
if max(v.co.y for v in brackets.data.vertices) > H + 0.15:
    raise RuntimeError("the consoles stand out further than the cornice they carry")
for ob in parts:
    K.check_mesh(ob, closed=ob is not soffit)
verts = [v.co for ob in (piers, ring) for v in ob.data.vertices]
wide = max(abs(v.x) for v in verts)
high = max(v.z for v in verts)
deep = max(abs(v.y) for v in verts)
if wide > 2.351 or high > 6.61 or deep > 0.301:
    raise RuntimeError(f"the arch is {wide:.3f} m wide to a side, {high:.3f} m high, {deep:.3f} m deep: outside the old arch's envelope")
arch = bpy.data.objects.new("street_arch", None)
bpy.context.collection.objects.link(arch)
piers.parent = ring.parent = arch
bpy.context.view_layer.update()
K.export(OUT, [side, arch, piers, ring, edge, soffit, brackets])
