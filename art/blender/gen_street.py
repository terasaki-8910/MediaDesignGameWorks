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

parts = [side, piers, ring]
for k, ob in enumerate(parts):
    K.world_uv(ob, offset=(0.7 * k, 0.3 * k, 0.45 * k))
    print(f"{ob.name}: {K.triangles(ob)} triangles")
for ob in (piers, ring):
    ob.location = (20.0, 0, 0)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.008)
ao = K.bake_ao(parts, "street_ao", 256, distance=0.8, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.6, skip=("M_gilt",))
K.face_weathering([piers, ring], vertical=ARCH_TONE, top=ARCH_TONE, skip=("M_gilt",))
K.face_weathering([side], vertical=KERB_TONE, top=KERB_TONE)
for ob in (piers, ring):
    ob.location = (0, 0, 0)
bpy.context.view_layer.update()
for ob in parts:
    K.check_mesh(ob, closed=True)
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
K.export(OUT, [side, arch, piers, ring])
