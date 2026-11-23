"""The background city: public/assets/city.glb.

    node <game3d>/scripts/blender.mjs art/blender/gen_city.py -- --out public/assets/city.glb

Ten buildings after the reference photos (A1: the Haussmann fronts and the dome of the Invalides beyond the bridge;
A2: the Art Deco mass of the Palais de Chaillot), each as <name>_lod0 (near ring, windows as single faces, dormers,
chimneys) and <name>_lod1 (far: masses, roofs and one dark band per floor):
  haussmann_a       apartment block: ashlar front, six floors of regular windows, two balcony lines, cornice,
                    slate mansard with dormers, chimney walls with pots
  haussmann_corner  the same with a rotunda and a small dome on the corner
  haussmann_step    a taller block with a lower wing: stepped roofline
  haussmann_low     four storeys, a shorter front, dormers far apart
  haussmann_tall    seven storeys under a two-tier mansard with two rows of dormers
  haussmann_court   a front block with two wings round a court
  deco_hall         long Art Deco hall: plinth, tall window slots between piers, stepped attic, taller pavilion
  deco_tower        Art Deco tower with three setbacks and a lantern
  dome              domed building: square base, portico, drum, ribbed dome, lantern and spire
  belfry            block with a tall clock tower under a slate pyramid
The colours are per face in COLOR_0 (limestone, slate, zinc, dark glass, dull gilt), already darker and greyer than
the play area, over one small grey tiling texture made here (courses of stone with their joints and rain streaks;
on the roofs the same courses at half the size read as slates). Walls darken in a streak under the eaves.
The game draws the buildings as one batch, tints and scales each one, and hangs the same ones upside down as the
mirrored city. Origin: ground centre of the footprint; +X is the long side.
"""
import math
import os
import sys

import bpy
import bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fc_kit as K  # noqa: E402
from city_kit import *  # noqa: E402,F401,F403  (the palette, Shell, slots, city_material, finished)

opts = K.script_args()
OUT = opts.get("out", "public/assets/city.glb")
K.reset()

def block(s, lod, hx, hy, floors, at=(0.0, 0.0), z0=0.0, chimneys=3, dormers=True, dormer_step=4.2, tiers=1):
    """A Haussmann block: ground floor, upper floors, balcony lines, cornice, mansard; returns the roof height."""
    s.o = at
    gh, fh = 4.6, 3.1
    top = z0 + gh + (floors - 1) * fh
    s.box((-hx, -hy, z0), (hx, hy, z0 + gh), BASE, foot=0.62 if z0 == 0.0 else None)
    s.box((-hx, -hy, z0 + gh), (hx, hy, top), WALL)
    s.box((-hx - 0.25, -hy - 0.25, z0 + gh - 0.15), (hx + 0.25, hy + 0.25, z0 + gh + 0.2), TRIM, bottom=True)
    s.box((-hx - 0.55, -hy - 0.55, top - 0.1), (hx + 0.55, hy + 0.55, top + 0.4), TRIM, bottom=True)
    for z in (z0 + gh + fh, top - fh):  # the two balcony lines: a slab and a dark rail
        s.box((-hx - 0.6, -hy - 0.6, z - 0.18), (hx + 0.6, hy + 0.6, z), WALL_B, bottom=True)
        s.band(hx, hy, z, z + 0.85, RAIL, 0.6, margin=0.0)
    s.streak(hx, hy, top - 0.1, WALL, depth=2.2 if lod == 0 else 3.0)
    if lod == 0:
        s.windows(hx, hy, z0 + 0.5, 0.2, 3.2, 3.3)
        for f in range(1, floors):
            s.windows(hx, hy, z0 + gh + (f - 1) * fh + 0.75, 0.34, 1.25, 2.05)
    else:
        for f in range(1, floors):
            z = z0 + gh + (f - 1) * fh + 0.9
            s.band(hx, hy, z, z + 1.7, GLASS, 0.3, margin=1.6)
        s.band(hx, hy, z0 + 0.6, z0 + 3.6, GLASS, 0.3, margin=2.0)
    # the mansard: a steep slate slope, then a low zinc roof hipped up to a ridge (never a flat lid: from above, and that is
    # how the folded city shows most of its roofs, a ridge and four planes catch the light differently)
    mh = 4.2
    s.frustum(hx + 0.1, hy + 0.1, top + 0.4, hx - 1.7, hy - 1.7, top + 0.4 + mh, SLATE, ZINC)
    roof = top + 0.4 + mh
    cx, cy = hx, hy  # half sizes of the roof the chimneys stand on
    ridge = 0.34 * (min(hx, hy) - (4.2 if tiers == 2 else 1.7))
    if tiers == 1:
        s.hip(hx - 1.7, hy - 1.7, roof, roof + ridge, ZINC)
    if tiers == 2:  # a second, flatter tier with its own small dormers
        s.frustum(hx - 1.7, hy - 1.7, roof, hx - 4.2, hy - 4.2, roof + 2.6, SLATE, ZINC)
        s.hip(hx - 4.2, hy - 4.2, roof + 2.6, roof + 2.6 + ridge, ZINC)
        if lod == 0:
            for i in range(max(2, int(hx * 2 / 7.0))):
                x = -hx + 4.5 + (2 * hx - 9.0) * i / max(int(hx * 2 / 7.0) - 1, 1)
                for sy in (-1, 1):
                    s.box((x - 0.5, sy * (hy - 2.9) - 0.5, roof + 0.3), (x + 0.5, sy * (hy - 2.9) + 0.5, roof + 1.6), TRIM, ZINC)
        roof += 2.6
        cx, cy = hx - 2.5, hy - 2.5
    if lod == 0 and dormers:
        n = max(2, int(hx * 2 / dormer_step))
        for i in range(n):
            x = -hx + 2.2 + (2 * hx - 4.4) * i / max(n - 1, 1)
            for sy in (-1, 1):
                y = sy * (hy - 0.55)
                s.box((x - 0.75, y - 0.6, top + 0.9), (x + 0.75, y + 0.6, top + 2.9), TRIM, ZINC)
                u0, u1 = sorted(((x - 0.45) * -sy, (x + 0.45) * -sy))  # along the wall as seen from outside
                s.panel("S" if sy < 0 else "N", 0.0, 0.0, u0, u1, top + 1.2, top + 2.6, GLASS, hy + 0.1)
    for i in range(chimneys):
        x = -cx + 2.5 + (2 * cx - 5.0) * (i + 0.5) / chimneys
        # the chimney wall runs across the roof and stands clear of the ridge
        s.box((x - 0.45, -cy + 2.6, roof - 0.3), (x + 0.45, cy - 2.6, roof + ridge + 1.3), BRICK)
        if lod == 0:
            for k in range(4):
                y = -cy + 3.2 + (2 * cy - 6.4) * k / 3
                s.box((x - 0.22, y - 0.22, roof + ridge + 1.3), (x + 0.22, y + 0.22, roof + ridge + 2.1), TANK)
    s.o = (0.0, 0.0)
    return roof


