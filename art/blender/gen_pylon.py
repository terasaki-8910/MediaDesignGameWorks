"""The stone pylon crowned in gilt (reference A1): public/assets/kit/pylon.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_pylon.py -- --out public/assets/kit/pylon.glb

One piece, `pylon` (an empty with pylon_stone and pylon_gilt). It stands beside a walkway, not on it, carried by a
stepped corbel that tapers away 3.4 m below the deck (no shaft of its own into the haze). The origin is at deck level
in the middle of its 1.74 m plinth. Above the deck, after A1's pylons of the Pont Alexandre III:
  - a plinth, and on it a square core with a fluted engaged column at each corner (ten flutes, a moulded base, a
    neck, a capital of eight carved lobes and a square abacus);
  - on each face, between the columns, a low tablet and a tall panel in a raised frame, with an oval cartouche in the
    tall panel inside a gilt laurel wreath;
  - an architrave over the capitals, a frieze, a deep cornice, an attic and a stepped pedestal (6.9 m);
  - the gilt winged finial to 8.5 m. The wings spread along X. The stone's tone varies from course to course.
"""
import math
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402

opts = K.script_args()
OUT = opts.get("out", "public/assets/kit/pylon.glb")
UPRIGHT_TONE = float(opts.get("upright", "0.6"))  # colour factor of upright faces (the tops keep 1.0); see K.face_weathering
K.reset()
STONE = K.stone_material("M_stone", dict(K.ASHLAR))
GILT = K.plain_material("M_gilt", "#E3C16F", metallic=1.0, roughness=0.26)
MATS = [STONE, GILT]
COURSE = 0.56
SHAFT = (0.95, 4.85)  # the shaft between the plinth and the architrave
CORE = 0.6  # half width of the shaft's core
COL = 0.6  # a column stands on each corner of the core
COL_R = 0.2  # its radius over the arrises of the flutes


def skin(bm, rings, material_index=0):
    """Join rings of equal vertex count (bottom to top) into a closed shell; the end rings are capped."""
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(verts[0])
    faces = []
    for k in range(len(verts) - 1):
        for i in range(n):
            faces.append(bm.faces.new((verts[k][i], verts[k][(i + 1) % n], verts[k + 1][(i + 1) % n], verts[k + 1][i])))
    faces.append(bm.faces.new(list(reversed(verts[0]))))
    faces.append(bm.faces.new(verts[-1]))
    for f in faces:
        f.material_index = material_index
    return faces


def round_ring(cx, cy, z, r, n, lobe=0.0, lobes=0, phase=0.0):
    """A ring of n points about (cx, cy): radius r, with `lobes` rounded swellings of height `lobe` (carved leaves)."""
    return [(cx + (r + lobe * math.cos(lobes * a)) * math.cos(a), cy + (r + lobe * math.cos(lobes * a)) * math.sin(a), z)
            for a in (phase + 2 * math.pi * i / n for i in range(n))]


def fluted_ring(cx, cy, z, r, depth, flutes, per):
    """A ring of `flutes` hollows, `per` points each: the arrises at radius r, the hollows `depth` deeper."""
    pts = []
    for i in range(flutes * per):
        t = (i % per) / per
        rr = r - depth * math.sin(math.pi * t) ** 0.8
        a = 2 * math.pi * i / (flutes * per)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
    return pts


def poly_prism(bm, pts, axis, offset, thick, material_index=0):
    """A polygon given as (u, v) points, standing on a face of the core and `thick` proud of it.
    axis ('x', '-x', 'y', '-y') names the face's normal; the points are (along the face, up)."""
    out = []
    for d in (offset, offset + thick):
        ring = []
        for u, v in pts:
            if axis == "y":
                ring.append((u, d, v))
            elif axis == "-y":
                ring.append((u, -d, v))
            elif axis == "x":
                ring.append((d, u, v))
            else:
                ring.append((-d, u, v))
        out.append(ring)
    verts = [[bm.verts.new(p) for p in ring] for ring in out]
    n = len(pts)
    faces = [bm.faces.new((verts[0][i], verts[0][(i + 1) % n], verts[1][(i + 1) % n], verts[1][i])) for i in range(n)]
    faces.append(bm.faces.new(list(reversed(verts[0]))))
    faces.append(bm.faces.new(verts[1]))
    for f in faces:
        f.material_index = material_index
    return faces


