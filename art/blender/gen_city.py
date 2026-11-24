"""The background city: public/assets/city.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_city.py -- --out public/assets/city.glb

Twelve buildings after the reference photos (A1: the Haussmann fronts and the dome of the Invalides beyond the bridge;
A2: the Art Deco mass of the Palais de Chaillot), each as <name>_lod0 (near) and <name>_lod1 (far):
  haussmann_a       apartment block: arcaded ground floor, five floors of windows, two balcony lines, cornice, slate
                    mansard with dormers and chimney stacks, between two end pavilions a storey taller
  haussmann_corner  the same with a rotunda and a slate dome on the corner
  haussmann_step    a taller block with a lower wing: stepped roofline
  haussmann_low     four storeys under a flat roof: a parapet, a roof garden, a glazed lantern, a water tank
  haussmann_tall    eight storeys, an attic storey set back behind a terrace, a two-tier mansard with two rows of dormers
  haussmann_short   a short front (seven bays) under a tall pavilion roof with two chimney stacks: the ends of a block
  tower_house       a slender house of twelve storeys under a stepped stone crown (four steps, no point)
  deco_block        an Art Deco apartment mass of twelve storeys with three setbacks under a stepped crown
  deco_hall         long Art Deco hall: plinth, tall glazing between piers, stepped attic, taller pavilion
  deco_tower        Art Deco tower with three setbacks and a stone lantern
  dome              domed building: square base, portico, drum, ribbed dome, lantern under a gilt ball
  belfry            block with a tall clock tower: an open bell stage, a stone spire between four pinnacles
The far model is the fronts of the facade atlas of city_kit.py (limestone walls with recessed windows, slate roofs),
one quad a storey, the dormers drawn on the mansard, bare roofs. The near model is made for the distance it is seen from
(the walls beside the play area, 120 to 250 m from the play cameras): fewer, larger features than a window to every
bay. Its fronts are in depth, after A2 (city_kit.order): giant piers of large ashlar blocks every 7 m or so, and between
them the wall 0.6 m back, in their shade, with one tall bay of glazing over the ground floor's. To that it adds outline.
A mansard with a steep lower slope and a shallow upper one, a pale zinc ledge at the break; a broad dormer to every pier
bay, and on the end slopes; chimney stacks beside the ridge, no two alike, with their pots; at each end of a mansard a
stepped gable wall of flues (the far model has its tall part); a cornice that stands 1.1 m out over a frieze in its
shade, balcony slabs over a line of shade; in the middle of a long front a shallow bay carried up through the cornice
(both models), so no eaves line is one ruled edge; an attic storey set back behind a terrace (haussmann_tall), end
pavilions a storey taller (haussmann_a), a stepped stone crown (tower_house); the Art Deco masses have broad piers that
stand out as fins before bands of glazing (deco_side), parapets at every setback and stepped crowns. Nothing but the belfry ends in a point: the dome, the corner rotunda and the towers end blunt, because on a wall
of the folded city a point aims at the walkways. COLOR_0 tints the atlas and colours the plain parts (zinc, cornices,
chimneys, gilt). The game draws the buildings as one batch, tints, scales and stretches each one along its length. Origin: ground
centre of the footprint; +X is the long side.
"""
import math
import os
import random
import sys

import bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402
from city_kit import *  # noqa: E402,F401,F403  (the palette, Shell, slots, deco_side, city_material, finished)

opts = K.script_args()
OUT = opts.get("out", "public/assets/city.glb")
K.reset()

TERRACE = K.srgb("#79848F")  # a flat roof of zinc and gravel: never the colour of the streets
STACK = K.srgb("#968B78")  # chimney stacks: rendered stone under soot, between the slate and the fronts
POT = K.srgb("#8E7D6E")  # chimney pots: terracotta under soot, never a row of red dots
DORMER = K.srgb("#A69B86")  # a dormer's stone front and cheeks
ZINC_B = K.srgb("#7E8893")  # zinc that takes the sky: dormer caps, the ledge at the mansard's break
SHADE = K.srgb("#756C5C")  # stone in the shade of a cornice or a balcony: the line under every overhang


def tiers_of(floors):
    """The tiers of a near front of `floors` storeys ((height, spandrel) each): the ground floor under its string course,
    then all the floors above as one tall bay up to the frieze (two where the front is over eight storeys), so a bay is
    one or two tall openings (A2's slots between piers) and not a window to every storey."""
    upper = floors - 1
    if upper > 7:
        low = upper // 2
        return [(GROUND_FLOOR, 1.0), (low * STOREY, 1.1), ((upper - low) * STOREY, 0.0)]
    return [(GROUND_FLOOR, 1.0), (upper * STOREY, 0.0)]  # (the frieze under the cornice closes the top bay)