def haussmann_a(lod):
    s = Shell()
    block(s, lod, 22.0, 8.0, 6)
    return s


def haussmann_corner(lod):
    s = Shell()
    roof = block(s, lod, 19.0, 8.5, 6, at=(-3.0, 0.0))
    c = (16.0, 0.0)
    seg = 14 if lod == 0 else 8
    s.cylinder(c, 6.2, 0.0, 4.6, BASE, seg)
    s.cylinder(c, 6.2, 4.6, roof - 4.2, WALL, seg, alt=WALL_B if lod == 0 else None)
    s.cylinder(c, 6.7, roof - 4.6, roof - 4.1, TRIM, seg)
    if lod == 0:
        for f in range(5):
            for i in range(seg):
                if i % 2:
                    continue
                a = 2 * math.pi * (i + 0.5) / seg
                r = 6.2 * math.cos(math.pi / seg) + 0.08
                t = (-math.sin(a), math.cos(a))
                m = (c[0] + r * math.cos(a), c[1] + r * math.sin(a))
                z = 5.35 + f * 3.1
                s.face([(m[0] - t[0] * 0.6, m[1] - t[1] * 0.6, z), (m[0] + t[0] * 0.6, m[1] + t[1] * 0.6, z),
                        (m[0] + t[0] * 0.6, m[1] + t[1] * 0.6, z + 2.05), (m[0] - t[0] * 0.6, m[1] - t[1] * 0.6, z + 2.05)], GLASS)
    s.dome(c, 6.4, roof - 4.1, 6.0, SLATE, seg, 4 if lod == 0 else 2)
    s.cylinder(c, 0.9, roof + 1.7, roof + 3.4, ZINC, 6)
    s.cylinder(c, 0.9, roof + 3.4, roof + 6.2, GILT, 6, r1=0.0)
    return s


def haussmann_step(lod):
    s = Shell()
    block(s, lod, 12.0, 8.0, 8, at=(-9.0, 0.0), chimneys=2)
    block(s, lod, 9.0, 7.0, 5, at=(12.0, -1.0), chimneys=2)
    return s


def haussmann_low(lod):
    s = Shell()
    block(s, lod, 17.0, 7.5, 4, chimneys=2, dormer_step=6.6)
    return s


def haussmann_tall(lod):
    s = Shell()
    block(s, lod, 20.0, 9.0, 7, chimneys=4, tiers=2)
    return s