bm = bmesh.new()
c = 0.03
# the corbel under the deck and the plinth on it: the plinth keeps its full width to the top, where the columns stand
K.loft(bm, [(0.06, -3.4, 0.02), (0.3, -3.0, c), (0.46, -2.3, c), (0.62, -1.62, c), (0.62, -1.45, c), (0.76, -1.3, c), (0.76, -0.92, c),
            (0.87, -0.78, c), (0.87, 0.5, c), (0.82, 0.58, c), (0.82, 0.84, c), (0.87, 0.88, c), (0.87, SHAFT[0], c)], 0)
# the core in courses, so each course can take its own tone
n = round((SHAFT[1] - SHAFT[0]) / COURSE)
K.loft(bm, [(CORE, SHAFT[0] + (SHAFT[1] - SHAFT[0]) * i / n, 0.01) for i in range(n + 1)], 0)

# a fluted column on each corner, half in the core, with a base, a neck and a capital of carved lobes
Z_BASE, Z_FLUTE0, Z_FLUTE1, Z_NECK, Z_CAP = SHAFT[0], 1.2, 4.12, 4.28, 4.6
for sx in (-1, 1):
    for sy in (-1, 1):
        cx, cy = sx * COL, sy * COL
        K.box(bm, (cx - 0.27, cy - 0.27, Z_BASE), (cx + 0.27, cy + 0.27, Z_BASE + 0.1), 0)  # the plinth block of the base
        skin(bm, [round_ring(cx, cy, z, r, 12) for z, r in ((Z_BASE + 0.1, 0.25), (Z_BASE + 0.15, 0.255), (Z_BASE + 0.2, 0.225),
                                                          (Z_BASE + 0.24, 0.235), (Z_FLUTE0, COL_R))])
        skin(bm, [fluted_ring(cx, cy, z, r, 0.034, 10, 3) for z, r in ((Z_FLUTE0 - 0.01, COL_R), (Z_FLUTE1 + 0.01, COL_R - 0.016))])
        # neck, then the capital: eight lobes swelling out to the abacus
        skin(bm, [round_ring(cx, cy, z, r, 16, lobe, 8) for z, r, lobe in ((Z_FLUTE1, 0.19, 0.0), (Z_NECK, 0.2, 0.0), (Z_NECK + 0.04, 0.21, 0.0),
                                                                         (Z_NECK + 0.17, 0.25, 0.03), (Z_NECK + 0.27, 0.285, 0.035),
                                                                         (Z_CAP, 0.3, 0.02))])
        K.box(bm, (cx - 0.31, cy - 0.31, Z_CAP), (cx + 0.31, cy + 0.31, Z_CAP + 0.16), 0)  # the abacus
        K.box(bm, (cx - 0.28, cy - 0.28, Z_CAP + 0.16), (cx + 0.28, cy + 0.28, SHAFT[1]), 0)

# the faces between the columns: a low panel, and a tall one with a cartouche, each in a raised frame
PROUD = 0.035
for face, nx, ny in (("-y", 0, -1), ("y", 0, 1), ("x", 1, 0), ("-x", -1, 0)):
    # the low panel is one raised tablet
    poly_prism(bm, [(-0.3, 1.4), (0.3, 1.4), (0.3, 1.9), (-0.3, 1.9)], face, CORE - 0.005, PROUD + 0.005)
    for z0, z1, half in ((2.18, 4.04, 0.31),):
        bar = 0.055
        # the uprights run into the cross bars (they must not share corners with them: the bars are separate shells)
        for u0, u1, v0, v1, proud in ((-half, half, z0, z0 + bar, 0.0), (-half, half, z1 - bar, z1, 0.0),
                                      (-half, -half + bar, z0 + bar / 2, z1 - bar / 2, 0.004), (half - bar, half, z0 + bar / 2, z1 - bar / 2, 0.004)):
            poly_prism(bm, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], face, CORE - 0.005, PROUD + 0.005 + proud)
    # the cartouche: an oval boss with a pointed foot, standing out from the tall panel
    zc, a, b = 3.2, 0.19, 0.5
    oval = []
    for i in range(14):
        t = 2 * math.pi * i / 14
        u, v = a * math.sin(t), b * math.cos(t)
        if math.cos(t) < 0:  # a pointed foot
            v *= 0.82 + 0.18 * abs(math.sin(t))
        oval.append((u, zc + v * 0.9))
    poly_prism(bm, oval, face, CORE - 0.005, 0.07)