def fronts(s, hx, hy, floors, z0=0.0, tint=WALL, sides="SNEW", rnd=None):
    """The storeys of a Haussmann front. Far (no `rnd`): the atlas's fronts, the arcade, then floors with a balcony line
    on the second and the top one. Near: the front in depth (city_kit.order), giant piers before tall recessed bays."""
    if rnd is not None:
        return order_box(s, hx, hy, z0, tiers_of(floors), rnd, tint, sides=sides, foot=0.5 if z0 == 0.0 else None, pitch=6.8, width=4.0, blocks=STOREY * 2)
    plan = [("ground", GROUND_FLOOR)] + [("balcony" if f in (2, floors - 1) else "floor", STOREY) for f in range(1, floors)]
    return s.storeys(hx, hy, z0, plan, tint, sides, foot=0.5 if z0 == 0.0 else None)


def chimney_stacks(s, lod, cx, cy, roof, ridge, n, seed):
    """Chimney stacks on a roof with half sizes cx, cy: short blocks of rendered stone beside the ridge, each where its
    flues come up (no two alike in place, size or height), with their pots on the near model. They break the roofline;
    none runs across the roof."""
    r = random.Random(seed)
    for i in range(n):
        x = -cx + 3.0 + (2 * cx - 6.0) * (i + 0.15 + 0.7 * r.random()) / n
        side = -1 if r.random() < 0.5 else 1
        y = side * min(cy - 3.4, 0.8 + 1.5 * r.random())
        w, l, h = 0.55 + 0.3 * r.random(), 0.9 + 0.8 * r.random(), ridge + 1.5 + 1.3 * r.random()
        s.box((x - w, y - l, roof - 0.3), (x + w, y + l, roof + h), STACK, top=TRIM, foot=0.8)
        if lod == 0:
            s.box((x - 0.22, y - l * 0.7, roof + h), (x + 0.22, y + l * 0.7, roof + h + 0.7), POT)


def dormers(s, hx, hy, z, inset, mh, h=2.6, w=1.25, skip=None, ends=(-1, 1)):
    """A row of dormers on the mansard's two long slopes, one to every bay between the front's piers: a broad stone front
    under a zinc cap, standing out of the slates, so the eaves line is a row of gables and never a ruled edge. `skip`
    leaves bays out."""
    n = max(1, round(2 * hx / 5.8))
    for i in range(n):
        if skip and i in skip:
            continue
        x = -hx + (i + 0.5) * 2 * hx / n
        back = inset * (0.6 + h) / mh + 0.15
        for sy in (-1, 1):
            y0, y1 = sorted((sy * (hy - 0.3), sy * (hy - back)))
            s.box((x - w, y0, z + 0.6), (x + w, y1, z + 0.6 + h), DORMER, top=ZINC_B)
            u0, u1 = sorted(((x - w + 0.32) * -sy, (x + w - 0.32) * -sy))  # along the wall as seen from outside
            s.panel("S" if sy < 0 else "N", 0.0, 0.0, u0, u1, z + 0.95, z + 0.3 + h, GLASS, hy - 0.26)
    # and on the two end slopes, so the roof's end against the sky is gables as well and no ruled line
    m = max(1, round(2 * hy / 6.5))
    for i in range(m):
        if ends is None:
            break
        y = -hy + (i + 0.5) * 2 * hy / m
        back = inset * (0.6 + h) / mh + 0.15
        for sx in ends:
            x0, x1 = sorted((sx * (hx - 0.3), sx * (hx - back)))
            s.box((x0, y - w, z + 0.6), (x1, y + w, z + 0.6 + h), DORMER, top=ZINC_B)
            u0, u1 = sorted(((y - w + 0.32) * sx, (y + w - 0.32) * sx))
            s.panel("W" if sx < 0 else "E", 0.0, 0.0, u0, u1, z + 0.95, z + 0.3 + h, GLASS, hx - 0.26)