def haussmann_court(lod):
    s = Shell()
    block(s, lod, 21.0, 6.5, 6, at=(0.0, -9.0), chimneys=3)
    block(s, lod, 6.0, 9.5, 5, at=(-15.0, 6.0), chimneys=1, dormer_step=5.0)
    block(s, lod, 6.0, 9.5, 5, at=(15.0, 6.0), chimneys=1, dormer_step=5.0)
    return s


def deco_hall(lod):
    s = Shell()
    hx, hy = 32.0, 10.0
    s.box((-hx - 0.6, -hy - 0.6, 0.0), (hx + 0.6, hy + 0.6, 3.2), DECO_B)
    s.box((-hx, -hy, 3.2), (hx, hy, 21.0), DECO)
    s.box((-hx - 0.5, -hy - 0.5, 21.0), (hx + 0.5, hy + 0.5, 21.9), TRIM, bottom=True)
    s.box((-hx + 2.0, -hy + 2.0, 21.9), (hx - 2.0, hy - 2.0, 25.2), DECO, ZINC)
    for sx in (-1, 1):  # each wing's roof: a glazed gallery roof, a garden terrace at its end, a water tank
        s.hip(8.0, 3.2, 25.2, 27.6, SKYLIGHT, c=(sx * 20.0, 0.0))
        if lod == 0:
            s.garden((sx * 29.4 - 0.2 * sx - 2.4, -hy + 2.6), (sx * 29.4 - 0.2 * sx + 2.4, hy - 2.6), 25.2)
            s.water_tower((sx * 14.5, sx * 5.2), 25.2)
    slots(s, hx, hy, 5.0, 19.2, 3.6 if lod == 0 else 7.2, 1.7 if lod == 0 else 3.4, proud=0.1 if lod == 0 else 0.3)
    slots(s, hx, hy, 5.0, 19.2, 4.5, 1.9, sides="EW", proud=0.1 if lod == 0 else 0.3)
    # the taller pavilion in the middle, stepped twice
    s.box((-10.0, -12.0, 0.0), (10.0, 12.0, 28.0), DECO)
    s.box((-10.5, -12.5, 28.0), (10.5, 12.5, 29.0), TRIM, bottom=True)
    s.box((-8.0, -10.0, 29.0), (8.0, 10.0, 33.5), DECO)
    s.box((-5.5, -7.5, 33.5), (5.5, 7.5, 36.5), DECO_B, ZINC)
    s.hip(4.6, 6.6, 36.5, 38.3, SKYLIGHT)
    s.o = (0.0, 0.0)
    slots(s, 10.0, 12.0, 4.0, 26.0, 3.3, 1.5, sides="SN", proud=0.1 if lod == 0 else 0.3, margin=1.4)
    if lod == 0:
        for sx in (-1, 1):  # gilt figures on pedestals at the ends of the plinth (A2)
            s.box((sx * 30.0 - 0.6, -hy - 2.2, 0.0), (sx * 30.0 + 0.6, -hy - 1.0, 4.2), DECO_B)
            s.box((sx * 30.0 - 0.3, -hy - 1.9, 4.2), (sx * 30.0 + 0.3, -hy - 1.3, 6.6), GILT)
    return s


def deco_tower(lod):
    s = Shell()
    steps = [(15.0, 0.0, 22.0), (11.0, 22.0, 40.0), (7.5, 40.0, 54.0), (4.5, 54.0, 61.0)]
    for h, z0, z1 in steps:
        s.box((-h, -h, z0), (h, h, z1), DECO if z0 < 50 else DECO_B, ZINC)
        s.box((-h - 0.4, -h - 0.4, z1 - 0.9), (h + 0.4, h + 0.4, z1), TRIM, bottom=True)
        slots(s, h, h, z0 + 2.5, z1 - 2.0, 3.0 if lod == 0 else 6.0, 1.3 if lod == 0 else 2.6, sides="SNEW",
              proud=0.1 if lod == 0 else 0.3, margin=1.2)
        if z1 < 60:  # the terrace of each setback: pylons at its corners, on the near model a parapet garden on two sides
            for sx in (-1, 1):
                for sy in (-1, 1):
                    s.box((sx * (h - 1.0) - 0.9, sy * (h - 1.0) - 0.9, z1), (sx * (h - 1.0) + 0.9, sy * (h - 1.0) + 0.9, z1 + 3.4), TRIM, ZINC)
            if lod == 0 and z1 < 30:
                s.garden((-h + 2.4, -h + 0.5), (h - 2.4, -h + 3.0), z1)
                s.garden((-h + 2.4, h - 3.0), (h - 2.4, h - 0.5), z1)
                s.water_tower((h - 2.6, 0.0), z1, r=1.5, h=2.8)
    s.cylinder((0.0, 0.0), 2.6, 61.0, 66.0, TRIM, 8, alt=GLASS)
    s.cylinder((0.0, 0.0), 2.9, 66.0, 71.0, GILT, 8, r1=0.0)
    return s