# architrave over the capitals, frieze, deep cornice, attic and stepped pedestal for the finial
K.loft(bm, [(0.93, SHAFT[1], c), (0.95, 4.9, c), (0.95, 5.06, c), (0.9, 5.08, c), (0.88, 5.12, c), (0.88, 5.34, c), (0.93, 5.37, c), (0.98, 5.43, c),
            (1.02, 5.55, c), (1.05, 5.6, c), (1.05, 5.78, c), (0.9, 5.84, c), (0.64, 5.86, c), (0.64, 6.3, c), (0.7, 6.33, c),
            (0.7, 6.42, c), (0.5, 6.44, c), (0.5, 6.56, c), (0.38, 6.58, c), (0.38, 6.84, c), (0.44, 6.87, c), (0.44, 6.92, c)], 0)
stone = K.finish(K.new_object("pylon_stone", bm, materials=MATS), smooth_angle=30)

# gilt: a laurel wreath round each cartouche, and the finial (a base, an orb, a spire, two wings swept up and back)
bm = bmesh.new()
for nx, ny in ((0, -1), (0, 1), (1, 0), (-1, 0)):
    d = CORE + 0.085
    path = []
    for i in range(13):
        t = math.radians(14 + 332 * i / 12)
        path.append((0.27 * math.sin(t), 3.2 + 0.56 * math.cos(t)))
    pts = [((nx * d, u, v) if nx else (u, ny * d, v)) for u, v in path]
    K.tube(bm, pts, 0.036, 5, 1, side=(1, 0, 0) if nx else (0, 1, 0))
S, Z = 0.72, 6.92  # the finial was drawn 1.39 times larger with its base at 8.7
f = lambda r, z: (r * S, (z - 8.7) * S + Z)  # noqa: E731
K.lathe(bm, [f(*p) for p in ((0.5, 8.7), (0.52, 8.8), (0.3, 8.92), (0.22, 9.05), (0.36, 9.25), (0.4, 9.42), (0.33, 9.6), (0.16, 9.72),
                             (0.12, 9.9), (0.17, 10.0), (0.05, 10.6), (0.0, 10.9))], 14, 1)
for sx in (-1, 1):
    outline = [f(*p) for p in ((0.12, 9.25), (0.7, 9.5), (1.35, 10.25), (1.28, 10.42), (0.95, 10.2), (0.98, 10.0), (0.62, 9.85), (0.66, 9.68),
                               (0.2, 9.62))]
    front = [bm.verts.new((sx * x, -0.04, z)) for x, z in outline]
    back = [bm.verts.new((sx * x, 0.04, z)) for x, z in outline]
    k = len(outline)
    faces = [bm.faces.new((front[i], front[(i + 1) % k], back[(i + 1) % k], back[i])) for i in range(k)]
    faces.append(bm.faces.new(front))
    faces.append(bm.faces.new(list(reversed(back))))
    for face in faces:
        face.material_index = 1
gilt = K.finish(K.new_object("pylon_gilt", bm, materials=MATS), smooth_angle=45)

parts = [stone, gilt]
for ob in parts:
    print(f"{ob.name}: {K.triangles(ob)} triangles")
    K.world_uv(ob)
bm = bmesh.new()
K.box(bm, (1.1, -6, -K.SLAB), (8, 6, 0))
deck = K.new_object("bake_deck", bm)
bpy.context.view_layer.update()
K.unwrap_atlas(parts, "UV1", margin=0.006)
ao = K.bake_ao(parts, "pylon_ao", 512, occluders=[deck], distance=1.2, strength=1.2)
K.grime_vertex_colours(parts, ao, amount=0.6, skip=("M_gilt",))
K.depth_weathering([stone], -0.6, -3.0, tint="#7C7E78")  # the corbel under the deck
K.depth_weathering([stone], 30.0, 29.0, tint="#D6D4CD")  # all of the stone, a shade under the parapets
K.course_tint([stone], COURSE, 0.08)
K.face_weathering([stone], vertical=UPRIGHT_TONE)  # upright faces darker, so the sunlit shafts do not outshine the paving
bpy.data.objects.remove(deck)
for ob in parts:
    K.check_mesh(ob, closed=True)
top = max(v.co.z for v in gilt.data.vertices)
low = min(v.co.z for v in stone.data.vertices)
if abs(low + 3.4) > 1e-3 or not 8.4 < top < 8.6:
    raise RuntimeError(f"pylon spans {low:.3f} .. {top:.3f}")
half = max(max(abs(v.co.x), abs(v.co.y)) for v in stone.data.vertices)
if half > 1.051:
    raise RuntimeError(f"pylon is {half:.3f} m from its axis: the layout leaves room for 1.05")
root = bpy.data.objects.new("pylon", None)
bpy.context.collection.objects.link(root)
for ob in parts:
    ob.parent = root
bpy.context.view_layer.update()
K.export(OUT, [root, *parts])