def block(s, lod, hx, hy, floors, at=(0.0, 0.0), z0=0.0, chimneys=3, tiers=1, tint=WALL, roof="mansard", slate_top=False, attic=False, seed=1, sides="SNEW"):
    """A Haussmann block: fronts, balcony slabs, cornice, and its roof; returns the height of the roof's flat. What the
    near model adds is what still reads from the play area (walls 120 to 250 m off): a cornice that stands well out over a
    frieze in its shade, balcony slabs over a line of shade, a row of dormers, chimney stacks with pots."""
    s.o = at
    near = lod == 0
    rnd = random.Random(seed * 31 + 7)
    top = fronts(s, hx, hy, floors, z0, tint, sides, rnd if near else None)
    out = 1.1 if near else 0.55
    s.box((-hx - out, -hy - out, top - 0.1), (hx + out, hy + out, top + 0.5), TRIM, bottom=True)
    if near:
        s.ring(hx + 0.35, hy + 0.35, top - 1.4, top - 0.1, SHADE)  # the frieze, in the cornice's shade
        for f in (2, floors - 1):
            z = z0 + GROUND_FLOOR + (f - 1) * STOREY
            s.box((-hx - 0.85, -hy - 0.85, z - 0.05), (hx + 0.85, hy + 0.85, z + 0.25), TRIM, bottom=True)
            s.ring(hx + 0.22, hy + 0.22, z - 0.55, z - 0.05, SHADE)
    top += 0.5
    if roof == "mansard" and not attic and hx >= 11.5:
        # a shallow bay in the middle of each long front, carried up through the cornice as a block of stone: the eaves of
        # a long house are stepped in the middle and never one ruled line against the sky
        bw = min(hx * 0.32, 6.5)
        out = 0.7 if near else 0.5
        for sy in (-1, 1):
            y0, y1 = sorted((sy * (hy - 0.2), sy * (hy + out)))
            s.box((-bw, y0, z0), (bw, y1, top + 2.5), mul(tint, 0.97), top=TRIM, strip="ashlar", foot=0.5 if z0 == 0.0 else None, walls="SEW" if sy < 0 else "NEW")
            s.box((-bw * 0.55, y0, top + 2.5), (bw * 0.55, y1, top + 3.6), TRIM, walls="SEW" if sy < 0 else "NEW")
    if attic:
        # the top storey stands back behind a terrace: the cornice line, then a lower, narrower storey under the roof
        s.box((-hx - 0.1, -hy - 0.1, top), (hx + 0.1, hy + 0.1, top + 0.9), TRIM, top=PAVED, paved=True)
        hx, hy = hx - 1.7, hy - 1.7
        top = order_box(s, hx, hy, top, [(STOREY, 0.0)], rnd, mul(tint, 0.94), depth=0.45) if near else s.storeys(hx, hy, top, [("floor", STOREY)], mul(tint, 0.94))
        s.box((-hx - 0.5, -hy - 0.5, top - 0.1), (hx + 0.5, hy + 0.5, top + 0.35), TRIM, bottom=True)
        top += 0.35
    if roof == "terrace":
        # a flat roof behind a parapet: a garden, a glazed lantern over the stair, a water tank (the near model)
        s.box((-hx - 0.2, -hy - 0.2, top - 0.1), (hx + 0.2, hy + 0.2, top + 0.9), TRIM, top=PAVED, paved=True)
        deck = top + 0.9
        s.box((-hx + 2.0, -2.2, deck), (-hx + 7.0, 2.2, deck + 2.6), WALL_B, top=ZINC, strip="ashlar")
        s.hip(4.0, 2.4, deck, deck + 1.9, SKYLIGHT, c=(3.0, 0.0))
        if near:
            s.garden((hx - 9.5, -hy + 1.4), (hx - 1.5, hy - 1.4), deck)
            s.water_tower((-hx + 10.5, hy - 3.2), deck)
            for x in (-hx + 9.0, hx - 11.5):  # the party walls' chimney stacks
                s.box((x - 0.6, hy - 3.6, deck - 0.2), (x + 0.6, hy - 1.2, deck + 2.6), STACK, top=TRIM, foot=0.8)
                s.box((x - 0.2, hy - 2.6, deck + 2.6), (x + 0.2, hy - 2.2, deck + 3.3), POT)
        s.o = (0.0, 0.0)
        return deck
    if roof == "crown":
        # a stepped crown of stone (Art Deco): an attic set back behind the cornice, two more steps, a lantern block; no point
        a = top
        s.box((-hx + 1.3, -hy + 1.3, a), (hx - 1.3, hy - 1.3, a + 3.6), tint, PAVED, strip="ashlar", paved=True)
        s.box((-hx + 0.9, -hy + 0.9, a + 3.6), (hx - 0.9, hy - 0.9, a + 4.1), TRIM, top=PAVED, bottom=True, paved=True)
        s.box((-hx + 3.0, -hy + 3.0, a + 4.1), (hx - 3.0, hy - 3.0, a + 7.2), mul(tint, 0.92), PAVED, strip="ashlar", paved=True)
        s.box((-hx + 2.7, -hy + 2.7, a + 7.2), (hx - 2.7, hy - 2.7, a + 7.6), TRIM, bottom=True)
        s.box((-hx + 4.6, -hy + 4.6, a + 7.6), (hx - 4.6, hy - 4.6, a + 10.4), tint, TRIM, strip="ashlar")
        s.box((-hx + 5.9, -hy + 5.9, a + 10.4), (hx - 5.9, hy - 5.9, a + 12.6), mul(tint, 0.9), ZINC)
        if near:
            for sx in (-1, 1):
                for sy in (-1, 1):  # a pylon of stone on each corner of the first two steps
                    s.box((sx * (hx - 1.8) - 0.5, sy * (hy - 1.8) - 0.5, a + 4.1), (sx * (hx - 1.8) + 0.5, sy * (hy - 1.8) + 0.5, a + 5.9), TRIM)
                    s.box((sx * (hx - 3.4) - 0.4, sy * (hy - 3.4) - 0.4, a + 7.6), (sx * (hx - 3.4) + 0.4, sy * (hy - 3.4) + 0.4, a + 9.0), TRIM)
            for side in "SN":
                s.panel(side, hx - 1.3, hy - 1.3, -2.6, 2.6, a + 0.7, a + 2.9, GLASS, 0.05)
        s.o = (0.0, 0.0)
        return a + 7.2
    # the mansard: a steep slate slope, a pale zinc ledge at its break, then a low roof hipped up to a ridge (never a flat lid)
    mh = 4.8 if roof == "mansard" else 7.4
    inset = 1.5 if roof == "mansard" else 3.2
    s.mansard(hx + 0.1, hy + 0.1, top, inset + 0.1, mh, drawn=not near)
    rz = top + mh
    if near:
        s.box((-hx + inset - 0.3, -hy + inset - 0.3, rz - 0.12), (hx - inset + 0.3, hy - inset + 0.3, rz + 0.14), ZINC_B, bottom=True)
        rz += 0.14
    cx, cy = hx, hy  # half sizes of the roof the chimneys stand on
    ridge = max(0.2, 0.34 * (min(hx, hy) - (4.0 if tiers == 2 else inset)))
    if tiers == 1:
        s.hip(hx - inset, hy - inset, rz, rz + ridge, SLATE if slate_top else WHITE, strip="slate" if slate_top else "zinc")
    if tiers == 2:  # a second, flatter tier with its own small dormers
        s.frustum(hx - inset, hy - inset, rz, hx - 4.0, hy - 4.0, rz + 2.6, SLATE, ZINC, strip="slate")
        s.hip(hx - 4.0, hy - 4.0, rz + 2.6, rz + 2.6 + ridge, WHITE, strip="zinc")
        if near:
            m = max(2, int(hx * 2 / 6.0))
            for i in range(m):
                x = -hx + 4.5 + (2 * hx - 9.0) * i / (m - 1)
                for sy in (-1, 1):
                    s.box((x - 0.55, sy * (hy - 2.75) - 0.55, rz + 0.3), (x + 0.55, sy * (hy - 2.75) + 0.55, rz + 1.7), DORMER, ZINC_B)
        rz += 2.6
        cx, cy = hx - 2.5, hy - 2.5
    if near:
        dormers(s, hx, hy, top, inset, mh, h=2.6 if roof == "mansard" else 3.2)
    if roof == "pavilion" and not chimneys:
        # an end pavilion's outer end: the same gable wall of flues, through the steep end slope
        for sx, side in ((-1, "W"), (1, "E")):
            if side in sides:
                x0, x1 = sorted((sx * (hx + 0.1), sx * (hx - 1.1)))
                s.box((x0, -hy * 0.4, top), (x1, hy * 0.4, rz + ridge), STACK, top=TRIM)
                if near:
                    s.box((x0, -hy * 0.75, top), (x1, hy * 0.75, top + mh * 0.55), STACK, top=TRIM)
    if roof == "mansard" and tiers == 1 and "E" in sides and "W" in sides:
        # the party walls at the two ends: a gable wall of chimney flues rising through the end slope, stepped (the Paris
        # mur pignon), so the roof's end against the sky is stone in steps and never the slope's ruled edge
        for sx in (-1, 1):
            x0, x1 = sorted((sx * (hx + 0.1), sx * (hx - 1.1)))
            s.box((x0, -hy * 0.42, top), (x1, hy * 0.42, rz + ridge + 1.5), STACK, top=TRIM)
            if near:
                s.box((x0, -hy * 0.8, top), (x1, hy * 0.8, top + mh * 0.6), STACK, top=TRIM)
                s.box((sx * (hx - 0.5) - 0.22, -hy * 0.3, rz + ridge + 1.5), (sx * (hx - 0.5) + 0.22, hy * 0.3, rz + ridge + 2.2), POT)
    if roof == "pavilion":  # tall stacks at the ends of the ridge
        if chimneys:
            for sx in (-1, 1):
                s.box((sx * (hx - inset - 0.2) - 0.7, -1.6, rz - 1.0), (sx * (hx - inset - 0.2) + 0.7, 1.6, rz + ridge + 2.6), STACK, top=TRIM, foot=0.8)
    else:
        chimney_stacks(s, lod, cx, cy, rz, ridge, chimneys, seed)
    s.o = (0.0, 0.0)
    return rz