def dome(lod):
    s = Shell()
    h = 17.0
    s.box((-h, -h, 0.0), (h, h, 3.0), BASE)
    s.box((-h, -h, 3.0), (h, h, 16.0), WALL)
    s.box((-h - 0.5, -h - 0.5, 16.0), (h + 0.5, h + 0.5, 17.0), TRIM, bottom=True)
    s.box((-h + 1.5, -h + 1.5, 17.0), (h - 1.5, h - 1.5, 19.0), WALL_B, ZINC)
    if lod == 0:
        s.windows(h, h, 4.2, 0.26, 1.5, 3.4)
        s.windows(h, h, 9.8, 0.26, 1.5, 4.2)
        for i in range(6):  # portico
            s.cylinder((-7.5 + 3.0 * i, -h - 2.2), 0.6, 3.0, 13.5, TRIM, 6)
        s.box((-9.5, -h - 3.2, 13.5), (9.5, -h, 14.8), TRIM, bottom=True)
        s.face([(-9.5, -h - 3.2, 14.8), (9.5, -h - 3.2, 14.8), (0.0, -h - 3.2, 18.4)], WALL)
        s.face([(9.5, -h - 3.2, 14.8), (9.5, -h, 14.8), (0.0, -h, 18.4), (0.0, -h - 3.2, 18.4)], SLATE)
        s.face([(-9.5, -h, 14.8), (-9.5, -h - 3.2, 14.8), (0.0, -h - 3.2, 18.4), (0.0, -h, 18.4)], SLATE)
        s.box((-9.5, -h - 3.2, 0.0), (9.5, -h, 3.0), BASE)
    else:
        s.band(h, h, 4.4, 7.6, GLASS, 0.3, margin=2.0)
        s.band(h, h, 10.0, 14.0, GLASS, 0.3, margin=2.0)
    seg = 16 if lod == 0 else 10
    s.cylinder((0.0, 0.0), 10.0, 19.0, 29.0, WALL, seg, alt=GLASS if lod == 0 else WALL_B)
    s.cylinder((0.0, 0.0), 10.6, 29.0, 30.0, TRIM, seg)
    s.dome((0.0, 0.0), 10.2, 30.0, 12.5, LEAD, seg, 5 if lod == 0 else 3, alt=GILT)
    s.cylinder((0.0, 0.0), 2.2, 41.6, 46.5, TRIM, 8, alt=GLASS)
    s.cylinder((0.0, 0.0), 2.5, 46.5, 49.0, LEAD, 8, r1=0.9)
    s.cylinder((0.0, 0.0), 0.9, 49.0, 58.0, GILT, 6, r1=0.0)
    return s


def belfry(lod):
    s = Shell()
    roof = block(s, lod, 15.0, 9.0, 5, at=(5.0, 0.0), chimneys=2)
    t = 4.2
    c = (-13.5, 0.0)
    s.o = c
    s.box((-t, -t, 0.0), (t, t, 4.6), BASE)
    s.box((-t, -t, 4.6), (t, t, 36.0), WALL)
    s.box((-t - 0.4, -t - 0.4, roof - 0.5), (t + 0.4, t + 0.4, roof), TRIM, bottom=True)
    s.box((-t - 0.6, -t - 0.6, 36.0), (t + 0.6, t + 0.6, 37.0), TRIM, bottom=True)
    for side in "SNEW":
        s.panel(side, t, t, -1.5, 1.5, 30.2, 33.2, TRIM, 0.1)  # clock face
        s.panel(side, t, t, -1.15, 1.15, 30.55, 32.85, RAIL, 0.16)
        s.panel(side, t, t, -1.0, 1.0, 24.0, 28.6, GLASS, 0.1 if lod == 0 else 0.3)  # belfry opening
        if lod == 0:
            for z in (7.0, 11.5, 16.0, 20.0):
                s.panel(side, t, t, -0.5, 0.5, z, z + 2.2, GLASS, 0.08)
    s.frustum(t + 0.3, t + 0.3, 37.0, 1.2, 1.2, 46.0, SLATE, ZINC)
    s.cylinder((0.0, 0.0), 0.7, 46.0, 50.5, GILT, 6, r1=0.0)
    s.o = (0.0, 0.0)
    return s


CITY = city_material()
objects = []
for make in (haussmann_a, haussmann_corner, haussmann_step, haussmann_low, haussmann_tall, haussmann_court, deco_hall, deco_tower, dome,
             belfry):
    for lod in (0, 1):
        objects.append(finished(make(lod), f"{make.__name__}_lod{lod}", CITY, 2600 if lod == 0 else 560))
bpy.context.view_layer.update()
K.export(OUT, objects)