def haussmann_a(lod):
    s = Shell()
    # a long front between two end pavilions a storey taller, under steep pavilion roofs
    block(s, lod, 14.3, 8.0, 6, slate_top=True, seed=11)
    for sx in (-1, 1):  # (the side against the long front is never seen)
        block(s, lod, 3.9, 8.5, 7, at=(sx * 18.1, 0.0), roof="pavilion", chimneys=0, seed=11, sides="SNE" if sx > 0 else "SNW")
    return s


def haussmann_corner(lod):
    s = Shell()
    block(s, lod, 19.0, 8.5, 6, at=(-3.0, 0.0), seed=12)
    c = (16.0, 0.0)
    seg = 12 if lod == 0 else 8
    z = 0.0
    for k, (strip, h) in enumerate([("ground", GROUND_FLOOR)] + [("balcony" if f in (2, 5) else "floor", STOREY) for f in range(1, 6)]):
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p0 = (c[0] + 6.2 * math.cos(a0), c[1] + 6.2 * math.sin(a0))
            p1 = (c[0] + 6.2 * math.cos(a1), c[1] + 6.2 * math.sin(a1))
            if lod == 0 and k > 0 and i % 2 == 0:
                g0, g1 = strip_v("slot")
                c = (0.8, 0.8, 0.8)
                s.face([(p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + h - 0.8), (p0[0], p0[1], z + h - 0.8)], c, None,
                       [(40 / SIZE, g0), (120 / SIZE, g0), (120 / SIZE, g1), (40 / SIZE, g1)])
                s.wall(p0, p1, z + h - 0.8, z + h, "ashlar", WALL_B)
            elif lod == 0:
                s.wall(p0, p1, z, z + h, "ashlar", WALL, foot=0.5 if k == 0 else None)
            else:
                s.wall(p0, p1, z, z + h, strip, WALL, bays=1, foot=0.5 if k == 0 else None)
        if lod == 0 and k in (0, 2, 5):  # the string course and the balconies run round the rotunda
            s.cylinder(c, 6.55, z + h - 0.3, z + h, mul(TRIM, 0.95), seg, top=TRIM)
        z += h
    s.cylinder(c, 6.7, z - 0.1, z + 0.4, TRIM, seg)
    s.dome(c, 6.4, z + 0.4, 6.0, SLATE, seg, 4 if lod == 0 else 2, strip="slate")
    s.cylinder(c, 0.9, z + 6.2, z + 7.9, ZINC, 6)
    s.cylinder(c, 0.9, z + 7.9, z + 9.3, GILT, 6, r1=0.45)
    return s


def haussmann_step(lod):
    s = Shell()
    block(s, lod, 12.0, 8.0, 8, at=(-9.0, 0.0), chimneys=2, slate_top=True, seed=13)
    block(s, lod, 9.0, 7.0, 5, at=(12.0, -1.0), chimneys=2, tint=WALL_B, seed=14)
    return s


def haussmann_low(lod):
    s = Shell()
    block(s, lod, 17.0, 7.5, 4, roof="terrace", tint=WALL_B, seed=15)
    return s


def haussmann_tall(lod):
    s = Shell()
    block(s, lod, 20.0, 9.0, 8, chimneys=4, tiers=2, attic=True, seed=16)
    return s


def tower_house(lod):
    """A slender house of twelve storeys under a stepped crown of stone: it stands a head above its row."""
    s = Shell()
    block(s, lod, 9.0, 8.2, 11, roof="crown", tint=WALL_B, seed=17)
    return s


def deco_block(lod):
    """An Art Deco apartment mass of twelve storeys: a plinth, piers and glazing, three setbacks with parapets (A2)."""
    s = Shell()
    rnd = random.Random(17)
    hx, hy = 15.0, 8.5
    s.box((-hx - 0.4, -hy - 0.4, 0.0), (hx + 0.4, hy + 0.4, 4.0), DECO_B, strip="ashlar", foot=0.6)
    steps = [(hx, hy, 4.0, 23.0), (hx - 3.2, hy - 1.8, 23.0, 31.5), (hx - 7.0, hy - 3.6, 31.5, 38.0)]
    for k, (x, y, z0, z1) in enumerate(steps):
        tint = DECO if k < 2 else DECO_B
        if lod == 0:
            deco_mass(s, x, y, z0, z1 - 0.8, rnd, tint)
        else:
            s.box((-x, -y, z0), (x, y, z1), tint, PAVED, strip="ashlar", paved=True)
            slots(s, x, y, z0 + 1.2, z1 - 1.6, sides="SNEW", margin=1.1)
        s.box((-x - 0.35, -y - 0.35, z1 - 0.8), (x + 0.35, y + 0.35, z1 + 0.5), TRIM, top=PAVED, bottom=True, paved=True)
        if lod == 0 and k < 2:  # the terrace of a setback: a stone pylon on each corner, shafts and skylights along its long sides
            for sx in (-1, 1):
                for sy in (-1, 1):
                    s.box((sx * (x - 0.9) - 0.7, sy * (y - 0.9) - 0.7, z1 + 0.5), (sx * (x - 0.9) + 0.7, sy * (y - 0.9) + 0.7, z1 + 2.4), TRIM, ZINC)
            nx, ny = steps[k + 1][0], steps[k + 1][1]
            s.clutter(rnd, (-x + 2.0, -y + 0.3), (x - 2.0, -ny - 0.3), z1 + 0.5, 3)
            s.clutter(rnd, (-x + 2.0, ny + 0.3), (x - 2.0, y - 0.3), z1 + 0.5, 3)
            s.clutter(rnd, (-x + 0.3, -ny), (-nx - 0.3, ny), z1 + 0.5, 2)
            s.clutter(rnd, (nx + 0.3, -ny), (x - 0.3, ny), z1 + 0.5, 2)
    # the crown: three more steps of stone, each narrower, the last a blunt lantern block (a ziggurat, no point)
    s.box((-5.6, -3.6, 38.5), (5.6, 3.6, 40.4), DECO, PAVED, strip="ashlar", paved=True)
    s.box((-3.8, -2.5, 40.4), (3.8, 2.5, 42.0), DECO_B, TRIM, strip="ashlar")
    s.box((-2.0, -1.4, 42.0), (2.0, 1.4, 43.2), TRIM, ZINC)
    s.water_tower((steps[1][0] - 2.2, 0.0), 32.0, r=1.5, h=2.6)
    return s


def haussmann_short(lod):
    s = Shell()
    block(s, lod, 10.2, 8.0, 5, roof="pavilion", slate_top=True, seed=18)
    return s


def deco_hall(lod):
    s = Shell()
    rnd = random.Random(19)
    hx, hy = 32.0, 10.0
    near = lod == 0
    s.box((-hx - 0.6, -hy - 0.6, 0.0), (hx + 0.6, hy + 0.6, 3.2), DECO_B, strip="ashlar", foot=0.6)
    if near:
        deco_mass(s, hx, hy, 3.2, 21.0, rnd, DECO, tier=8.9)
    else:
        s.box((-hx, -hy, 3.2), (hx, hy, 21.0), DECO, strip="ashlar")
        slots(s, hx, hy, 5.0, 19.2, sides="SNEW", margin=1.6)
    s.box((-hx - 0.5, -hy - 0.5, 21.0), (hx + 0.5, hy + 0.5, 21.9), TRIM, top=PAVED, bottom=True, paved=True)
    s.box((-hx + 2.0, -hy + 2.0, 21.9), (hx - 2.0, hy - 2.0, 25.2), DECO, PAVED, strip="ashlar", paved=True)
    for sx in (-1, 1):  # each wing's roof: a glazed gallery roof, a garden terrace at its end, a water tank
        s.hip(8.0, 3.2, 25.2, 27.6, SKYLIGHT, c=(sx * 20.0, 0.0))
        if near:
            s.garden((sx * 29.4 - 0.2 * sx - 2.4, -hy + 2.6), (sx * 29.4 - 0.2 * sx + 2.4, hy - 2.6), 25.2)
            s.water_tower((sx * 14.5, sx * 5.2), 25.2)
            lo, hi = sorted((sx * 11.5, sx * 26.0))
            s.clutter(rnd, (lo, -hy + 2.4), (hi, -3.6), 25.2, 3)
            s.clutter(rnd, (lo, 3.6), (hi, hy - 2.4), 25.2, 3)
    # the taller pavilion in the middle, stepped twice
    if near:
        s.box((-10.0, -12.0, 0.0), (10.0, 12.0, 28.0), DECO, strip="ashlar", foot=0.6, walls="EW")
        for p0, p1 in (((-10.0, -12.0), (10.0, -12.0)), ((10.0, 12.0), (-10.0, 12.0))):
            deco_side(s, p0, p1, 0.0, 28.0, rnd, DECO, fin=0.9, width=1.2, pitch=3.6, tier=14.0)
    else:
        s.box((-10.0, -12.0, 0.0), (10.0, 12.0, 28.0), DECO, strip="ashlar", foot=0.6)
        slots(s, 10.0, 12.0, 4.0, 26.0, sides="SN", margin=1.4)
    s.box((-10.5, -12.5, 28.0), (10.5, 12.5, 29.0), TRIM, top=PAVED, bottom=True, paved=True)
    s.box((-8.0, -10.0, 29.0), (8.0, 10.0, 33.5), DECO, PAVED, strip="ashlar", paved=True)
    s.box((-5.5, -7.5, 33.5), (5.5, 7.5, 36.5), DECO_B, PAVED, strip="ashlar", paved=True)
    s.box((-3.4, -5.0, 36.5), (3.4, 5.0, 38.3), DECO, ZINC, strip="ashlar")
    if near:
        for sx in (-1, 1):  # gilt figures on pedestals at the ends of the plinth (A2)
            s.box((sx * 30.0 - 0.6, -hy - 2.2, 0.0), (sx * 30.0 + 0.6, -hy - 1.0, 4.2), DECO_B)
            s.box((sx * 30.0 - 0.3, -hy - 1.9, 4.2), (sx * 30.0 + 0.3, -hy - 1.3, 6.6), GILT)
    return s


def deco_tower(lod):
    s = Shell()
    rnd = random.Random(20)
    steps = [(15.0, 0.0, 22.0), (11.0, 22.0, 40.0), (7.5, 40.0, 54.0), (4.5, 54.0, 61.0)]
    for h, z0, z1 in steps:
        tint = DECO if z0 < 50 else DECO_B
        if lod == 0:
            deco_mass(s, h, h, z0, z1 - 0.9, rnd, tint, tier=9.0 if z0 == 0.0 else 7.4)
        else:
            s.box((-h, -h, z0), (h, h, z1), tint, PAVED, strip="ashlar", foot=0.6 if z0 == 0.0 else None, paved=True)
            slots(s, h, h, z0 + 2.5, z1 - 2.0, sides="SNEW", margin=1.2)
        s.box((-h - 0.4, -h - 0.4, z1 - 0.9), (h + 0.4, h + 0.4, z1 + 0.02), TRIM, top=PAVED, bottom=True, paved=True)
        if z1 < 60:  # the terrace of each setback: pylons at its corners, on the near model a parapet garden on two sides
            for sx in (-1, 1):
                for sy in (-1, 1):
                    s.box((sx * (h - 1.0) - 0.9, sy * (h - 1.0) - 0.9, z1), (sx * (h - 1.0) + 0.9, sy * (h - 1.0) + 0.9, z1 + 3.4), TRIM, ZINC)
            if lod == 0 and z1 < 30:
                s.garden((-h + 2.4, -h + 0.5), (h - 2.4, -h + 3.0), z1)
                s.garden((-h + 2.4, h - 3.0), (h - 2.4, h - 0.5), z1)
                s.water_tower((h - 2.6, 0.0), z1, r=1.5, h=2.8)
    # the lantern: glazed between stone ribs, under a stepped cap of stone and a short gilt point
    s.cylinder((0.0, 0.0), 2.6, 61.0, 66.0, TRIM, 8, alt=GLASS)
    s.cylinder((0.0, 0.0), 3.0, 66.0, 66.7, TRIM, 8)
    s.cylinder((0.0, 0.0), 2.3, 66.7, 69.2, SPIRE, 8, r1=0.9, alt=SPIRE_B)
    s.cylinder((0.0, 0.0), 0.9, 69.2, 71.0, GILT, 6, r1=0.55)
    return s


def dome(lod):
    s = Shell()
    h = 17.0
    if lod == 0:
        top = order_box(s, h, h, 0.0, [(5.2, 1.0), (10.8, 0.0)], random.Random(21), WALL, foot=0.6, pitch=6.4, width=3.6, depth=0.8)
    else:
        top = s.storeys(h, h, 0.0, [("ground", 5.2), ("balcony", 5.4), ("floor", 5.4)], WALL, foot=0.6)
    s.box((-h - 0.5, -h - 0.5, top), (h + 0.5, h + 0.5, top + 1.0), TRIM, top=PAVED, bottom=True, paved=True)
    s.box((-h + 1.5, -h + 1.5, top + 1.0), (h - 1.5, h - 1.5, top + 3.0), WALL_B, PAVED, strip="ashlar", paved=True)
    if lod == 0:
        s.ring(h + 0.25, h + 0.25, 4.9, 5.25, mul(TRIM, 0.95), top=TRIM)
        s.ring(h + 0.25, h + 0.25, top - 0.4, top, mul(TRIM, 0.72))
        for i in range(6):  # portico
            s.cylinder((-7.5 + 3.0 * i, -h - 2.2), 0.6, 3.0, 13.5, TRIM, 6)
        s.box((-9.5, -h - 3.2, 13.5), (9.5, -h, 14.8), TRIM, bottom=True)
        s.face([(-9.5, -h - 3.2, 14.8), (9.5, -h - 3.2, 14.8), (0.0, -h - 3.2, 18.4)], TRIM)
        s.slope([(9.5, -h - 3.2, 14.8), (9.5, -h, 14.8), (0.0, -h, 18.4), (0.0, -h - 3.2, 18.4)], SLATE)
        s.slope([(-9.5, -h, 14.8), (-9.5, -h - 3.2, 14.8), (0.0, -h - 3.2, 18.4), (0.0, -h, 18.4)], SLATE)
        s.box((-9.5, -h - 3.2, 0.0), (9.5, -h, 3.0), BASE, strip="ashlar")
        for sx in (-1, 1):
            for sy in (-1, 1):  # a stone lantern on each corner of the attic
                s.box((sx * (h - 2.6) - 1.0, sy * (h - 2.6) - 1.0, top + 3.0), (sx * (h - 2.6) + 1.0, sy * (h - 2.6) + 1.0, top + 5.6), TRIM, ZINC)
    seg = 16 if lod == 0 else 10
    s.cylinder((0.0, 0.0), 10.0, 19.0, 29.0, TRIM, seg, alt=GLASS if lod == 0 else K.srgb("#6E675A"))
    s.cylinder((0.0, 0.0), 10.6, 29.0, 30.0, TRIM, seg)
    s.dome((0.0, 0.0), 10.2, 30.0, 12.5, LEAD, seg, 5 if lod == 0 else 3, alt=GILT)
    s.cylinder((0.0, 0.0), 2.2, 41.6, 46.5, TRIM, 8, alt=GLASS)
    s.cylinder((0.0, 0.0), 2.5, 46.5, 49.0, LEAD, 8, r1=0.9)
    s.cylinder((0.0, 0.0), 0.9, 49.0, 50.6, GILT, 6, r1=0.6)  # a gilt ball where a needle would stand: the dome ends blunt
    return s


def belfry(lod):
    s = Shell()
    roof = block(s, lod, 15.0, 9.0, 5, at=(5.0, 0.0), chimneys=2, seed=22)
    t = 4.2
    c = (-13.5, 0.0)
    s.o = c
    if lod == 0:
        # the shaft, then the bell stage: four corner piers round a dark chamber, then the clock stage
        s.box((-t, -t, 0.0), (t, t, 23.2), WALL, strip="ashlar", foot=0.5)
        s.box((-t + 0.9, -t + 0.9, 23.2), (t - 0.9, t - 0.9, 29.2), GLASS)
        for sx in (-1, 1):
            for sy in (-1, 1):
                s.box((sx * (t - 0.75) - 0.75, sy * (t - 0.75) - 0.75, 23.2), (sx * (t - 0.75) + 0.75, sy * (t - 0.75) + 0.75, 29.2), WALL, strip="ashlar")
        for nx, ny in ((0, -1), (0, 1), (1, 0), (-1, 0)):  # a stone mullion in the middle of each opening
            xs = sorted((nx * (t - 0.6), nx * t)) if nx else (-0.35, 0.35)
            ys = sorted((ny * (t - 0.6), ny * t)) if ny else (-0.35, 0.35)
            s.box((xs[0], ys[0], 23.2), (xs[1], ys[1], 29.2), WALL_B)
        s.box((-t - 0.3, -t - 0.3, 22.7), (t + 0.3, t + 0.3, 23.2), TRIM, bottom=True)
        s.box((-t, -t, 29.2), (t, t, 36.0), WALL, strip="ashlar")
        s.box((-t - 0.3, -t - 0.3, 29.0), (t + 0.3, t + 0.3, 29.5), TRIM, bottom=True)
    else:
        s.box((-t, -t, 0.0), (t, t, 36.0), WALL, strip="ashlar", foot=0.5)
    s.box((-t - 0.4, -t - 0.4, roof - 0.5), (t + 0.4, t + 0.4, roof), TRIM, bottom=True)
    s.box((-t - 0.6, -t - 0.6, 36.0), (t + 0.6, t + 0.6, 37.0), TRIM, bottom=True)
    for side in "SNEW":
        s.panel(side, t, t, -1.5, 1.5, 30.2, 33.2, TRIM, 0.1)  # clock face
        s.panel(side, t, t, -1.15, 1.15, 30.55, 32.85, RAIL, 0.16)
        if lod == 1:
            s.panel(side, t, t, -1.0, 1.0, 24.0, 28.6, GLASS, 0.3)  # belfry opening
        if lod == 0:
            for z in (7.0, 11.5, 16.0, 20.0):
                s.panel(side, t, t, -0.5, 0.5, z, z + 2.2, GLASS, 0.08)
    # a spire of dressed stone between four pinnacles, a short gilt point
    s.frustum(t - 0.4, t - 0.4, 37.0, 0.45, 0.45, 48.3, SPIRE, SPIRE_B)
    if lod == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                s.frustum(0.75, 0.75, 37.0, 0.0, 0.0, 41.2, SPIRE_B, c=(sx * (t - 0.2), sy * (t - 0.2)))
    s.cylinder((0.0, 0.0), 0.4, 48.3, 50.5, GILT, 6, r1=0.0)
    s.o = (0.0, 0.0)
    return s


CITY = city_material()
objects = []
for make in (haussmann_a, haussmann_corner, haussmann_step, haussmann_low, haussmann_tall, haussmann_short, tower_house, deco_block, deco_hall, deco_tower, dome, belfry):
    for lod in (0, 1):
        objects.append(finished(make(lod), f"{make.__name__}_lod{lod}", CITY, 3400 if lod == 0 else 560))
bpy.context.view_layer.update()
K.export(OUT, objects)
